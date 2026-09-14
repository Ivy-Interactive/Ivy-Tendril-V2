import { invoke } from "@tauri-apps/api/core";
import type {
  CreateProjectRequest,
  DoctorCheck,
  DraftComment,
  GitHubIssuesPage,
  Job,
  JobDetail,
  ModelCatalogStatus,
  OnboardingStatus,
  PlanDetail,
  PlanQuery,
  PlanSummary,
  PrStatus,
  PrSyncReport,
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
  VerificationReport,
  VerificationStatus,
} from "../types/api";

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
    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        return await invoke<unknown>("cmd_execute_review_action", {
          projectName,
          actionName,
          planId,
          worktree,
        });
      }
    } catch {
      // Fall back to direct fetch if Tauri invoke is not available
    }

    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectName)}/review-actions/${encodeURIComponent(actionName)}/execute`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, worktree }),
      },
    );
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Execution failed (${res.status}): ${err}`);
    }
    return res.json().catch(() => ({ status: "ok" }));
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

  async runDoctor(this: void): Promise<DoctorCheck[]> {
    return invoke<DoctorCheck[]>("cmd_run_doctor");
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
