import { describe, it } from "mocha";
import { expect } from "chai";
import { DateTime } from "luxon";
import { LifecycleConfig, LifecycleNote, planLifecycle } from "../../src/sync/lifecycle-plan";

const NZ = "Pacific/Auckland";
const now = DateTime.fromISO("2026-05-28T12:00:00", { zone: NZ });

const cfg: LifecycleConfig = {
    eventsFolder: "events",
    tasksFolder: "tasks",
    autoArchiveEnabled: true,
    autoArchiveDaysPast: 1,
    autoCloseTasksOnArchive: true,
    defaultTimezone: NZ,
};

function event(path: string, fm: Record<string, unknown>): LifecycleNote {
    const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
    return { path, basename, kind: "event", fm };
}
function task(path: string, fm: Record<string, unknown>): LifecycleNote {
    const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
    return { path, basename, kind: "task", fm };
}

describe("planLifecycle", () => {
    it("archives an event past the threshold and lists linked tasks to close", () => {
        const notes = [
            event("events/old.md", {
                title: "Old",
                date: "2026-05-25T09:00:00",
                tasks: ["buy-milk", 7],
            }),
        ];
        const actions = planLifecycle(notes, cfg, now);
        expect(actions).to.have.length(1);
        expect(actions[0]?.type).to.equal("archive");
        expect(actions[0]?.newPath).to.equal("events/archive/old.md");
        expect(actions[0]?.closeTasks).to.deep.equal(["buy-milk"]);
    });

    it("does not archive an event still within the threshold", () => {
        const notes = [event("events/soon.md", { title: "Soon", date: "2026-05-28T09:00:00" })];
        expect(planLifecycle(notes, cfg, now)).to.have.length(0);
    });

    it("skips event archival when disabled", () => {
        const notes = [event("events/old.md", { title: "Old", date: "2026-05-01T09:00:00" })];
        expect(planLifecycle(notes, { ...cfg, autoArchiveEnabled: false }, now)).to.have.length(0);
    });

    it("omits linked tasks when auto-close is off", () => {
        const notes = [
            event("events/old.md", { title: "Old", date: "2026-05-01T09:00:00", tasks: ["t"] }),
        ];
        const actions = planLifecycle(notes, { ...cfg, autoCloseTasksOnArchive: false }, now);
        expect(actions[0]?.closeTasks).to.deep.equal([]);
    });

    it("moves a completed task to completed/", () => {
        const notes = [task("tasks/done.md", { title: "Done", completed: true })];
        const actions = planLifecycle(notes, cfg, now);
        expect(actions[0]?.type).to.equal("completed");
        expect(actions[0]?.newPath).to.equal("tasks/completed/done.md");
    });

    it("moves an overdue incomplete task to overdue/", () => {
        const notes = [
            task("tasks/late.md", { title: "Late", due: "2026-05-27T09:00:00", completed: false }),
        ];
        const actions = planLifecycle(notes, cfg, now);
        expect(actions[0]?.type).to.equal("overdue");
        expect(actions[0]?.newPath).to.equal("tasks/overdue/late.md");
    });

    it("leaves a future incomplete task alone", () => {
        const notes = [task("tasks/future.md", { title: "Future", due: "2026-05-30T09:00:00" })];
        expect(planLifecycle(notes, cfg, now)).to.have.length(0);
    });
});
