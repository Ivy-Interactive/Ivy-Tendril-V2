/**
 * The Team Vault DTOs, as the daemon's `/api/vaults` routes serialize them.
 *
 * They are declared once, in the components package, because the vault dialogs are presentational and
 * a component may not import from a consumer. This module re-exports them so app code has the same
 * single import site it has for everything else, and `types/api.ts` re-exports it in turn.
 */

export type {
  DiscoveredVaultRepo,
  GitHubAccountOption,
  LocalProjectRef,
  ProjectAssets,
  VaultCatalog,
  VaultCatalogItem,
  VaultExportRequest,
  VaultImportRequest,
  VaultItemSyncStatus,
  VaultPrResult,
  VaultRepoRef,
  VaultResult,
  VaultStatus,
} from "@ivy-interactive/components/tendril";
