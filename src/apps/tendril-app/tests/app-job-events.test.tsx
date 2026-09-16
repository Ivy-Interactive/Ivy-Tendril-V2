import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, cleanup } from "@testing-library/react";
import { App } from "../src/App";
import { bridge } from "../src/api/bridge";
import { chatApi } from "../src/api/chatApi";
import * as events from "../src/api/events";
import { jobsStore } from "../src/state/jobsStore";
import { plansStore } from "../src/state/plansStore";

/**
 * The shell's `onJobEvent` handler.
 *
 * The daemon only recently began emitting job lifecycle over this channel; before that it emitted
 * nothing job-shaped at all, so this handler appended agent output and nothing else, and the 5s poll
 * was the only thing that ever moved a badge. These tests pin the two halves that were dead wiring:
 * a lifecycle event has to refresh the list, and a terminal one has to refresh the plan list too,
 * because a finished job moves its plan's state and that is a separate projection.
 */
describe("App job event handling", () => {
  /** The handler the shell registers, captured so a frame can be delivered to it directly. */
  let deliver: ((payload: unknown) => void) | undefined;

  beforeEach(() => {
    vi.spyOn(bridge, "listPlans").mockResolvedValue([]);
    vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
    vi.spyOn(bridge, "listProjects").mockResolvedValue([]);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
    vi.spyOn(events, "onJobEvent").mockImplementation((handler) => {
      deliver = handler as (payload: unknown) => void;
      return Promise.resolve(() => {});
    });
  });

  afterEach(() => {
    // Unmount before restoring the spies. `App` is a real mount: it registers store subscriptions and
    // a 5s job poll, and the stores are module singletons shared with every other test file in this
    // worker — so a mount left standing keeps calling into them after this file is done.
    cleanup();
    deliver = undefined;
    vi.restoreAllMocks();
  });

  const mountAndWait = async () => {
    render(<App />);
    await waitFor(() => expect(deliver).toBeDefined());
  };

  it("refreshes the job list on a status change, and does not treat it as agent output", async () => {
    const fetchJobs = vi.spyOn(jobsStore, "fetchJobs").mockResolvedValue([]);
    const addStreamEvent = vi.spyOn(jobsStore, "addStreamEvent");
    await mountAndWait();
    fetchJobs.mockClear();

    await act(async () => {
      deliver!({ type: "job.status_changed", jobId: "00007", status: "Running" });
    });

    expect(fetchJobs).toHaveBeenCalled();
    // A lifecycle event is not a log line; appending it would put JSON in the output viewer.
    expect(addStreamEvent).not.toHaveBeenCalled();
  });

  it("also refreshes plans when a job reaches a terminal state", async () => {
    const fetchJobs = vi.spyOn(jobsStore, "fetchJobs").mockResolvedValue([]);
    const fetchPlans = vi.spyOn(plansStore, "fetchPlans").mockResolvedValue([]);
    await mountAndWait();
    fetchJobs.mockClear();
    fetchPlans.mockClear();

    await act(async () => {
      deliver!({ type: "job.completed", jobId: "00007", status: "Completed" });
    });

    expect(fetchJobs).toHaveBeenCalled();
    expect(fetchPlans).toHaveBeenCalled();
  });

  it("treats a failure the same way, since it also moves the plan", async () => {
    const fetchPlans = vi.spyOn(plansStore, "fetchPlans").mockResolvedValue([]);
    await mountAndWait();
    fetchPlans.mockClear();

    await act(async () => {
      deliver!({ type: "job.failed", jobId: "00007", status: "Failed" });
    });

    expect(fetchPlans).toHaveBeenCalled();
  });

  it("re-reads both projections on a resync rather than trying to replay", async () => {
    const fetchJobs = vi.spyOn(jobsStore, "fetchJobs").mockResolvedValue([]);
    const fetchPlans = vi.spyOn(plansStore, "fetchPlans").mockResolvedValue([]);
    const addStreamEvent = vi.spyOn(jobsStore, "addStreamEvent");
    await mountAndWait();
    fetchJobs.mockClear();
    fetchPlans.mockClear();

    // The daemon sends this when a client fell behind its broadcast. There is nothing to replay into
    // a log from a dropped-count, so the only correct reaction is to re-read.
    await act(async () => {
      deliver!({ type: "resync", dropped: 12 });
    });

    expect(fetchJobs).toHaveBeenCalled();
    expect(fetchPlans).toHaveBeenCalled();
    expect(addStreamEvent).not.toHaveBeenCalled();
  });

  it("still appends an agent output frame, which is what this channel used to carry alone", async () => {
    const addStreamEvent = vi.spyOn(jobsStore, "addStreamEvent");
    await mountAndWait();

    await act(async () => {
      deliver!({ jobId: "00007", type: "assistant", text: "working" });
    });

    expect(addStreamEvent).toHaveBeenCalledWith("00007", expect.objectContaining({ text: "working" }));
  });
});
