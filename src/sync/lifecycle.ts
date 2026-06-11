import { DateTime } from "luxon";
import { GoogleSyncSettings } from "../settings-data";
import { GoogleTasksClient } from "../google/tasks";
import { VaultPort } from "../vault/port";
import { normalizeVaultPath } from "../vault/paths";
import { detectKind, isManagedSubpath } from "./frontmatter";
import { LifecycleNote, planLifecycle } from "./lifecycle-plan";

export interface LifecycleCounts {
    archived: number;
    overdue: number;
    completed: number;
}

/**
 * Executes the lifecycle plan against the vault (file moves) + closes linked Google tasks.
 * No `obsidian` import — runs in the plugin and headless.
 */
export class Lifecycle {
    constructor(
        private readonly port: VaultPort,
        private readonly tasks: GoogleTasksClient,
        private readonly settings: () => GoogleSyncSettings,
        private readonly notify: (msg: string) => void = () => {},
    ) {}

    async runOnce(): Promise<LifecycleCounts> {
        const s = this.settings();
        const notes: LifecycleNote[] = [];
        for (const ref of await this.port.listMarkdown([s.eventsFolder, s.tasksFolder])) {
            if (isManagedSubpath(ref.path, s.eventsFolder, s.tasksFolder)) continue;
            const kind = detectKind(ref.path, s.eventsFolder, s.tasksFolder);
            if (!kind) continue;
            notes.push({
                path: ref.path,
                basename: ref.basename,
                kind,
                fm: await this.port.readFrontmatter(ref.path),
            });
        }

        const actions = planLifecycle(notes, s, DateTime.now());
        const counts: LifecycleCounts = { archived: 0, overdue: 0, completed: 0 };

        for (const action of actions) {
            // Each action is isolated: one failing move (e.g. a stale plan entry or a
            // filesystem error) must not abort the remaining moves.
            try {
                if (!(await this.port.exists(action.path))) continue;
                if (action.type === "archive" && action.closeTasks.length && s.taskListId) {
                    for (const basename of action.closeTasks)
                        await this.closeLinkedTask(basename, s);
                }
                await this.port.move(action.path, await this.unusedDestination(action.newPath));
                if (action.type === "archive") counts.archived++;
                else if (action.type === "overdue") counts.overdue++;
                else counts.completed++;
            } catch (e) {
                console.error("[google-sync] lifecycle move failed for", action.path, e);
            }
        }
        return counts;
    }

    /** Suffix the destination (-2, -3, …) when a note with the same name is already filed. */
    private async unusedDestination(preferred: string): Promise<string> {
        const normalized = normalizeVaultPath(preferred);
        if (!(await this.port.exists(normalized))) return normalized;
        const dot = normalized.lastIndexOf(".");
        const stem = dot === -1 ? normalized : normalized.slice(0, dot);
        const ext = dot === -1 ? "" : normalized.slice(dot);
        for (let i = 2; i < 1000; i++) {
            const candidate = `${stem}-${i}${ext}`;
            if (!(await this.port.exists(candidate))) return candidate;
        }
        throw new Error(`No unused lifecycle destination for ${normalized}`);
    }

    private async closeLinkedTask(basename: string, s: GoogleSyncSettings): Promise<void> {
        for (const ref of await this.port.listMarkdown([s.tasksFolder])) {
            if (ref.basename !== basename) continue;
            if (detectKind(ref.path, s.eventsFolder, s.tasksFolder) !== "task") continue;
            const fm = await this.port.readFrontmatter(ref.path);
            const gid = fm.googleId;
            if (typeof gid === "string" && gid) {
                try {
                    await this.tasks.patchTask(s.taskListId, gid, { status: "completed" });
                } catch (e) {
                    this.notify(
                        `google-sync: could not close task ${basename}: ${(e as Error).message}`,
                    );
                }
            }
        }
    }
}
