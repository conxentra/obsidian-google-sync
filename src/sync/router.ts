import { GoogleSyncSettings } from "../settings-data";
import { GoogleCalendarClient, WriteEventOptions } from "../google/calendar";
import { GoogleTasksClient } from "../google/tasks";
import { detectKind, isManagedSubpath, validateEvent, validateTask } from "./frontmatter";
import { eventToGoogle, taskToGoogle } from "./mapper";
import { linkToBasename } from "./lifecycle-plan";
import { VaultPort } from "../vault/port";
import { EventFrontmatter, GoogleEvent, NoteKind } from "../types";

function isPullOnly(fm: Record<string, unknown>): boolean {
    return fm.syncDirection === "pull-only" || fm.googleSyncDirection === "pull-only";
}

function noteName(path: string): string {
    return path.split("/").pop() ?? path;
}

/**
 * Pushes vault note edits to Google as updates (PATCH) — and nothing else. Sync is
 * one-way for existence: notes never create Google objects (only an import links a note
 * to an existing item via `googleId`) and never delete them. A note without a `googleId`
 * is simply local-only. No `obsidian` import — runs in the plugin and headless.
 */
export class SyncRouter {
    constructor(
        private readonly port: VaultPort,
        private readonly calendar: GoogleCalendarClient,
        private readonly tasks: GoogleTasksClient,
        private readonly settings: () => GoogleSyncSettings,
        private readonly notify: (msg: string) => void = () => {},
        /** Called when the router writes a key back into a note (e.g. meetLink), so the
         * caller can suppress the resulting modify event from echoing back into sync. */
        private readonly onTouch: (path: string) => void = () => {},
    ) {}

    /** The note kind to sync for this path, or null if it should be ignored. */
    syncKind(path: string): NoteKind | null {
        const s = this.settings();
        if (isManagedSubpath(path, s.eventsFolder, s.tasksFolder)) return null;
        return detectKind(path, s.eventsFolder, s.tasksFolder);
    }

    async syncPath(path: string): Promise<void> {
        const kind = this.syncKind(path);
        if (!kind) return;
        const fm = await this.port.readFrontmatter(path);
        if (isPullOnly(fm)) return;
        if (kind === "event") await this.syncEvent(path, fm);
        else await this.syncTask(path, fm);
    }

    private async syncEvent(path: string, fm: Record<string, unknown>): Promise<void> {
        const v = validateEvent(fm);
        if (!v.ok || !v.value) {
            this.notify(`google-sync: ${noteName(path)}: ${v.errors.join("; ")}`);
            return;
        }
        // One-way: notes without a googleId stay local until an import links them.
        if (!v.value.googleId) return;
        const s = this.settings();
        const calendarId = v.value.calendarId || s.defaultCalendarId;
        const body = eventToGoogle(v.value, s.defaultTimezone);
        const opts = this.eventWriteOptions(v.value, body);
        const patched = await this.calendar.patchEvent(calendarId, v.value.googleId, body, opts);
        await this.writeMeetLinkBack(path, v.value, patched);
    }

    /**
     * Derive patch query params from the event, and — when the note asks for a
     * Google Meet link it doesn't have yet — attach a conferenceData create request.
     */
    private eventWriteOptions(value: EventFrontmatter, body: GoogleEvent): WriteEventOptions {
        const opts: WriteEventOptions = {};
        const wantsMeet = value.conferencing === true || value.conferencing === "hangoutsMeet";
        if (wantsMeet && !value.meetLink) {
            body.conferenceData = {
                createRequest: {
                    requestId: crypto.randomUUID(),
                    conferenceSolutionKey: { type: "hangoutsMeet" },
                },
            };
            opts.conferenceDataVersion = 1;
        } else if (value.meetLink || value.conferencing) {
            // Ask Google to round-trip existing conference data on update.
            opts.conferenceDataVersion = 1;
        }
        if (Array.isArray(body.attachments) && body.attachments.length) {
            opts.supportsAttachments = true;
        }
        return opts;
    }

    /** Persist a newly minted Meet link back into the note (managed, read-only). */
    private async writeMeetLinkBack(
        path: string,
        value: EventFrontmatter,
        result: GoogleEvent,
    ): Promise<void> {
        const link =
            result.hangoutLink ??
            result.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
        if (!link || value.meetLink === link) return;
        await this.port.writeFrontmatterKey(path, "meetLink", link);
        this.onTouch(path);
    }

    private async syncTask(path: string, fm: Record<string, unknown>): Promise<void> {
        const v = validateTask(fm);
        if (!v.ok || !v.value) {
            this.notify(`google-sync: ${noteName(path)}: ${v.errors.join("; ")}`);
            return;
        }
        // One-way: notes without a googleId stay local until an import links them.
        if (!v.value.googleId) return;
        const s = this.settings();
        const taskListId = v.value.tasklist || s.taskListId;
        if (!taskListId) {
            this.notify("google-sync: set a task list ID in settings before syncing tasks.");
            return;
        }
        const body = taskToGoogle(v.value, s.defaultTimezone);
        const parentId = await this.resolveParentGoogleId(v.value.parent);
        await this.tasks.patchTask(taskListId, v.value.googleId, body);
        // parent can't be changed via patch — move handles (re)nesting.
        if (parentId) await this.tasks.moveTask(taskListId, v.value.googleId, { parent: parentId });
    }

    /**
     * Resolve a task note's `parent` wikilink/basename to the parent task's Google id,
     * so it can be nested as a subtask. Returns undefined when there's no parent, the
     * link doesn't resolve to a task note, or the parent isn't linked to Google yet.
     */
    private async resolveParentGoogleId(parent: unknown): Promise<string | undefined> {
        if (typeof parent !== "string" || parent.trim() === "") return undefined;
        const target = linkToBasename(parent);
        if (!target) return undefined;
        const s = this.settings();
        for (const ref of await this.port.listMarkdown([s.tasksFolder])) {
            if (ref.basename !== target) continue;
            const gid: unknown = (await this.port.readFrontmatter(ref.path)).googleId;
            if (typeof gid === "string" && gid) return gid;
        }
        return undefined;
    }

    /**
     * Sync every event/task note in scope. One failing note doesn't abort the rest — errors
     * are isolated and counted so a single bad note or transient Google error is survivable.
     */
    async syncAll(): Promise<{ synced: number; failed: number }> {
        let synced = 0;
        let failed = 0;
        const s = this.settings();
        for (const ref of await this.port.listMarkdown([s.eventsFolder, s.tasksFolder])) {
            if (!this.syncKind(ref.path)) continue;
            try {
                await this.syncPath(ref.path);
                synced++;
            } catch (e) {
                failed++;
                this.notify(`google-sync: ${noteName(ref.path)}: ${(e as Error).message}`);
            }
        }
        return { synced, failed };
    }
}
