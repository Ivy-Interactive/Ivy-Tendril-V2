import { bridge } from "../api/bridge";
import { subscribeJobEvents, type EventUnsubscribe } from "../api/events";
import { serviceStore } from "./serviceStore";
import type { Job, JobDetail, StartJobArgs, StartJobResponse } from "../types/api";

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

  public async fetchJobs(status?: string, limit?: number): Promise<Job[]> {
    this.state.isLoading = true;
    this.notify();

    try {
      const jobs = await bridge.listJobs(status, limit);
      this.state.jobs = jobs;
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
    this.processedEventIds.clear();
    this.notify();
  }

  /**
   * Subscribe to structured job events via SSE and add them to stream sessions
   */
  public subscribeToJob(
    jobId: string,
    kinds?: string[],
    baseUrl?: string,
    token?: string,
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
      },
    });
  }
}

export const jobsStore = new JobsStore();
