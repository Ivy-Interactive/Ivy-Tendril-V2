import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type EventUnsubscribe = () => void;

export async function onServiceStatus(
  handler: (status: "connected" | "reconnecting" | "disconnected") => void,
): Promise<EventUnsubscribe> {
  const unlisten: UnlistenFn = await listen<string>("service-status", (event) => {
    handler(event.payload as "connected" | "reconnecting" | "disconnected");
  });
  return () => unlisten();
}

export async function onJobEvent(handler: (payload: unknown) => void): Promise<EventUnsubscribe> {
  const unlisten: UnlistenFn = await listen<unknown>("job-event", (event) => {
    handler(event.payload);
  });
  return () => unlisten();
}

export async function onPlanEvent(handler: (payload: unknown) => void): Promise<EventUnsubscribe> {
  const unlisten: UnlistenFn = await listen<unknown>("plan-event", (event) => {
    handler(event.payload);
  });
  return () => unlisten();
}

/**
 * Fires when a PR sync pass reported a change. Listens on both channels because
 * `route_ws_message` in `service/ws_bridge.rs` routes only `type: "state"` and `type: "status"` to
 * `plan-event` and classifies every other message type — `pr_status_changed` included — as a job
 * event. Filtering here rather than guessing a channel keeps the subscriber correct either way.
 */
export async function onPrStatusEvent(handler: () => void): Promise<EventUnsubscribe> {
  const isPrStatusChange = (payload: unknown): boolean => {
    if (typeof payload === "string") return payload === "pr_status_changed";
    if (typeof payload !== "object" || payload === null) return false;
    return (payload as { type?: unknown }).type === "pr_status_changed";
  };

  const unlistens = await Promise.all(
    (["plan-event", "job-event"] as const).map((channel) =>
      listen<unknown>(channel, (event) => {
        if (isPrStatusChange(event.payload)) handler();
      }),
    ),
  );
  return () => unlistens.forEach((unlisten) => unlisten());
}

/** What changed on disk. `folder: null` on a plans change means "rescan everything". */
export type ChangeTarget =
  | { kind: "plans"; folder: string | null }
  | { kind: "config" }
  | { kind: "inbox" };

export interface ChangeEvent {
  type: "fs.change";
  target: ChangeTarget;
}

/**
 * Filesystem changes, bridged from the daemon's `/api/changes/events` SSE stream by
 * `service/changes_bridge.rs`. That stream is bearer-authenticated and the secret is native-only, so
 * the webview receives the frames as Tauri events rather than reading the stream itself.
 */
export async function onChangeEvent(
  handler: (event: ChangeEvent) => void,
): Promise<EventUnsubscribe> {
  const unlisten: UnlistenFn = await listen<ChangeEvent>("change-event", (event) => {
    handler(event.payload);
  });
  return () => unlisten();
}

/** Connection transitions of the change stream, which decide whether polling is needed at all. */
export async function onChangeStreamStatus(
  handler: (status: "connected" | "disconnected") => void,
): Promise<EventUnsubscribe> {
  const unlisten: UnlistenFn = await listen<string>("change-stream-status", (event) => {
    handler(event.payload as "connected" | "disconnected");
  });
  return () => unlisten();
}

export async function onChatEvent(
  handler: (event: import("../types/chat").ChatEvent) => void,
): Promise<EventUnsubscribe> {
  const unlisten: UnlistenFn = await listen<import("../types/chat").ChatEvent>(
    "chat-event",
    (event) => {
      handler(event.payload);
    },
  );
  return () => unlisten();
}

export interface JobStreamEvent {
  kind?: string;
  type?: string;
  text?: string;
  delta?: boolean;
  tool_name?: string;
  tool_use_id?: string;
  input?: Record<string, unknown>;
  output?: string;
  is_error?: boolean;
  status?: string;
  message?: string;
  [key: string]: unknown;
}

export interface JobEventSubscriptionOptions {
  kinds?: string[];
  /**
   * Where to resume: the daemon skips every log line below this index.
   *
   * `/api/jobs/:id/events` reads the job's log from the start on every connection, so without this a
   * remount or a reconnect replays the whole run. Frames carry their line index (see `line` below),
   * which is what makes a resume point expressible in the first place.
   */
  sinceLine?: number;
  /** `line` is the frame's index in the job's log, from the SSE `id:` field. */
  onEvent: (event: JobStreamEvent, line?: number) => void;
  onEnd?: (status: string) => void;
  onError?: (err: unknown) => void;
}

export interface SseSubscriptionOptions {
  /** `POST` for a stream that starts something, which is what a review action's `/execute` is. */
  method?: "GET" | "POST";
  /** JSON request body, sent with `Content-Type: application/json`. */
  body?: string;
  token?: string;
  /**
   * Every frame except `end`, with the payload exactly as it arrived — undecoded and unparsed.
   *
   * `id` is the frame's SSE `id:` field when it had one. Streams that number their frames use it to
   * make a resume point expressible; streams that do not leave it `undefined`.
   */
  onEvent: (event: string, data: string, id?: string) => void;
  /** The `end` frame's raw payload. The stream is closed immediately afterwards. */
  onEnd?: (data: string) => void;
  onError?: (err: unknown) => void;
}

/**
 * Reads one SSE stream over `fetch`, calling back per frame.
 *
 * `EventSource` is not usable here: it cannot send an `Authorization` header and cannot `POST`, and
 * both are required — the daemon's stream routes are bearer-authenticated, and starting a review
 * action is a POST.
 *
 * Frames are reassembled across chunk boundaries, which can fall anywhere including mid-`data:`. The
 * payload is handed over untouched: this function has no way to know whether a given stream's frames
 * are JSON, text, or base64, and guessing would corrupt one of them.
 */
export function subscribeSse(url: string, options: SseSubscriptionOptions): EventUnsubscribe {
  const controller = new AbortController();

  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };
  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let active = true;

  void (async () => {
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to subscribe to ${url}: HTTP ${response.status}`);
      }

      const body = response.body;
      if (!body) {
        return;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";
      let currentId: string | undefined;
      let currentData: string[] = [];

      const processLine = (line: string) => {
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }

        if (line === "") {
          if (currentData.length > 0) {
            // Per the SSE spec, multiple data lines in one frame join with newlines.
            const dataStr = currentData.join("\n");
            if (currentEvent === "end") {
              options.onEnd?.(dataStr);
              active = false;
              controller.abort();
            } else {
              options.onEvent(currentEvent, dataStr, currentId);
            }
          }
          currentEvent = "";
          currentId = undefined;
          currentData = [];
        } else if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("id:")) {
          currentId = line.slice(3).trim();
        } else if (line.startsWith("data:")) {
          currentData.push(line.slice(5).trimStart());
        }
      };

      while (active) {
        const { value, done } = await reader.read();
        if (done) {
          // A stream that ended without its blank-line terminator still holds a frame worth
          // delivering — including, for a short-lived process, its `end`.
          if (buffer.length > 0) {
            processLine(buffer);
            processLine("");
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          processLine(line);
          if (!active) {
            break;
          }
        }
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        return;
      }
      options.onError?.(err);
    }
  })();

  return () => {
    active = false;
    controller.abort();
  };
}

/**
 * Whether the app is running inside the Tauri host.
 *
 * Duplicated from `api/bridge.ts` rather than imported: `bridge.ts` imports this module, and the
 * cycle would be resolved at load time by whichever side won, which for a module-scope `invoke`
 * lookup is not something to leave to chance.
 */
function isTauriHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** One frame of a job's event stream, as re-emitted by `service/job_events_bridge.rs`. */
export interface JobStreamFrame {
  jobId: string;
  /** `event` or `end`. */
  event: string;
  /** The frame's payload, exactly as the daemon sent it. */
  data: string;
  /** The frame's index in the job's log, or `null` for a frame the daemon did not number. */
  line: number | null;
}

/**
 * Job event frames bridged from the daemon's `/api/jobs/:id/events` SSE stream by
 * `service/job_events_bridge.rs`, for the same reason [`onChangeEvent`] exists.
 */
export async function onJobStreamEvent(
  handler: (frame: JobStreamFrame) => void,
): Promise<EventUnsubscribe> {
  const unlisten: UnlistenFn = await listen<JobStreamFrame>("job-stream-event", (event) => {
    handler(event.payload);
  });
  return () => unlisten();
}

/**
 * Subscribes to a job's event stream over whichever transport can actually authenticate.
 *
 * Under Tauri that is the native bridge: `/api/jobs/:id/events` is bearer-authenticated and the
 * secret is deliberately native-only, so a `fetch` from the webview gets a 401 and the job session
 * view shows nothing. This is why the change stream and review actions are bridged natively too;
 * job events were the one stream still trying to read the daemon directly from the webview, which is
 * why live agent output never appeared in the desktop app.
 *
 * In a browser build there is no native side, so the HTTP transport is used with whatever credential
 * the caller has.
 */
export function subscribeToJobStream(
  jobId: string,
  options: JobEventSubscriptionOptions & {
    /** Daemon origin for the HTTP transport. Unused under Tauri, where the native side knows it. */
    httpBaseUrl: string;
    /** Bearer credential for the HTTP transport. Unused under Tauri, for the reason above. */
    token?: string;
  },
): EventUnsubscribe {
  if (isTauriHost()) {
    return subscribeJobEventsViaTauri(jobId, options);
  }
  return subscribeJobEvents(options.httpBaseUrl, jobId, options.token, options);
}

/**
 * Desktop transport: the native side holds the bearer secret, reads the stream and re-emits every
 * frame as a `job-stream-event`.
 *
 * The listener is registered before the invoke, because the daemon can deliver a job's backlog before
 * the invoke's acknowledgement has crossed back over the boundary. Frames for other jobs are dropped
 * here rather than in the host, so several open job tabs cost one stream each and no cross-talk.
 */
function subscribeJobEventsViaTauri(
  jobId: string,
  options: JobEventSubscriptionOptions,
): EventUnsubscribe {
  let active = true;
  let unlisten: EventUnsubscribe | undefined;

  const deliver = (frame: JobStreamFrame) => {
    if (!active || frame.jobId !== jobId) return;

    if (frame.event === "end") {
      options.onEnd?.(parseEndStatus(frame.data));
      return;
    }

    options.onEvent(parseJobFrame(frame.data), frame.line ?? undefined);
  };

  void (async () => {
    try {
      unlisten = await onJobStreamEvent(deliver);
      if (!active) {
        unlisten();
        return;
      }
      await invoke<void>("cmd_subscribe_job_events", {
        jobId,
        kinds: options.kinds && options.kinds.length > 0 ? options.kinds.join(",") : null,
        sinceLine: options.sinceLine ?? null,
      });
    } catch (err) {
      if (!active) return;
      options.onError?.(err);
    }
  })();

  return () => {
    active = false;
    unlisten?.();
    // Fire-and-forget: the view is already gone, and a failure here only means the native reader
    // stops when the job ends instead of now.
    void invoke<void>("cmd_unsubscribe_job_events", { jobId }).catch(() => {});
  };
}

/** A frame that is not JSON is still worth showing; both fields are set because consumers read one or the other. */
function parseJobFrame(data: string): JobStreamEvent {
  try {
    return JSON.parse(data) as JobStreamEvent;
  } catch {
    return { text: data, message: data };
  }
}

function parseEndStatus(data: string): string {
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
      return parsed.status;
    }
  } catch {
    if (data) return data;
  }
  return "Completed";
}

export function subscribeJobEvents(
  baseUrl: string,
  jobId: string,
  token: string | undefined,
  options: JobEventSubscriptionOptions,
): EventUnsubscribe {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${trimmedBase}/api/jobs/${encodeURIComponent(jobId)}/events`);
  if (options.kinds && options.kinds.length > 0) {
    url.searchParams.set("kinds", options.kinds.join(","));
  }
  if (options.sinceLine !== undefined && options.sinceLine > 0) {
    url.searchParams.set("since_line", String(options.sinceLine));
  }

  return subscribeSse(url.toString(), {
    token,
    onEvent: (_event, data, id) => {
      const line = id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined;
      options.onEvent(parseJobFrame(data), line);
    },
    onEnd: (data) => options.onEnd?.(parseEndStatus(data)),
    onError: options.onError,
  });
}

/** The `meta` frame: what a client needs before it can decode output or address the session. */
export interface ReviewActionSession {
  sessionId: string;
  encoding: string;
  rows: number;
  cols: number;
}

export interface ReviewActionSubscriptionOptions {
  planId?: string;
  worktree?: string;
  token?: string;
  /** The session, once announced. Arrives before any output. */
  onSession?: (session: ReviewActionSession) => void;
  /** One chunk of raw terminal output, decoded from the frame's base64. */
  onChunk: (bytes: Uint8Array) => void;
  /** The process's exit message. */
  onEnd?: (message: string) => void;
  onError?: (err: unknown) => void;
}

/** Decodes a base64 `log` payload back into the bytes the pty produced. */
export function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Starts a review action and streams its terminal output.
 *
 * Used when the app runs in a browser rather than under Tauri; the desktop app cannot read this
 * stream from the webview (the route is bearer-authenticated with a native-only secret and the
 * webview's origin is `tauri://`), so it goes through `review_action_bridge.rs` and
 * [`onReviewActionEvent`] instead.
 *
 * A `log` frame carries base64 of the raw pty bytes, escapes and bare carriage returns included —
 * splitting that into lines is what a terminal view exists not to do.
 */
export function subscribeReviewAction(
  baseUrl: string,
  projectName: string,
  actionName: string,
  options: ReviewActionSubscriptionOptions,
): EventUnsubscribe {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const url =
    `${trimmedBase}/api/projects/${encodeURIComponent(projectName)}` +
    `/review-actions/${encodeURIComponent(actionName)}/execute`;

  return subscribeSse(url, {
    method: "POST",
    body: JSON.stringify({
      planId: options.planId ?? null,
      worktree: options.worktree ?? null,
    }),
    token: options.token,
    onEvent: (event, data) => {
      if (event === "meta") {
        try {
          options.onSession?.(JSON.parse(data) as ReviewActionSession);
        } catch (err) {
          options.onError?.(err);
        }
        return;
      }
      if (event === "log") {
        try {
          options.onChunk(decodeBase64(data));
        } catch (err) {
          options.onError?.(err);
        }
      }
    },
    onEnd: (data) => options.onEnd?.(data),
    onError: options.onError,
  });
}

/** One frame of a review action's stream, as re-emitted by `review_action_bridge.rs`. */
export interface ReviewActionEvent {
  sessionId: string;
  /** `log` or `end`; `meta` is returned by the invoke rather than emitted. */
  event: string;
  data: string;
}

/**
 * Review-action frames bridged from the daemon's `/execute` SSE stream by
 * `service/review_action_bridge.rs`, for the same reason [`onChangeEvent`] exists.
 *
 * Subscribe before starting the action: output can arrive before the invoke that started it has
 * returned the session id, so a listener registered afterwards misses the first frames.
 */
export async function onReviewActionEvent(
  handler: (event: ReviewActionEvent) => void,
): Promise<EventUnsubscribe> {
  const unlisten: UnlistenFn = await listen<ReviewActionEvent>("review-action-event", (event) => {
    handler(event.payload);
  });
  return () => unlisten();
}

/**
 * Connection transitions of a review action's stream. Unlike the change stream this never
 * reconnects — re-issuing the request would start a second process — so `disconnected` is terminal.
 */
export async function onReviewActionStreamStatus(
  handler: (status: { sessionId: string; status: "connected" | "disconnected" }) => void,
): Promise<EventUnsubscribe> {
  const unlisten: UnlistenFn = await listen<{
    sessionId: string;
    status: "connected" | "disconnected";
  }>("review-action-stream-status", (event) => {
    handler(event.payload);
  });
  return () => unlisten();
}
