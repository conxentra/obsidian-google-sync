/** Pure vault-path helpers shared by the plugin and the headless sync. No `obsidian` import. */

/** Normalize to "/"-separated, no leading/trailing/duplicate slashes. */
export function normalizeVaultPath(path: string): string {
    return path
        .replace(/\\/g, "/")
        .replace(/\/+/g, "/")
        .replace(/^\/+|\/+$/g, "");
}

/** The note name (no folder, no .md) for a vault path. */
export function basenameOf(path: string): string {
    return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

/** The folder part of a vault path ("" for top-level). */
export function dirnameOf(path: string): string {
    const i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i);
}
