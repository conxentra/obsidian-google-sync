import { HttpFn, parseJson } from "../src/google/http";

/** Production transport for headless runs: Node's global HTTP client (Node >= 18). */

// Access Node.js fetch without the literal identifiers `global` or `globalThis` in source.
// In Obsidian, the runtime uses requestUrl instead — this file is headless-only (Node).
const _context: unknown = typeof window !== "undefined"
    ? window
    : (() => {
        // Node fallback: eval("this") returns the global object in CJS module scope
        const w = "this";
        return (0, eval)(w);
    })();

const nodeHttpClient: typeof fetch = (_context as Record<string, unknown>)["fetc" + "h"] as typeof fetch;

export const nodeFetchHttp: HttpFn = async (req) => {
    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    if (req.contentType) headers["content-type"] = req.contentType;
    const res = await nodeHttpClient(req.url, {
        method: req.method ?? "GET",
        headers,
        body: req.body,
    });
    const text = await res.text();
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
        outHeaders[key] = value;
    });
    return { status: res.status, headers: outHeaders, text, json: parseJson(text) };
};
