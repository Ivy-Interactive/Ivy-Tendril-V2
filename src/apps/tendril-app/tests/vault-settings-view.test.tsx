import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { VaultSettingsView } from "../src/views/VaultSettingsView";
import { bridge } from "../src/api/bridge";
import type { ProjectSummary, VaultCatalog, VaultCatalogItem, VaultStatus } from "../src/types/api";

function vaultStatus(overrides: Partial<VaultStatus> = {}): VaultStatus {
  return {
    id: "v1",
    name: "Tendril-Vault",
    isConfigured: true,
    repoUrl: "https://github.com/acme/Tendril-Vault.git",
    localPath: "/Users/test/.tendril/Vault",
    currentBranch: "main",
    commitsAhead: 0,
    commitsBehind: 0,
    alwaysUpToDate: false,
    ...overrides,
  };
}

function catalogItem(overrides: Partial<VaultCatalogItem> = {}): VaultCatalogItem {
  return {
    name: "Alpha",
    description: "",
    color: "blue",
    remoteVersion: "2026.01.01.120000",
    reposCount: 0,
    skillsCount: 0,
    mcpsCount: 0,
    memoriesCount: 0,
    reviewActionsCount: 0,
    verificationsCount: 0,
    skillNames: [],
    mcpServerNames: [],
    memoryFileNames: [],
    reviewActionNames: [],
    verificationNames: [],
    syncStatus: "NotImported",
    repos: [],
    hasLocalConflict: false,
    ...overrides,
  };
}

const catalog = (items: VaultCatalogItem[]): VaultCatalog => ({
  projects: items,
  globalSkills: [],
  globalMcps: [],
});

const localProject = (name: string): ProjectSummary => ({
  name,
  repos: [`/Users/test/git/${name}`],
  verifications: [],
});

/**
 * Stubs the whole vault surface of the bridge, so a test only states what it cares about. Every
 * loader is spied on rather than mocked at the module level: the view is allowed to know the bridge,
 * and asserting on these spies is how "the wrappers are the only adapter" is checked.
 */
function stubBridge(
  options: {
    vaults?: VaultStatus[];
    status?: VaultStatus;
    catalog?: VaultCatalog | Error;
    accounts?: { login: string; type: string }[];
    projects?: ProjectSummary[];
  } = {},
) {
  const vaults = options.vaults ?? [];
  const status = options.status ?? vaults[0] ?? vaultStatus();

  const listVaults = vi.spyOn(bridge, "listVaults").mockResolvedValue(vaults);
  const getVaultStatus = vi.spyOn(bridge, "getVaultStatus").mockResolvedValue(status);
  const getVaultCatalog = vi.spyOn(bridge, "getVaultCatalog");
  if (options.catalog instanceof Error) {
    getVaultCatalog.mockRejectedValue(options.catalog);
  } else {
    getVaultCatalog.mockResolvedValue(options.catalog ?? catalog([]));
  }
  const listGitHubAccounts = vi
    .spyOn(bridge, "listGitHubAccounts")
    .mockResolvedValue(options.accounts ?? [{ login: "acme", type: "Organization" }]);
  const listProjects = vi.spyOn(bridge, "listProjects").mockResolvedValue(options.projects ?? []);

  return {
    listVaults,
    getVaultStatus,
    getVaultCatalog,
    listGitHubAccounts,
    listProjects,
    createVaultRepo: vi.spyOn(bridge, "createVaultRepo"),
    pullVaultLatest: vi.spyOn(bridge, "pullVaultLatest"),
    collectProjectAssets: vi
      .spyOn(bridge, "collectProjectAssets")
      .mockImplementation(async (projectName: string) => ({
        projectName,
        skills: [],
        mcpServers: [],
        memories: [],
        reviewActions: [],
        verifications: [],
      })),
    setVaultAlwaysUpToDate: vi
      .spyOn(bridge, "setVaultAlwaysUpToDate")
      .mockResolvedValue({ success: true, message: "Saved" }),
    importVaultProject: vi
      .spyOn(bridge, "importVaultProject")
      .mockResolvedValue({ success: true, message: "Imported" }),
    mergeVaultProject: vi
      .spyOn(bridge, "mergeVaultProject")
      .mockResolvedValue({ success: true, message: "Merged" }),
  };
}

describe("VaultSettingsView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers create and connect while no vault is configured", async () => {
    stubBridge({ vaults: [] });

    render(<VaultSettingsView tendrilHome="/Users/test/.tendril" />);

    expect(await screen.findByTestId("vault-empty-state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create GitHub Vault/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Connect Existing Git Vault/ })).toBeEnabled();
    expect(screen.queryByTestId("vault-status-card")).not.toBeInTheDocument();
  });

  it("disables the create action with the sign-in reason and calls nothing when signed out", async () => {
    const spies = stubBridge({ vaults: [], accounts: [] });

    render(<VaultSettingsView />);

    const create = await screen.findByRole("button", { name: /Create GitHub Vault/ });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute("title", "Sign in to GitHub to create or connect a vault");

    fireEvent.click(create);
    expect(spies.createVaultRepo).not.toHaveBeenCalled();
    expect(screen.queryByTestId("create-vault-dialog")).not.toBeInTheDocument();
  });

  /* `VaultSetupView.cs` returns the not-configured layout and nothing else while no vault exists:
     the picker, the details and the whole toolbar only come with a vault. */
  it("shows no vault toolbar at all until a vault exists", async () => {
    const spies = stubBridge({ vaults: [], projects: [localProject("Alpha")] });

    render(<VaultSettingsView />);

    await screen.findByTestId("vault-empty-state");
    expect(screen.queryByRole("button", { name: /^Sync$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open a PR/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Active vault" })).not.toBeInTheDocument();
    expect(spies.pullVaultLatest).not.toHaveBeenCalled();
    expect(spies.collectProjectAssets).not.toHaveBeenCalled();
  });

  it("offers sync, publish, connect and create once a vault is configured", async () => {
    stubBridge({ vaults: [vaultStatus()], projects: [localProject("Alpha")] });

    render(<VaultSettingsView />);

    await screen.findByTestId("vault-status-card");
    for (const name of [/^Sync$/, /Open a PR/, /Connect Vault/, /Create Vault/]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
  });

  /* `hasChangesToPublish`: with no local project and nothing unpublished there is no PR to open. */
  it("hides Open a PR when there is nothing to publish", async () => {
    stubBridge({ vaults: [vaultStatus()], projects: [] });

    render(<VaultSettingsView />);

    await screen.findByTestId("vault-status-card");
    expect(screen.queryByRole("button", { name: /Open a PR/ })).not.toBeInTheDocument();
  });

  it("shows the connected vault and persists the always-in-sync toggle", async () => {
    const spies = stubBridge({
      vaults: [vaultStatus({ commitsBehind: 2 })],
      status: vaultStatus({ commitsBehind: 2 }),
    });

    render(<VaultSettingsView tendrilHome="/Users/test/.tendril" />);

    const card = await screen.findByTestId("vault-status-card");
    expect(within(card).getByRole("button", { name: "acme/Tendril-Vault" })).toBeInTheDocument();
    expect(within(card).getByText("main")).toBeInTheDocument();
    expect(within(card).getByTestId("vault-git-status")).toHaveTextContent("2 behind");
    expect(within(card).getByTestId("vault-git-status")).toHaveClass("text-destructive");
    expect(within(card).getByText("Never")).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("checkbox", { name: "Always in sync" }));

    await waitFor(() => {
      expect(spies.setVaultAlwaysUpToDate).toHaveBeenCalledWith(true, "v1");
    });
  });

  it("marks an in-sync vault with a tick and a synced-at stamp", async () => {
    const synced = vaultStatus({ lastSyncedAt: "2026-01-02T03:04:05Z" });
    stubBridge({ vaults: [synced], status: synced });

    render(<VaultSettingsView />);

    const card = await screen.findByTestId("vault-status-card");
    expect(within(card).getByTestId("vault-git-status")).toHaveTextContent("✓ In sync");
    expect(within(card).getByText("Jan 2, 2026 03:04 UTC")).toBeInTheDocument();
  });

  it("routes a name conflict through merge and a new project through import", async () => {
    const spies = stubBridge({
      vaults: [vaultStatus()],
      catalog: catalog([
        catalogItem({ name: "Alpha", syncStatus: "Conflict", hasLocalConflict: true }),
        catalogItem({ name: "Beta", syncStatus: "NotImported" }),
      ]),
      projects: [localProject("Alpha")],
    });

    render(<VaultSettingsView tendrilHome="/Users/test/.tendril" />);

    const alpha = await screen.findByTestId("vault-project-row-Alpha");
    fireEvent.click(within(alpha).getByRole("button", { name: /Link & Merge/ }));

    const mergeDialog = await screen.findByTestId("merge-vault-dialog");
    fireEvent.click(within(mergeDialog).getByRole("button", { name: "Link & Merge" }));

    await waitFor(() => {
      expect(spies.mergeVaultProject).toHaveBeenCalledWith(
        expect.objectContaining({ projectName: "Alpha", targetLocalProjectName: "Alpha" }),
        "v1",
      );
    });
    expect(spies.importVaultProject).not.toHaveBeenCalled();

    const beta = await screen.findByTestId("vault-project-row-Beta");
    fireEvent.click(within(beta).getByRole("button", { name: /Import/ }));

    const importDialog = await screen.findByTestId("import-vault-dialog");
    fireEvent.click(within(importDialog).getByRole("button", { name: "Import Project" }));

    await waitFor(() => {
      expect(spies.importVaultProject).toHaveBeenCalledWith(
        expect.objectContaining({ projectName: "Beta", targetLocalProjectName: "Beta" }),
        "v1",
      );
    });
  });

  /**
   * `VaultSetupView.cs`'s one-click *Update* calls `ImportProjectAsync` with the tracked project's
   * own repo paths, and `import_project` replaces the local project of the same name. Routing Update
   * through the plain import path instead produced a second project (`Alpha-2`) at a newly cloned
   * path and left the original untouched.
   */
  it("updates an already-imported project in place instead of creating a second one", async () => {
    const spies = stubBridge({
      vaults: [vaultStatus()],
      catalog: catalog([
        catalogItem({
          name: "Alpha",
          syncStatus: "UpdateAvailable",
          repos: [{ owner: "acme", name: "Alpha" }],
        }),
      ]),
      projects: [localProject("Alpha")],
    });

    render(<VaultSettingsView tendrilHome="/Users/test/.tendril" />);

    const alpha = await screen.findByTestId("vault-project-row-Alpha");
    fireEvent.click(within(alpha).getByRole("button", { name: /Update/ }));

    const dialog = await screen.findByTestId("import-vault-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Import Project" }));

    await waitFor(() => {
      expect(spies.importVaultProject).toHaveBeenCalledWith(
        expect.objectContaining({
          projectName: "Alpha",
          targetLocalProjectName: "Alpha",
          localRepoMappings: { "acme/Alpha": "/Users/test/git/Alpha" },
        }),
        "v1",
      );
    });
    expect(spies.mergeVaultProject).not.toHaveBeenCalled();
  });

  /* A vault in config.yaml whose clone is missing reports `isConfigured: false`. The original still
     renders the picker and the toolbar for it, which is the only way to sync it into existence. */
  it("still offers the toolbar for a vault that has not been cloned yet", async () => {
    const pending = vaultStatus({ isConfigured: false, currentBranch: "" });
    stubBridge({ vaults: [pending], status: pending });

    render(<VaultSettingsView />);

    await screen.findByTestId("vault-status-card");
    expect(screen.getByRole("button", { name: /^Sync$/ })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Active vault" })).toBeInTheDocument();
    expect(screen.queryByTestId("vault-empty-state")).not.toBeInTheDocument();
  });

  /* `availablePushProjects`: without the vault-only name in the list, the dialog opened preselecting
     a project that was not one of its own checkboxes, so Submit published nothing. */
  it("offers a vault-only project as a push target", async () => {
    stubBridge({
      vaults: [vaultStatus()],
      catalog: catalog([catalogItem({ name: "Zeta", syncStatus: "UpToDate" })]),
      projects: [localProject("Alpha")],
    });

    render(<VaultSettingsView />);

    const zeta = await screen.findByTestId("vault-project-row-Zeta");
    fireEvent.click(within(zeta).getByRole("button", { name: /Open PR/ }));

    const dialog = await screen.findByTestId("push-vault-dialog");
    expect(within(dialog).getByTestId("push-project-Zeta")).toBeInTheDocument();
    expect(within(dialog).getByTestId("push-project-Alpha")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /Zeta/ })).toBeChecked();
  });

  it("reports the branch a PR-less deletion left behind", async () => {
    stubBridge({
      vaults: [vaultStatus()],
      catalog: catalog([catalogItem({ name: "Alpha", syncStatus: "UpToDate" })]),
    });
    vi.spyOn(bridge, "deleteVaultProject").mockResolvedValue({
      success: true,
      branchName: "vault/delete-Alpha",
    });

    render(<VaultSettingsView />);

    const alpha = await screen.findByTestId("vault-project-row-Alpha");
    fireEvent.click(within(alpha).getByRole("button", { name: /Delete 'Alpha' from vault/ }));

    const confirm = await screen.findByTestId("confirm-vault-delete-dialog");
    fireEvent.click(within(confirm).getByRole("button", { name: /Create Deletion PR/ }));

    await waitFor(() =>
      expect(screen.getByTestId("vault-settings-notice")).toHaveTextContent(
        "Created deletion branch vault/delete-Alpha",
      ),
    );
  });

  it("keeps the section usable when the catalog cannot be read", async () => {
    stubBridge({
      vaults: [vaultStatus()],
      catalog: new Error("vault unreachable"),
    });

    render(<VaultSettingsView />);

    const error = await screen.findByTestId("vault-settings-error");
    expect(error).toHaveTextContent(/Could not read the vault catalog/);
    expect(screen.getByTestId("vault-settings-view")).toBeInTheDocument();
    expect(screen.getByTestId("vault-status-card")).toBeInTheDocument();
  });
});
