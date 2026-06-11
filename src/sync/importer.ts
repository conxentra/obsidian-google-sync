import { GoogleCalendarClient } from "../google/calendar";
import { GoogleTasksClient } from "../google/tasks";
import { GoogleSyncSettings } from "../settings-data";
import { GoogleEvent, GoogleTask } from "../types";
import { VaultPort } from "../vault/port";
import { basenameOf, normalizeVaultPath } from "../vault/paths";
import { mergeManagedFrontmatter, remoteEventToNote, remoteTaskToNote } from "./mapper";
import { isEventAllowed } from "./recurrence";

export interface ImportCounts {
    events: number;
    tasks: number;
    failed: number;
}

export interface ImportOptions {
    /** Create missing notes only. Existing googleId matches are left untouched. */
    createOnly?: boolean;
}

function slugify(value: string, maxLength: number): string {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, maxLength);
    return slug.replace(/-+$/g, "") || "untitled";
}

function basePathFor(
    folder: string,
    id: string | undefined,
    title: string | undefined,
    fallback: string,
): string {
    const titlePart = slugify(title || fallback, 50);
    const idPart = id ? slugify(id, 80) : "new";
    return normalizeVaultPath(`${folder}/${titlePart}-${idPart}.md`);
}

async function unusedPath(port: VaultPort, preferredPath: string): Promise<string> {
    const normalized = normalizeVaultPath(preferredPath);
    if (!(await port.exists(normalized))) return normalized;

    const dot = normalized.lastIndexOf(".");
    const stem = dot === -1 ? normalized : normalized.slice(0, dot);
    const ext = dot === -1 ? "" : normalized.slice(dot);
    for (let i = 2; i < 1000; i++) {
        const candidate = `${stem}-${i}${ext}`;
        if (!(await port.exists(candidate))) return candidate;
    }
    throw new Error(`Could not find an unused import path for ${normalized}`);
}

async function pathFor(
    port: VaultPort,
    folder: string,
    id: string | undefined,
    title: string | undefined,
    fallback: string,
): Promise<string> {
    return unusedPath(port, basePathFor(folder, id, title, fallback));
}

async function findByGoogleId(
    port: VaultPort,
    folder: string,
    googleId: string | undefined,
): Promise<string | null> {
    if (!googleId) return null;
    for (const ref of await port.listMarkdown([folder])) {
        const fm = await port.readFrontmatter(ref.path);
        if (fm.googleId === googleId) return ref.path;
    }
    return null;
}

export class GoogleImporter {
    constructor(
        private readonly port: VaultPort,
        private readonly calendar: GoogleCalendarClient,
        private readonly tasks: GoogleTasksClient,
        private readonly settings: () => GoogleSyncSettings,
        /** Called with each note path the importer creates or rewrites, so the caller can
         * suppress the resulting vault events from echoing back into sync. */
        private readonly onTouch: (path: string) => void = () => {},
    ) {}

    async importAll(options: ImportOptions = {}): Promise<ImportCounts> {
        const counts: ImportCounts = { events: 0, tasks: 0, failed: 0 };
        // Events and tasks are imported independently: a failure in one phase must not
        // abort the other, nor prevent the caller from running the lifecycle afterwards.
        try {
            await this.importEvents(counts, options);
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] event import failed", e);
        }
        try {
            await this.importTasks(counts, options);
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] task import failed", e);
        }
        return counts;
    }

    /** Bounded RFC3339 time window so recurring events aren't expanded across all of history. */
    private eventWindow(): { timeMin: string; timeMax: string } {
        const s = this.settings();
        const dayMs = 24 * 60 * 60 * 1000;
        const now = Date.now();
        return {
            timeMin: new Date(now - Math.max(0, s.importPastDays) * dayMs).toISOString(),
            timeMax: new Date(now + Math.max(0, s.importFutureDays) * dayMs).toISOString(),
        };
    }

    private async importEvents(counts: ImportCounts, options: ImportOptions): Promise<void> {
        const calendarIds = await this.calendarIds();
        const window = this.eventWindow();
        for (const calendarId of calendarIds) {
            const { items } = await this.calendar.listEvents(calendarId, window);
            for (const event of items) await this.upsertEvent(calendarId, event, counts, options);
        }
    }

    private async calendarIds(): Promise<string[]> {
        const s = this.settings();
        if (s.importOnlyDefaultCalendar) return [s.defaultCalendarId];
        const calendars = await this.calendar.listCalendars();
        const ids = calendars.map((c) => c.id).filter((id): id is string => !!id);
        if (!ids.includes(s.defaultCalendarId)) ids.unshift(s.defaultCalendarId);
        return Array.from(new Set(ids));
    }

    private async upsertEvent(
        calendarId: string,
        event: GoogleEvent,
        counts: ImportCounts,
        options: ImportOptions,
    ): Promise<void> {
        try {
            if (event.status === "cancelled") return;
            const s = this.settings();
            if (!isEventAllowed(event, s.recurringEventFilterMode, s.recurringEventFilters)) return;
            const fm = remoteEventToNote(event, calendarId);
            const existing = await findByGoogleId(this.port, s.eventsFolder, event.id);
            if (existing) {
                if (options.createOnly) return;
                const merged = mergeManagedFrontmatter(
                    await this.port.readFrontmatter(existing),
                    fm,
                    "event",
                );
                await this.port.writeFrontmatter(existing, merged);
                this.onTouch(existing);
            } else {
                const path = await pathFor(
                    this.port,
                    s.eventsFolder,
                    event.id,
                    event.summary,
                    "event",
                );
                await this.port.upsertMarkdown(path, fm);
                this.onTouch(path);
            }
            counts.events++;
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] failed to import event", event.id, e);
        }
    }

    private async importTasks(counts: ImportCounts, options: ImportOptions): Promise<void> {
        const taskListIds = await this.taskListIds();
        for (const taskListId of taskListIds) {
            const tasks = await this.tasks.listTasks(taskListId);
            // Google lists subtasks after their parent (position order), so a map of
            // already-seen id -> note basename lets a subtask link back to its parent.
            const basenameById = new Map<string, string>();
            for (const task of tasks) {
                const parentBasename = task.parent ? basenameById.get(task.parent) : undefined;
                const basename = await this.upsertTask(
                    taskListId,
                    task,
                    counts,
                    options,
                    parentBasename,
                );
                if (task.id && basename) basenameById.set(task.id, basename);
            }
        }
    }

    private async taskListIds(): Promise<string[]> {
        const s = this.settings();
        if (s.importOnlyDefaultTaskList) return [s.taskListId];
        const lists = await this.tasks.listTaskLists();
        const ids = lists.map((l) => l.id).filter((id): id is string => !!id);
        if (s.taskListId && !ids.includes(s.taskListId)) ids.unshift(s.taskListId);
        return Array.from(new Set(ids));
    }

    /** Returns the note basename (without extension) so subtasks can link to it. */
    private async upsertTask(
        taskListId: string,
        task: GoogleTask,
        counts: ImportCounts,
        options: ImportOptions,
        parentBasename?: string,
    ): Promise<string | undefined> {
        try {
            const fm = remoteTaskToNote(task, taskListId, parentBasename);
            const existing = await findByGoogleId(this.port, this.settings().tasksFolder, task.id);
            if (existing) {
                if (options.createOnly) return basenameOf(existing);
                const merged = mergeManagedFrontmatter(
                    await this.port.readFrontmatter(existing),
                    fm,
                    "task",
                );
                await this.port.writeFrontmatter(existing, merged);
                this.onTouch(existing);
                counts.tasks++;
                return basenameOf(existing);
            }
            const path = await pathFor(
                this.port,
                this.settings().tasksFolder,
                task.id,
                task.title,
                "task",
            );
            await this.port.upsertMarkdown(path, fm);
            this.onTouch(path);
            counts.tasks++;
            return basenameOf(path);
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] failed to import task", task.id, e);
            return undefined;
        }
    }
}
