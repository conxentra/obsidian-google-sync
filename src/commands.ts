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
        name: "Sync now",
        callback: () => void plugin.syncNow(),
    });
    plugin.addCommand({
        id: "test-connection",
        name: "Test connection",
        callback: async () => {
            new Notice(await plugin.testConnection());
        },
    });
}
