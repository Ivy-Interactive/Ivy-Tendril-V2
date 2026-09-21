import { bridge } from "../api/bridge";
import { subscribeToJobStream, type EventUnsubscribe, type JobStreamEvent } from "../api/events";
import { serviceStore } from "./serviceStore";
import type { JobNotification } from "./notificationBurst";
import type { Job, JobDetail, JobStatus, StartJobArgs, StartJobResponse } from "../types/api";

/** A job has exited once it reaches one of these. `Blocked` and `Queued` are not exits. */
const TERMINAL_STATUSES: readonly JobStatus[] = ["Completed", "Failed", "Timeout", "Stopped"];

function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Every state a job can still be taken out of. `JobsApp.DataTable.cs` gates the Stop row action and
 * the header's `Stop All (n)` on exactly this set (Running, Queued, Pending, Blocked) - not just the
 * two that are already moving.
 */
const ACTIVE_STATUSES: readonly JobStatus[] = ["Running", "Queued", "Pending", "Blocked"];

export function isActiveStatus(status: JobStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

const KNOWN_STATUSES: readonly JobStatus[] = [
  "Pending",
  "Queued",
  "Running",
  "Completed",
  "Failed",
  "Timeout",
  "Stopped",
  "Blocked",
];

/**
 * Resolves whatever a stream frame called the status into a `JobStatus`, or `undefined` when it is
 * not one.
 *
 * This exists because two callers hand over unvalidated strings. `subscribeJobEvents`
 * (`api/events.ts`) **defaults an unparseable `end` frame to `"Completed"`**, and
 * `cancel_job` in `crates/tendril-server/src/routes/jobs.rs:231` answers `{"status":"Cancelled"}` -
 * a word that is not in `JobStatus` at all (tendril-core `models/job.rs`). Writing either through
 * unchecked would put a status on the row that no badge, guard or `isTerminal` check recognises, and
 * in the `end`-frame case would announce a failed job as having completed. `Cancelled`/`Canceled`
 * maps onto V1's `Stopped`, which is the status a cancel actually produces.
 */
export function coerceJobStatus(raw: unknown): JobStatus | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  const known = KNOWN_STATUSES.find((s) => s.toLowerCase() === trimmed.toLowerCase());
  if (known) return known;
  if (/^cancell?ed$/i.test(trimmed)) return "Stopped";
  return undefined;
}

/**
 * Job actions whose daemon route and manager call both exist but whose `bridge` wrapper does not.
 *
 * `DELETE /api/jobs/:id` and `POST /api/jobs/:id/force-start` are registered in
 * `crates/tendril-server/src/routes/mod.rs:171-172`, and `JobManager::delete_job` /
 * `force_start_job` implement them; both of those wrappers have since landed. `POST /api/jobs/clear`
 * (`routes/mod.rs:169`, `JobManager::clear_completed_jobs` / `clear_failed_jobs`) has not: it still
 * needs the client half - a method on `ServiceClient` (`src-tauri/src/service/client.rs`), a
 * `#[tauri::command]` (`src-tauri/src/commands/jobs.rs`, registered in `lib.rs`) and an
 * `api/bridge.ts` wrapper - three files this area does not own.
 *
 * Probing for the wrapper rather than assuming it is what keeps this from becoming the thing the
 * parity contract warns about: a button that is present but cannot do anything. `canDeleteJob()`,
 * `canForceStartJob()` and `canClearJobs()` gate the UI on the capability, so an action appears the
 * moment its wrapper lands and never appears as a control that throws.
 */
interface OptionalJobBridge {
  deleteJob?: (id: string) => Promise<void>;
  forceStartJob?: (id: string) => Promise<void>;
  /** `POST /api/jobs/clear`, which answers `{ cleared: n }`. */
  clearJobs?: (status: string) => Promise<number>;
}

function optionalBridge(): OptionalJobBridge {
  return bridge as unknown as OptionalJobBridge;
}

/**
 * Port of `JobCompletionHandler.SendCompletionNotification`. V2's `Job` has no `PlanFile`, so
 * `planTitle` is the readable stand-in and `planId` the fallback.
 */
export function describeJobExit(
  job: Pick<Job, "type" | "status" | "planId" | "planTitle"> & {
    statusMessage?: string;
  },
): JobNotification {
  const isSuccess = job.status === "Completed";
  const title =
    job.status === "Timeout"
      ? `${job.type} Timed Out`
      : isSuccess
        ? `${job.type} Completed`
        : `${job.type} Failed`;

  let message = job.planTitle ?? job.planId ?? job.type;
  if (!isSuccess && job.statusMessage) message += `: ${job.statusMessage}`;

  return { title, message, isSuccess };
}

export interface JobSubscriptionCallbacks {
  onEvent?: (event: JobStreamEvent) => void;
  onEnd?: (status: string) => void;
  onError?: (err: unknown) => void;
}

export interface StreamEventItem {
  id: string;
  type: string;
  timestamp: number;
  payload: unknown;
  rawText?: string;
}

export interface JobsState {
  jobs: Job[];
  /** Details fetched per job, keyed by job id. Carries the fields the list
   *  endpoint omits — notably `reportedFailureReason`. */
  jobDetails: Record<string, JobDetail>;
  activeSessions: Record<string, StreamEventItem[]>;
  isLoading: boolean;
  error: string | null;
}

class JobsStore {
  private state: JobsState = {
    jobs: [],
    jobDetails: {},
    activeSessions: {},
    isLoading: false,
    error: null,
  };

  private listeners: Set<() => void> = new Set();
  /**
   * Event keys already ingested, **per session**. This used to be one flat set, which made
   * `clearSession` for one job drop the dedupe state of every other open job's stream: the next
   * frame each of them delivered was accepted a second time.
   */
  private processedEventIds: Map<string, Set<string>> = new Map();

  /**
   * Highest log line ingested per job, which is where a resumed stream is asked to start.
   *
   * Kept alongside the session rather than derived from it: `activeSessions` holds only the frames
   * that passed the `kinds` filter, so its length is not a line number.
   */
  private lastStreamLine: Map<string, number> = new Map();

  /** Last status seen per job id. A job absent from here has no baseline yet and cannot have exited. */
  private lastStatus: Map<string, JobStatus> = new Map();
  /** Job ids already notified about, so a re-reported exit is not a second notification. */
  private notified: Set<string> = new Set();
  private exitListeners: Set<(notification: JobNotification) => void> = new Set();

  public getState(): JobsState {
    return this.state;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  /**
   * Fires once per job that transitions into a terminal status. Every status write in this store
   * funnels through `recordStatuses`, so this covers polling, cancellation and — once a realtime
   * transport exists — the SSE paths, with no double reporting between them.
   */
  public onJobExit(callback: (notification: JobNotification) => void): () => void {
    this.exitListeners.add(callback);
    return () => this.exitListeners.delete(callback);
  }

  /**
   * Diffs a batch of jobs against the last statuses seen and emits an exit for each new transition.
   *
   * The **first** sighting of a job id only records a baseline: the initial `fetchJobs()` returns a
   * history full of finished jobs, and announcing those would greet the operator with a wave of
   * notifications for work that finished days ago.
   */
  private recordStatuses(jobs: readonly Job[]): void {
    for (const job of jobs) {
      const previous = this.lastStatus.get(job.id);
      this.lastStatus.set(job.id, job.status);

      if (previous === undefined) continue;
      if (!isTerminal(job.status) || isTerminal(previous)) continue;
      if (this.notified.has(job.id)) continue;

      this.notified.add(job.id);
      const notification = describeJobExit(job);
      this.exitListeners.forEach((listener) => listener(notification));
    }
  }

  /** `recordStatuses` for a single job, taking the detail entry when the list has no row for it. */
  private recordJob(jobId: string): void {
    const job = this.findJob(jobId);
    if (job) this.recordStatuses([job]);
  }

  /** The best copy of a job the store holds: the list row, else the fetched detail. */
  private findJob(jobId: string): Job | undefined {
    return this.state.jobs.find((j) => j.id === jobId) ?? this.state.jobDetails[jobId];
  }

  /**
   * Writes a patch to **every** copy of a job the store holds.
   *
   * `JobSessionView` prefers `jobDetails[id]` over the list row, so patching only `jobs` left an
   * open job tab showing the status from before the action: pressing Stop on a job whose detail had
   * been fetched refreshed the list behind the tab and nothing else.
   */
  private applyJobPatch(id: string, patch: Partial<Job>): void {
    let touched = false;

    if (this.state.jobs.some((j) => j.id === id)) {
      this.state.jobs = this.state.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
      touched = true;
    }

    const existing = this.state.jobDetails[id];
    if (existing) {
      this.state.jobDetails = { ...this.state.jobDetails, [id]: { ...existing, ...patch } };
      touched = true;
    }

    if (!touched) {
      // Nothing has been fetched for this id yet, so record only what was actually reported. The
      // previous version invented `type: "Promptware Job"` and `project: "Tendril"` here, and
      // because the session view renders `{...job, ...detail}` those placeholders overwrote the real
      // type and project of the row the tab was opened from.
      this.state.jobDetails = {
        ...this.state.jobDetails,
        [id]: { id, ...patch } as JobDetail,
      };
    }
  }

  /** `JobsApp.DataTable.cs:34`: the `(n)` in `Stop All Queued (n)`. */
  public queuedJobCount(): number {
    return this.state.jobs.filter((j) => j.status === "Queued").length;
  }

  /** `JobsApp.DataTable.cs:35`: the `(n)` in `Stop All (n)` - Running, Queued, Pending or Blocked. */
  public activeJobCount(): number {
    return this.state.jobs.filter((j) => isActiveStatus(j.status)).length;
  }

  /** Whether `Delete` can be offered at all. See {@link OptionalJobBridge}. */
  public canDeleteJob(): boolean {
    return typeof optionalBridge().deleteJob === "function";
  }

  /** Whether `Force Start` can be offered at all. See {@link OptionalJobBridge}. */
  public canForceStartJob(): boolean {
    return typeof optionalBridge().forceStartJob === "function";
  }

  /** Whether the bulk clears can be offered at all. See {@link OptionalJobBridge}. */
  public canClearJobs(): boolean {
    return typeof optionalBridge().clearJobs === "function";
  }

  /**
   * The Jobs table header's bulk clears (`JobsApp.DataTable.cs:279-289`), each followed by a refresh.
   *
   * One daemon route, `POST /api/jobs/clear`, and `scope` is its `status` field: `all`, or the name of
   * one terminal status — `Completed`, `Failed`, `Timeout` or `Stopped`. V1's menu exposes two of those,
   * but its service was always a generic predicate clear (`JobService.ClearJobsByStatus`), so the rest
   * are that primitive's remaining uses rather than new behaviour. See `JOB_CLEAR_SCOPES` in
   * `JobsView.tsx` for the list the menu offers.
   *
   * A scope naming a *non-terminal* status is refused by the daemon with a 400, and refused again
   * inside `JobManager::clear_jobs`: a clear only ever removes finished work, and that guarantee is the
   * daemon's rather than this caller's.
   *
   * Returns how many rows the daemon says it removed, which is what a toast can quote. The list is
   * re-read rather than filtered locally: the daemon decides what each scope means, and a client-side
   * guess at that would drift from it.
   */
  public async clearJobs(scope: string): Promise<number> {
    const clearViaBridge = optionalBridge().clearJobs;
    if (!clearViaBridge) {
      throw new Error(
        "Clearing jobs needs bridge.clearJobs, which does not exist yet; " +
          "gate the action on jobsStore.canClearJobs().",
      );
    }

    const cleared = await clearViaBridge(scope);
    await this.fetchJobs().catch(() => {});
    return cleared;
  }

  /** Test seam: drops the exit baseline so a suite can replay snapshots from scratch. */
  public resetExitTracking(): void {
    this.lastStatus.clear();
    this.notified.clear();
  }

  public async fetchJobs(status?: string, limit?: number): Promise<Job[]> {
    this.state.isLoading = true;
    this.notify();

    try {
      const jobs = await bridge.listJobs(status, limit);
      this.state.jobs = jobs;
      this.recordStatuses(jobs);
      this.state.isLoading = false;
      // A successful poll clears the previous failure. Without this the offline banner a dropped
      // daemon left behind stayed up for the rest of the session.
      this.state.error = null;
      this.notify();
      return jobs;
    } catch (err) {
      this.state.isLoading = false;
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
      throw err;
    }
  }

  /** Fetch a single job's detail so the session view can show why it failed. */
  public async fetchJobDetail(id: string): Promise<JobDetail> {
    const detail = await bridge.getJob(id);
    this.state.jobDetails = { ...this.state.jobDetails, [id]: detail };
    // The detail endpoint is the only status source for a job the list no longer carries (it is
    // capped, and `clear` removes rows), so an exit learned here has to reach `onJobExit` too - the
    // baseline and `notified` guards make a second sighting free.
    this.recordStatuses([detail]);
    this.notify();
    return detail;
  }

  public getJobDetail(id: string): JobDetail | undefined {
    return this.state.jobDetails[id];
  }

  public async startJob(args: StartJobArgs): Promise<StartJobResponse> {
    const res = await bridge.startJob(args);
    // Refresh jobs
    this.fetchJobs().catch(() => {});
    return res;
  }

  /**
   * `JobsApp.DataTable.cs:221-228`: V1's Stop row action calls `StopJob` **only** when the job is
   * still Running, Queued, Pending or Blocked, and does nothing otherwise. Returns whether it acted,
   * which is what the bulk sweeps below count.
   *
   * The optimistic write clears the status message rather than keeping it: a Running job's message
   * ("Executing plan...") is not true of a stopped one, and dropping it lets the view fall back to
   * V1's Stopped default from `JobsApp.Helpers.cs` `GetStatusMessage` ("Job was manually stopped").
   * A caller-supplied `message` replaces it, matching what the daemon stores.
   */
  public async cancelJob(id: string, message?: string): Promise<boolean> {
    const job = this.findJob(id);
    if (job && !isActiveStatus(job.status)) return false;

    await bridge.cancelJob(id, message);
    this.applyJobPatch(id, { status: "Stopped", statusMessage: message });
    this.recordJob(id);
    this.notify();
    return true;
  }

  /**
   * `JobService.StopQueuedJobs` (`Services/Jobs/JobService.cs:685`): stop every Queued job and report
   * how many, which is the count V1's toast quotes ("Stopped {count} queued job(s)."). Running jobs
   * are left alone, which is exactly what the confirm copy promises - so this cannot go through
   * `POST /api/jobs/stop-all`, which would take them too.
   */
  public async stopQueuedJobs(): Promise<number> {
    const ids = this.state.jobs.filter((j) => j.status === "Queued").map((j) => j.id);
    return this.stopEach(ids);
  }

  /**
   * `JobService.StopAllJobs` (`Services/Jobs/JobService.cs:406`), including its loop: V1 re-snapshots
   * between passes because stopping a job releases its slot and `ProcessJobQueue` can promote a
   * Queued job to Running while the sweep is still in flight. The same is true of the daemon's
   * dispatcher, so the list is re-read after each pass, and the pass count is bounded at three for
   * V1's stated reason - a pathological launch/stop loop must not spin forever.
   *
   * Each pass is dispatched concurrently by `stopEachIds`, which is what makes the loop affordable:
   * a pass costs one kill grace rather than one per job, and passes two and three normally find
   * nothing left active and break immediately.
   *
   * Deliberately not `POST /api/jobs/stop-all` (`crates/tendril-server/src/routes/mod.rs:180`),
   * which would collapse the whole sweep into a single round-trip. That route sits inside
   * `auth_middleware` and the webview holds no bearer credential of its own, so reaching it needs
   * the same three-file client half {@link OptionalJobBridge} describes -- a `stop_all_jobs` on
   * `ServiceClient`, a `#[tauri::command]` registered in `lib.rs`, and a wrapper in `api/bridge.ts`.
   * None of those exist yet. That is worth revisiting, but it was never the reason this was slow:
   * the cost was awaiting the cancels one at a time, not the number of requests.
   */
  public async stopAllJobs(): Promise<number> {
    const stopped = new Set<string>();

    for (let pass = 0; pass < 3; pass += 1) {
      const active = this.state.jobs
        .filter((j) => isActiveStatus(j.status) && !stopped.has(j.id))
        .map((j) => j.id);
      if (active.length === 0) break;

      // `Stopped by stop-all` is the message `JobManager::stop_all_jobs` records
      // (`crates/tendril-core/src/jobs/manager.rs:943`), so a per-job cancel sweep leaves the same
      // rows behind as the daemon's own route would.
      const ids = await this.stopEachIds(active, "Stopped by stop-all");
      ids.forEach((id) => stopped.add(id));

      await this.fetchJobs().catch(() => {});
    }

    return stopped.size;
  }

  private async stopEach(ids: readonly string[], message?: string): Promise<number> {
    const stopped = await this.stopEachIds(ids, message);
    if (stopped.length > 0) await this.fetchJobs().catch(() => {});
    return stopped.length;
  }

  /**
   * One pass. The caller owns the refresh, so a multi-pass sweep costs one request per pass.
   *
   * The cancels are issued together rather than one after another. `cancel_job` blocks server-side
   * on `kill_tree(p, DEFAULT_KILL_GRACE)`, and that grace is three seconds
   * (`crates/tendril-core/src/jobs/process_tree.rs:68`), so awaiting each in turn made the sweep
   * cost the sum of the kills: fifteen jobs held the Stop All confirm on "Working..." for ~45s. The
   * daemon kills each job's tree independently, so the same fifteen overlap in about one grace.
   *
   * `allSettled`, not `all`: one failure must not abort the sweep. V1's loop keeps going and returns
   * what it managed to stop, so nine successes are not reported as zero because the tenth was
   * refused -- and with `all` a single rejection would also abandon the remaining cancels
   * mid-flight, which is worse than the sequential version it replaced.
   *
   * The result preserves `ids` order because `allSettled` resolves positionally, so a caller reading
   * the returned ids sees the same order the sequential sweep produced.
   */
  private async stopEachIds(ids: readonly string[], message?: string): Promise<string[]> {
    const outcomes = await Promise.allSettled(ids.map((id) => this.cancelJob(id, message)));

    return ids.filter((_id, index) => {
      const outcome = outcomes[index];
      // A rejection is counted as not stopped; the next pass or the poll will show it still running.
      return outcome !== undefined && outcome.status === "fulfilled" && outcome.value;
    });
  }

  /**
   * The Delete Job confirm's handler (`JobsApp.DataTable.cs:302-315`): a job still Running or Queued
   * is stopped first, then deleted, then the list is re-read. Note how much narrower that guard is
   * than the Stop action's - V1 does not pre-stop a Pending or Blocked job, neither of which holds a
   * process, and the delete alone is enough to take it out of the queue.
   *
   * V1 keeps the job's artifacts in `<TendrilHome>/Jobs/` (`JobService.cs:439`) and so does the
   * daemon route, so this removes the row and not the forensic record.
   */
  public async deleteJob(id: string): Promise<void> {
    const deleteViaBridge = optionalBridge().deleteJob;
    if (!deleteViaBridge) {
      throw new Error(
        "Deleting a job needs bridge.deleteJob, which does not exist yet; " +
          "gate the action on jobsStore.canDeleteJob().",
      );
    }

    const job = this.findJob(id);
    if (job && (job.status === "Running" || job.status === "Queued")) {
      // A stop that fails must not stop the delete: V1 calls `StopJob` for effect and deletes
      // regardless of what it returned.
      await this.cancelJob(id).catch(() => false);
    }

    await deleteViaBridge(id);

    this.state.jobs = this.state.jobs.filter((j) => j.id !== id);
    const remaining = { ...this.state.jobDetails };
    delete remaining[id];
    this.state.jobDetails = remaining;
    // Forget the exit baseline too, so a job id the daemon reuses is not treated as one already
    // notified about.
    this.lastStatus.delete(id);
    this.notified.delete(id);
    this.lastStreamLine.delete(id);
    this.notify();

    this.fetchJobs().catch(() => {});
  }

  /**
   * `JobService.ForceStartJob` (`Services/Jobs/JobService.cs:1201`): Blocked only, and a silent
   * no-op for anything else - V1 does not refuse it after the click, it never offers it. The daemon's
   * `force_start_job` also accepts Queued; the guard here follows V1's row action, which is the
   * narrower of the two.
   */
  public async forceStartJob(id: string): Promise<boolean> {
    const forceStartViaBridge = optionalBridge().forceStartJob;
    if (!forceStartViaBridge) {
      throw new Error(
        "Force-starting a job needs bridge.forceStartJob, which does not exist yet; " +
          "gate the action on jobsStore.canForceStartJob().",
      );
    }

    const job = this.findJob(id);
    if (job && job.status !== "Blocked") return false;

    await forceStartViaBridge(id);
    await this.fetchJobs().catch(() => {});
    return true;
  }

  /**
   * Appends one stream frame to a session, dropping the ones already held.
   *
   * Two kinds of duplicate arrive here and they need different answers.
   *
   * A frame that carries its own identity (`id`/`uuid`) is deduplicated on it, per session.
   *
   * A frame that does not - which is every line of a job's eventwire log, since `JobManager` appends
   * the agent's raw line verbatim - is deduplicated on `line`, the frame's index in that log. The
   * daemon numbers every frame it sends (the SSE `id:` field) and honours `since_line`, so a resumed
   * stream does not replay a prefix in the first place; this set covers the remaining overlap, which
   * is a job watched over two transports at once - the per-job stream and the broadcast `job-event`
   * channel `App.tsx` feeds from the WebSocket.
   *
   * This replaces a positional comparison against `session[index].rawText`, which was standing in for
   * a `since_line` the client had no way to send. It could only ever suppress a replay of the
   * *leading* frames of a session, in order, and quietly accepted a duplicate that arrived after a
   * gap; a line number needs neither assumption.
   *
   * The key before that fell back to `Date.now()` for an id-less frame, which was wrong in both
   * directions: it never suppressed a replay (a new millisecond made a new key), and it silently
   * **dropped** two distinct frames of the same type that landed in the same millisecond, which for a
   * fast agent is most of them.
   */
  public addStreamEvent(jobOrPlanId: string, event: unknown, line?: number): boolean {
    const item =
      typeof event === "string" ? { message: event } : (event as Record<string, unknown>);
    const rawId = (item.id as string) || (item.uuid as string);
    const type =
      (item.type as string) || (item.kind as string) || (item.action as string) || "status";
    const timestamp = (item.timestamp as number) || (item.time as number) || Date.now();
    const rawText = typeof event === "string" ? event : JSON.stringify(event);

    const session = this.state.activeSessions[jobOrPlanId];

    let processed = this.processedEventIds.get(jobOrPlanId);
    if (!processed) {
      processed = new Set<string>();
      this.processedEventIds.set(jobOrPlanId, processed);
    }

    if (line !== undefined) {
      const lineKey = `line:${line}`;
      if (processed.has(lineKey)) return false;
      processed.add(lineKey);
      this.lastStreamLine.set(
        jobOrPlanId,
        Math.max(this.lastStreamLine.get(jobOrPlanId) ?? -1, line),
      );
    }

    if (rawId) {
      if (processed.has(rawId)) return false;
      processed.add(rawId);
    }

    const eventKey = rawId || `${jobOrPlanId}-${line ?? session?.length ?? 0}-${type}`;

    if (!this.state.activeSessions[jobOrPlanId]) {
      this.state.activeSessions[jobOrPlanId] = [];
    }

    this.state.activeSessions[jobOrPlanId].push({
      id: eventKey,
      type,
      timestamp,
      payload: event,
      rawText,
    });

    this.notify();
    return true;
  }

  public getSessionEvents(jobOrPlanId: string): StreamEventItem[] {
    return this.state.activeSessions[jobOrPlanId] || [];
  }

  public clearSession(jobOrPlanId: string): void {
    delete this.state.activeSessions[jobOrPlanId];
    delete this.state.jobDetails[jobOrPlanId];
    this.processedEventIds.delete(jobOrPlanId);
    // The resume point goes with the frames it counted: keeping it would make the next subscription
    // ask the daemon to skip lines this session no longer holds, and the view would open blank.
    this.lastStreamLine.delete(jobOrPlanId);
    this.notify();
  }

  /**
   * Subscribes to a job's structured event stream, updating the session and the job's status.
   *
   * The transport is chosen by `subscribeToJobStream`: under Tauri, the native bridge, because
   * `/api/jobs/:id/events` is bearer-authenticated and the webview has no secret to send. `baseUrl`
   * and `token` describe the HTTP transport used in a browser build; the session view passes neither,
   * which used to mean sending no `Authorization` header at all, so every job subscription the desktop
   * app made was answered with a 401 and the session view never showed live output.
   *
   * A resubscription resumes from the last line this store ingested, so a remount does not replay the
   * run it already has.
   */
  public subscribeToJob(
    jobId: string,
    kinds?: string[],
    baseUrl?: string,
    token?: string,
    options?: JobSubscriptionCallbacks,
  ): EventUnsubscribe {
    const info = serviceStore.getState().info;
    const resolvedBaseUrl =
      baseUrl ||
      (info?.port
        ? `${info.scheme || "http"}://${info.host || "127.0.0.1"}:${info.port}`
        : "http://127.0.0.1:3000");

    const seen = this.lastStreamLine.get(jobId);

    return subscribeToJobStream(jobId, {
      kinds,
      httpBaseUrl: resolvedBaseUrl,
      token,
      sinceLine: seen === undefined ? undefined : seen + 1,
      onEvent: (event, line) => {
        this.addStreamEvent(jobId, event, line);

        const item =
          typeof event === "string" ? { message: event } : (event as Record<string, unknown>);
        const type = (item.type as string) || (item.kind as string);

        if (type === "status" || item.status || item.statusMessage) {
          const payload =
            typeof item.payload === "object" && item.payload !== null
              ? (item.payload as Record<string, unknown>)
              : {};
          const newStatus = coerceJobStatus(item.status ?? payload.status);
          const statusMsg = (item.statusMessage ||
            item.message ||
            payload.statusMessage ||
            payload.message) as string | undefined;

          if (newStatus || statusMsg !== undefined) {
            this.applyJobPatch(jobId, {
              ...(newStatus ? { status: newStatus } : {}),
              ...(statusMsg !== undefined ? { statusMessage: statusMsg } : {}),
            });
            this.recordJob(jobId);
            this.notify();
          }
        }

        options?.onEvent?.(event);
      },
      onEnd: (status) => {
        // `subscribeJobEvents` substitutes "Completed" for an `end` frame it could not parse, so an
        // unrecognised status is not written onto the row: a failed job must not be badged, notified
        // and treated as terminal-successful because its last frame arrived malformed. The refetch
        // below settles it either way.
        const terminalStatus = coerceJobStatus(status);
        if (terminalStatus) {
          this.applyJobPatch(jobId, { status: terminalStatus });
          this.recordJob(jobId);
          this.notify();
        }

        this.fetchJobDetail(jobId).catch(() => {});
        this.fetchJobs().catch(() => {});

        options?.onEnd?.(status);
      },
      onError: (err) => {
        console.warn(`Job event stream error for job ${jobId}:`, err);
        options?.onError?.(err);
      },
    });
  }
}

export const jobsStore = new JobsStore();
