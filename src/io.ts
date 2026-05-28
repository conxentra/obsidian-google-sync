import { App, TFile, normalizePath, parseYaml } from "obsidian";

/**
 * Obsidian Vault file helpers. Mobile-safe (Vault API + fileManager only, no Node fs).
 * Reading frontmatter parses the leading `---` block directly so it doesn't depend on
 * metadataCache timing right after a write.
 */

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

export async function readFrontmatter(app: App, file: TFile): Promise<Record<string, unknown>> {
    const content = await app.vault.read(file);
    const match = content.match(FRONTMATTER_RE);
    const block = match?.[1];
    if (!block) return {};
    const parsed: unknown = parseYaml(block);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

/** Set a single frontmatter key, preserving the rest. */
export async function writeFrontmatterKey(
    app: App,
    file: TFile,
    key: string,
    value: unknown,
): Promise<void> {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm[key] = value;
    });
}

/** Move a note to newPath, creating the parent folder if needed. Returns the moved file. */
export async function moveFile(app: App, file: TFile, newPath: string): Promise<void> {
    const path = normalizePath(newPath);
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir && !app.vault.getAbstractFileByPath(dir)) {
        await app.vault.createFolder(dir).catch(() => undefined);
    }
    await app.fileManager.renameFile(file, path);
}
