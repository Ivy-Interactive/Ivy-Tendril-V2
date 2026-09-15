import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeBase64, subscribeJobEvents, subscribeReviewAction, subscribeSse } from "../events";

/**
 * A `fetch` that streams `chunks` back, in order, as one SSE response.
 *
 * The chunk boundaries are the point of most of these tests: the daemon writes whenever the process
 * does, so a frame is routinely split — including inside a `data:` line — and a reader that assumes
 * one chunk is one frame loses output.
 */
function streamingFetch(chunks: string[], init?: { ok?: boolean; status?: number }) {
  const encoder = new TextEncoder();
  const calls: { url: string; init: RequestInit }[] = [];

  const fetchMock = vi.fn((url: string, requestInit: RequestInit) => {
    calls.push({ url, init: requestInit });
    let index = 0;
    return Promise.resolve({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      text: () => Promise.resolve("nope"),
      body: {
        getReader: () => ({
          read: () =>
            Promise.resolve(
              index < chunks.length
                ? { value: encoder.encode(chunks[index++]), done: false }
                : { value: undefined, done: true },
            ),
        }),
      },
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

/** Lets the reader loop drain: each chunk costs at least one microtask turn. */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("subscribeSse", () => {
  it("reassembles a frame split across chunks", async () => {
    streamingFetch(["event: log\nda", 'ta: {"a":1', "}\n\n"]);
    const frames: [string, string][] = [];

    subscribeSse("/api/stream", { onEvent: (event, data) => frames.push([event, data]) });
    await drain();

    expect(frames).toEqual([["log", '{"a":1}']]);
  });

  it("joins a frame's multiple data lines with newlines", async () => {
    streamingFetch(["event: log\ndata: first\ndata: second\n\n"]);
    const frames: [string, string][] = [];

    subscribeSse("/api/stream", { onEvent: (event, data) => frames.push([event, data]) });
    await drain();

    expect(frames).toEqual([["log", "first\nsecond"]]);
  });

  it("hands the payload over undecoded", async () => {
    // Whether a stream's frames are JSON, text or base64 is the caller's business; trimming or
    // parsing here would corrupt one of them.
    streamingFetch(["event: log\ndata:   aGVsbG8=  \n\n"]);
    const frames: [string, string][] = [];

    subscribeSse("/api/stream", { onEvent: (event, data) => frames.push([event, data]) });
    await drain();

    expect(frames).toEqual([["log", "aGVsbG8=  "]]);
  });

  it("tolerates CRLF line endings", async () => {
    streamingFetch(["event: log\r\ndata: hi\r\n\r\n"]);
    const frames: [string, string][] = [];

    subscribeSse("/api/stream", { onEvent: (event, data) => frames.push([event, data]) });
    await drain();

    expect(frames).toEqual([["log", "hi"]]);
  });

  it("ends on the end frame and stops reading", async () => {
    streamingFetch([
      "event: log\ndata: one\n\n",
      "event: end\ndata: Process exited with code 0\n\n",
      "event: log\ndata: after the end\n\n",
    ]);
    const frames: [string, string][] = [];
    const ended: string[] = [];

    subscribeSse("/api/stream", {
      onEvent: (event, data) => frames.push([event, data]),
      onEnd: (data) => ended.push(data),
    });
    await drain();

    expect(ended).toEqual(["Process exited with code 0"]);
    expect(frames).toEqual([["log", "one"]]);
  });

  it("delivers a final frame that arrived without its blank line", async () => {
    // A process that exits immediately can have its stream closed before the terminator is written.
    streamingFetch(["event: end\ndata: Process exited with code 1"]);
    const ended: string[] = [];

    subscribeSse("/api/stream", { onEvent: () => {}, onEnd: (data) => ended.push(data) });
    await drain();

    expect(ended).toEqual(["Process exited with code 1"]);
  });

  it("posts a body and authenticates when asked", async () => {
    const calls = streamingFetch(["event: end\ndata: done\n\n"]);

    subscribeSse("/api/stream", {
      method: "POST",
      body: '{"planId":"00636"}',
      token: "s3cret",
      onEvent: () => {},
    });
    await drain();

    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe('{"planId":"00636"}');
    expect(calls[0].init.headers).toMatchObject({
      Accept: "text/event-stream",
      Authorization: "Bearer s3cret",
      "Content-Type": "application/json",
    });
  });

  it("reports a rejected request through onError", async () => {
    streamingFetch([], { ok: false, status: 404 });
    const errors: unknown[] = [];

    subscribeSse("/api/stream", { onEvent: () => {}, onError: (err) => errors.push(err) });
    await drain();

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("404");
  });

  it("aborts the request when unsubscribed, without reporting an error", async () => {
    const calls = streamingFetch([]);
    const errors: unknown[] = [];

    const unsubscribe = subscribeSse("/api/stream", {
      onEvent: () => {},
      onError: (err) => errors.push(err),
    });
    await drain();
    unsubscribe();
    await drain();

    expect((calls[0].init.signal as AbortSignal).aborted).toBe(true);
    expect(errors).toEqual([]);
  });
});

describe("subscribeJobEvents", () => {
  it("parses events as JSON and reads the end status out of its payload", async () => {
    const calls = streamingFetch([
      'event: message\ndata: {"kind":"text","text":"hello"}\n\n',
      'event: end\ndata: {"status":"Failed"}\n\n',
    ]);
    const events: unknown[] = [];
    const ended: string[] = [];

    subscribeJobEvents("http://127.0.0.1:5055/", "03231", "token", {
      kinds: ["text", "tool"],
      onEvent: (event) => events.push(event),
      onEnd: (status) => ended.push(status),
    });
    await drain();

    expect(calls[0].url).toBe("http://127.0.0.1:5055/api/jobs/03231/events?kinds=text%2Ctool");
    expect(events).toEqual([{ kind: "text", text: "hello" }]);
    expect(ended).toEqual(["Failed"]);
  });

  it("falls back to text for a frame that is not JSON", async () => {
    streamingFetch(["event: message\ndata: not json\n\n", "event: end\ndata: Cancelled\n\n"]);
    const events: unknown[] = [];
    const ended: string[] = [];

    subscribeJobEvents("http://127.0.0.1:5055", "03231", undefined, {
      onEvent: (event) => events.push(event),
      onEnd: (status) => ended.push(status),
    });
    await drain();

    expect(events).toEqual([{ text: "not json", message: "not json" }]);
    expect(ended).toEqual(["Cancelled"]);
  });

  it("reports Completed for an end frame with no status", async () => {
    streamingFetch(['event: end\ndata: {"other":true}\n\n']);
    const ended: string[] = [];

    subscribeJobEvents("http://127.0.0.1:5055", "03231", undefined, {
      onEvent: () => {},
      onEnd: (status) => ended.push(status),
    });
    await drain();

    expect(ended).toEqual(["Completed"]);
  });
});

describe("subscribeReviewAction", () => {
  it("reports the session, then the raw bytes of each log frame", async () => {
    // base64 of "\x1b[32mready\x1b[0m\r\n": escapes and a bare carriage return that must survive.
    const payload = "[32mready[0m\r\n";
    const encoded = btoa(payload);
    const calls = streamingFetch([
      `event: meta\ndata: {"encoding":"base64","sessionId":"abc123","rows":24,"cols":80}\n\n`,
      `event: log\ndata: ${encoded}\n\n`,
      "event: end\ndata: Process exited with code 0\n\n",
    ]);

    const sessions: unknown[] = [];
    const chunks: Uint8Array[] = [];
    const ended: string[] = [];

    subscribeReviewAction("", "Demo", "Run App", {
      planId: "00636",
      onSession: (session) => sessions.push(session),
      onChunk: (bytes) => chunks.push(bytes),
      onEnd: (message) => ended.push(message),
    });
    await drain();

    expect(calls[0].url).toBe("/api/projects/Demo/review-actions/Run%20App/execute");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ planId: "00636", worktree: null });
    expect(sessions).toEqual([{ encoding: "base64", sessionId: "abc123", rows: 24, cols: 80 }]);
    expect(new TextDecoder().decode(chunks[0])).toBe(payload);
    expect(ended).toEqual(["Process exited with code 0"]);
  });

  it("ignores frames it does not understand rather than treating them as output", async () => {
    streamingFetch(["event: comment\ndata: keep-alive\n\n"]);
    const chunks: Uint8Array[] = [];
    const errors: unknown[] = [];

    subscribeReviewAction("http://127.0.0.1:5055", "Demo", "Run", {
      onChunk: (bytes) => chunks.push(bytes),
      onError: (err) => errors.push(err),
    });
    await drain();

    expect(chunks).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("reports unreadable meta through onError instead of throwing", async () => {
    streamingFetch(["event: meta\ndata: {not json}\n\n"]);
    const sessions: unknown[] = [];
    const errors: unknown[] = [];

    subscribeReviewAction("", "Demo", "Run", {
      onSession: (session) => sessions.push(session),
      onChunk: () => {},
      onError: (err) => errors.push(err),
    });
    await drain();

    expect(sessions).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});

describe("decodeBase64", () => {
  it("round-trips bytes that are not valid text", () => {
    const bytes = new Uint8Array([0x00, 0x1b, 0x5b, 0x41, 0xff, 0x0d]);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    expect(Array.from(decodeBase64(btoa(binary)))).toEqual(Array.from(bytes));
  });
});
