import { VaultNoteRef, VaultPort } from "../../../src/vault/port";
import { basenameOf, normalizeVaultPath } from "../../../src/vault/paths";

interface MemoryNote {
    fm: Record<string, unknown>;
    body: string;
}

/** In-memory VaultPort for unit-testing router/importer/lifecycle without Obsidian. */
export class MemoryVault implements VaultPort {
    readonly notes = new Map<string, MemoryNote>();

    seed(path: string, fm: Record<string, unknown>, body = ""): void {
        this.notes.set(normalizeVaultPath(path), { fm: { ...fm }, body });
    }

    fm(path: string): Record<string, unknown> | undefined {
        return this.notes.get(normalizeVaultPath(path))?.fm;
    }

    paths(): string[] {
        return [...this.notes.keys()].sort();
    }

    private note(path: string): MemoryNote {
        const n = this.notes.get(normalizeVaultPath(path));
        if (!n) throw new Error(`No such note: ${path}`);
        return n;
    }

    async listMarkdown(roots: string[]): Promise<VaultNoteRef[]> {
        const out: VaultNoteRef[] = [];
        const normalizedRoots = roots.map(normalizeVaultPath).filter((r) => r.length > 0);
        for (const path of this.notes.keys()) {
            if (!path.endsWith(".md")) continue;
            if (normalizedRoots.some((r) => path.startsWith(`${r}/`))) {
                out.push({ path, basename: basenameOf(path) });
            }
        }
        return out;
    }

    async exists(path: string): Promise<boolean> {
        return this.notes.has(normalizeVaultPath(path));
    }

    async readFrontmatter(path: string): Promise<Record<string, unknown>> {
        return { ...this.note(path).fm };
    }

    async writeFrontmatter(path: string, frontmatter: Record<string, unknown>): Promise<void> {
        this.note(path).fm = { ...frontmatter };
    }

    async writeFrontmatterKey(path: string, key: string, value: unknown): Promise<void> {
        this.note(path).fm[key] = value;
    }

    async upsertMarkdown(
        path: string,
        frontmatter: Record<string, unknown>,
        body = "",
    ): Promise<void> {
        this.notes.set(normalizeVaultPath(path), { fm: { ...frontmatter }, body });
    }

    async move(oldPath: string, newPath: string): Promise<void> {
        const from = normalizeVaultPath(oldPath);
        const to = normalizeVaultPath(newPath);
        const n = this.notes.get(from);
        if (!n) throw new Error(`No such note: ${oldPath}`);
        if (this.notes.has(to)) throw new Error(`Destination exists: ${newPath}`);
        this.notes.delete(from);
        this.notes.set(to, n);
    }
}
