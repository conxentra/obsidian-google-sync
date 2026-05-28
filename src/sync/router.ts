import { App, Notice, TFile } from "obsidian";
import { GoogleSyncSettings } from "../settings";
import { GoogleCalendarClient } from "../google/calendar";
import { GoogleTasksClient } from "../google/tasks";
import { detectKind, isManagedSubpath, validateEvent, validateTask } from "./frontmatter";
import { eventToGoogle, taskToGoogle } from "./mapper";
import { readFrontmatter, writeFrontmatterKey } from "../io";
import { NoteKind } from "../types";

interface RemoteRef {
    kind: NoteKind;
    googleId: string;
    container: string; // calendarId for events, taskListId for tasks
}

/**
 * Turns vault changes into Google Calendar/Tasks operations. Holds a path -> remote-id
 * index (rebuilt from frontmatter on load) so deletes can target the right Google object
 * after the note is gone.
 */
export class SyncRouter {
    private index = new Map<string, RemoteRef>();

    constructor(
        private readonly app: App,
        private readonly calendar: GoogleCalendarClient,
        private readonly tasks: GoogleTasksClient,
        private readonly settings: () => GoogleSyncSettings,
        private readonly notify: (msg: string) => void = (m) => {
            new Notice(m);
        },
    ) {}

    /** The note kind to sync for this path, or null if it should be ignored. */
    syncKind(path: string): NoteKind | null {
        const s = this.settings();
        if (isManagedSubpath(path, s.eventsFolder, s.tasksFolder)) return null;
        return detectKind(path, s.eventsFolder, s.tasksFolder);
    }

    /** Rebuild the path -> remote-id index from frontmatter (fast: uses metadataCache). */
    buildIndex(): void {
        this.index.clear();
        const s = this.settings();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const kind = this.syncKind(file.path);
            if (!kind) continue;
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            const googleId: unknown = fm?.googleId;
            if (typeof googleId !== "string" || !googleId) continue;
            const container =
                kind === "event" ? (fm?.calendarId as string) || s.defaultCalendarId : s.taskListId;
            this.index.set(file.path, { kind, googleId, container });
        }
    }

    async syncFile(file: TFile): Promise<void> {
        const kind = this.syncKind(file.path);
        if (!kind) return;
        const fm = await readFrontmatter(this.app, file);
        if (kind === "event") await this.syncEvent(file, fm);
        else await this.syncTask(file, fm);
    }

    private async syncEvent(file: TFile, fm: Record<string, unknown>): Promise<void> {
        const v = validateEvent(fm);
        if (!v.ok || !v.value) {
            this.notify(`google-sync: ${file.name}: ${v.errors.join("; ")}`);
            return;
        }
        const s = this.settings();
        const calendarId = v.value.calendarId || s.defaultCalendarId;
        const body = eventToGoogle(v.value, s.defaultTimezone);
        if (v.value.googleId) {
            await this.calendar.patchEvent(calendarId, v.value.googleId, body);
            this.index.set(file.path, {
                kind: "event",
                googleId: v.value.googleId,
                container: calendarId,
            });
        } else {
            const created = await this.calendar.insertEvent(calendarId, body);
            if (created.id) {
                await writeFrontmatterKey(this.app, file, "googleId", created.id);
                this.index.set(file.path, {
                    kind: "event",
                    googleId: created.id,
                    container: calendarId,
                });
            }
        }
    }

    private async syncTask(file: TFile, fm: Record<string, unknown>): Promise<void> {
        const v = validateTask(fm);
        if (!v.ok || !v.value) {
            this.notify(`google-sync: ${file.name}: ${v.errors.join("; ")}`);
            return;
        }
        const s = this.settings();
        if (!s.taskListId) {
            this.notify("google-sync: set a task list ID in settings before syncing tasks.");
            return;
        }
        const body = taskToGoogle(v.value, s.defaultTimezone);
        if (v.value.googleId) {
            await this.tasks.patchTask(s.taskListId, v.value.googleId, body);
            this.index.set(file.path, {
                kind: "task",
                googleId: v.value.googleId,
                container: s.taskListId,
            });
        } else {
            const created = await this.tasks.insertTask(s.taskListId, body);
            if (created.id) {
                await writeFrontmatterKey(this.app, file, "googleId", created.id);
                this.index.set(file.path, {
                    kind: "task",
                    googleId: created.id,
                    container: s.taskListId,
                });
            }
        }
    }

    /** Delete the Google object for a (now-removed) note path, if we know its id. */
    async handleDelete(path: string): Promise<void> {
        const ref = this.index.get(path);
        if (!ref) return;
        if (ref.kind === "event") await this.calendar.deleteEvent(ref.container, ref.googleId);
        else await this.tasks.deleteTask(ref.container, ref.googleId);
        this.index.delete(path);
    }

    /** Track a rename so a later delete still resolves, then re-sync the new path. */
    async handleRename(file: TFile, oldPath: string): Promise<void> {
        const ref = this.index.get(oldPath);
        if (ref) {
            this.index.delete(oldPath);
            this.index.set(file.path, ref);
        }
        await this.syncFile(file);
    }

    /** Sync every event/task note in scope. Returns the number processed. */
    async syncAll(): Promise<number> {
        let count = 0;
        for (const file of this.app.vault.getMarkdownFiles()) {
            if (!this.syncKind(file.path)) continue;
            await this.syncFile(file);
            count++;
        }
        return count;
    }
}
