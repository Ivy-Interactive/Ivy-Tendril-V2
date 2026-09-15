import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { describeJobExit, jobsStore } from "../src/state/jobsStore";
import { bridge } from "../src/api/bridge";
import type { JobNotification } from "../src/state/notificationBurst";
import type { Job, JobStatus } from "../src/types/api";

/**
 * The producer side of the notification port: which status transitions raise a job-exit event.
 * `JobCompletionHandler` upstream had the daemon tell it once per completion; V2 polls, so the
 * store has to derive "exited" from consecutive snapshots without repeating itself.
 */

function job(id: string, status: JobStatus, extra: Partial<Job> = {}): Job {
  return {
    id,
    type: "ExecutePlan",
    project: "Ivy-Tendril-V2",
    status,
    planId: "00638",
    planTitle: "Port Notification Delivery",
    ...extra,
  };
}

describe("describeJobExit", () => {
  it("titles a completion by job type and names the plan", () => {
    expect(describeJobExit(job("j1", "Completed"))).toEqual({
      title: "ExecutePlan Completed",
      message: "Port Notification Delivery",
      isSuccess: true,
    });
  });

  it("appends the status message to a failure", () => {
    expect(describeJobExit(job("j1", "Failed", { statusMessage: "verification failed" }))).toEqual({
      title: "ExecutePlan Failed",
      message: "Port Notification Delivery: verification failed",
      isSuccess: false,
    });
  });

  it("distinguishes a timeout from a plain failure", () => {
    expect(describeJobExit(job("j1", "Timeout")).title).toBe("ExecutePlan Timed Out");
  });

  it("falls back to the plan id, then the job type, when there is no title", () => {
    expect(describeJobExit(job("j1", "Completed", { planTitle: undefined })).message).toBe("00638");
    expect(
      describeJobExit(job("j1", "Completed", { planTitle: undefined, planId: undefined })).message,
    ).toBe("ExecutePlan");
  });
});

describe("jobsStore job-exit tracking", () => {
  let raised: JobNotification[];
  let unsubscribe: () => void;

  beforeEach(() => {
    raised = [];
    jobsStore.resetExitTracking();
    unsubscribe = jobsStore.onJobExit((n) => raised.push(n));
  });

  afterEach(() => {
    unsubscribe();
    vi.restoreAllMocks();
  });

  /** One poll tick: whatever `listJobs` is stubbed to return becomes the next snapshot. */
  async function poll(jobs: Job[]): Promise<void> {
    vi.spyOn(bridge, "listJobs").mockResolvedValue(jobs);
    await jobsStore.fetchJobs();
  }

  it("raises nothing for jobs that were already finished when the app started", async () => {
    // The first snapshot is history, not news: it is a baseline only.
    await poll([job("j1", "Completed"), job("j2", "Failed"), job("j3", "Running")]);

    expect(raised).toEqual([]);
  });

  it("raises one failure notification when a running job fails", async () => {
    await poll([job("j1", "Running")]);
    await poll([job("j1", "Failed", { statusMessage: "RustClippy failed" })]);

    expect(raised).toEqual([
      {
        title: "ExecutePlan Failed",
        message: "Port Notification Delivery: RustClippy failed",
        isSuccess: false,
      },
    ]);
  });

  it("raises a success notification when a running job completes", async () => {
    await poll([job("j1", "Running")]);
    await poll([job("j1", "Completed")]);

    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ isSuccess: true, message: "Port Notification Delivery" });
  });

  it("raises nothing for a job that is still queued or blocked", async () => {
    await poll([job("j1", "Queued")]);
    await poll([job("j1", "Blocked")]);
    await poll([job("j1", "Running")]);

    expect(raised).toEqual([]);
  });

  it("raises once per exit however many times a poll re-reports it", async () => {
    await poll([job("j1", "Running")]);
    await poll([job("j1", "Completed")]);
    // An ad-hoc refresh — a view mounting, say — lands between two ticks and sees the same row.
    await poll([job("j1", "Completed")]);
    await poll([job("j1", "Completed")]);

    expect(raised).toHaveLength(1);
  });

  it("raises one notification per job in a wave of exits", async () => {
    await poll([job("j1", "Running"), job("j2", "Running"), job("j3", "Running")]);
    await poll([
      job("j1", "Completed"),
      job("j2", "Failed", { statusMessage: "NpmTest failed" }),
      job("j3", "Running"),
    ]);

    expect(raised.map((n) => n.title)).toEqual(["ExecutePlan Completed", "ExecutePlan Failed"]);
  });

  it("raises the exit for a cancelled job", async () => {
    await poll([job("j1", "Running")]);
    vi.spyOn(bridge, "cancelJob").mockResolvedValue(undefined);

    await jobsStore.cancelJob("j1");

    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ title: "ExecutePlan Failed", isSuccess: false });
  });

  it("does not re-raise when the poll that follows a cancellation confirms it", async () => {
    await poll([job("j1", "Running")]);
    vi.spyOn(bridge, "cancelJob").mockResolvedValue(undefined);
    await jobsStore.cancelJob("j1");

    await poll([job("j1", "Stopped")]);

    expect(raised).toHaveLength(1);
  });
});
