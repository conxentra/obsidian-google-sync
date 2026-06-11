import { describe, it } from "mocha";
import { expect } from "chai";
import { diffBody, projectRemoteBody, vetPatch } from "../../src/sync/baseline";

describe("diffBody", () => {
    it("returns null when nothing changed (independent of key order / undefineds)", () => {
        const baseline = { summary: "X", start: { dateTime: "a", timeZone: "z" } };
        const current = { start: { timeZone: "z", dateTime: "a" }, summary: "X", end: undefined };
        expect(diffBody(baseline, current)).to.equal(null);
    });

    it("includes only changed fields", () => {
        const patch = diffBody(
            { summary: "X", location: "Wellington", status: "confirmed" },
            { summary: "Y", location: "Wellington", status: "confirmed" },
        );
        expect(patch).to.deep.equal({ summary: "Y" });
    });

    it("emits null to clear a removed field, but never for start/end", () => {
        const patch = diffBody(
            { summary: "X", location: "Wellington", end: { dateTime: "e" } },
            { summary: "X" },
        );
        expect(patch).to.deep.equal({ location: null });
    });

    it("does not touch fields the note never knew about (remote-only edits survive)", () => {
        const patch = diffBody(
            { summary: "X" }, // baseline from import: no description back then
            { summary: "X", location: "Den" }, // note added a location; Google added a description
        );
        expect(patch).to.deep.equal({ location: "Den" });
    });
});

describe("vetPatch", () => {
    it("rejects placeholder/empty titles", () => {
        expect(vetPatch({ summary: "Untitled event" }, { summary: "Real" }, "event").ok).to.equal(
            false,
        );
        expect(vetPatch({ summary: "  " }, { summary: "Real" }, "event").ok).to.equal(false);
        expect(vetPatch({ title: "Event title" }, { title: "Real" }, "task").ok).to.equal(false);
        expect(vetPatch({ summary: "Renamed" }, { summary: "Real" }, "event").ok).to.equal(true);
    });

    it("rejects a patch that clears half or more of the populated fields", () => {
        const baseline = {
            summary: "X",
            location: "L",
            description: "D",
            colorId: "7",
            transparency: "opaque",
            visibility: "private",
        };
        const massClear = { location: null, description: null, colorId: null };
        expect(vetPatch(massClear, baseline, "event").ok).to.equal(false);
        const smallClear = { location: null, summary: "Y" };
        expect(vetPatch(smallClear, baseline, "event").ok).to.equal(true);
    });
});

describe("projectRemoteBody", () => {
    it("keeps only mapper-owned keys from a raw API response", () => {
        const projected = projectRemoteBody(
            {
                id: "ev1",
                etag: '"abc"',
                updated: "2026-06-01T00:00:00Z",
                summary: "Meeting",
                start: { dateTime: "2026-06-02T09:00:00+12:00" },
                creator: { email: "x@y.z" },
            },
            "event",
        );
        expect(projected).to.deep.equal({
            summary: "Meeting",
            start: { dateTime: "2026-06-02T09:00:00+12:00" },
        });
    });

    it("includes a task's parent so re-nesting is detectable", () => {
        const projected = projectRemoteBody(
            { id: "c1", title: "Child", parent: "p1", position: "0001" },
            "task",
        );
        expect(projected).to.deep.equal({ title: "Child", parent: "p1" });
    });
});
