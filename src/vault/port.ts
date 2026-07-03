/**
 * Vault access boundary. The sync core (router, importer, lifecycle) talks to the vault
 * only through this interface, so the same logic runs inside Obsidian (ObsidianVaultPort)
 * and headless on a server over the filesystem (NodeVaultPort). No `obsidian` import.
 *
 * All paths are vault-relative, "/"-separated, without a leading slash.
 */

export interface VaultNoteRef {
    path: string;
    /** Note name without folder or .md extension. */
    basename: string;
}

export interface VaultPort {
    /** All markdown notes under the given root folders, recursively, de-duplicated. */
    listMarkdown(roots: string[]): Promise<VaultNoteRef[]>;

    exists(path: string): Promise<boolean>;

    /** Parsed YAML frontmatter of the note ({} when it has none). Throws if missing. */
    readFrontmatter(path: string): Promise<Record<string, unknown>>;

    /** Replace the note's entire frontmatter block, preserving the body. */
    writeFrontmatter(path: string, frontmatter: Record<string, unknown>): Promise<void>;

    /** Set a single frontmatter key, preserving everything else. */
    writeFrontmatterKey(path: string, key: string, value: unknown): Promise<void>;

    /** Create (with parent folders) or overwrite a note with frontmatter + body. */
    upsertMarkdown(
        path: string,
        frontmatter: Record<string, unknown>,
        body?: string,
    ): Promise<void>;

    /** Move a note, creating the destination folder if needed. */
    move(oldPath: string, newPath: string): Promise<void>;
}
