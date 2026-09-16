import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { JobSessionView } from "../src/views/JobSessionView";
import { jobsStore } from "../src/state/jobsStore";
import type { Job } from "../src/types/api";

/**
 * The desktop transport for job output (#143).
 *
 * `/api/jobs/:id/events` is in the daemon's protected router and the bearer secret is native-only, so
 * a `fetch` from the webview is answered with a 401 - which is what the app used to do, and why live
 * agent output never appeared in the session view. Under Tauri the subscription must go through
 * `cmd_subscribe_job_events`, whose native side holds the credential, and the frames it re-emits must
 * reach the rendered viewer.
 *
 * These tests assert on both halves: the invoke that was made, and the output that came back. A fetch
 * of any kind fails them, because a fetch is the bug.
 */

const unlisten = vi.fn();
let frameHandler: ((event: { payload: unknown }) => void) | null = null;
const invoked: Array<{ cmd: string; args?: Record<string, unknown> }> = [];

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    if (name === "job-stream-event") frameHandler = handler;
    return Promise.resolve(unlisten);
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    return Promise.resolve(undefined);
  },
}));

const runningJob: Job = {
  id: "job-native-1",
  type: "ExecutePlan",
  project: "Tendril",
  status: "Running",
  planTitle: "Native stream",
};

/** Pushes one bridged frame and lets React flush the store notification it triggers. */
async function emitFrame(frame: {
  jobId: string;
  event: string;
  data: string;
  line: number | null;
}) {
  await act(async () => {
    frameHandler?.({ payload: frame });
    await Promise.resolve();
  });
}

describe("JobSessionView under Tauri", () => {
  const originalFetch = globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    frameHandler = null;
    invoked.length = 0;
    unlisten.mockClear();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};

    // Any call at all is a failure: it would be the unauthenticated request this fix removes.
    fetchSpy = vi.fn(() => {
      throw new Error("the webview must not read the daemon's job stream directly");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    jobsStore.clearSession(runningJob.id);
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("subscribes through the native bridge and renders the frames it re-emits", async () => {
    render(<JobSessionView job={runningJob} events={[]} />);

    await waitFor(() => {
      expect(invoked.map((i) => i.cmd)).toContain("cmd_subscribe_job_events");
    });
    const subscribe = invoked.find((i) => i.cmd === "cmd_subscribe_job_events");
    expect(subscribe?.args).toEqual({
      jobId: runningJob.id,
      // No `kinds` filter and nothing ingested yet, so there is no prefix to skip.
      kinds: null,
      sinceLine: null,
    });

    await emitFrame({
      jobId: runningJob.id,
      event: "event",
      data: JSON.stringify({
        kind: "text",
        timestamp: "2026-09-14T10:00:00Z",
        text: "Reading the plan...",
      }),
      line: 0,
    });

    await waitFor(() => {
      expect(screen.getByText("Reading the plan...")).toBeInTheDocument();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores frames belonging to another job's stream", async () => {
    render(<JobSessionView job={runningJob} events={[]} />);
    await waitFor(() => {
      expect(frameHandler).not.toBeNull();
    });

    await emitFrame({
      jobId: "some-other-job",
      event: "event",
      data: JSON.stringify({ kind: "text", text: "not mine" }),
      line: 0,
    });

    expect(jobsStore.getSessionEvents(runningJob.id)).toHaveLength(0);
    expect(screen.queryByText("not mine")).not.toBeInTheDocument();
  });

  it("takes the terminal status from the bridged end frame", async () => {
    const detailSpy = vi
      .spyOn(jobsStore, "fetchJobDetail")
      .mockResolvedValue({ ...runningJob, status: "Failed" });
    vi.spyOn(jobsStore, "fetchJobs").mockResolvedValue([]);

    render(<JobSessionView job={runningJob} events={[]} />);
    await waitFor(() => {
      expect(frameHandler).not.toBeNull();
    });
    expect(screen.getByText("Running")).toBeInTheDocument();

    await emitFrame({
      jobId: runningJob.id,
      event: "end",
      data: JSON.stringify({ status: "Failed" }),
      line: null,
    });

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });
    expect(detailSpy).toHaveBeenCalledWith(runningJob.id);
  });

  it("stops the native stream when the view unmounts", async () => {
    const { unmount } = render(<JobSessionView job={runningJob} events={[]} />);
    await waitFor(() => {
      expect(invoked.map((i) => i.cmd)).toContain("cmd_subscribe_job_events");
    });

    unmount();

    expect(unlisten).toHaveBeenCalled();
    expect(invoked.map((i) => i.cmd)).toContain("cmd_unsubscribe_job_events");
    expect(invoked.find((i) => i.cmd === "cmd_unsubscribe_job_events")?.args).toEqual({
      jobId: runningJob.id,
    });
  });

  it("resumes after the last line it holds rather than replaying the run", async () => {
    render(<JobSessionView job={runningJob} events={[]} />);
    await waitFor(() => {
      expect(frameHandler).not.toBeNull();
    });

    for (const line of [0, 1, 2]) {
      await emitFrame({
        jobId: runningJob.id,
        event: "event",
        data: JSON.stringify({ kind: "text", text: `line ${line}` }),
        line,
      });
    }
    expect(jobsStore.getSessionEvents(runningJob.id)).toHaveLength(3);

    // A remount: the store still holds the session, so the daemon is told where to pick up.
    invoked.length = 0;
    jobsStore.subscribeToJob(runningJob.id);

    await waitFor(() => {
      expect(invoked.find((i) => i.cmd === "cmd_subscribe_job_events")?.args).toEqual({
        jobId: runningJob.id,
        kinds: null,
        sinceLine: 3,
      });
    });
  });

  it("does not ingest a line twice if two transports deliver it", async () => {
    render(<JobSessionView job={runningJob} events={[]} />);
    await waitFor(() => {
      expect(frameHandler).not.toBeNull();
    });

    const frame = {
      jobId: runningJob.id,
      event: "event",
      data: JSON.stringify({ kind: "text", text: "once" }),
      line: 4,
    };
    await emitFrame(frame);
    await emitFrame(frame);

    expect(jobsStore.getSessionEvents(runningJob.id)).toHaveLength(1);
  });
});
