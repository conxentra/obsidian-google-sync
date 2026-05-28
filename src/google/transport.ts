import { requestUrl } from "obsidian";
import { HttpFn, parseJson } from "./http";

/**
 * Default production transport: Obsidian's requestUrl (bypasses Electron CORS, works on
 * desktop + mobile) with `throw` disabled so the caller owns status handling. Kept apart
 * from http.ts so the pure HTTP/retry logic stays importable under Node for unit tests.
 */
export const obsidianHttp: HttpFn = async (req) => {
    const res = await requestUrl({
        url: req.url,
        method: req.method ?? "GET",
        headers: req.headers,
        body: req.body,
        contentType: req.contentType,
        throw: false,
    });
    const text = res.text ?? "";
    return {
        status: res.status,
        headers: res.headers ?? {},
        text,
        json: parseJson(text),
    };
};
