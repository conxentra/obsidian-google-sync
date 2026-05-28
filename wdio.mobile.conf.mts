import * as path from "path";
import { parseObsidianVersions } from "wdio-obsidian-service";
import { env } from "process";

const cacheDir = path.resolve(".obsidian-cache");

const versions = await parseObsidianVersions(
    env.OBSIDIAN_VERSIONS ?? "earliest/earliest latest/latest",
    { cacheDir },
);
if (env.CI) {
    console.log("obsidian-cache-key:", JSON.stringify(versions));
}

export const config: WebdriverIO.Config = {
    runner: "local",
    framework: "mocha",
    specs: ["./test/specs/**/*.e2e.ts"],
    maxInstances: 1,
    hostname: env.APPIUM_HOST || "localhost",
    port: parseInt(env.APPIUM_PORT || "4723"),

    capabilities: versions.map<WebdriverIO.Capabilities>(([appVersion]) => ({
        browserName: "obsidian",
        browserVersion: appVersion,
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:avd": "obsidian_test",
        "appium:noReset": true,
        "appium:adbExecTimeout": 60 * 1000,
        "wdio:obsidianOptions": {
            plugins: ["."],
            vault: "test/vaults/simple",
        },
    })),

    services: [
        "obsidian",
        ["appium", { args: { allowInsecure: "*:chromedriver_autodownload,*:adb_shell" } }],
    ],
    reporters: ["obsidian"],
    mochaOpts: { ui: "bdd", timeout: 60 * 1000 },
    waitforInterval: 250,
    waitforTimeout: 5 * 1000,
    logLevel: "warn",
    cacheDir,
    injectGlobals: false,
};
