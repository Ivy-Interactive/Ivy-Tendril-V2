/**
 * DTOs of a project's memory files and its repo-asset import, as the daemon serializes them
 * (`crates/tendril-server/src/routes/projects/memory.rs` and `repo_assets.rs`).
 *
 * `DiscoveredRepoAsset` and `RepoAssetKind` are the component library's (`ImportRepoAssetsDialog`
 * owns the shape it renders); they are re-exported so app code has one import site.
 */
export type { DiscoveredRepoAsset, RepoAssetKind } from "@ivy-interactive/components/dialogs";

/** One row of a project's memory table: `GET /api/projects/:name/memory`. */
export interface ProjectMemoryEntry {
  fileName: string;
  /** The first two non-blank lines, markers trimmed, joined with " — " (V1's snippet). */
  snippet: string;
  sizeBytes: number;
}

/** `GET`/`PUT /api/projects/:name/memory/:file`. */
export interface ProjectMemoryFile {
  fileName: string;
  content: string;
}
