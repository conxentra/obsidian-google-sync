import { App, Notice, TFile } from "obsidian";
import { DateTime } from "luxon";
import { GoogleSyncSettings } from "../settings";
import { GoogleTasksClient } from "../google/tasks";
import { moveFile, readFrontmatter } from "../io";
import { detectKind, isManagedSubpath } from "./frontmatter";
import { LifecycleNote, planLifecycle } from "./lifecycle-plan";

export interface LifecycleCounts {
    archived: number;
    overdue: number;
    completed: number;
}

/** Executes the lifecycle plan against the vault (file moves) + closes linked Google tasks. */
export class Lifecycle {
    constructor(
        private readonly app: App,
        private readonly tasks: GoogleTasksClient,
        private readonly settings: () => GoogleSyncSettings,
    ) {}

    async runOnce(): Promise<LifecycleCounts> {
        const s = this.settings();
        const notes: LifecycleNote[] = [];
        for (const file of this.app.vault.getMarkdownFiles()) {
            if (isManagedSubpath(file.path, s.eventsFolder, s.tasksFolder)) continue;
            const kind = detectKind(file.path, s.eventsFolder, s.tasksFolder);
            if (!kind) continue;
            notes.push({
                path: file.path,
                basename: file.basename,
                kind,
                fm: await readFrontmatter(this.app, file),
            });
        }

        const actions = planLifecycle(notes, s, DateTime.now());
        const counts: LifecycleCounts = { archived: 0, overdue: 0, completed: 0 };

        for (const action of actions) {
            const file = this.app.vault.getAbstractFileByPath(action.path);
            if (!(file instanceof TFile)) continue;
            if (action.type === "archive" && action.closeTasks.length && s.taskListId) {
                for (const basename of action.closeTasks) await this.closeLinkedTask(basename, s);
            }
            await moveFile(this.app, file, action.newPath);
            if (action.type === "archive") counts.archived++;
            else if (action.type === "overdue") counts.overdue++;
            else counts.completed++;
        }
        return counts;
    }

    private async closeLinkedTask(basename: string, s: GoogleSyncSettings): Promise<void> {
        for (const file of this.app.vault.getMarkdownFiles()) {
            if (file.basename !== basename) continue;
            if (detectKind(file.path, s.eventsFolder, s.tasksFolder) !== "task") continue;
            const fm = await readFrontmatter(this.app, file);
            const gid = fm.googleId;
            if (typeof gid === "string" && gid) {
                try {
                    await this.tasks.patchTask(s.taskListId, gid, { status: "completed" });
                } catch (e) {
                    new Notice(
                        `google-sync: could not close task ${basename}: ${(e as Error).message}`,
                    );
                }
            }
        }
    }
}
