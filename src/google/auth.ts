import { HttpFn, RetryOptions, withRetry } from "./http";
import { GoogleApiError } from "./api";

/**
 * Google OAuth 2.0 Authorization Code + PKCE. Cross-platform (desktop + iOS): the consent
 * redirect lands on a user-hosted bridge page that forwards code+state to
 * obsidian://google-sync, which calls completeAuth(). All network goes through an injectable
 * HttpFn (requestUrl in production); crypto uses Web Crypto (available in Node + Electron).
 * No `obsidian` import, so this module is unit-testable.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
export const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
export const DEFAULT_SCOPES = [CALENDAR_SCOPE, TASKS_SCOPE];

export interface OAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string; // the bridge https URL registered with Google
    scopes: string[];
}

export interface TokenSet {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number; // epoch ms
    scope?: string;
    tokenType?: string;
}

export interface TokenStore {
    load(): Promise<TokenSet | null>;
    save(tokens: TokenSet | null): Promise<void>;
}

// ---- PKCE helpers ----

function base64url(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64url(bytes); // 43 url-safe chars
}

export function generateState(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return base64url(bytes);
}

export async function codeChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64url(new Uint8Array(digest));
}

export async function buildAuthUrl(
    config: OAuthConfig,
    verifier: string,
    state: string,
): Promise<string> {
    const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: config.scopes.join(" "),
        code_challenge: await codeChallenge(verifier),
        code_challenge_method: "S256",
        state,
        access_type: "offline",
        prompt: "consent",
    });
    return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
}

function toTokenSet(json: unknown, nowMs: number, fallbackRefresh?: string): TokenSet {
    const j = (json ?? {}) as TokenResponse;
    return {
        accessToken: j.access_token,
        refreshToken: j.refresh_token ?? fallbackRefresh,
        expiresAt: nowMs + (j.expires_in ?? 3600) * 1000,
        scope: j.scope,
        tokenType: j.token_type,
    };
}

async function postToken(
    http: HttpFn,
    params: Record<string, string>,
    retry: RetryOptions,
): Promise<unknown> {
    const res = await withRetry(
        () =>
            http({
                url: TOKEN_URL,
                method: "POST",
                contentType: "application/x-www-form-urlencoded",
                body: new URLSearchParams(params).toString(),
            }),
        retry,
    );
    if (res.status < 200 || res.status >= 300) {
        throw new GoogleApiError(
            res.status,
            `token endpoint -> ${res.status}`,
            res.json ?? res.text,
        );
    }
    return res.json;
}

export async function exchangeCode(
    http: HttpFn,
    config: OAuthConfig,
    code: string,
    verifier: string,
    now: () => number = Date.now,
    retry: RetryOptions = {},
): Promise<TokenSet> {
    const json = await postToken(
        http,
        {
            grant_type: "authorization_code",
            code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: config.redirectUri,
            code_verifier: verifier,
        },
        retry,
    );
    return toTokenSet(json, now());
}

export async function refreshAccessToken(
    http: HttpFn,
    config: OAuthConfig,
    refreshToken: string,
    now: () => number = Date.now,
    retry: RetryOptions = {},
): Promise<TokenSet> {
    const json = await postToken(
        http,
        {
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: config.clientId,
            client_secret: config.clientSecret,
        },
        retry,
    );
    return toTokenSet(json, now(), refreshToken);
}

/** Seconds of slack before expiry at which we proactively refresh. */
const EXPIRY_SKEW_MS = 60_000;

/** Stateful OAuth manager: drives the auth handshake and hands out fresh access tokens. */
export class GoogleAuth {
    private pending?: { verifier: string; state: string };

    constructor(
        private readonly http: HttpFn,
        private readonly config: () => OAuthConfig,
        private readonly store: TokenStore,
        private readonly now: () => number = Date.now,
        private readonly retry: RetryOptions = {},
    ) {}

    /** Build the consent URL and remember the PKCE verifier + state for completion. */
    async beginAuth(): Promise<{ url: string; state: string }> {
        const verifier = generateCodeVerifier();
        const state = generateState();
        this.pending = { verifier, state };
        const url = await buildAuthUrl(this.config(), verifier, state);
        return { url, state };
    }

    /** Called by the obsidian:// handler. Verifies state, exchanges code, persists tokens. */
    async completeAuth(code: string, state: string): Promise<void> {
        if (!this.pending) throw new Error("No auth in progress");
        if (state !== this.pending.state) throw new Error("OAuth state mismatch");
        const tokens = await exchangeCode(
            this.http,
            this.config(),
            code,
            this.pending.verifier,
            this.now,
            this.retry,
        );
        this.pending = undefined;
        await this.store.save(tokens);
    }

    async isConnected(): Promise<boolean> {
        const t = await this.store.load();
        return !!t?.refreshToken || (!!t && t.expiresAt > this.now());
    }

    async signOut(): Promise<void> {
        this.pending = undefined;
        await this.store.save(null);
    }

    /** Return a valid access token, refreshing when expired. Throws if not connected. */
    async getAccessToken(): Promise<string> {
        const tokens = await this.store.load();
        if (!tokens) throw new Error("Not connected to Google");
        if (tokens.expiresAt - EXPIRY_SKEW_MS > this.now()) return tokens.accessToken;
        if (!tokens.refreshToken) {
            await this.store.save(null);
            throw new Error("Google session expired — reconnect via Connect to Google.");
        }
        let refreshed: TokenSet;
        try {
            refreshed = await refreshAccessToken(
                this.http,
                this.config(),
                tokens.refreshToken,
                this.now,
                this.retry,
            );
        } catch (e) {
            // A revoked/expired refresh token won't recover — clear it and ask to reconnect.
            await this.store.save(null);
            throw new Error(
                `Google session expired — reconnect via Connect to Google. (${(e as Error).message})`,
            );
        }
        await this.store.save(refreshed);
        return refreshed.accessToken;
    }
}
