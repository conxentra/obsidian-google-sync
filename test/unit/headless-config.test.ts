import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { loadConfig } from "../../headless/config";

describe("headless config", () => {
    let dir: string;
    beforeEach(async () => {
        dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "gsync-cfg-"));
    });
    afterEach(async () => {
        await fs.rm(dir, { recursive: true, force: true });
        delete process.env.GSYNC_CLIENT_SECRET;
    });

    async function write(config: unknown): Promise<string> {
        const file = nodePath.join(dir, "gsync.json");
        await fs.writeFile(file, JSON.stringify(config));
        return file;
    }

    it("merges settings over plugin defaults and resolves paths relative to the config", async () => {
        const file = await write({
            vaultPath: "vault",
            settings: { taskListId: "L1", importFutureDays: 30 },
        });
        const cfg = await loadConfig(file);
        expect(cfg.vaultPath).to.equal(nodePath.join(dir, "vault"));
        expect(cfg.tokenFile).to.equal(nodePath.join(dir, "gsync-tokens.json"));
        expect(cfg.settings.taskListId).to.equal("L1");
        expect(cfg.settings.importFutureDays).to.equal(30);
        expect(cfg.settings.eventsFolder).to.equal("events"); // default
        expect(cfg.settings.maxPatchesPerRun).to.equal(10); // default
        expect(cfg.git.enabled).to.equal(true);
        expect(cfg.loopbackPort).to.equal(8765);
    });

    it("requires vaultPath and rejects a token file inside the vault", async () => {
        let err: unknown;
        try {
            await loadConfig(await write({}));
        } catch (e) {
            err = e;
        }
        expect((err as Error).message).to.contain("vaultPath");

        try {
            await loadConfig(
                await write({ vaultPath: "vault", tokenFile: "vault/.google-sync/tokens.json" }),
            );
        } catch (e) {
            err = e;
        }
        expect((err as Error).message).to.contain("outside the vault");
    });

    it("lets GSYNC_CLIENT_SECRET override the file value", async () => {
        process.env.GSYNC_CLIENT_SECRET = "env-secret";
        const file = await write({ vaultPath: "vault", settings: { clientSecret: "file-secret" } });
        const cfg = await loadConfig(file);
        expect(cfg.settings.clientSecret).to.equal("env-secret");
    });
});
