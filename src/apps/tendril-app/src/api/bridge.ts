import { invoke } from "@tauri-apps/api/core";
import type {
  DiscoveredVaultRepo,
  GitHubAccountOption,
  GitHubIssuesPage,
  Job,
  JobDetail,
  ModelCatalogStatus,
  PlanDetail,
  PlanQuery,
  PlanSummary,
  ProjectAssets,
  ProjectSummary,
  RecommendationItem,
  RecommendationState,
  RepoStatus,
  ReviewActionConfig,
  RevisionResult,
  ServiceHealth,
  ServiceInfo,
  StartJobArgs,
  StartJobResponse,
  TendrilConfig,
  VaultCatalog,
  VaultExportRequest,
  VaultImportRequest,
  VaultPrResult,
  VaultResult,
  VaultStatus,
  VerificationReport,
  VerificationStatus,
} from "../types/api";

/**
 * A call that prefers Tauri IPC and falls back to the daemon over HTTP.
 *
 * IPC is the real path: the daemon's bearer secret is read from `.master` on the native side and never
 * enters the webview, so only the Rust command can authenticate. The `fetch` is for running the UI in
 * a plain browser during development, where the dev server proxies `/api`.
 */
async function invokeOrFetch<T>(
  command: string,
  args: Record<string, unknown>,
  path: string,
  init?: RequestInit,
): Promise<T> {
  try {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      return await invoke<T>(command, args);
    }
  } catch {
    // Fall back to direct fetch if Tauri invoke is not available
  }

  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    /* A failed vault result answers 500 carrying the message the dialogs show, so it is a value
       rather than an error — see `vault_request` in src-tauri. */
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object" && (body as { success?: unknown }).success === false) {
      return body as T;
    }
    throw new Error(`Request to ${path} failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** `default` is the id the service resolves to the primary vault. */
function vaultPath(vaultId: string | undefined, suffix = ""): string {
  return `/api/vaults/${encodeURIComponent(vaultId?.trim() || "default")}${suffix}`;
}

export const bridge = {
  async checkServiceHealth(this: void): Promise<ServiceHealth> {
    return invoke<ServiceHealth>("cmd_check_service_health");
  },

  async getServiceInfo(this: void): Promise<ServiceInfo> {
    return invoke<ServiceInfo>("cmd_get_service_info");
  },

  async getServiceLogs(this: void, lines?: number): Promise<string[]> {
    return invoke<string[]>("cmd_get_service_logs", { lines });
  },

  async restartService(this: void): Promise<ServiceInfo> {
    return invoke<ServiceInfo>("cmd_restart_service");
  },

  async repairService(this: void): Promise<string> {
    return invoke<string>("cmd_repair_service");
  },

  async switchServiceMode(this: void, mode: string): Promise<ServiceInfo> {
    return invoke<ServiceInfo>("cmd_switch_service_mode", { mode });
  },

  async listPlans(this: void, query?: PlanQuery): Promise<PlanSummary[]> {
    return invoke<PlanSummary[]>("cmd_list_plans", { query });
  },

  async getPlan(this: void, id: string): Promise<PlanDetail> {
    return invoke<PlanDetail>("cmd_get_plan", { id });
  },

  async updatePlanField(
    this: void,
    id: string,
    field: string,
    value: string,
    allowFailed?: boolean,
  ): Promise<void> {
    return invoke<void>("cmd_update_plan_field", {
      id,
      field,
      value,
      allowFailed,
    });
  },

  /**
   * Permanently delete a plan folder and its database row. Rejects with a
   * `CONFLICT` bridge error while a job still holds the plan.
   */
  async deletePlan(this: void, id: string): Promise<void> {
    return invoke<void>("cmd_delete_plan", { id });
  },

  /**
   * Send a plan back to Draft and remove its worktrees. Rejects with a
   * `CONFLICT` bridge error for Completed/Skipped plans and for running ones.
   */
  async resetPlan(this: void, id: string): Promise<void> {
    return invoke<void>("cmd_reset_plan", { id });
  },

  /** Uncommitted-change status of each repo the plan targets. */
  async getRepoStatus(this: void, id: string): Promise<RepoStatus[]> {
    return invoke<RepoStatus[]>("cmd_get_repo_status", { id });
  },

  async getRevision(this: void, id: string, number?: number): Promise<string> {
    return invoke<string>("cmd_get_revision", { id, number });
  },

  async writeRevision(this: void, id: string, content: string): Promise<RevisionResult> {
    return invoke<RevisionResult>("cmd_write_revision", { id, content });
  },

  /** Markdown of one `<planFolder>/Verification/<name>.md` report. */
  async getVerificationReport(
    this: void,
    planId: string,
    name: string,
  ): Promise<VerificationReport> {
    return invoke<VerificationReport>("cmd_get_verification_report", {
      planId,
      name,
    });
  },

  /** Every verification report that exists on disk for a plan. */
  async listVerificationReports(this: void, planId: string): Promise<VerificationReport[]> {
    return invoke<VerificationReport[]>("cmd_list_verification_reports", {
      planId,
    });
  },

  async setVerificationStatus(
    this: void,
    planId: string,
    name: string,
    status: VerificationStatus,
  ): Promise<void> {
    return invoke<void>("cmd_set_verification_status", {
      planId,
      name,
      status,
    });
  },

  async listRecommendations(this: void, planId: string): Promise<RecommendationItem[]> {
    return invoke<RecommendationItem[]>("cmd_list_recommendations", { planId });
  },

  async setRecommendationState(
    this: void,
    planId: string,
    title: string,
    state: RecommendationState,
    declineReason?: string,
  ): Promise<void> {
    return invoke<void>("cmd_set_recommendation_state", {
      planId,
      title,
      state,
      declineReason,
    });
  },

  async listJobs(this: void, status?: string, limit?: number): Promise<Job[]> {
    return invoke<Job[]>("cmd_list_jobs", { status, limit });
  },

  async getJob(this: void, id: string): Promise<JobDetail> {
    return invoke<JobDetail>("cmd_get_job", { id });
  },

  async startJob(this: void, args: StartJobArgs): Promise<StartJobResponse> {
    return invoke<StartJobResponse>("cmd_start_job", { args });
  },

  async cancelJob(this: void, id: string, message?: string): Promise<void> {
    return invoke<void>("cmd_cancel_job", { id, message });
  },

  async listProjects(this: void): Promise<ProjectSummary[]> {
    return invoke<ProjectSummary[]>("cmd_list_projects");
  },

  async getProjectReviewActions(this: void, projectName: string): Promise<ReviewActionConfig[]> {
    try {
      const projects = await bridge.listProjects();
      const proj = projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase());
      return proj?.reviewActions ?? [];
    } catch {
      return [];
    }
  },

  async executeReviewAction(
    this: void,
    projectName: string,
    actionName: string,
    planId?: string,
    worktree?: string,
  ): Promise<unknown> {
    return invokeOrFetch<unknown>(
      "cmd_execute_review_action",
      { projectName, actionName, planId, worktree },
      `/api/projects/${encodeURIComponent(projectName)}/review-actions/${encodeURIComponent(actionName)}/execute`,
      { method: "POST", body: JSON.stringify({ planId, worktree }) },
    );
  },

  async getConfig(this: void): Promise<TendrilConfig> {
    return invoke<TendrilConfig>("cmd_get_config");
  },

  async getModelsStatus(this: void): Promise<ModelCatalogStatus> {
    return invoke<ModelCatalogStatus>("cmd_get_models_status");
  },

  async refreshModels(this: void): Promise<ModelCatalogStatus> {
    return invoke<ModelCatalogStatus>("cmd_refresh_models");
  },

  async saveUiState(this: void, key: string, value: string): Promise<void> {
    return invoke<void>("cmd_save_ui_state", { key, value });
  },

  async loadUiState(this: void, key: string): Promise<string | null> {
    return invoke<string | null>("cmd_load_ui_state", { key });
  },

  /* --- Team Vault ------------------------------------------------------------------------------
     These wrappers are the only place that knows command names and route shapes: the vault
     components take plain data and callbacks. `vaultId` is optional everywhere — omitting it means
     the primary vault, which is what `default` resolves to on the service. */

  async listVaults(this: void): Promise<VaultStatus[]> {
    return invokeOrFetch<VaultStatus[]>("cmd_vault_list", {}, "/api/vaults");
  },

  async getVaultStatus(this: void, vaultId?: string): Promise<VaultStatus> {
    return invokeOrFetch<VaultStatus>("cmd_vault_status", { vaultId }, vaultPath(vaultId));
  },

  async getVaultCatalog(this: void, vaultId?: string): Promise<VaultCatalog> {
    return invokeOrFetch<VaultCatalog>(
      "cmd_vault_catalog",
      { vaultId },
      vaultPath(vaultId, "/catalog"),
    );
  },

  /** The GitHub identities a vault can be created under. Empty means "not signed in". */
  async listGitHubAccounts(this: void): Promise<GitHubAccountOption[]> {
    return invokeOrFetch<GitHubAccountOption[]>(
      "cmd_vault_github_accounts",
      {},
      "/api/vaults/accounts",
    );
  },

  /** Repositories on GitHub that look like a Tendril vault, for the connect dialog. */
  async discoverVaults(this: void): Promise<DiscoveredVaultRepo[]> {
    return invokeOrFetch<DiscoveredVaultRepo[]>("cmd_vault_discover", {}, "/api/vaults/discover");
  },

  async createVaultRepo(
    this: void,
    name: string,
    isPrivate: boolean,
    org?: string,
  ): Promise<VaultResult> {
    return invokeOrFetch<VaultResult>(
      "cmd_vault_create",
      { name, isPrivate, org },
      "/api/vaults/create",
      { method: "POST", body: JSON.stringify({ repoName: name, private: isPrivate, org }) },
    );
  },

  async connectVault(this: void, repoUrl: string, name?: string): Promise<VaultResult> {
    return invokeOrFetch<VaultResult>("cmd_vault_connect", { repoUrl, name }, "/api/vaults", {
      method: "POST",
      body: JSON.stringify({ repoUrl, name }),
    });
  },

  /** Forget a vault. The clone is left on disk, so nothing local is lost. */
  async disconnectVault(this: void, vaultId?: string): Promise<VaultResult> {
    return invokeOrFetch<VaultResult>("cmd_vault_disconnect", { vaultId }, vaultPath(vaultId), {
      method: "DELETE",
    });
  },

  async setVaultAlwaysUpToDate(
    this: void,
    alwaysUpToDate: boolean,
    vaultId?: string,
  ): Promise<VaultResult> {
    return invokeOrFetch<VaultResult>(
      "cmd_vault_set_always_up_to_date",
      { vaultId, alwaysUpToDate },
      vaultPath(vaultId),
      { method: "PUT", body: JSON.stringify({ alwaysUpToDate }) },
    );
  },

  async pullVaultLatest(this: void, vaultId?: string): Promise<VaultResult> {
    return invokeOrFetch<VaultResult>("cmd_vault_pull", { vaultId }, vaultPath(vaultId, "/pull"), {
      method: "POST",
    });
  },

  /** What a local project could publish, for the push dialog's asset checklists. */
  async collectProjectAssets(this: void, projectName: string): Promise<ProjectAssets> {
    return invokeOrFetch<ProjectAssets>(
      "cmd_vault_project_assets",
      { projectName },
      `/api/vaults/project-assets/${encodeURIComponent(projectName)}`,
    );
  },

  async pushToVault(
    this: void,
    request: VaultExportRequest,
    vaultId?: string,
  ): Promise<VaultPrResult> {
    return invokeOrFetch<VaultPrResult>(
      "cmd_vault_push",
      { request, vaultId },
      vaultPath(vaultId, "/push"),
      { method: "POST", body: JSON.stringify(request) },
    );
  },

  async importVaultProject(
    this: void,
    request: VaultImportRequest,
    vaultId?: string,
  ): Promise<VaultResult> {
    return invokeOrFetch<VaultResult>(
      "cmd_vault_import",
      { request, vaultId },
      vaultPath(vaultId, "/projects"),
      { method: "POST", body: JSON.stringify({ ...request, merge: false }) },
    );
  },

  /** Adopt a vault project into the local project of the same name, keeping local repo paths. */
  async mergeVaultProject(
    this: void,
    request: VaultImportRequest,
    vaultId?: string,
  ): Promise<VaultResult> {
    return invokeOrFetch<VaultResult>(
      "cmd_vault_merge",
      { request, vaultId },
      vaultPath(vaultId, "/projects"),
      { method: "POST", body: JSON.stringify({ ...request, merge: true }) },
    );
  },

  /** Opens a PR that removes the project from the vault; the local project is untouched. */
  async deleteVaultProject(
    this: void,
    projectName: string,
    vaultId?: string,
  ): Promise<VaultPrResult> {
    return invokeOrFetch<VaultPrResult>(
      "cmd_vault_delete_project",
      { projectName, vaultId },
      vaultPath(vaultId, `/projects/${encodeURIComponent(projectName)}`),
      { method: "DELETE" },
    );
  },

  async listGitHubIssues(
    this: void,
    repo?: string,
    category?: string,
    page?: number,
    perPage?: number,
  ): Promise<GitHubIssuesPage> {
    return invoke<GitHubIssuesPage>("cmd_list_github_issues", {
      repo,
      category,
      page,
      perPage,
    });
  },
};
