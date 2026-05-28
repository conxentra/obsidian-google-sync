import { Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, GoogleSyncSettings, GoogleSyncSettingTab } from "./settings";
import { HttpFn } from "./google/http";
import { obsidianHttp } from "./google/transport";
import { DEFAULT_SCOPES, GoogleAuth, OAuthConfig, TokenSet, TokenStore } from "./google/auth";
import { GoogleCalendarClient } from "./google/calendar";
import { GoogleTasksClient } from "./google/tasks";
import { SyncRouter } from "./sync/router";
import { registerCommands } from "./commands";

interface PersistedData {
    settings: GoogleSyncSettings;
    tokens: TokenSet | null;
}

const DEBOUNCE_MS = 750;

/**
 * Google Calendar/Tasks sync. Obsidian -> Google, desktop + iOS. main.ts only wires
 * lifecycle + services; logic lives in src/google and src/sync.
 */
export default class GoogleSyncPlugin extends Plugin {
    settings: GoogleSyncSettings = { ...DEFAULT_SETTINGS };
    private tokens: TokenSet | null = null;
    private auth!: GoogleAuth;
    private calendar!: GoogleCalendarClient;
    private router!: SyncRouter;
    private timers = new Map<string, number>();

    async onload(): Promise<void> {
        await this.loadAll();

        // Late-bound transport so e2e can inject a mock after load.
        const http: HttpFn = (req) => {
            const injected = (window as unknown as { __gsyncHttp?: HttpFn }).__gsyncHttp;
            return (typeof injected === "function" ? injected : obsidianHttp)(req);
        };

        this.auth = new GoogleAuth(http, () => this.oauthConfig(), this.tokenStore());
        const tokenProvider = () => this.auth.getAccessToken();
        this.calendar = new GoogleCalendarClient(http, tokenProvider);
        const tasks = new GoogleTasksClient(http, tokenProvider);
        this.router = new SyncRouter(this.app, this.calendar, tasks, () => this.settings);

        this.addSettingTab(new GoogleSyncSettingTab(this.app, this));
        registerCommands(this);
        this.registerObsidianProtocolHandler(
            "google-sync",
            (params) => void this.onOAuthCallback(params),
        );
        this.registerVaultEvents();
        this.app.workspace.onLayoutReady(() => this.router.buildIndex());
    }

    onunload(): void {
        for (const id of this.timers.values()) window.clearTimeout(id);
        this.timers.clear();
    }

    // ---- persistence (settings + tokens together in data.json) ----

    private async loadAll(): Promise<void> {
        const data = (await this.loadData()) as Partial<PersistedData> | null;
        this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
        this.tokens = data?.tokens ?? null;
    }

    private async saveAll(): Promise<void> {
        const data: PersistedData = { settings: this.settings, tokens: this.tokens };
        await this.saveData(data);
    }

    async saveSettings(): Promise<void> {
        await this.saveAll();
    }

    private tokenStore(): TokenStore {
        return {
            load: async () => this.tokens,
            save: async (t) => {
                this.tokens = t;
                await this.saveAll();
            },
        };
    }

    private oauthConfig(): OAuthConfig {
        return {
            clientId: this.settings.clientId,
            clientSecret: this.settings.clientSecret,
            redirectUri: this.settings.redirectUri,
            scopes: DEFAULT_SCOPES,
        };
    }

    // ---- public API used by settings tab + commands ----

    async connect(): Promise<void> {
        if (!this.settings.clientId || !this.settings.redirectUri) {
            new Notice("Set the OAuth client ID and redirect URL in settings first.");
            return;
        }
        const { url } = await this.auth.beginAuth();
        window.open(url, "_blank");
        new Notice("Continue in your browser, then return to Obsidian.");
    }

    async disconnect(): Promise<void> {
        await this.auth.signOut();
        new Notice("Disconnected from Google.");
    }

    isConnected(): Promise<boolean> {
        return this.auth.isConnected();
    }

    async testConnection(): Promise<string> {
        try {
            await this.auth.getAccessToken();
            const cals = await this.calendar.listCalendars();
            return `Connection OK — ${cals.length} calendar(s) visible.`;
        } catch (e) {
            return `Connection failed: ${(e as Error).message}`;
        }
    }

    async syncNow(): Promise<void> {
        if (!(await this.auth.isConnected())) {
            new Notice("Connect to Google first.");
            return;
        }
        try {
            const n = await this.router.syncAll();
            new Notice(`google-sync: synced ${n} note(s).`);
        } catch (e) {
            new Notice(`google-sync error: ${(e as Error).message}`);
        }
    }

    /** Guarded e2e hook: seed a fake token so sync runs against the mock transport. */
    async e2eSeedToken(): Promise<void> {
        if (!(window as unknown as { __gsyncE2E?: boolean }).__gsyncE2E) return;
        this.tokens = {
            accessToken: "e2e-token",
            refreshToken: "e2e-refresh",
            expiresAt: Date.now() + 3600_000,
        };
        await this.saveAll();
        this.router.buildIndex();
    }

    // ---- internals ----

    private async onOAuthCallback(params: Record<string, string>): Promise<void> {
        if (params.error) {
            new Notice(`Google auth failed: ${params.error}`);
            return;
        }
        if (!params.code || !params.state) return;
        try {
            await this.auth.completeAuth(params.code, params.state);
            this.router.buildIndex();
            new Notice("Connected to Google.");
        } catch (e) {
            new Notice(`Google auth failed: ${(e as Error).message}`);
        }
    }

    private registerVaultEvents(): void {
        this.registerEvent(
            this.app.vault.on("create", (f) => {
                if (f instanceof TFile && this.settings.syncOnCreate) this.debounceSync(f);
            }),
        );
        this.registerEvent(
            this.app.vault.on("modify", (f) => {
                if (f instanceof TFile && this.settings.syncOnModify) this.debounceSync(f);
            }),
        );
        this.registerEvent(
            this.app.vault.on("delete", (f) => {
                if (f instanceof TFile && this.settings.syncOnDelete) void this.safeDelete(f.path);
            }),
        );
        this.registerEvent(
            this.app.vault.on("rename", (f, oldPath) => {
                if (f instanceof TFile) void this.safeRename(f, oldPath);
            }),
        );
    }

    private debounceSync(file: TFile): void {
        if (!this.router.syncKind(file.path)) return;
        const prev = this.timers.get(file.path);
        if (prev) window.clearTimeout(prev);
        const id = window.setTimeout(() => {
            this.timers.delete(file.path);
            void this.safeSync(file);
        }, DEBOUNCE_MS);
        this.timers.set(file.path, id);
    }

    private async safeSync(file: TFile): Promise<void> {
        if (!this.router.syncKind(file.path)) return;
        if (!(await this.auth.isConnected())) return;
        try {
            await this.router.syncFile(file);
        } catch (e) {
            new Notice(`google-sync: ${(e as Error).message}`);
        }
    }

    private async safeDelete(path: string): Promise<void> {
        if (!(await this.auth.isConnected())) return;
        try {
            await this.router.handleDelete(path);
        } catch (e) {
            new Notice(`google-sync: ${(e as Error).message}`);
        }
    }

    private async safeRename(file: TFile, oldPath: string): Promise<void> {
        if (!(await this.auth.isConnected())) return;
        try {
            await this.router.handleRename(file, oldPath);
        } catch (e) {
            new Notice(`google-sync: ${(e as Error).message}`);
        }
    }
}
