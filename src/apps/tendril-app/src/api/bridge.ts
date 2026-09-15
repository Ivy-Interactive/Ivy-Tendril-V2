import { invoke } from "@tauri-apps/api/core";
import type {
  AgentCostBreakdown,
  CreateProjectRequest,
  DashboardActivity,
  DiscoveredVaultRepo,
  DoctorCheck,
  DraftComment,
  GitHubAccountOption,
  GitHubIssuesPage,
  InboxProposal,
  Job,
  JobDetail,
  ModelCatalogStatus,
  OnboardingStatus,
  PlanDetail,
  PlanQuery,
  PlanSummary,
  PrStatus,
  PrSyncReport,
  ProjectAssets,
  ProjectSummary,
  RecentMergedPr,
  RecentPlanCost,
  RecommendationItem,
  RecommendationState,
  RepoStatus,
  ReviewActionConfig,
  RevisionResult,
  ServiceHealth,
  ServiceInfo,
  ShippedFeatureDay,
  StartJobArgs,
  StartJobResponse,
  SubscribeOutcome,
  SweepReport,
  TendrilConfig,
  VaultCatalog,
  VaultExportRequest,
  VaultImportRequest,
  VaultPrResult,
  VaultResult,
  VaultStatus,
  VerificationReport,
  VerificationStatus,
  VersionInfo,
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

  /* `Headers` rather than an object spread: `HeadersInit` also allows an array of pairs, and
     spreading one of those would turn it into numeric keys. */
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(path, { ...init, headers });
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

  /**
   * Every inline diff comment drafted against a plan, across all revision pairs.
   *
   * The mutations below all return the plan's new full list, so a caller replaces its state from
   * the response instead of guessing at the outcome.
   */
  async listDiffComments(this: void, planId: string): Promise<DraftComment[]> {
    return invoke<DraftComment[]>("cmd_list_diff_comments", { planId });
  },

  async upsertDiffComment(
    this: void,
    planId: string,
    comment: DraftComment,
  ): Promise<DraftComment[]> {
    return invoke<DraftComment[]>("cmd_upsert_diff_comment", { planId, comment });
  },

  async deleteDiffComment(
    this: void,
    planId: string,
    filePath: string,
    changeKey: string,
  ): Promise<DraftComment[]> {
    return invoke<DraftComment[]>("cmd_delete_diff_comment", { planId, filePath, changeKey });
  },

  async clearDiffComments(this: void, planId: string): Promise<void> {
    return invoke<void>("cmd_clear_diff_comments", { planId });
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

  /**
   * `declineReason` and `notes` are separate fields, not one field reused: a
   * decline reason is why the recommendation was rejected, a note is why it was
   * accepted. Pass `notes` with `AcceptedWithNotes` and `declineReason` with
   * `Declined`.
   */
  async setRecommendationState(
    this: void,
    planId: string,
    title: string,
    state: RecommendationState,
    declineReason?: string,
    notes?: string,
  ): Promise<void> {
    return invoke<void>("cmd_set_recommendation_state", {
      planId,
      title,
      state,
      declineReason,
      notes,
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

  async listPullRequests(this: void): Promise<PrStatus[]> {
    return invoke<PrStatus[]>("cmd_list_pull_requests");
  },

  /** Rejects with code `PR_SYNC_IN_PROGRESS` when the daemon is already reconciling. */
  async syncPullRequests(this: void): Promise<PrSyncReport> {
    return invoke<PrSyncReport>("cmd_sync_pull_requests");
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

  async createProject(this: void, request: CreateProjectRequest): Promise<unknown> {
    return invoke<unknown>("cmd_create_project", { request });
  },

  async getConfig(this: void): Promise<TendrilConfig> {
    return invoke<TendrilConfig>("cmd_get_config");
  },

  /** Merges a single top-level key into `config.yaml`, leaving every other key untouched. */
  async putConfig(this: void, key: string, value: unknown): Promise<void> {
    return invoke<void>("cmd_put_config", { key, value });
  },

  async getOnboardingStatus(this: void): Promise<OnboardingStatus> {
    return invoke<OnboardingStatus>("cmd_get_onboarding_status");
  },

  async completeOnboarding(this: void): Promise<void> {
    return invoke<void>("cmd_complete_onboarding");
  },

  async dismissOnboarding(this: void): Promise<void> {
    return invoke<void>("cmd_dismiss_onboarding");
  },

  async subscribeNewsletter(this: void, email: string): Promise<SubscribeOutcome> {
    return invoke<SubscribeOutcome>("cmd_subscribe_newsletter", { email });
  },

  async runDoctor(this: void): Promise<DoctorCheck[]> {
    return invoke<DoctorCheck[]>("cmd_run_doctor");
  },

  async getModelsStatus(this: void): Promise<ModelCatalogStatus> {
    return invoke<ModelCatalogStatus>("cmd_get_models_status");
  },

  async refreshModels(this: void): Promise<ModelCatalogStatus> {
    return invoke<ModelCatalogStatus>("cmd_refresh_models");
  },

  async getVersionInfo(this: void): Promise<VersionInfo> {
    return invoke<VersionInfo>("cmd_get_version_info");
  },

  async checkVersionNow(this: void): Promise<VersionInfo> {
    return invoke<VersionInfo>("cmd_check_version_now");
  },

  async saveUiState(this: void, key: string, value: string): Promise<void> {
    return invoke<void>("cmd_save_ui_state", { key, value });
  },

  async loadUiState(this: void, key: string): Promise<string | null> {
    return invoke<string | null>("cmd_load_ui_state", { key });
  },

  /**
   * Monthly rollups, the daily series and the month's projection in one call. The projection is
   * computed by the daemon, not here, so there is exactly one implementation of it.
   */
  async getDashboardActivity(this: void, months?: number): Promise<DashboardActivity> {
    return invoke<DashboardActivity>("cmd_get_dashboard_activity", { months });
  },

  async getShippedFeatures(this: void, days?: number): Promise<ShippedFeatureDay[]> {
    return invoke<ShippedFeatureDay[]>("cmd_get_shipped_features", { days });
  },

  async getRecentMergedPrs(this: void, limit?: number): Promise<RecentMergedPr[]> {
    return invoke<RecentMergedPr[]>("cmd_get_recent_merged_prs", { limit });
  },

  async getRecentPlanCosts(this: void, days?: number): Promise<RecentPlanCost[]> {
    return invoke<RecentPlanCost[]>("cmd_get_recent_plan_costs", { days });
  },

  async getAgentCostBreakdown(this: void, days?: number): Promise<AgentCostBreakdown[]> {
    return invoke<AgentCostBreakdown[]>("cmd_get_agent_cost_breakdown", { days });
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

  /**
   * Forces an assigned-issue sweep. Resolves for both `Ran` and
   * `AlreadyRunning` — read `outcome` to tell them apart. Rejects when the
   * daemon is not the master, since it cannot do the work.
   */
  async checkInbox(this: void): Promise<SweepReport> {
    return invoke<SweepReport>("cmd_check_inbox");
  },

  /** Swept issues awaiting a decision. Omitting `state` returns the pending ones. */
  async listInboxProposals(this: void, state?: string): Promise<InboxProposal[]> {
    return invoke<InboxProposal[]>("cmd_list_inbox_proposals", { state });
  },

  async acceptInboxProposal(this: void, id: number): Promise<{ jobId: string }> {
    return invoke<{ jobId: string }>("cmd_accept_inbox_proposal", { id });
  },

  async dismissInboxProposal(this: void, id: number): Promise<void> {
    await invoke("cmd_dismiss_inbox_proposal", { id });
  },
};
