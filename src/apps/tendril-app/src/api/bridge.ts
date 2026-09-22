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
  AddedProjectRepo,
  AgentCostBreakdown,
  Annotation,
  CreateProjectRequest,
  CreatedProject,
  CrossPlanRecommendation,
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
  PlanArtifacts,
  PlanChangesData,
  PlanDetail,
  PlanGitData,
  PlanQuery,
  PlanSummary,
  PrStatus,
  PrSyncReport,
  ProjectAssets,
  ProjectSummary,
  ProvisionReport,
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
import type { ChatAttachment } from "../types/chat";
import { encodeBase64, isTauri } from "../utils/tauri";
import { i18n } from "../i18n";

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
      throw new Error(
        i18n.t("common:errors.reviewActionFailed", { endpoint, status: res.status, detail }),
      );
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
    if (isTauri()) {
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
    throw new Error(i18n.t("common:errors.requestFailed", { path, status: res.status }));
  }
  return res.json() as Promise<T>;
}

/** `default` is the id the service resolves to the primary vault. */
function vaultPath(vaultId: string | undefined, suffix = ""): string {
  return `/api/vaults/${encodeURIComponent(vaultId?.trim() || "default")}${suffix}`;
}

const tauriClient = {
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

  /**
   * Installs the bundled `tendril` and `opencode` sidecars into `<tendril home>/bin` and registers
   * the daemon to start with the session. The app already does this on first run; this is the retry
   * for a machine that refused it then.
   */
  async installService(this: void): Promise<ProvisionReport> {
    return invoke<ProvisionReport>("cmd_install_service");
  },

  /** Stops the daemon starting at login. The installed binaries stay where they are. */
  async uninstallServiceAutostart(this: void): Promise<string> {
    return invoke<string>("cmd_uninstall_service_autostart");
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

  /**
   * The plan's worktrees, its commits grouped under them, and the reachability
   * verdict for the commits no worktree accounts for — the Git tab's data.
   */
  async getPlanGit(this: void, id: string): Promise<PlanGitData> {
    return invoke<PlanGitData>("cmd_get_plan_git", { id });
  },

  async getPlanChanges(this: void, id: string): Promise<PlanChangesData> {
    return invokeOrFetch<PlanChangesData>(
      "cmd_get_plan_changes",
      { id },
      `/api/plans/${encodeURIComponent(id)}/changes`,
    );
  },

  async getPlanSummary(this: void, id: string): Promise<string | null> {
    const res = await invokeOrFetch<{ summary: string | null } | string | null>(
      "cmd_get_plan_summary",
      { id },
      `/api/plans/${encodeURIComponent(id)}/summary`,
    );
    if (res && typeof res === "object" && "summary" in res) {
      return res.summary;
    }
    return (res as string | null) ?? null;
  },

  async getPlanArtifacts(this: void, id: string): Promise<PlanArtifacts> {
    return invokeOrFetch<PlanArtifacts>(
      "cmd_get_plan_artifacts",
      { id },
      `/api/plans/${encodeURIComponent(id)}/artifacts`,
    );
  },

  async getRevision(this: void, id: string, number?: number): Promise<string> {
    return invoke<string>("cmd_get_revision", { id, number });
  },

  async writeRevision(this: void, id: string, content: string): Promise<RevisionResult> {
    return invoke<RevisionResult>("cmd_write_revision", { id, content });
  },

  /**
   * Overwrite the plan's newest revision in place, keeping its number.
   *
   * The write answering a plan question needs, and deliberately not `writeRevision`, which appends.
   * V1 routes answers through `IPlanReaderService.UpdateLatestRevision` on the stated grounds that
   * "answering a question is not a new revision of the plan, it is filling in a blank the plan left".
   * An append would claim the agent produced a new plan, and it would inflate `revisionCount`, which
   * `executeGuards.unfoldedAnswerCount` reads as `revisionCount === 1` — so one answer would switch
   * that guard off. The returned `revision` is the number that did *not* move.
   */
  async updateLatestRevision(this: void, id: string, content: string): Promise<RevisionResult> {
    return invoke<RevisionResult>("cmd_update_latest_revision", { id, content });
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

  /**
   * Every draft annotation left on a plan's revision markdown.
   *
   * Same contract as the diff comments above: the mutations return the plan's new full list.
   */
  async listAnnotations(this: void, planId: string): Promise<Annotation[]> {
    return invoke<Annotation[]>("cmd_list_annotations", { planId });
  },

  async upsertAnnotation(
    this: void,
    planId: string,
    annotation: Annotation,
  ): Promise<Annotation[]> {
    return invoke<Annotation[]>("cmd_upsert_annotation", { planId, annotation });
  },

  async deleteAnnotation(this: void, planId: string, annotationId: string): Promise<Annotation[]> {
    return invoke<Annotation[]>("cmd_delete_annotation", { planId, annotationId });
  },

  async clearAnnotations(this: void, planId: string): Promise<void> {
    return invoke<void>("cmd_clear_annotations", { planId });
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

  async listCrossPlanRecommendations(
    this: void,
    project?: string,
    state?: string,
  ): Promise<CrossPlanRecommendation[]> {
    try {
      return await invoke<CrossPlanRecommendation[]>("cmd_list_all_recommendations", {
        project,
        state,
      });
    } catch {
      // Cross-plan projection fallback: gather from completed plans
      const plans = await bridge.listPlans();
      const relevantPlans = plans.filter((p) => p.state === "Completed" || !state);
      const results: CrossPlanRecommendation[] = [];
      await Promise.all(
        relevantPlans.map(async (plan) => {
          try {
            const recs = await bridge.listRecommendations(plan.id);
            for (const r of recs) {
              const rState = r.state || "Pending";
              if (state && rState !== state) continue;
              if (project && plan.project !== project) continue;
              results.push({
                planId: plan.id,
                planTitle: plan.title,
                project: plan.project,
                sourcePlanStatus: plan.state,
                title: r.title,
                description: r.description,
                impact: r.impact,
                state: r.state,
                declineReason: r.declineReason,
                notes: r.notes,
              });
            }
          } catch {
            // Ignore per-plan failure
          }
        }),
      );
      return results;
    }
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

  /** Drops a job from the list and the database. The daemon keeps its log artifacts. */
  async deleteJob(this: void, id: string): Promise<void> {
    return invoke<void>("cmd_delete_job", { id });
  },

  /** Promotes a blocked or queued job past its gates so it runs next. */
  async forceStartJob(this: void, id: string): Promise<void> {
    return invoke<void>("cmd_force_start_job", { id });
  },

  /**
   * Bulk-clears finished jobs by scope, answering how many rows went.
   *
   * The scope is not validated here. The daemon filters to the terminal statuses before it reads a row,
   * so a Running or Queued job cannot be cleared through any caller, and it answers a `400` naming the
   * scopes it accepts — a refusal worth showing rather than pre-empting with a second list that could
   * fall out of step with it.
   */
  async clearJobs(this: void, status: string): Promise<number> {
    return invoke<number>("cmd_clear_jobs", { status });
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

  /**
   * Creates a project, cloning any remote among `repos` first. The returned project's `repos` are
   * the resolved local paths - the only place the caller can learn where a URL was cloned to.
   */
  async createProject(this: void, request: CreateProjectRequest): Promise<CreatedProject> {
    return invoke<CreatedProject>("cmd_create_project", { request });
  },

  /**
   * Adds one repository to an existing project, cloning it first when `path` is a remote URL.
   *
   * `putConfig("projects", ...)` cannot stand in for this. It merges and saves whatever it is given,
   * so a URL added that way is what lands in `config.yaml` - persisting any credential embedded in
   * it, and leaving a repo entry the daemon skips, because a working directory has to be a directory.
   * Only this route clones. The returned `path` is what was stored, which is the clone's directory
   * for a remote and the typed path for a local one.
   */
  async addProjectRepo(this: void, projectName: string, path: string): Promise<AddedProjectRepo> {
    return invoke<AddedProjectRepo>("cmd_add_project_repo", { projectName, path });
  },

  /**
   * Renames a project, cascading the new name into its plans and database rows.
   *
   * `putConfig("projects", ...)` cannot stand in for this either. That merges the sequence by name,
   * so a renamed entry matches no existing project and is appended next to the original - leaving
   * two projects where there was one. Only this route renames, and only this route rewrites the
   * plans and the Plans/Jobs/Recommendations rows that name the old project.
   *
   * Rejects with `RENAME_PROJECT_FAILED` carrying the daemon's status: 400 for an empty name, 404
   * when the project is gone, 409 when the target name is already taken.
   *
   * Resolves to the new name rather than to the project. The route answers the whole stored
   * `ProjectConfig` - the unprojected wire shape, whose `repos` are objects rather than the name
   * strings {@link ProjectSummary} carries - so typing it as a `ProjectSummary` would be wrong, and
   * projecting it here would duplicate `cmd_list_projects`'s mapping for a value whose only use is
   * to re-read the list. The name is what a caller needs to reselect the project it just renamed.
   */
  async renameProject(this: void, name: string, newName: string): Promise<string> {
    const renamed = await invoke<{ name?: string }>("cmd_rename_project", { name, newName });
    /* Trusting the daemon's echo rather than `newName`: it trims before it stores, so the stored
       name is the one that will match on the next read. */
    return renamed?.name ?? newName;
  },

  /**
   * Removes a project from `config.yaml`.
   *
   * `putConfig("projects", ...)` cannot do this at all: the merge reads an omitted project as
   * unchanged rather than deleted, so a project can only be removed by the route that removes it.
   *
   * Removes the config entry and nothing else - the project's plans, its Plans/Jobs/Recommendations
   * rows and any repository the daemon cloned for it all stay on disk. Any caller must say so
   * before it asks the user to confirm.
   *
   * Named `removeProject` rather than `deleteProject`, which is what it was called while it was the
   * only one of the two. The mismatch was the bug: a method called *delete* that deletes nothing sat
   * behind a button called "Delete Project", and the copy explaining that nothing is deleted was the
   * only thing standing between an operator and the wrong expectation. See
   * {@link bridge.deleteProjectData} for the one that does delete.
   */
  async removeProject(this: void, name: string): Promise<void> {
    await invoke<unknown>("cmd_remove_project", { name });
  },

  /**
   * Deletes a project **and its data** (`DELETE /api/projects/:name/data`).
   *
   * The destructive counterpart to {@link bridge.removeProject}, and a separate route rather than a
   * flag on that one so that the irreversible call cannot be reached by getting a boolean wrong.
   *
   * The daemon removes, in order: every plan folder naming the project (worktrees cleaned first),
   * `<TENDRIL_HOME>/Projects/<name>/` with the clones, skills, MCP definitions and memories inside
   * it, the project's rows in `Plans`, `Jobs` and `Recommendations`, and last the `config.yaml`
   * entry. Job logs under `Logs/Jobs/` are keyed by job id rather than by project and are kept,
   * which the dialog says.
   *
   * 409 while a job of the project is still running, which is the daemon's refusal to delete a
   * worktree out from under a live agent, and a message the caller should show rather than retry.
   */
  async deleteProjectData(this: void, name: string): Promise<void> {
    await invoke<unknown>("cmd_delete_project_data", { name });
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

  /**
   * A file on this machine as a `data:` URL an `<img>` can load, or a rejection if the daemon will not
   * serve it.
   *
   * The webview cannot load a `file://` path, so the bytes come from the daemon's guarded
   * `GET /ivy/local-file` — V1's mechanism — fetched natively because that route takes its credential
   * in the query string and the only credential the app has is the bearer secret the webview never
   * sees. Which paths are readable is the daemon's decision, not this method's: anything outside the
   * configured local-file roots, and anything that is not an allow-listed image or PDF, rejects with
   * `NOT_FOUND`. See `src-tauri/src/commands/local_file.rs`.
   *
   * A client that is not on the daemon's machine implements this shape differently — it can request the
   * route directly with a session token, which is what V1's `getAttachmentUrl` builds.
   */
  async getLocalFilePreview(this: void, path: string): Promise<string> {
    return invoke<string>("cmd_get_local_file_preview", { path });
  },

  /**
   * Copies an attached file into Tendril's own attachment directory and answers with the attachment to
   * put on the message: the user's file name, and the staged path.
   *
   * The path a file dialog or a native drop hands over is almost never inside a local-file root — a
   * screenshot on the Desktop is the ordinary case — so `getLocalFilePreview` would refuse it and the
   * message would show a paperclip chip instead of the image. Staging is what makes it previewable, and
   * is what V1's composer does by uploading every attachment before referencing it. The staged path is
   * also what the agent is told about, so the file the agent reads is the file the thumbnail shows.
   *
   * `sessionId` is the chat session the file belongs to; omitted, the daemon stages under `temp`, as
   * V1 does for a file attached before the session exists.
   */
  async uploadChatAttachment(
    this: void,
    path: string,
    sessionId?: string,
  ): Promise<ChatAttachment> {
    return invoke<ChatAttachment>("cmd_upload_chat_attachment", { path, sessionId });
  },
};

/**
 * The surface every view talks to, and the seam a non-Tauri client plugs into.
 *
 * `tauriClient` reaches the daemon through Tauri IPC, which only works when the app and the daemon share
 * a machine: `invoke` is not available in a browser, and the webview holds no daemon credential of its
 * own (see #143). A web or mobile client therefore needs a different implementation of this same shape,
 * talking HTTP with a session token from `POST /api/auth/login`.
 *
 * Views import `bridge` and are indifferent to which implementation is installed. The indirection is a
 * `Proxy` rather than 100-odd delegating methods, so adding a command to `tauriClient` needs no second
 * edit here, and `TendrilClient` stays derived from the implementation instead of drifting from it.
 */
export type TendrilClient = typeof tauriClient;

let current: TendrilClient = tauriClient;

/** Installs a different client, e.g. an HTTP one for a client that is not on the daemon's machine. */
export function setTendrilClient(next: TendrilClient): void {
  current = next;
}

/** Restores the Tauri client. Tests use this to undo `setTendrilClient`. */
export function resetTendrilClient(): void {
  current = tauriClient;
}

export const bridge: TendrilClient = new Proxy({} as TendrilClient, {
  get(_target, property) {
    return (current as unknown as Record<string | symbol, unknown>)[property];
  },
  // `vi.spyOn(bridge, "listGitHubIssues")` writes the spy back onto the object, so `set` and
  // `deleteProperty` have to reach the installed client too. Without them the spy lands on the proxy's
  // own target, `get` keeps returning the original method, and the stub silently never fires.
  set(_target, property, value) {
    (current as unknown as Record<string | symbol, unknown>)[property] = value;
    return true;
  },
  deleteProperty(_target, property) {
    delete (current as unknown as Record<string | symbol, unknown>)[property];
    return true;
  },
  // `vi.spyOn` installs through `Object.defineProperty`, not a plain assignment, so this trap is what
  // actually makes spying work; without it the spy is defined on the proxy's own target and `get` keeps
  // serving the original method.
  defineProperty(_target, property, descriptor) {
    Object.defineProperty(current as object, property, descriptor);
    return true;
  },
  has(_target, property) {
    return property in (current as object);
  },
  ownKeys() {
    return Reflect.ownKeys(current as object);
  },
  getOwnPropertyDescriptor(_target, property) {
    return Reflect.getOwnPropertyDescriptor(current as object, property);
  },
});
