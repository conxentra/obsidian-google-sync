import { App, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { VaultNoteRef, VaultPort } from "./port";
import {
    moveFile,
    readFrontmatter,
    upsertMarkdownFile,
    writeFrontmatter,
    writeFrontmatterKey,
} from "../io";

/** VaultPort over Obsidian's Vault API (mobile-safe: no Node fs). */
export class ObsidianVaultPort implements VaultPort {
    constructor(private readonly app: App) {}

    private fileAt(path: string): TFile {
        const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (!(f instanceof TFile)) throw new Error(`No such note: ${path}`);
        return f;
    }

    async listMarkdown(roots: string[]): Promise<VaultNoteRef[]> {
        const out: VaultNoteRef[] = [];
        const seen = new Set<string>();

        const visit = (node: TAbstractFile): void => {
            if (node instanceof TFile) {
                if (node.extension === "md" && !seen.has(node.path)) {
                    seen.add(node.path);
                    out.push({ path: node.path, basename: node.basename });
                }
                return;
            }
            if (node instanceof TFolder) {
                for (const child of node.children) visit(child);
            }
        };

        for (const root of roots) {
            const normalized = normalizePath(root).replace(/\/+$/, "");
            const node = this.app.vault.getAbstractFileByPath(normalized);
            if (!node) continue;
            visit(node);
        }

        return out;
    }

    async exists(path: string): Promise<boolean> {
        return !!this.app.vault.getAbstractFileByPath(normalizePath(path));
    }

    async readFrontmatter(path: string): Promise<Record<string, unknown>> {
        return readFrontmatter(this.app, this.fileAt(path));
    }

    async writeFrontmatter(path: string, frontmatter: Record<string, unknown>): Promise<void> {
        await writeFrontmatter(this.app, this.fileAt(path), frontmatter);
    }

    async writeFrontmatterKey(path: string, key: string, value: unknown): Promise<void> {
        await writeFrontmatterKey(this.app, this.fileAt(path), key, value);
    }

    async upsertMarkdown(
        path: string,
        frontmatter: Record<string, unknown>,
        body = "",
    ): Promise<void> {
        await upsertMarkdownFile(this.app, path, frontmatter, body);
    }

    async move(oldPath: string, newPath: string): Promise<void> {
        await moveFile(this.app, this.fileAt(oldPath), newPath);
    }
}
