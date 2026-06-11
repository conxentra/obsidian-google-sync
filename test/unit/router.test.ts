import { describe, it } from "mocha";
import { expect } from "chai";
import { SyncRouter } from "../../src/sync/router";
import { GoogleCalendarClient } from "../../src/google/calendar";
import { GoogleTasksClient } from "../../src/google/tasks";
import { DEFAULT_SETTINGS, GoogleSyncSettings } from "../../src/settings-data";
import { MemoryVault } from "./helpers/memoryVault";
import { fakeHttp, jsonResp, noWaitRetry, token } from "./helpers/fakeHttp";

function makeRouter(vault: MemoryVault, overrides: Partial<GoogleSyncSettings> = {}) {
    const settings: GoogleSyncSettings = { ...DEFAULT_SETTINGS, taskListId: "L1", ...overrides };
    const { calls, fn } = fakeHttp();
    const calendar = new GoogleCalendarClient(fn, token, noWaitRetry);
    const tasks = new GoogleTasksClient(fn, token, noWaitRetry);
    const notices: string[] = [];
    const router = new SyncRouter(
        vault,
        calendar,
        tasks,
        () => settings,
        (m) => notices.push(m),
    );
    return { router, calls, notices };
}

describe("SyncRouter (one-way)", () => {
    it("patches an event note that has a googleId", async () => {
        const vault = new MemoryVault();
        vault.seed("events/standup.md", {
            title: "Standup",
            date: "2026-06-02T09:00:00",
            timezone: "Pacific/Auckland",
            googleId: "ev-1",
        });
        const { router, calls } = makeRouter(vault);

        await router.syncPath("events/standup.md");

        expect(calls).to.have.length(1);
        expect(calls[0]?.method).to.equal("PATCH");
        expect(calls[0]?.url).to.contain("/calendars/primary/events/ev-1");
        const body = JSON.parse(calls[0]?.body ?? "{}") as { summary?: string };
        expect(body.summary).to.equal("Standup");
    });

    it("does nothing for a note without a googleId (never inserts)", async () => {
        const vault = new MemoryVault();
        vault.seed("events/new.md", { title: "New", date: "2026-06-02T09:00:00" });
        vault.seed("tasks/new.md", { title: "New task" });
        const { router, calls } = makeRouter(vault);

        await router.syncAll();

        expect(calls).to.have.length(0);
        expect(vault.fm("events/new.md")?.googleId).to.equal(undefined);
    });

    it("honors a per-note pull-only opt-out", async () => {
        const vault = new MemoryVault();
        vault.seed("tasks/quiet.md", {
            title: "Quiet",
            googleId: "t-1",
            syncDirection: "pull-only",
        });
        const { router, calls } = makeRouter(vault);

        await router.syncPath("tasks/quiet.md");

        expect(calls).to.have.length(0);
    });

    it("patches a task and re-nests it under a resolved parent wikilink", async () => {
        const vault = new MemoryVault();
        vault.seed("tasks/renew-rego.md", { title: "Renew", googleId: "task-parent" });
        vault.seed("tasks/pick-up-car.md", {
            title: "Pick up car",
            googleId: "task-child",
            parent: "[[renew-rego]]",
        });
        const { router, calls } = makeRouter(vault);

        await router.syncPath("tasks/pick-up-car.md");

        expect(calls).to.have.length(2);
        expect(calls[0]?.method).to.equal("PATCH");
        expect(calls[0]?.url).to.contain("/lists/L1/tasks/task-child");
        expect(calls[1]?.method).to.equal("POST");
        expect(calls[1]?.url).to.contain("/tasks/task-child/move");
        expect(calls[1]?.url).to.contain("parent=task-parent");
    });

    it("skips notes in managed subfolders and isolates per-note failures", async () => {
        const vault = new MemoryVault();
        vault.seed("events/archive/old.md", { title: "Old", googleId: "ev-old" });
        vault.seed("events/bad.md", { title: "Bad", date: "not-a-date", googleId: "ev-bad" });
        vault.seed("events/good.md", {
            title: "Good",
            date: "2026-06-02T09:00:00",
            googleId: "ev-good",
        });
        const { router, calls, notices } = makeRouter(vault);

        const { synced } = await router.syncAll();

        // Only the good note produced a request; the bad one was reported, archive ignored.
        expect(calls.map((c) => c.method)).to.deep.equal(["PATCH"]);
        expect(calls[0]?.url).to.contain("/events/ev-good");
        expect(synced).to.be.greaterThan(0);
        expect(notices.join(" ")).to.contain("bad.md");
    });
});
