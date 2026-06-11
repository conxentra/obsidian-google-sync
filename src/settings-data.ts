import { RecurringFilterMode } from "./sync/recurrence";

/**
 * Settings shape + defaults, kept free of any `obsidian` import so the sync core and the
 * headless runner can use them. The settings UI lives in settings.ts.
 */
export interface GoogleSyncSettings {
    // OAuth (BYO Google "Web application" client + self-hosted bridge redirect)
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    // Vault layout
    eventsFolder: string;
    tasksFolder: string;
    // Google targets
    defaultCalendarId: string;
    taskListId: string;
    defaultTimezone: string;
    // Behavior
    syncOnModify: boolean;
    /** Mass-update circuit breaker: more pending pushes than this in one run blocks the
     * run until explicitly confirmed, so a runaway template/script can't corrupt en masse. */
    maxPatchesPerRun: number;
    importOnStartup: boolean;
    importOnlyDefaultCalendar: boolean;
    importOnlyDefaultTaskList: boolean;
    importPastDays: number;
    importFutureDays: number;
    recurringEventFilterMode: RecurringFilterMode;
    recurringEventFilters: string[];
    autoArchiveEnabled: boolean;
    autoArchiveDaysPast: number;
    autoCloseTasksOnArchive: boolean;
}

export function systemTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

export const DEFAULT_SETTINGS: GoogleSyncSettings = {
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    eventsFolder: "events",
    tasksFolder: "tasks",
    defaultCalendarId: "primary",
    taskListId: "@default",
    defaultTimezone: systemTimezone(),
    syncOnModify: true,
    maxPatchesPerRun: 10,
    importOnStartup: false,
    importOnlyDefaultCalendar: true,
    importOnlyDefaultTaskList: true,
    importPastDays: 7,
    importFutureDays: 90,
    recurringEventFilterMode: "allow",
    recurringEventFilters: [],
    autoArchiveEnabled: true,
    autoArchiveDaysPast: 1,
    autoCloseTasksOnArchive: true,
};
