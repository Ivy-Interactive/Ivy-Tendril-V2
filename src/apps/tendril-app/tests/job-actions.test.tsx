import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { bridge } from "../src/api/bridge";
import { coerceJobStatus, isActiveStatus, jobsStore } from "../src/state/jobsStore";
import { JobSessionView, normalizeJobId } from "../src/views/JobSessionView";
import type { Job, JobStatus } from "../src/types/api";

/**
 * The Jobs area's **actions and their guards**, against `Apps/Jobs/JobsApp.DataTable.cs` (the row
 * actions and their confirm copy) and `Services/Jobs/JobService.cs` (what each one does).
 */

function job(id: string, status: JobStatus, extra: Partial<Job> = {}): Job {
  return {
    id,
    type: "ExecutePlan",
    project: "Ivy-Tendril-V2",
    status,
    planId: "00638",
    ...extra,
  };
}

/** Seeds the store's list the only way a caller can: through a stubbed `listJobs`. */
async function seed(jobs: Job[]): Promise<void> {
  vi.spyOn(bridge, "listJobs").mockResolvedValue(jobs);
  await jobsStore.fetchJobs();
}

type OptionalBridge = { deleteJob?: unknown; forceStartJob?: unknown };

describe("job status coercion", () => {
  it("accepts every JobStatus, case-insensitively", () => {
    expect(coerceJobStatus("Running")).toBe("Running");
    expect(coerceJobStatus("completed")).toBe("Completed");
    expect(coerceJobStatus(" Blocked ")).toBe("Blocked");
  });

  // `cancel_job` in `crates/tendril-server/src/routes/jobs.rs:231` answers `{"status":"Cancelled"}`,
  // which is not a `JobStatus`. V1 calls the same outcome Stopped.
  it("maps the daemon's Cancelled/Canceled onto Stopped", () => {
    expect(coerceJobStatus("Cancelled")).toBe("Stopped");
    expect(coerceJobStatus("Canceled")).toBe("Stopped");
  });

  it("refuses anything else rather than inventing a status", () => {
    expect(coerceJobStatus("Job finished")).toBeUndefined();
    expect(coerceJobStatus("")).toBeUndefined();
    expect(coerceJobStatus(undefined)).toBeUndefined();
    expect(coerceJobStatus(7)).toBeUndefined();
  });
});

describe("isActiveStatus", () => {
  // `JobsApp.DataTable.cs:183` and `:35`.
  it("covers exactly Running, Queued, Pending and Blocked", () => {
    expect((["Running", "Queued", "Pending", "Blocked"] as JobStatus[]).every(isActiveStatus)).toBe(
      true,
    );
    expect(
      (["Completed", "Failed", "Timeout", "Stopped"] as JobStatus[]).some(isActiveStatus),
    ).toBe(false);
  });
});

describe("normalizeJobId", () => {
  // `Helpers/JobId.cs`.
  it("pads a numeric id to five digits and leaves anything else alone", () => {
    expect(normalizeJobId("458")).toBe("00458");
    expect(normalizeJobId("00458")).toBe("00458");
    expect(normalizeJobId(" 7 ")).toBe("00007");
    expect(normalizeJobId("123456")).toBe("123456");
    expect(normalizeJobId("00458-ExecutePlan")).toBe("00458-ExecutePlan");
  });
});

describe("jobsStore action guards", () => {
  beforeEach(async () => {
    jobsStore.resetExitTracking();
    await seed([]);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete (bridge as OptionalBridge).deleteJob;
    delete (bridge as OptionalBridge).forceStartJob;
    vi.restoreAllMocks();
  });

  it("refuses to cancel a job that has already exited", async () => {
    await seed([job("j1", "Completed")]);
    const cancel = vi.spyOn(bridge, "cancelJob").mockResolvedValue(undefined);

    expect(await jobsStore.cancelJob("j1")).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels a Pending or Blocked job, not just a moving one", async () => {
    await seed([job("j1", "Pending"), job("j2", "Blocked")]);
    const cancel = vi.spyOn(bridge, "cancelJob").mockResolvedValue(undefined);

    expect(await jobsStore.cancelJob("j1")).toBe(true);
    expect(await jobsStore.cancelJob("j2")).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  // The session view prefers `jobDetails[id]` over the list row, so a patch that only reached
  // `jobs` left an open tab showing the status from before the action.
  it("writes the optimistic Stopped to the detail entry as well as the list row", async () => {
    await seed([job("j1", "Running", { statusMessage: "Executing plan..." })]);
    vi.spyOn(bridge, "getJob").mockResolvedValue({
      ...job("j1", "Running", { statusMessage: "Executing plan..." }),
    });
    await jobsStore.fetchJobDetail("j1");
    vi.spyOn(bridge, "cancelJob").mockResolvedValue(undefined);

    await jobsStore.cancelJob("j1");

    expect(jobsStore.getJobDetail("j1")?.status).toBe("Stopped");
    // The Running message is not true of a stopped job; clearing it lets the view fall back to
    // V1's "Job was manually stopped" default.
    expect(jobsStore.getJobDetail("j1")?.statusMessage).toBeUndefined();
  });

  it("counts queued and active jobs the way the header labels do", async () => {
    await seed([
      job("j1", "Queued"),
      job("j2", "Queued"),
      job("j3", "Running"),
      job("j4", "Blocked"),
      job("j5", "Completed"),
    ]);

    expect(jobsStore.queuedJobCount()).toBe(2);
    expect(jobsStore.activeJobCount()).toBe(4);
  });

  // `JobService.StopQueuedJobs` (`JobService.cs:685`) and the confirm copy's promise that
  // "Running jobs are not affected".
  it("stopQueuedJobs stops only the queued jobs and returns the count", async () => {
    await seed([job("j1", "Queued"), job("j2", "Running"), job("j3", "Queued")]);
    const cancel = vi.spyOn(bridge, "cancelJob").mockResolvedValue(undefined);

    expect(await jobsStore.stopQueuedJobs()).toBe(2);
    expect(cancel.mock.calls.map((c) => c[0])).toEqual(["j1", "j3"]);
  });

  // `JobService.StopAllJobs` (`JobService.cs:406`).
  it("stopAllJobs stops every unfinished job and leaves terminal ones alone", async () => {
    await seed([
      job("j1", "Running"),
      job("j2", "Queued"),
      job("j3", "Pending"),
      job("j4", "Blocked"),
      job("j5", "Failed"),
    ]);
    const cancel = vi.spyOn(bridge, "cancelJob").mockResolvedValue(undefined);

    expect(await jobsStore.stopAllJobs()).toBe(4);
    expect(cancel.mock.calls.map((c) => c[0])).toEqual(["j1", "j2", "j3", "j4"]);
    // The daemon's own `stop_all_jobs` records this message, so the rows read the same either way.
    expect(cancel.mock.calls.every((c) => c[1] === "Stopped by stop-all")).toBe(true);
  });

  it("keeps sweeping past a stop the daemon refused and reports what it managed", async () => {
    await seed([job("j1", "Running"), job("j2", "Running")]);
    vi.spyOn(bridge, "cancelJob").mockImplementation(async (id: string) => {
      if (id === "j1") throw new Error("process already gone");
    });

    expect(await jobsStore.stopAllJobs()).toBe(1);
  });

  it("offers no Delete or Force Start while the bridge cannot perform them", async () => {
    expect(jobsStore.canDeleteJob()).toBe(false);
    expect(jobsStore.canForceStartJob()).toBe(false);
    await expect(jobsStore.deleteJob("j1")).rejects.toThrow(/bridge.deleteJob/);
    await expect(jobsStore.forceStartJob("j1")).rejects.toThrow(/bridge.forceStartJob/);
  });

  // `JobsApp.DataTable.cs:302-315`: a Running or Queued job is stopped first, then deleted.
  it("stops a running job before deleting it, and drops it from every copy", async () => {
    await seed([job("j1", "Running"), job("j2", "Running")]);
    const cancel = vi.spyOn(bridge, "cancelJob").mockResolvedValue(undefined);
    const del = vi.fn().mockResolvedValue(undefined);
    (bridge as OptionalBridge).deleteJob = del;
    // The refresh that follows the delete reads the daemon again, and by then the row is gone.
    vi.spyOn(bridge, "listJobs").mockResolvedValue([job("j2", "Running")]);

    await jobsStore.deleteJob("j1");

    expect(cancel).toHaveBeenCalledWith("j1", undefined);
    expect(del).toHaveBeenCalledWith("j1");
    await waitFor(() => expect(jobsStore.getState().jobs.map((j) => j.id)).toEqual(["j2"]));
  });

  // V1's confirm handler stops only Running and Queued - narrower than the Stop action's guard,
  // because a Pending or Blocked job holds no process.
  it("does not pre-stop a Blocked job before deleting it", async () => {
    await seed([job("j1", "Blocked")]);
    const cancel = vi.spyOn(bridge, "cancelJob").mockResolvedValue(undefined);
    (bridge as OptionalBridge).deleteJob = vi.fn().mockResolvedValue(undefined);

    await jobsStore.deleteJob("j1");

    expect(cancel).not.toHaveBeenCalled();
  });

  it("deletes even when the pre-emptive stop fails", async () => {
    await seed([job("j1", "Running")]);
    vi.spyOn(bridge, "cancelJob").mockRejectedValue(new Error("no such process"));
    const del = vi.fn().mockResolvedValue(undefined);
    (bridge as OptionalBridge).deleteJob = del;

    await jobsStore.deleteJob("j1");

    expect(del).toHaveBeenCalledWith("j1");
  });

  // `JobService.ForceStartJob` (`JobService.cs:1201`) returns without doing anything unless the job
  // is Blocked.
  it("force-starts a Blocked job and refuses any other status", async () => {
    await seed([job("j1", "Blocked"), job("j2", "Queued")]);
    const force = vi.fn().mockResolvedValue(undefined);
    (bridge as OptionalBridge).forceStartJob = force;

    expect(await jobsStore.forceStartJob("j1")).toBe(true);
    expect(await jobsStore.forceStartJob("j2")).toBe(false);
    expect(force).toHaveBeenCalledTimes(1);
    expect(force).toHaveBeenCalledWith("j1");
  });
});

describe("jobsStore stream event ingestion", () => {
  beforeEach(() => {
    jobsStore.clearSession("s1");
    jobsStore.clearSession("s2");
  });

  // The old key fell back to `Date.now()`, so two frames of the same type in the same millisecond
  // collapsed into one and a line of agent output was silently lost.
  it("keeps two distinct frames that land in the same millisecond", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    expect(jobsStore.addStreamEvent("s1", { kind: "text", text: "first" }, 0)).toBe(true);
    expect(jobsStore.addStreamEvent("s1", { kind: "text", text: "second" }, 1)).toBe(true);
    expect(jobsStore.getSessionEvents("s1")).toHaveLength(2);

    vi.restoreAllMocks();
  });

  // A frame's log line index is its identity. `since_line` stops the daemon replaying a prefix in the
  // first place, and this covers the remaining overlap: a job watched over both the per-job stream and
  // the broadcast `job-event` channel delivers some lines twice.
  it("ingests a given log line once, however often it arrives", () => {
    jobsStore.addStreamEvent("s1", { kind: "text", text: "a" }, 0);
    jobsStore.addStreamEvent("s1", { kind: "text", text: "b" }, 1);

    // The same two lines again, then a new one.
    expect(jobsStore.addStreamEvent("s1", { kind: "text", text: "a" }, 0)).toBe(false);
    expect(jobsStore.addStreamEvent("s1", { kind: "text", text: "b" }, 1)).toBe(false);
    expect(jobsStore.addStreamEvent("s1", { kind: "text", text: "c" }, 2)).toBe(true);

    expect(jobsStore.getSessionEvents("s1").map((e) => e.rawText)).toEqual([
      JSON.stringify({ kind: "text", text: "a" }),
      JSON.stringify({ kind: "text", text: "b" }),
      JSON.stringify({ kind: "text", text: "c" }),
    ]);
  });

  it("still deduplicates a frame that carries its own id", () => {
    expect(jobsStore.addStreamEvent("s1", { id: "e1", text: "a" })).toBe(true);
    expect(jobsStore.addStreamEvent("s1", { id: "e1", text: "a" })).toBe(false);
  });

  // Clearing one job's session used to clear the dedupe set of every other open stream.
  it("clearing one session leaves another session's dedupe state intact", () => {
    jobsStore.addStreamEvent("s1", { id: "e1", text: "a" });
    jobsStore.addStreamEvent("s2", { id: "e2", text: "b" });

    jobsStore.clearSession("s1");

    expect(jobsStore.addStreamEvent("s2", { id: "e2", text: "b" })).toBe(false);
  });
});

describe("JobSessionView lifecycle rendering", () => {
  beforeEach(() => {
    vi.spyOn(jobsStore, "subscribeToJob").mockReturnValue(() => {});
  });

  afterEach(() => {
    delete (bridge as OptionalBridge).deleteJob;
    delete (bridge as OptionalBridge).forceStartJob;
    vi.restoreAllMocks();
  });

  function show(j: Job) {
    jobsStore.clearSession(j.id);
    return render(<JobSessionView job={j} events={[]} />);
  }

  it("pads the job id it displays", () => {
    show(job("638", "Running"));
    expect(screen.getByText("00638")).toBeInTheDocument();
  });

  // `OutputSheet.cs:42-47`.
  it("explains a Pending job rather than leaving it blank", () => {
    show(job("00001", "Pending"));
    expect(screen.getByTestId("job-failure-reason")).toHaveTextContent(
      "Job is queued and waiting to start.",
    );
  });

  // `OutputSheet.cs:52` keys the live viewer on Running alone.
  it("does not animate a Queued job as though it were working", () => {
    show(job("00002", "Queued"));
    expect(screen.queryByText("Starting…")).not.toBeInTheDocument();
    expect(screen.getByTestId("job-failure-reason")).toHaveTextContent(
      "Waiting for a job slot to become available",
    );
  });

  it("offers Stop for a Blocked job and not for a finished one", () => {
    const blocked = show(job("00003", "Blocked"));
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    blocked.unmount();

    show(job("00004", "Completed"));
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("offers Force Start only for a Blocked job, and only when the bridge can", () => {
    const withoutBridge = show(job("00005", "Blocked"));
    expect(screen.queryByTestId("job-force-start")).not.toBeInTheDocument();
    withoutBridge.unmount();

    (bridge as OptionalBridge).forceStartJob = vi.fn().mockResolvedValue(undefined);

    const blocked = show(job("00005", "Blocked"));
    expect(screen.getByTestId("job-force-start")).toBeInTheDocument();
    blocked.unmount();

    show(job("00006", "Queued"));
    expect(screen.queryByTestId("job-force-start")).not.toBeInTheDocument();
  });

  // `JobsApp.DataTable.cs:296-317`, copy included.
  it("confirms a Delete in V1's words, then stops and deletes", async () => {
    const deleteJob = vi.spyOn(jobsStore, "deleteJob").mockResolvedValue(undefined);
    vi.spyOn(jobsStore, "canDeleteJob").mockReturnValue(true);
    const onCloseTab = vi.fn();

    jobsStore.clearSession("00007");
    render(<JobSessionView job={job("00007", "Running")} events={[]} onCloseTab={onCloseTab} />);

    fireEvent.click(screen.getByTestId("job-delete"));

    expect(screen.getByText("Delete Job")).toBeInTheDocument();
    expect(
      screen.getByText("Are you sure you want to delete this job? This cannot be undone."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(deleteJob).toHaveBeenCalledWith("00007"));
    expect(onCloseTab).toHaveBeenCalled();
  });

  it("keeps the delete dialog open with the reason when the daemon refuses", async () => {
    vi.spyOn(jobsStore, "canDeleteJob").mockReturnValue(true);
    vi.spyOn(jobsStore, "deleteJob").mockRejectedValue(new Error("job is still running"));

    jobsStore.clearSession("00008");
    render(<JobSessionView job={job("00008", "Completed")} events={[]} />);

    fireEvent.click(screen.getByTestId("job-delete"));
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Delete failed.*job is still running/),
    );
    expect(screen.getByTestId("job-delete-dialog")).toBeInTheDocument();
  });
});

describe("JobSessionView cost and token display", () => {
  beforeEach(() => {
    vi.spyOn(jobsStore, "subscribeToJob").mockReturnValue(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  function show(j: Job) {
    jobsStore.clearSession(j.id);
    return render(<JobSessionView job={j} events={[]} />);
  }

  // A subscription-plan run: tokens spent, nothing billed. "0" and "unknown" must not look alike.
  it("distinguishes a cost of zero from no cost at all", () => {
    const none = show(job("00010", "Completed", { tokens: 450_000 }));
    expect(screen.getByTestId("job-tokens")).toHaveTextContent("Tokens 450K");
    expect(screen.getByTestId("job-cost")).toHaveTextContent("Cost —");
    none.unmount();

    show(job("00011", "Completed", { tokens: 450_000, cost: 0 }));
    expect(screen.getByTestId("job-cost")).toHaveTextContent("Cost $0.00");
  });

  it("shows nothing at all for a job with neither figure", () => {
    show(job("00012", "Completed"));
    expect(screen.queryByTestId("job-cost")).not.toBeInTheDocument();
    expect(screen.queryByTestId("job-tokens")).not.toBeInTheDocument();
  });

  // `FormatHelper.FormatTokens` keeps scaling past a million rather than saturating.
  it("keeps a very large token count readable and carries the exact figure", () => {
    show(job("00013", "Completed", { tokens: 1_400_000_000 }));
    const tokens = screen.getByTestId("job-tokens");
    expect(tokens).toHaveTextContent("Tokens 1400.0M");
    expect(tokens).toHaveAttribute("title", "1,400,000,000");
  });

  // `JobsApp.Data.cs:49`: an estimate derived from tokens times the price list is prefixed "~" so
  // the figure never presents itself as a charge anyone was billed.
  it("marks an estimated cost with V1's tilde", () => {
    show({
      ...job("00014", "Completed", { tokens: 12_000, cost: 1.234 }),
      costSource: "Estimated",
    } as Job);
    expect(screen.getByTestId("job-cost")).toHaveTextContent("Cost ~$1.23");
  });
});
