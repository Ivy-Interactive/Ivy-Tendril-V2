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
  onEvent: (event: JobStreamEvent) => void;
  onEnd?: (status: string) => void;
  onError?: (err: unknown) => void;
}

export function subscribeJobEvents(
  baseUrl: string,
  jobId: string,
  token: string | undefined,
  options: JobEventSubscriptionOptions,
): EventUnsubscribe {
  const controller = new AbortController();
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${trimmedBase}/api/jobs/${encodeURIComponent(jobId)}/events`);
  if (options.kinds && options.kinds.length > 0) {
    url.searchParams.set("kinds", options.kinds.join(","));
  }

  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let active = true;

  void (async () => {
    try {
      const response = await fetch(url.toString(), {
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to subscribe to job events: HTTP ${response.status}`);
      }

      const body = response.body;
      if (!body) {
        return;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";
      let currentData: string[] = [];

      const processLine = (line: string) => {
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }

        if (line === "") {
          if (currentData.length > 0) {
            const dataStr = currentData.join("\n");
            if (currentEvent === "end") {
              let status = "Completed";
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
                  status = parsed.status;
                }
              } catch {
                if (dataStr) {
                  status = dataStr;
                }
              }
              options.onEnd?.(status);
              active = false;
              controller.abort();
            } else {
              try {
                const parsed = JSON.parse(dataStr);
                options.onEvent(parsed);
              } catch {
                options.onEvent({ text: dataStr, message: dataStr });
              }
            }
          }
          currentEvent = "";
          currentData = [];
        } else if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          currentData.push(line.slice(5).trimStart());
        }
      };

      while (active) {
        const { value, done } = await reader.read();
        if (done) {
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
