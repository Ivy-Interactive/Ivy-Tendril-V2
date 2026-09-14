/** Pure helpers shared by the vault dialogs — no React, no filesystem, no network. */

import type { LocalProjectRef, VaultRepoRef } from "./types";

/** Owners the vault writes for repos that have no GitHub home; they never appear in a repo key. */
const PLACEHOLDER_OWNERS = new Set(["", "local", "default"]);

/**
 * The key a vault repo is mapped by: `owner/name`, or the bare name when the vault has no real
 * owner for it. Both halves of the import round-trip use this, so it lives here rather than in a
 * component.
 */
export function vaultRepoKey(repo: VaultRepoRef): string {
  const owner = (repo.owner ?? "").trim();
  return PLACEHOLDER_OWNERS.has(owner.toLowerCase()) ? repo.name : `${owner}/${repo.name}`;
}

/** Where a repo lands when nothing else is known about it: `<home>/git/<name>`. */
export function defaultLocalRepoPath(homeDir: string, repoName: string): string {
  const base = homeDir.replace(/[/\\]+$/, "");
  return `${base}/git/${repoName}`;
}

/** The last path segment, tolerating both separators — a repo's folder name. */
export function repoFolderName(path: string): string {
  const segments = path.split(/[/\\]+/).filter((segment) => segment !== "");
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

/**
 * A free local project name, matching the original's `ComputeSuggestedName`: keep the vault's own
 * name when nothing local claims it, else count up `-2`, `-3`, … Comparison is case-insensitive,
 * because two projects differing only in case would collide on a case-insensitive filesystem.
 */
export function suggestLocalProjectName(baseName: string, existingNames: string[]): string {
  const taken = new Set(existingNames.map((name) => name.toLowerCase()));
  if (!taken.has(baseName.toLowerCase())) return baseName;

  let index = 2;
  while (taken.has(`${baseName}-${index}`.toLowerCase())) index += 1;
  return `${baseName}-${index}`;
}

/** Whether a local project of this name already exists, compared the way names collide. */
export function isLocalProjectNameTaken(name: string, existingNames: string[]): boolean {
  const needle = name.trim().toLowerCase();
  return existingNames.some((existing) => existing.toLowerCase() === needle);
}

/**
 * `yyyy.MM.dd.HHmmss` in UTC — the same version format the vault service generates, so a version
 * typed over the prefilled one still sorts against the vault's history.
 */
export function generateVaultVersion(now: Date = new Date()): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`,
  ].join(".");
}

/** `"alice, bob"` → `["alice", "bob"]`, dropping the blanks a trailing comma leaves behind. */
export function parseReviewers(input: string): string[] {
  return input
    .split(",")
    .map((reviewer) => reviewer.trim())
    .filter((reviewer) => reviewer !== "");
}

/**
 * The local paths a vault project's repos should map to.
 *
 * In merge mode the existing local project already has these repos checked out somewhere, and that
 * is the whole point of merging rather than importing: a repo matched by folder name keeps the path
 * it lives at today. Anything unmatched falls back to `<home>/git/<name>`.
 */
export function seedRepoMappings(
  repos: VaultRepoRef[],
  homeDir: string,
  localProject?: LocalProjectRef | null,
): Record<string, string> {
  const byFolder = new Map<string, string>();
  for (const path of localProject?.repos ?? []) {
    byFolder.set(repoFolderName(path).toLowerCase(), path);
  }

  const mappings: Record<string, string> = {};
  for (const repo of repos) {
    const matched = byFolder.get(repo.name.toLowerCase());
    mappings[vaultRepoKey(repo)] = matched ?? defaultLocalRepoPath(homeDir, repo.name);
  }
  return mappings;
}
