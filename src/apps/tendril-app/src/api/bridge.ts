import { invoke } from "@tauri-apps/api/core";
import {
  decodeBase64,
  onReviewActionEvent,
  subscribeReviewAction,
  type EventUnsubscribe,
  type ReviewActionEvent,
  type ReviewActionSession,
} from "./events";
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

export type { ReviewActionSession } from "./events";

export interface ReviewActionRunOptions {
  planId?: string;
  worktree?: string;
  /** One chunk of raw terminal output: escapes, bare carriage returns and partial sequences included. */
  onChunk?: (bytes: Uint8Array) => void;
  /** The process's exit message, after which no more output arrives. */
  onEnd?: (message: string) => void;
  onError?: (err: unknown) => void;
}

/** A running review action, and the three things a terminal view needs to do to it. */
export interface ReviewActionRun {
  session: ReviewActionSession;
  /** Sends keystrokes. A string is sent as UTF-8. */
  sendInput(data: string | Uint8Array): Promise<void>;
  resize(rows: number, cols: number): Promise<void>;
  /**
   * Stops watching the output. Does not stop the process — the app it started has to keep serving the
   * preview that replaces the terminal.
   */
  close(): Promise<void>;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Encodes raw bytes for the daemon's `input` route, which takes base64 for the same reason `log` does. */
function encodeBase64(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function reviewActionUrl(projectName: string, actionName: string, endpoint: string): string {
  return (
    `/api/projects/${encodeURIComponent(projectName)}` +
    `/review-actions/${encodeURIComponent(actionName)}/${endpoint}`
  );
}

/**
 * Desktop transport: the native side reads the stream and re-emits it, because `invoke` cannot stream
 * and the daemon's route is bearer-authenticated with a secret the webview never sees.
 *
 * The listener is registered before the invoke and frames are held until the session id comes back,
 * because the process can write before the invoke's return value has crossed the boundary. Frames
 * belonging to other sessions are dropped on the replay, once there is an id to compare them to.
 */
async function startReviewActionViaTauri(
  projectName: string,
  actionName: string,
  options: ReviewActionRunOptions,
): Promise<ReviewActionRun> {
  let session: ReviewActionSession | null = null;
  const pending: ReviewActionEvent[] = [];

  const deliver = (frame: ReviewActionEvent) => {
    if (frame.event === "end") {
      options.onEnd?.(frame.data);
      return;
    }
    if (frame.event === "log") {
      try {
        options.onChunk?.(decodeBase64(frame.data));
      } catch (err) {
        options.onError?.(err);
      }
    }
  };

  const unlisten = await onReviewActionEvent((frame) => {
    if (!session) {
      pending.push(frame);
      return;
    }
    if (frame.sessionId === session.sessionId) {
      deliver(frame);
    }
  });

  try {
    session = await invoke<ReviewActionSession>("cmd_execute_review_action", {
      projectName,
      actionName,
      planId: options.planId,
      worktree: options.worktree,
    });
  } catch (err) {
    unlisten();
    throw err;
  }

  for (const frame of pending) {
    if (frame.sessionId === session.sessionId) {
      deliver(frame);
    }
  }
  pending.length = 0;

  const sessionId = session.sessionId;
  return {
    session,
    async sendInput(data) {
      await invoke<void>("cmd_send_review_action_input", {
        projectName,
        actionName,
        sessionId,
        data: encodeBase64(data),
      });
    },
    async resize(rows, cols) {
      await invoke<void>("cmd_resize_review_action", {
        projectName,
        actionName,
        sessionId,
        rows,
        cols,
      });
    },
    async close() {
      unlisten();
      await invoke<boolean>("cmd_close_review_action", { sessionId });
    },
  };
}

/** Browser transport: the webview reads the SSE stream itself, same-origin through the dev proxy. */
async function startReviewActionViaHttp(
  projectName: string,
  actionName: string,
  options: ReviewActionRunOptions,
): Promise<ReviewActionRun> {
  let unsubscribe: EventUnsubscribe = () => {};

  const session = await new Promise<ReviewActionSession>((resolve, reject) => {
    let settled = false;
    unsubscribe = subscribeReviewAction("", projectName, actionName, {
      planId: options.planId,
      worktree: options.worktree,
      onSession: (announced) => {
        settled = true;
        resolve(announced);
      },
      onChunk: (bytes) => options.onChunk?.(bytes),
      onEnd: (message) => {
        // A command that fails to start exits before announcing anything; that end message is the
        // only explanation the caller will get.
        if (!settled) {
          settled = true;
          reject(new Error(message));
          return;
        }
        options.onEnd?.(message);
      },
      onError: (err) => {
        if (!settled) {
          settled = true;
          reject(err);
          return;
        }
        options.onError?.(err);
      },
    });
  }).catch((err) => {
    unsubscribe();
    throw err;
  });

  const post = async (endpoint: string, body: Record<string, unknown>) => {
    const res = await fetch(reviewActionUrl(projectName, actionName, endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, ...body }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Review action ${endpoint} failed (${res.status}): ${detail}`);
    }
  };

  return {
    session,
    async sendInput(data) {
      await post("input", { data: encodeBase64(data) });
    },
    async resize(rows, cols) {
      await post("resize", { rows, cols });
    },
    async close() {
      unsubscribe();
    },
  };
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

  /**
   * Starts a review action and streams its terminal output.
   *
   * Resolves once the daemon has announced the session, which is what the input and resize routes are
   * keyed by; output can start arriving before that, so both transports buffer rather than drop it.
   */
  async startReviewAction(
    this: void,
    projectName: string,
    actionName: string,
    options: ReviewActionRunOptions = {},
  ): Promise<ReviewActionRun> {
    return isTauri()
      ? startReviewActionViaTauri(projectName, actionName, options)
      : startReviewActionViaHttp(projectName, actionName, options);
  },

  /**
   * Starts a review action without watching its output, returning the session it announced.
   *
   * The stream is left open and unread: the process is a dev server that has to keep serving after
   * the caller has stopped listening.
   */
  async executeReviewAction(
    this: void,
    projectName: string,
    actionName: string,
    planId?: string,
    worktree?: string,
  ): Promise<ReviewActionSession> {
    const run = await bridge.startReviewAction(projectName, actionName, { planId, worktree });
    return run.session;
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
