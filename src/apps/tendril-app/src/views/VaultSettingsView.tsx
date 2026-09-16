import React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GitBranch, Plus, RefreshCw, GitPullRequest } from "lucide-react";
import { DensityProvider } from "@ivy-interactive/components";
import {
  Callout,
  Densities,
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ivy-interactive/components/ui";
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
  formatVaultRepo,
  seedRepoMappings,
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

/**
 * Which dialog is open, and what it is about. Only one vault dialog is ever open at a time.
 *
 * `import` covers all three of the original's entry points, and `update` is what separates them:
 * `Import` creates a new local project, `Link & Merge` (`merge`) combines with an existing one, and
 * `Update` replaces an already-imported project in place. Without the flag, Update behaved like
 * Import and produced a second project named `<name>-2` at a freshly cloned path.
 */
type VaultDialog =
  | { kind: "create" }
  | { kind: "connect" }
  | { kind: "push"; project: string | null }
  | { kind: "import"; item: VaultCatalogItem; merge: boolean; update?: boolean }
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
  branchName?: string | null;
}

/** The message a vault call left behind, whichever half of the result carries it. */
function resultMessage(result: VaultActionResult): string {
  return result.errorMessage?.trim() || result.message?.trim() || "";
}

/**
 * What a PR-opening call has to show for itself. `VaultSetupView.cs` falls back to the branch when the
 * PR could not be opened (no `gh` auth, for instance) — reporting only the message would leave the
 * operator with a pushed branch they have no way of finding.
 */
function resultReference(result: VaultActionResult, branchLabel = "branch"): string {
  const prUrl = result.prUrl?.trim();
  if (prUrl) return `Created PR: ${prUrl}`;
  const branch = result.branchName?.trim();
  return branch ? `Created ${branchLabel} ${branch}` : "";
}

/**
 * The Team Vault section of Settings: the only stateful piece of the vault UI.
 *
 * Every loader tolerates rejection with an inline error and an empty result, the way
 * `getProjectReviewActions` does — a vault that cannot be reached must not take the settings page
 * down with it. Actions that cannot work yet are disabled with the reason as their tooltip
 * (`computeVaultGate`) instead of failing against GitHub on click.
 *
 * The section is `Small` density throughout because `VaultSetupView.cs` marks every button, badge and
 * expander in it `.Small()`, and `max-w-240` is its `Size.Full().Max(Size.Units(240))`.
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
  const [pushPrUrl, setPushPrUrl] = React.useState<string | null>(null);

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

      // An explicitly picked vault wins even when it is not configured, the way `selectedVaultId` in
      // `VaultSetupView.cs` is only auto-corrected when it names no vault in the list at all.
      // Otherwise selecting a not-yet-cloned vault snapped straight back to a configured one.
      const active =
        loadedVaults.find((vault) => vault.id === vaultId) ??
        loadedVaults.find((vault) => vault.isConfigured) ??
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

  /**
   * A vault that is in `config.yaml` but reports `isConfigured: false` — disabled, or cloned nowhere
   * yet — still gets the full section, exactly as in `VaultSetupView.cs`, whose not-configured layout
   * is only returned when there is no vault at all. Requiring `isConfigured` here hid the picker and
   * the Sync button that are the only way to recover such a vault.
   */
  const hasVault = vaults.length > 0;
  const hasGitHubAuth = accounts.length > 0;
  const existingNames = projects.map((project) => project.name);
  const existingPaths = projects.flatMap((project) => project.repos);
  const localProjects = projects.map((project) => ({
    name: project.name,
    repos: project.repos,
  }));

  const createGate = computeVaultGate({ hasGitHubAuth, hasVault, isBusy, requires: ["github"] });
  const vaultGate = computeVaultGate({ hasGitHubAuth, hasVault, isBusy, requires: ["vault"] });

  /**
   * Whether there is anything a PR could carry: a project the vault does not have or has an older
   * copy of, unpushed vault commits, or simply a local project. `hasChangesToPublish` in
   * `VaultSetupView.cs`, which hides *Open a PR* rather than offering an empty one.
   */
  const hasChangesToPublish =
    catalog.some(
      (item) =>
        item.syncStatus === "LocalOnly" ||
        item.syncStatus === "UpdateAvailable" ||
        item.syncStatus === "Modified",
    ) ||
    (status?.commitsAhead ?? 0) > 0 ||
    projects.length > 0;

  /** Runs one mutation, keeping a failed result in the dialog and a successful one in the section. */
  const runVaultAction = async (
    work: () => Promise<VaultActionResult>,
    { closeOnSuccess = true, branchLabel }: { closeOnSuccess?: boolean; branchLabel?: string } = {},
  ): Promise<VaultActionResult | null> => {
    setIsBusy(true);
    setDialogError(null);
    try {
      const result = await work();
      if (!result.success) {
        setDialogError(resultMessage(result) || "The vault service reported a failure.");
        return null;
      }

      setNotice(
        [resultMessage(result), resultReference(result, branchLabel)].filter(Boolean).join(" — ") ||
          "Done.",
      );
      if (closeOnSuccess) setDialog(null);
      await refresh(selectedVaultId);
      return result;
    } catch (error) {
      setDialogError(String(error));
      return null;
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
   * `availablePushProjects` in `VaultSetupView.cs`: a project the vault knows but this machine does
   * not is added to the list, case-insensitively. Without it, *Publish* on such a row opened a dialog
   * whose default project was not one of its own options.
   */
  const pushProjectNames = (project: string | null): string[] =>
    project && !existingNames.some((name) => name.toLowerCase() === project.toLowerCase())
      ? [...existingNames, project]
      : existingNames;

  /**
   * The push dialog seeds its checkboxes from `assets` on mount, so the assets are collected before
   * it opens rather than arriving into an already-empty checklist.
   */
  const openPushDialog = async (project: string | null) => {
    setDialogError(null);
    setPushPrUrl(null);
    const names = pushProjectNames(project);
    const assets = await Promise.all(
      names.map((name) =>
        projects.some((entry) => entry.name === name)
          ? bridge.collectProjectAssets(name).catch(() => EMPTY_ASSETS(name))
          : // A vault-only project has nothing to collect locally, but it still needs an entry: the
            // dialog reads its checklist out of `assets` by project name.
            Promise.resolve(EMPTY_ASSETS(name)),
      ),
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

  /**
   * `Import`, `Link & Merge` and `Update`, which all reach the same dialog.
   *
   * The `update` branch is what `VaultSetupView.cs`'s one-click *Update* did: `import_project`
   * *replaces* the local project of the same name, so the target name and the repo paths must be the
   * existing project's, not a freshly suggested name under `~/git`. The original read the paths out
   * of the vault's `TrackedProjects[...].LocalRepoPaths`; `VaultStatus` does not carry those over the
   * wire in V2, so they are recovered by matching each vault repo against the local project's repo
   * folders — the same rule `seedRepoMappings` uses for a merge.
   */
  const handleImportSubmit = (
    request: VaultImportRequest,
    { merge, update, item }: { merge: boolean; update?: boolean; item: VaultCatalogItem },
  ) => {
    if (merge) {
      return runVaultAction(() => bridge.mergeVaultProject(request, selectedVaultId));
    }

    const localMatch = update
      ? (localProjects.find((p) => p.name.toLowerCase() === item.name.toLowerCase()) ?? null)
      : null;
    const payload = localMatch
      ? {
          ...request,
          targetLocalProjectName: item.name,
          localRepoMappings: seedRepoMappings(item.repos, homeDirOf(tendrilHome), localMatch),
        }
      : request;

    return runVaultAction(() => bridge.importVaultProject(payload, selectedVaultId));
  };

  const handlePushSubmit = async (draft: VaultExportDraft) => {
    const projectList = draft.projectNames.join(", ");
    const prTitle = `feat(vault): update ${projectList} to v${draft.version}`;
    const prBody = [
      `Publishes ${projectList} to the team vault at version \`${draft.version}\`.`,
      draft.changelog ? `\n## Changelog\n\n${draft.changelog}` : "",
      "\nOpened from the Tendril desktop app.",
    ]
      .filter(Boolean)
      .join("\n");

    /* The push dialog stays open on success and shows the PR link, the way `createdPrUrl` does. */
    const result = await runVaultAction(
      () =>
        bridge.pushToVault(
          { ...draft, targetVaultId: draft.targetVaultId ?? selectedVaultId, prTitle, prBody },
          selectedVaultId,
        ),
      { closeOnSuccess: false },
    );
    if (result) setPushPrUrl(result.prUrl?.trim() || null);
  };

  return (
    <DensityProvider density={Densities.Small}>
      <div className="max-w-240 space-y-4" data-testid="vault-settings-view">
        {errors.map((message) => (
          <Callout.Error key={message} data-testid="vault-settings-error">
            {message}
          </Callout.Error>
        ))}

        {notice && <Callout.Success data-testid="vault-settings-notice">{notice}</Callout.Success>}

        {hasVault && status ? (
          <>
            {/* `topHeader`: the vault picker on the left, the toolbar on the right. Both only exist
                once a vault does — until then the section is the empty state and nothing else. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Select value={selectedVaultId} onValueChange={(id) => void handleSelectVault(id)}>
                <SelectTrigger aria-label="Active vault" className="w-fit min-w-56">
                  <SelectValue placeholder="Select vault" />
                </SelectTrigger>
                {/* Every vault, not only the configured ones: `vaultOptions` is built from the whole
                    `vaultsList`, so a vault that has not been cloned yet is still selectable. */}
                <SelectContent>
                  {vaults.map((vault) => (
                    <SelectItem key={vault.id} value={vault.id}>
                      {formatVaultRepo(vault) || vault.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex flex-wrap items-center gap-2">
                {/* Not in the original, which reloads off its own `VaultChanged` event: without it a
                    failed first load would have nothing to retry with. */}
                <IconButton
                  label="Refresh"
                  size="sm"
                  disabled={isLoading || isBusy}
                  onClick={() => void refresh(selectedVaultId)}
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                </IconButton>
                {/* Gated rather than hidden: a disabled control with its reason tells the operator
                    what to fix, which is the whole point of the preflight check this ports. */}
                <GatedActionButton
                  gate={vaultGate}
                  variant="outline"
                  size="sm"
                  onClick={() => void runVaultAction(() => bridge.pullVaultLatest(selectedVaultId))}
                >
                  <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
                  Sync
                </GatedActionButton>
                {hasChangesToPublish && (
                  <GatedActionButton
                    gate={vaultGate}
                    variant="outline"
                    size="sm"
                    onClick={() => void openPushDialog(null)}
                  >
                    <GitPullRequest className="mr-1.5 size-3.5" aria-hidden="true" />
                    Open a PR
                  </GatedActionButton>
                )}
                <GatedActionButton
                  gate={createGate}
                  variant="outline"
                  size="sm"
                  onClick={() => void openConnectDialog()}
                >
                  <GitBranch className="mr-1.5 size-3.5" aria-hidden="true" />
                  Connect Vault
                </GatedActionButton>
                <GatedActionButton
                  gate={createGate}
                  variant="outline"
                  size="sm"
                  onClick={openCreateDialog}
                >
                  <Plus className="mr-1.5 size-3.5" aria-hidden="true" />
                  Create Vault
                </GatedActionButton>
              </div>
            </div>

            <VaultStatusCard
              status={status}
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
              <h4 className="text-sm font-semibold text-foreground">Shared Projects</h4>
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
                  setDialog({ kind: "import", item, merge: false, update: true });
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
            vaultDisplayName={status ? formatVaultRepo(status) : "Team Vault"}
            targetVaultId={selectedVaultId}
            availableProjects={pushProjectNames(dialog.project)}
            assets={pushAssets}
            defaultProject={dialog.project}
            error={dialogError}
            prUrl={pushPrUrl}
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
            onSubmit={(request) =>
              void handleImportSubmit(request, {
                merge: dialog.merge,
                update: dialog.update,
                item: dialog.item,
              })
            }
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
              void runVaultAction(
                () => bridge.deleteVaultProject(dialog.item.name, selectedVaultId),
                { branchLabel: "deletion branch" },
              )
            }
          />
        )}
      </div>
    </DensityProvider>
  );
};
