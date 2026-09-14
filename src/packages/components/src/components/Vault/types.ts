/**
 * The vault DTOs, mirroring the JSON `tendril-core`'s `vault::models` serializes (camelCase, see
 * `crates/tendril-core/src/vault/models.rs`).
 *
 * They are declared here rather than in the app because these components are presentational and the
 * components package must not import from a consumer. The app re-exports them from `types/api.ts`.
 */

export type VaultItemSyncStatus =
  | "UpToDate"
  | "Modified"
  | "UpdateAvailable"
  | "LocalOnly"
  | "NotImported"
  | "Conflict";

export interface VaultStatus {
  id: string;
  name: string;
  isConfigured: boolean;
  repoUrl: string;
  localPath: string;
  currentBranch: string;
  latestCommit?: string | null;
  commitsAhead: number;
  commitsBehind: number;
  lastSyncedAt?: string | null;
  alwaysUpToDate: boolean;
}

export interface VaultRepoRef {
  owner: string;
  name: string;
  baseBranch?: string | null;
  remoteUrl?: string | null;
}

export interface VaultCatalogItem {
  name: string;
  description: string;
  color: string;
  localVersion?: string | null;
  remoteVersion: string;
  latestChangelog?: string | null;
  reposCount: number;
  skillsCount: number;
  mcpsCount: number;
  memoriesCount: number;
  reviewActionsCount: number;
  verificationsCount: number;
  skillNames: string[];
  mcpServerNames: string[];
  memoryFileNames: string[];
  reviewActionNames: string[];
  verificationNames: string[];
  syncStatus: VaultItemSyncStatus;
  repos: VaultRepoRef[];
  hasLocalConflict: boolean;
  conflictReason?: string | null;
  linkedVaultId?: string | null;
  sourceVaultId?: string | null;
  sourceVaultName?: string | null;
}

export interface VaultCatalog {
  projects: VaultCatalogItem[];
  globalSkills: string[];
  globalMcps: string[];
}

export interface GitHubAccountOption {
  login: string;
  /** `User` or `Organization`, shown in parentheses after the login. */
  type: string;
}

export interface DiscoveredVaultRepo {
  fullName: string;
  repoUrl: string;
  owner: string;
  name: string;
  accountType: string;
  isPrivate: boolean;
}

export interface VaultResult {
  success: boolean;
  message: string;
  errorMessage?: string | null;
}

export interface VaultPrResult {
  success: boolean;
  prUrl?: string | null;
  branchName?: string | null;
  errorMessage?: string | null;
}

/** The per-project asset lists the push dialog offers as checkbox groups. */
export interface ProjectAssets {
  projectName: string;
  skills: string[];
  mcpServers: string[];
  memories: string[];
  reviewActions: string[];
  verifications: string[];
}

export interface VaultExportRequest {
  targetVaultId?: string;
  projectNames: string[];
  version: string;
  changelog: string;
  prTitle: string;
  prBody: string;
  reviewers: string[];
  /** Keyed by project name, so one PR can publish several projects with different asset subsets. */
  selectedSkills: Record<string, string[]>;
  selectedMcps: Record<string, string[]>;
  selectedMemories: Record<string, string[]>;
  selectedReviewActions: Record<string, string[]>;
  selectedVerifications: Record<string, string[]>;
  syncPermissions: Record<string, boolean>;
}

export interface VaultImportRequest {
  sourceVaultId?: string;
  projectName: string;
  targetLocalProjectName: string;
  /** Vault repo key (`owner/name`, or bare `name`) to the local path it should live at. */
  localRepoMappings: Record<string, string>;
  selectedSkills: string[];
  selectedMcps: string[];
  selectedMemories: string[];
  selectedReviewActions: string[];
  selectedVerifications: string[];
  importPermissions: boolean;
}

/** One local project, as much of it as the vault dialogs need. */
export interface LocalProjectRef {
  name: string;
  repos: string[];
}
