import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subscribeJobEvents } from "../src/api/events";
import { jobsStore } from "../src/state/jobsStore";

describe("Job Events Subscription Utility", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jobsStore.clearSession("job-999");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("formats URL with and without kinds query parameter", async () => {
    let capturedUrl1 = "";
    let capturedUrl2 = "";

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (!capturedUrl1) {
        capturedUrl1 = url;
      } else {
        capturedUrl2 = url;
      }
      return Promise.resolve(
        new Response(new ReadableStream(), {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    }) as unknown as typeof fetch;

    const unsub1 = subscribeJobEvents("http://localhost:3000", "job-42", undefined, {
      kinds: ["tool_use", "assistant"],
      onEvent: () => {},
    });
    unsub1();

    expect(capturedUrl1).toBe(
      "http://localhost:3000/api/jobs/job-42/events?kinds=tool_use%2Cassistant",
    );

    const unsub2 = subscribeJobEvents("http://localhost:3000", "job-43", undefined, {
      onEvent: () => {},
    });
    unsub2();

    expect(capturedUrl2).toBe("http://localhost:3000/api/jobs/job-43/events");
  });

  it("injects Authorization bearer token and Accept headers", async () => {
    let capturedHeaders: Record<string, string> | undefined;

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return Promise.resolve(
        new Response(new ReadableStream(), {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    }) as unknown as typeof fetch;

    const unsub = subscribeJobEvents("http://localhost:3000", "job-50", "secret-token-abc", {
      onEvent: () => {},
    });
    unsub();

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders?.["Authorization"]).toBe("Bearer secret-token-abc");
    expect(capturedHeaders?.["Accept"]).toBe("text/event-stream");
  });

  it("parses SSE chunks across chunk boundaries and handles terminal event", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Chunk 1: Complete event
        controller.enqueue(
          encoder.encode('event: event\ndata: {"kind":"tool_use","tool_name":"bash"}\n\n'),
        );
        // Chunk 2: Split event across boundary
        controller.enqueue(encoder.encode('event: event\ndata: {"kind":"status",'));
        controller.enqueue(encoder.encode('"message":"step 2 done"}\n\n'));
        // Chunk 3: Terminal end event
        controller.enqueue(encoder.encode('event: end\ndata: {"status":"Completed"}\n\n'));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    ) as unknown as typeof fetch;

    const receivedEvents: unknown[] = [];
    let endStatus = "";

    await new Promise<void>((resolve) => {
      subscribeJobEvents("http://localhost:3000", "job-100", undefined, {
        onEvent: (event) => {
          receivedEvents.push(event);
        },
        onEnd: (status) => {
          endStatus = status;
          resolve();
        },
      });
    });

    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0]).toEqual({
      kind: "tool_use",
      tool_name: "bash",
    });
    expect(receivedEvents[1]).toEqual({
      kind: "status",
      message: "step 2 done",
    });
    expect(endStatus).toBe("Completed");
  });

  it("supports cancellation via unsubscribe function", async () => {
    let aborted = false;

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      }
      return Promise.resolve(
        new Response(new ReadableStream(), {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    }) as unknown as typeof fetch;

    const unsub = subscribeJobEvents("http://localhost:3000", "job-60", undefined, {
      onEvent: () => {},
    });

    expect(aborted).toBe(false);
    unsub();
    expect(aborted).toBe(true);
  });

  it("integrates with jobsStore.subscribeToJob and populates active session", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: event\ndata: {"type":"tool_call","id":"evt-1","tool_name":"git"}\n\n',
          ),
        );
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    ) as unknown as typeof fetch;

    jobsStore.subscribeToJob("job-999", ["tool_call"], "http://localhost:3000", "test-token");

    // Wait a brief moment for the stream reader microtasks to flush
    await new Promise((resolve) => setTimeout(resolve, 50));

    const events = jobsStore.getSessionEvents("job-999");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe("tool_call");
  });

  it("updates job status and triggers detail refresh upon receiving onEnd", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: event\ndata: {"type":"status","status":"Running","message":"In progress..."}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('event: end\ndata: {"status":"Completed"}\n\n'));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    ) as unknown as typeof fetch;

    const fetchDetailSpy = vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue({
      id: "job-end-test",
      type: "Test",
      project: "Tendril",
      status: "Completed",
    });
    const fetchJobsSpy = vi.spyOn(jobsStore, "fetchJobs").mockResolvedValue([]);

    let endStatus = "";
    await new Promise<void>((resolve) => {
      jobsStore.subscribeToJob("job-end-test", undefined, "http://localhost:3000", undefined, {
        onEnd: (status) => {
          endStatus = status;
          resolve();
        },
      });
    });

    expect(endStatus).toBe("Completed");
    expect(jobsStore.getJobDetail("job-end-test")?.status).toBe("Completed");
    expect(fetchDetailSpy).toHaveBeenCalledWith("job-end-test");
    expect(fetchJobsSpy).toHaveBeenCalled();
  });
});
