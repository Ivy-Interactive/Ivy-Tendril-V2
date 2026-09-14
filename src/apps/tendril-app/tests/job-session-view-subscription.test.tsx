import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { JobSessionView } from "../src/views/JobSessionView";
import { jobsStore } from "../src/state/jobsStore";
import type { Job } from "../types/api";

describe("JobSessionView Real-Time Subscription", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jobsStore.clearSession("job-view-100");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const mockRunningJob: Job = {
    id: "job-view-100",
    type: "CreatePlan",
    project: "Tendril",
    status: "Running",
    planTitle: "Test Plan Streaming",
  };

  it("initiates jobsStore.subscribeToJob with the job ID upon mounting", () => {
    const subscribeSpy = vi.spyOn(jobsStore, "subscribeToJob");

    render(<JobSessionView job={mockRunningJob} events={[]} />);

    expect(subscribeSpy).toHaveBeenCalledWith(mockRunningJob.id);
  });

  it("calls the returned unsubscribe function when unmounting", () => {
    const unsubMock = vi.fn();
    vi.spyOn(jobsStore, "subscribeToJob").mockReturnValue(unsubMock);

    const { unmount } = render(<JobSessionView job={mockRunningJob} events={[]} />);

    expect(unsubMock).not.toHaveBeenCalled();
    unmount();
    expect(unsubMock).toHaveBeenCalledTimes(1);
  });

  it("updates the rendered stream in AgentViewer upon receiving SSE events", async () => {
    const jobEvents: Job = {
      id: "job-view-stream-events",
      type: "CreatePlan",
      project: "Tendril",
      status: "Running",
    };
    jobsStore.clearSession(jobEvents.id);

    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controllerRef = ctrl;
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    ) as unknown as typeof fetch;

    render(<JobSessionView job={jobEvents} events={[]} />);

    controllerRef?.enqueue(
      encoder.encode(
        'event: event\ndata: {"kind":"text","timestamp":"2026-09-14T10:00:00Z","text":"Starting plan research..."}\n\n',
      ),
    );

    await waitFor(() => {
      expect(screen.getByText("Starting plan research...")).toBeInTheDocument();
    });
  });

  it("updates job status in the header immediately from Running to Completed upon receiving terminal event", async () => {
    const jobCompleted: Job = {
      id: "job-view-end-completed",
      type: "CreatePlan",
      project: "Tendril",
      status: "Running",
      planTitle: "Test Completed Streaming",
    };
    jobsStore.clearSession(jobCompleted.id);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: end\ndata: {"status":"Completed"}\n\n'));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    ) as unknown as typeof fetch;

    vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue({
      ...jobCompleted,
      status: "Completed",
    });
    vi.spyOn(jobsStore, "fetchJobs").mockResolvedValue([]);

    render(<JobSessionView job={jobCompleted} events={[]} />);

    expect(screen.getByText("Running")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Completed")).toBeInTheDocument();
    });
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("updates job status in the header immediately from Running to Failed upon receiving terminal failure event", async () => {
    const jobFailed: Job = {
      id: "job-view-end-failed",
      type: "CreatePlan",
      project: "Tendril",
      status: "Running",
      planTitle: "Test Failed Streaming",
    };
    jobsStore.clearSession(jobFailed.id);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: end\ndata: {"status":"Failed"}\n\n'));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    ) as unknown as typeof fetch;

    vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue({
      ...jobFailed,
      status: "Failed",
    });
    vi.spyOn(jobsStore, "fetchJobs").mockResolvedValue([]);

    render(<JobSessionView job={jobFailed} events={[]} />);

    expect(screen.getByText("Running")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });
});
