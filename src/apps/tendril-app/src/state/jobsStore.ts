import { bridge } from "../api/bridge";
import { subscribeJobEvents, type EventUnsubscribe, type JobStreamEvent } from "../api/events";
import { serviceStore } from "./serviceStore";
import type { JobNotification } from "./notificationBurst";
import type { Job, JobDetail, JobStatus, StartJobArgs, StartJobResponse } from "../types/api";

/** A job has exited once it reaches one of these. `Blocked` and `Queued` are not exits. */
const TERMINAL_STATUSES: readonly JobStatus[] = ["Completed", "Failed", "Timeout", "Stopped"];

function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Port of `JobCompletionHandler.SendCompletionNotification`. V2's `Job` has no `PlanFile`, so
 * `planTitle` is the readable stand-in and `planId` the fallback.
 */
export function describeJobExit(job: Pick<Job, "type" | "status" | "planId" | "planTitle"> & {
  statusMessage?: string;
}): JobNotification {
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
  private processedEventIds: Set<string> = new Set();

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
    const job = this.state.jobs.find((j) => j.id === jobId) ?? this.state.jobDetails[jobId];
    if (job) this.recordStatuses([job]);
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

  public async cancelJob(id: string, message?: string): Promise<void> {
    await bridge.cancelJob(id, message);
    this.state.jobs = this.state.jobs.map((j) => (j.id === id ? { ...j, status: "Stopped" } : j));
    this.recordJob(id);
    this.notify();
  }

  /**
   * Append stream event with deduplication by event id or compound timestamp+type
   */
  public addStreamEvent(jobOrPlanId: string, event: unknown): boolean {
    const item =
      typeof event === "string" ? { message: event } : (event as Record<string, unknown>);
    const rawId = (item.id as string) || (item.uuid as string);
    const type = (item.type as string) || (item.action as string) || "status";
    const timestamp = (item.timestamp as number) || (item.time as number) || Date.now();
    const eventKey =
      rawId ||
      `${jobOrPlanId}-${type}-${timestamp}-${JSON.stringify(item.step || item.message || "")}`;

    // Deduplication check
    if (this.processedEventIds.has(eventKey)) {
      return false; // Ignored duplicate
    }
    this.processedEventIds.add(eventKey);

    if (!this.state.activeSessions[jobOrPlanId]) {
      this.state.activeSessions[jobOrPlanId] = [];
    }

    this.state.activeSessions[jobOrPlanId].push({
      id: eventKey,
      type,
      timestamp,
      payload: event,
      rawText: typeof event === "string" ? event : JSON.stringify(event),
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
    this.processedEventIds.clear();
    this.notify();
  }

  /**
   * Subscribe to structured job events via SSE, updating stream sessions and job lifecycle status
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

    return subscribeJobEvents(resolvedBaseUrl, jobId, token, {
      kinds,
      onEvent: (event) => {
        this.addStreamEvent(jobId, event);

        const item =
          typeof event === "string" ? { message: event } : (event as Record<string, unknown>);
        const type = (item.type as string) || (item.kind as string);

        if (type === "status" || item.status || item.statusMessage) {
          const payload =
            typeof item.payload === "object" && item.payload !== null
              ? (item.payload as Record<string, unknown>)
              : {};
          const newStatus = (item.status || payload.status) as JobStatus | undefined;
          const statusMsg = (item.statusMessage ||
            item.message ||
            payload.statusMessage ||
            payload.message) as string | undefined;

          let changed = false;

          if (this.state.jobs.some((j) => j.id === jobId)) {
            this.state.jobs = this.state.jobs.map((j) => {
              if (j.id !== jobId) return j;
              return {
                ...j,
                ...(newStatus ? { status: newStatus } : {}),
                ...(statusMsg !== undefined ? { statusMessage: statusMsg } : {}),
              };
            });
            changed = true;
          }

          if (this.state.jobDetails[jobId]) {
            this.state.jobDetails = {
              ...this.state.jobDetails,
              [jobId]: {
                ...this.state.jobDetails[jobId],
                ...(newStatus ? { status: newStatus } : {}),
                ...(statusMsg !== undefined ? { statusMessage: statusMsg } : {}),
              },
            };
            changed = true;
          } else if (newStatus) {
            this.state.jobDetails = {
              ...this.state.jobDetails,
              [jobId]: {
                id: jobId,
                type: "Promptware Job",
                project: "Tendril",
                status: newStatus,
                statusMessage: statusMsg,
              } as JobDetail,
            };
            changed = true;
          }

          if (changed) {
            this.recordJob(jobId);
            this.notify();
          }
        }

        options?.onEvent?.(event);
      },
      onEnd: (status) => {
        const terminalStatus = status as JobStatus;
        let changed = false;

        if (this.state.jobs.some((j) => j.id === jobId)) {
          this.state.jobs = this.state.jobs.map((j) =>
            j.id === jobId ? { ...j, status: terminalStatus } : j,
          );
          changed = true;
        }

        if (this.state.jobDetails[jobId]) {
          this.state.jobDetails = {
            ...this.state.jobDetails,
            [jobId]: {
              ...this.state.jobDetails[jobId],
              status: terminalStatus,
            },
          };
          changed = true;
        } else {
          this.state.jobDetails = {
            ...this.state.jobDetails,
            [jobId]: {
              id: jobId,
              type: "Promptware Job",
              project: "Tendril",
              status: terminalStatus,
            } as JobDetail,
          };
          changed = true;
        }

        if (changed) {
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
