import { DateTime } from "luxon";
import { GoogleEventDateTime, NoteKind } from "../types";

/**
 * Baseline-diff patching: the structural guard against mass calendar corruption.
 *
 * The router remembers, per note, the Google body it last pushed or imported (the
 * *baseline*). A sync then sends only the fields that changed against that baseline —
 * an unchanged note produces no request at all, and a field edited only on the Google
 * side is never overwritten because it isn't in the diff. A note with no baseline yet
 * is diffed against a fresh GET of the remote item, so first contact can't clobber it
 * either. Pure module: no `obsidian` import.
 */

export type GoogleBody = Record<string, unknown>;

/** Where baselines persist: plugin data.json in Obsidian, .google-sync/state.json headless. */
export interface BaselineStore {
    get(path: string): Promise<GoogleBody | undefined>;
    set(path: string, body: GoogleBody): Promise<void>;
}

/** The Google body keys the mapper owns per kind — a remote GET is projected onto these
 * before diffing so read-only response fields (id, etag, updated, …) never count. */
const EVENT_BODY_KEYS = [
    "summary",
    "description",
    "location",
    "status",
    "visibility",
    "transparency",
    "colorId",
    "guestsCanInviteOthers",
    "guestsCanModify",
    "guestsCanSeeOtherGuests",
    "reminders",
    "extendedProperties",
    "start",
    "end",
    "attendees",
    "recurrence",
    "attachments",
    "source",
] as const;

// `parent` is diffed (re-nesting detection) though it's sent via move, not PATCH.
const TASK_BODY_KEYS = ["title", "notes", "due", "status", "parent"] as const;

/** Project a raw remote object onto the mapper-owned key space for the given kind. */
export function projectRemoteBody(remote: GoogleBody, kind: NoteKind): GoogleBody {
    const keys: readonly string[] = kind === "event" ? EVENT_BODY_KEYS : TASK_BODY_KEYS;
    const out: GoogleBody = {};
    for (const k of keys) {
        if (remote[k] !== undefined) out[k] = remote[k];
    }
    return out;
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
}

function sameValue(a: unknown, b: unknown): boolean {
    return stableStringify(a) === stableStringify(b);
}

/**
 * start/end compare by meaning, not representation: Google returns instants like
 * "...T00:38:00.000Z" while the mapper emits zone-offset strings — the same moment must
 * not register as a change (a big import would otherwise queue a pointless patch per
 * timed event and eat the mass-update budget).
 */
function sameEventTime(a: unknown, b: unknown): boolean {
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return sameValue(a, b);
    const x = a as GoogleEventDateTime;
    const y = b as GoogleEventDateTime;
    if (x.date || y.date) return x.date === y.date;
    if (x.dateTime && y.dateTime) {
        const dx = DateTime.fromISO(x.dateTime, { setZone: true });
        const dy = DateTime.fromISO(y.dateTime, { setZone: true });
        if (dx.isValid && dy.isValid) return dx.toMillis() === dy.toMillis();
    }
    return sameValue(a, b);
}

/**
 * Fields to PATCH so the remote matches `current`, given the last-known `baseline`.
 * Keys present in the baseline but gone from `current` map to null (Google clears them).
 * Returns null when nothing changed. `start`/`end` are never emitted as null — a note
 * that lost its dates is a broken note, not a request to strip the event's times.
 */
export function diffBody(baseline: GoogleBody, current: GoogleBody): GoogleBody | null {
    const patch: GoogleBody = {};
    for (const [k, v] of Object.entries(current)) {
        if (v === undefined) continue;
        const same =
            k === "start" || k === "end" ? sameEventTime(baseline[k], v) : sameValue(baseline[k], v);
        if (!same) patch[k] = v;
    }
    for (const k of Object.keys(baseline)) {
        if (baseline[k] === undefined || current[k] !== undefined) continue;
        if (k === "start" || k === "end") continue;
        patch[k] = null;
    }
    return Object.keys(patch).length ? patch : null;
}

export interface PatchVeto {
    ok: boolean;
    reason?: string;
}

const PLACEHOLDER_TITLES = new Set(["untitled event", "untitled task", "event title", "untitled"]);

function isPlaceholderTitle(value: unknown): boolean {
    return (
        typeof value === "string" &&
        (value.trim() === "" || PLACEHOLDER_TITLES.has(value.trim().toLowerCase()))
    );
}

/**
 * Sanity-check a computed patch before it is sent. Rejects the classic corruption
 * signatures: a placeholder/empty title (template rewrite), or a patch that would clear
 * half or more of the remote item's populated fields at once.
 */
export function vetPatch(patch: GoogleBody, baseline: GoogleBody, kind: NoteKind): PatchVeto {
    const titleKey = kind === "event" ? "summary" : "title";
    if (titleKey in patch && isPlaceholderTitle(patch[titleKey])) {
        return { ok: false, reason: `refusing to push placeholder ${titleKey} "${String(patch[titleKey])}"` };
    }
    const cleared = Object.values(patch).filter((v) => v === null).length;
    const populated = Object.values(baseline).filter((v) => v != null).length;
    if (cleared >= 3 && cleared * 2 >= populated) {
        return {
            ok: false,
            reason: `refusing to clear ${cleared} of ${populated} fields in one update`,
        };
    }
    return { ok: true };
}

/** In-memory store, used headless within a single run and by tests. */
export class MemoryBaselineStore implements BaselineStore {
    constructor(private readonly data: Record<string, GoogleBody> = {}) {}

    async get(path: string): Promise<GoogleBody | undefined> {
        return this.data[path];
    }

    async set(path: string, body: GoogleBody): Promise<void> {
        this.data[path] = body;
    }

    snapshot(): Record<string, GoogleBody> {
        return this.data;
    }
}
