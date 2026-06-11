import { describe, it } from "mocha";
import { expect } from "chai";
import { GitSync } from "../../headless/git";

interface Scripted {
    /** Matches the start of a `git` argv (joined with spaces); throws when `fail` set. */
    match: string;
    fail?: boolean;
    out?: string;
}

function scriptedGit(script: Scripted[]) {
    const calls: string[] = [];
    const run = async (args: string[]): Promise<string> => {
        const joined = args.join(" ");
        calls.push(joined);
        for (const s of script) {
            if (joined.startsWith(s.match)) {
                if (s.fail) throw new Error(`scripted failure for: ${s.match}`);
                return s.out ?? "";
            }
        }
        return "";
    };
    return { calls, run };
}

const CFG = {
    enabled: true,
    remote: "origin",
    branch: "main",
    authorName: "bot",
    authorEmail: "bot@x",
};

describe("GitSync", () => {
    it("preSync commits a dirty tree, fetches, and fast-forwards", async () => {
        const { calls, run } = scriptedGit([{ match: "status --porcelain", out: " M tasks/a.md" }]);
        const git = new GitSync("/vault", CFG, () => {}, run);

        await git.preSync();

        expect(calls.some((c) => c.startsWith("add -A"))).to.equal(true);
        expect(calls.some((c) => c.includes("commit -m google-sync: recover"))).to.equal(true);
        expect(calls).to.include("fetch origin main");
        expect(calls).to.include("merge --ff-only origin/main");
    });

    it("preSync falls back ff-only -> rebase -> hard reset", async () => {
        const { calls, run } = scriptedGit([
            { match: "merge --ff-only", fail: true },
            { match: "rebase origin/main", fail: true },
        ]);
        const git = new GitSync("/vault", CFG, () => {}, run);

        await git.preSync();

        expect(calls).to.include("rebase origin/main");
        expect(calls).to.include("rebase --abort");
        expect(calls).to.include("reset --hard origin/main");
    });

    it("preSync continues offline when fetch fails", async () => {
        const { calls, run } = scriptedGit([{ match: "fetch", fail: true }]);
        const git = new GitSync("/vault", CFG, () => {}, run);

        await git.preSync();

        expect(calls.some((c) => c.startsWith("merge"))).to.equal(false);
    });

    it("commitAndPush stages scoped paths, skips an empty commit, and pushes", async () => {
        const { calls, run } = scriptedGit([{ match: "diff --cached --name-only", out: "" }]);
        const git = new GitSync("/vault", CFG, () => {}, run);

        await git.commitAndPush(["events", "tasks", ".google-sync"], "google-sync: now");

        expect(calls).to.include("add -A -- events tasks .google-sync");
        expect(calls.some((c) => c.includes("commit -m google-sync: now"))).to.equal(false);
        expect(calls).to.include("push origin HEAD:main");
    });

    it("retries a rejected push with rebase -X theirs, never force-pushing", async () => {
        let pushes = 0;
        const calls: string[] = [];
        const run = async (args: string[]): Promise<string> => {
            const joined = args.join(" ");
            calls.push(joined);
            if (joined.startsWith("push")) {
                pushes++;
                if (pushes === 1) throw new Error("rejected (fetch first)");
            }
            if (joined.startsWith("diff --cached")) return "tasks/a.md";
            return "";
        };
        const git = new GitSync("/vault", CFG, () => {}, run);

        await git.commitAndPush(["tasks"], "msg");

        expect(pushes).to.equal(2);
        expect(calls).to.include("rebase -X theirs origin/main");
        expect(calls.every((c) => !c.includes("--force"))).to.equal(true);
    });

    it("gives up after 3 rejected pushes with a clear error", async () => {
        const run = async (args: string[]): Promise<string> => {
            if (args[0] === "push") throw new Error("rejected");
            return "";
        };
        const git = new GitSync("/vault", CFG, () => {}, run);

        let err: unknown;
        try {
            await git.commitAndPush(["tasks"], "msg");
        } catch (e) {
            err = e;
        }
        expect((err as Error)?.message ?? "").to.contain("after 3 attempts");
    });

    it("resolves the current branch when none is configured", async () => {
        const { run } = scriptedGit([{ match: "rev-parse --abbrev-ref HEAD", out: "trunk" }]);
        const git = new GitSync("/vault", { ...CFG, branch: "" }, () => {}, run);
        expect(await git.branch()).to.equal("trunk");
    });
});
