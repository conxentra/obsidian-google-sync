import { DateTime } from "luxon";
import { NoteKind } from "../types";
import { isPast } from "./dates";

/** Pure lifecycle planning — no `obsidian` import, so it's unit-testable under Node. */

export interface LifecycleNote {
    path: string;
    basename: string;
    kind: NoteKind;
    fm: Record<string, unknown>;
}

export type LifecycleActionType = "archive" | "overdue" | "completed";

export interface LifecycleAction {
    path: string;
    type: LifecycleActionType;
    newPath: string;
    closeTasks: string[]; // task basenames to close in Google (archive only)
}

export interface LifecycleConfig {
    eventsFolder: string;
    tasksFolder: string;
    autoArchiveEnabled: boolean;
    autoArchiveDaysPast: number;
    autoCloseTasksOnArchive: boolean;
    defaultTimezone: string;
}

function dest(folder: string, sub: string, basename: string): string {
    return `${folder.replace(/\/+$/, "")}/${sub}/${basename}.md`;
}

/**
 * Decide which notes should move (and which linked tasks to close). Inputs must be
 * top-level notes (callers exclude archive/overdue/completed subfolders). `now` is injected
 * for deterministic tests.
 */
export function planLifecycle(
    notes: LifecycleNote[],
    cfg: LifecycleConfig,
    now: DateTime,
): LifecycleAction[] {
    const actions: LifecycleAction[] = [];
    for (const note of notes) {
        if (note.kind === "event") {
            if (!cfg.autoArchiveEnabled) continue;
            const date = note.fm.date;
            if (typeof date !== "string") continue;
            const zone =
                (typeof note.fm.timezone === "string" && note.fm.timezone) || cfg.defaultTimezone;
            const threshold = DateTime.fromISO(date, { zone }).plus({
                days: cfg.autoArchiveDaysPast,
            });
            if (!threshold.isValid || now <= threshold) continue;
            const linked = note.fm.tasks;
            const closeTasks =
                cfg.autoCloseTasksOnArchive && Array.isArray(linked)
                    ? linked.filter((t): t is string => typeof t === "string")
                    : [];
            actions.push({
                path: note.path,
                type: "archive",
                newPath: dest(cfg.eventsFolder, "archive", note.basename),
                closeTasks,
            });
        } else {
            const completed = note.fm.completed === true || note.fm.status === "completed";
            if (completed) {
                actions.push({
                    path: note.path,
                    type: "completed",
                    newPath: dest(cfg.tasksFolder, "completed", note.basename),
                    closeTasks: [],
                });
            } else if (
                typeof note.fm.due === "string" &&
                isPast(note.fm.due, cfg.defaultTimezone, now)
            ) {
                actions.push({
                    path: note.path,
                    type: "overdue",
                    newPath: dest(cfg.tasksFolder, "overdue", note.basename),
                    closeTasks: [],
                });
            }
        }
    }
    return actions;
}
