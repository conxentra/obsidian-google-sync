import { Notice } from "obsidian";
import GoogleSyncPlugin from "./main";

/** Register the user-facing commands. Stable IDs — don't rename once released. */
export function registerCommands(plugin: GoogleSyncPlugin): void {
    plugin.addCommand({
        id: "connect",
        name: "Connect to Google",
        callback: () => void plugin.connect(),
    });
    plugin.addCommand({
        id: "disconnect",
        name: "Disconnect from Google",
        callback: () => void plugin.disconnect(),
    });
    plugin.addCommand({
        id: "sync-now",
        name: "Push updates to Google",
        callback: () => void plugin.syncNow(),
    });
    plugin.addCommand({
        id: "sync-now-confirmed",
        name: "Push pending updates (confirmed)",
        callback: () => void plugin.syncNow(true),
    });
    plugin.addCommand({
        id: "preview-pending",
        name: "Preview pending Google updates (dry run)",
        callback: () => void plugin.previewPending(),
    });
    plugin.addCommand({
        id: "import-from-google",
        name: "Import events and tasks from Google",
        callback: () => void plugin.importFromGoogle(),
    });
    plugin.addCommand({
        id: "run-lifecycle",
        name: "Run lifecycle scan",
        callback: () => void plugin.runLifecycle(true),
    });
    plugin.addCommand({
        id: "test-connection",
        name: "Test connection",
        callback: async () => {
            new Notice(await plugin.testConnection());
        },
    });
    plugin.addCommand({
        id: "validate-setup",
        name: "Validate setup",
        callback: async () => {
            new Notice(await plugin.validateSetup(), 12000);
        },
    });
}
