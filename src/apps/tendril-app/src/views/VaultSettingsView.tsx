import React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RefreshCw, Upload } from "lucide-react";
import { Alert, AlertDescription, Button } from "@ivy-interactive/components/ui";
import {
  ConfirmVaultDeleteDialog,
  ConnectVaultDialog,
  CreateVaultDialog,
  GatedActionButton,
  ImportFromVaultDialog,
  PushToVaultDialog,
  VaultEmptyState,
  VaultProjectsTable,
  VaultStatusCard,
  computeVaultGate,
  type VaultExportDraft,
} from "@ivy-interactive/components/tendril";
import { bridge } from "../api/bridge";
import type {
  DiscoveredVaultRepo,
  GitHubAccountOption,
  ProjectAssets,
  ProjectSummary,
  VaultCatalogItem,
  VaultImportRequest,
  VaultStatus,
} from "../types/api";

export interface VaultSettingsViewProps {
  /**
   * `TENDRIL_HOME`, which the settings view already has from the service info. The repo-path defaults
   * in the import dialog hang off its parent, because Tendril lives at `<home>/.tendril`.
   */
  tendrilHome?: string | null;
}

/** Which dialog is open, and what it is about. Only one vault dialog is ever open at a time. */
type VaultDialog =
  | { kind: "create" }
  | { kind: "connect" }
  | { kind: "push"; project: string | null }
  | { kind: "import"; item: VaultCatalogItem; merge: boolean }
  | { kind: "delete"; item: VaultCatalogItem };

const EMPTY_ASSETS = (projectName: string): ProjectAssets => ({
  projectName,
  skills: [],
  mcpServers: [],
  memories: [],
  reviewActions: [],
  verifications: [],
});

/** Tendril lives at `<home>/.tendril`, so a repo path defaults under the parent of that folder. */
function homeDirOf(tendrilHome?: string | null): string {
  const trimmed = (tendrilHome ?? "").replace(/[/\\]+$/, "");
  const parent = trimmed.replace(/[/\\][^/\\]+$/, "");
  return parent || trimmed;
}

/**
 * What every vault mutation answers with. `VaultResult` and `VaultPrResult` are the two shapes; both
 * report `success` and carry their message in one of two fields, and only the PR ones have a `prUrl`.
 */
interface VaultActionResult {
  success: boolean;
  message?: string;
  errorMessage?: string | null;
  prUrl?: string | null;
}

/** The message a vault call left behind, whichever half of the result carries it. */
function resultMessage(result: VaultActionResult): string {
  return result.errorMessage?.trim() || result.message?.trim() || "";
}

/**
 * The Team Vault section of Settings: the only stateful piece of the vault UI.
 *
 * Every loader tolerates rejection with an inline error and an empty result, the way
 * `getProjectReviewActions` does — a vault that cannot be reached must not take the settings page
 * down with it. Actions that cannot work yet are disabled with the reason as their tooltip
 * (`computeVaultGate`) instead of failing against GitHub on click.
 */
export const VaultSettingsView: React.FC<VaultSettingsViewProps> = ({ tendrilHome }) => {
  const [vaults, setVaults] = React.useState<VaultStatus[]>([]);
  const [selectedVaultId, setSelectedVaultId] = React.useState("");
  const [status, setStatus] = React.useState<VaultStatus | null>(null);
  const [catalog, setCatalog] = React.useState<VaultCatalogItem[]>([]);
  const [accounts, setAccounts] = React.useState<GitHubAccountOption[]>([]);
  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [discovered, setDiscovered] = React.useState<DiscoveredVaultRepo[]>([]);
  const [isDiscovering, setIsDiscovering] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isBusy, setIsBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<VaultDialog | null>(null);
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [pushAssets, setPushAssets] = React.useState<ProjectAssets[]>([]);

  const addError = (message: string) => setErrors((current) => [...new Set([...current, message])]);

  /** Loads everything the section shows. Each call is independent, so one failure loses one panel. */
  const refresh = React.useCallback(
    async (vaultId?: string) => {
      setIsLoading(true);
      setErrors([]);

      const loadedVaults = await bridge.listVaults().catch((error: unknown) => {
        addError(`Could not list vaults: ${String(error)}`);
        return [] as VaultStatus[];
      });
      setVaults(loadedVaults);

      const configured = loadedVaults.filter((vault) => vault.isConfigured);
      const active =
        configured.find((vault) => vault.id === vaultId) ??
        configured[0] ??
        loadedVaults[0] ??
        null;
      setSelectedVaultId(active?.id ?? "");

      const [loadedAccounts, loadedProjects] = await Promise.all([
        bridge.listGitHubAccounts().catch(() => [] as GitHubAccountOption[]),
        bridge.listProjects().catch(() => [] as ProjectSummary[]),
      ]);
      setAccounts(loadedAccounts);
      setProjects(loadedProjects);

      if (active) {
        const [loadedStatus, loadedCatalog] = await Promise.all([
          bridge.getVaultStatus(active.id).catch((error: unknown) => {
            addError(`Could not read the vault status: ${String(error)}`);
            return active;
          }),
          bridge
            .getVaultCatalog(active.id)
            .then((result) => result.projects ?? [])
            .catch((error: unknown) => {
              addError(`Could not read the vault catalog: ${String(error)}`);
              return [] as VaultCatalogItem[];
            }),
        ]);
        setStatus(loadedStatus);
        setCatalog(loadedCatalog);
      } else {
        setStatus(null);
        setCatalog([]);
      }

      setIsLoading(false);
    },
    /* Nothing outside React's own setters is read, so this loader is stable for the mount effect. */
    [],
  );

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasVault = vaults.some((vault) => vault.isConfigured);
  const hasGitHubAuth = accounts.length > 0;
  const existingNames = projects.map((project) => project.name);
  const existingPaths = projects.flatMap((project) => project.repos);
  const localProjects = projects.map((project) => ({
    name: project.name,
    repos: project.repos,
  }));

  const createGate = computeVaultGate({ hasGitHubAuth, hasVault, isBusy, requires: ["github"] });
  const vaultGate = computeVaultGate({ hasGitHubAuth, hasVault, isBusy, requires: ["vault"] });

  /** Runs one mutation, keeping a failed result in the dialog and a successful one in the section. */
  const runVaultAction = async (
    work: () => Promise<VaultActionResult>,
    { closeOnSuccess = true }: { closeOnSuccess?: boolean } = {},
  ) => {
    setIsBusy(true);
    setDialogError(null);
    try {
      const result = await work();
      if (!result.success) {
        setDialogError(resultMessage(result) || "The vault service reported a failure.");
        return;
      }

      const prUrl = result.prUrl?.trim();
      setNotice([resultMessage(result), prUrl].filter(Boolean).join(" — ") || "Done.");
      if (closeOnSuccess) setDialog(null);
      await refresh(selectedVaultId);
    } catch (error) {
      setDialogError(String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleSelectVault = async (vaultId: string) => {
    setSelectedVaultId(vaultId);
    await refresh(vaultId);
  };

  const openCreateDialog = () => {
    setDialogError(null);
    setDialog({ kind: "create" });
  };

  /** Discovery reaches GitHub, so it runs when the dialog opens rather than on every page load. */
  const openConnectDialog = async () => {
    setDialogError(null);
    setDialog({ kind: "connect" });
    setIsDiscovering(true);
    setDiscovered(await bridge.discoverVaults().catch(() => [] as DiscoveredVaultRepo[]));
    setIsDiscovering(false);
  };

  /**
   * The push dialog seeds its checkboxes from `assets` on mount, so the assets are collected before
   * it opens rather than arriving into an already-empty checklist.
   */
  const openPushDialog = async (project: string | null) => {
    setDialogError(null);
    const names = projects.map((entry) => entry.name);
    const assets = await Promise.all(
      names.map((name) => bridge.collectProjectAssets(name).catch(() => EMPTY_ASSETS(name))),
    );
    setPushAssets(assets);
    setDialog({ kind: "push", project });
  };

  const handleOpenUrl = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  const handleImportSubmit = (request: VaultImportRequest, merge: boolean) =>
    runVaultAction(() =>
      merge
        ? bridge.mergeVaultProject(request, selectedVaultId)
        : bridge.importVaultProject(request, selectedVaultId),
    );

  const handlePushSubmit = (draft: VaultExportDraft) => {
    const projectList = draft.projectNames.join(", ");
    const prTitle = `feat(vault): update ${projectList} to v${draft.version}`;
    const prBody = [
      `Publishes ${projectList} to the team vault at version \`${draft.version}\`.`,
      draft.changelog ? `\n## Changelog\n\n${draft.changelog}` : "",
      "\nOpened from the Tendril desktop app.",
    ]
      .filter(Boolean)
      .join("\n");

    return runVaultAction(() =>
      bridge.pushToVault(
        { ...draft, targetVaultId: draft.targetVaultId ?? selectedVaultId, prTitle, prBody },
        selectedVaultId,
      ),
    );
  };

  return (
    <div className="space-y-4" data-testid="vault-settings-view">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading || isBusy}
          onClick={() => void refresh(selectedVaultId)}
        >
          <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
          Refresh
        </Button>
        {/* Gated rather than hidden: a disabled control with its reason tells the operator what to
            fix, which is the whole point of the preflight check this ports. */}
        <GatedActionButton
          gate={vaultGate}
          variant="outline"
          size="sm"
          onClick={() => void runVaultAction(() => bridge.pullVaultLatest(selectedVaultId))}
        >
          Sync
        </GatedActionButton>
        <GatedActionButton
          gate={vaultGate}
          variant="outline"
          size="sm"
          onClick={() => void openPushDialog(null)}
        >
          <Upload className="mr-1.5 size-3.5" aria-hidden="true" />
          Open a PR
        </GatedActionButton>
      </div>

      {errors.map((message) => (
        <Alert key={message} variant="destructive" data-testid="vault-settings-error">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ))}

      {notice && (
        <Alert data-testid="vault-settings-notice">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {hasVault && status ? (
        <>
          <VaultStatusCard
            status={status}
            vaults={vaults.filter((vault) => vault.isConfigured)}
            selectedVaultId={selectedVaultId}
            onSelectVault={(vaultId) => void handleSelectVault(vaultId)}
            onSync={() => void runVaultAction(() => bridge.pullVaultLatest(selectedVaultId))}
            onDisconnect={() =>
              void runVaultAction(() => bridge.disconnectVault(selectedVaultId), {
                closeOnSuccess: false,
              })
            }
            onAlwaysUpToDateChange={(value) =>
              void runVaultAction(() => bridge.setVaultAlwaysUpToDate(value, selectedVaultId), {
                closeOnSuccess: false,
              })
            }
            onOpenUrl={(url) => void handleOpenUrl(url)}
            isBusy={isBusy}
          />

          <section className="space-y-2">
            <h4 className="text-xs font-semibold text-foreground">Shared Projects</h4>
            <VaultProjectsTable
              items={catalog}
              isLoading={isLoading}
              gate={vaultGate}
              onImport={(item) => {
                setDialogError(null);
                setDialog({ kind: "import", item, merge: false });
              }}
              onMerge={(item) => {
                setDialogError(null);
                setDialog({ kind: "import", item, merge: true });
              }}
              onUpdate={(item) => {
                setDialogError(null);
                setDialog({ kind: "import", item, merge: false });
              }}
              onPublish={(item) => void openPushDialog(item.name)}
              onDelete={(item) => {
                setDialogError(null);
                setDialog({ kind: "delete", item });
              }}
              onAddTrackedProject={() => void openPushDialog(null)}
            />
          </section>
        </>
      ) : (
        <VaultEmptyState
          gate={createGate}
          onCreate={openCreateDialog}
          onConnect={() => void openConnectDialog()}
        />
      )}

      {dialog?.kind === "create" && (
        <CreateVaultDialog
          open
          accounts={accounts}
          error={dialogError}
          isBusy={isBusy}
          onClose={() => setDialog(null)}
          onSubmit={({ name, isPrivate, owner }) =>
            void runVaultAction(() => bridge.createVaultRepo(name, isPrivate, owner || undefined))
          }
        />
      )}

      {dialog?.kind === "connect" && (
        <ConnectVaultDialog
          open
          discovered={discovered}
          isDiscovering={isDiscovering}
          error={dialogError}
          isBusy={isBusy}
          onClose={() => setDialog(null)}
          onSubmit={({ repoUrl, displayName }) =>
            void runVaultAction(() => bridge.connectVault(repoUrl, displayName || undefined))
          }
        />
      )}

      {dialog?.kind === "push" && (
        <PushToVaultDialog
          open
          vaultDisplayName={status?.name || "Team Vault"}
          targetVaultId={selectedVaultId}
          availableProjects={existingNames}
          assets={pushAssets}
          defaultProject={dialog.project}
          error={dialogError}
          isBusy={isBusy}
          onClose={() => setDialog(null)}
          onSubmit={(draft) => void handlePushSubmit(draft)}
        />
      )}

      {dialog?.kind === "import" && (
        <ImportFromVaultDialog
          open
          mergeMode={dialog.merge}
          item={dialog.item}
          existingNames={existingNames}
          existingPaths={existingPaths}
          localProjects={localProjects}
          homeDir={homeDirOf(tendrilHome)}
          error={dialogError}
          isBusy={isBusy}
          onClose={() => setDialog(null)}
          onSubmit={(request) => void handleImportSubmit(request, dialog.merge)}
        />
      )}

      {dialog?.kind === "delete" && (
        <ConfirmVaultDeleteDialog
          open
          projectName={dialog.item.name}
          error={dialogError}
          isBusy={isBusy}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            void runVaultAction(() => bridge.deleteVaultProject(dialog.item.name, selectedVaultId))
          }
        />
      )}
    </div>
  );
};
