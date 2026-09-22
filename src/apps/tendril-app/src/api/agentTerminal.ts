import { invoke } from "@tauri-apps/api/core";
import {
  decodeBase64,
  onAgentTerminalEvent,
  subscribeSse,
  type AgentTerminalEvent,
  type EventUnsubscribe,
} from "./events";
import { encodeBase64, isTauri } from "../utils/tauri";
import { i18n } from "../i18n";

/** The `meta` frame: what a pane needs before it can type into the agent. */
export interface AgentTerminalSession {
  /** The pty session id, which `input` / `resize` / close are keyed by. */
  sessionId: string;
  encoding: string;
  rows: number;
  cols: number;
}

export interface AgentTerminalOptions {
  /** A task typed for the agent on launch, as `AgentAppArgs.Prompt` is in V1. */
  prompt?: string;
  agentId?: string;
  modelId?: string;
  /** One chunk of raw terminal output: escapes, bare carriage returns and partial sequences included. */
  onChunk?: (bytes: Uint8Array) => void;
  /** The agent's exit message, after which no more output arrives. */
  onEnd?: (message: string) => void;
  onError?: (err: unknown) => void;
  /** Daemon origin for the browser transport. Unused under Tauri, where the native side knows it. */
  httpBaseUrl?: string;
  /** Bearer credential for the browser transport. Unused under Tauri, where the secret is native-only. */
  token?: string;
}

/** A running agent terminal, and the three things a terminal view needs to do to it. */
export interface AgentTerminalRun {
  session: AgentTerminalSession;
  /** Sends keystrokes. A string is sent as UTF-8. */
  sendInput(data: string | Uint8Array): Promise<void>;
  resize(rows: number, cols: number): Promise<void>;
  /** Stops watching the output **and ends the agent**: it has nothing to serve once the pane is gone. */
  close(): Promise<void>;
}

/**
 * Starts an interactive agent for a chat session over whichever transport can actually authenticate.
 *
 * The two transports are **exclusive**, chosen once by host: a failure on the native path is raised as
 * itself rather than retried over HTTP. Falling through would send the request to the asset origin,
 * where it cannot succeed, and replace the real reason with a meaningless one.
 */
export function startAgentTerminal(
  chatSessionId: string,
  options: AgentTerminalOptions,
): Promise<AgentTerminalRun> {
  return isTauri() ? startViaTauri(chatSessionId, options) : startViaHttp(chatSessionId, options);
}

/**
 * Desktop transport: the native side reads the stream and re-emits it, because `invoke` cannot stream
 * and the daemon's route is bearer-authenticated with a secret the webview never sees.
 *
 * The listener is registered before the invoke and frames are held until the pty id comes back,
 * because the agent can write before the invoke's return value has crossed the boundary.
 */
async function startViaTauri(
  chatSessionId: string,
  options: AgentTerminalOptions,
): Promise<AgentTerminalRun> {
  let started = false;
  const pending: AgentTerminalEvent[] = [];

  const deliver = (frame: AgentTerminalEvent) => {
    if (frame.event === "end") {
      options.onEnd?.(frame.data);
      return;
    }
    if (frame.event === "log") {
      try {
        options.onChunk?.(decodeBase64(frame.data));
      } catch (err) {
        options.onError?.(err);
      }
    }
  };

  const unlisten = await onAgentTerminalEvent((frame) => {
    if (frame.chatSessionId !== chatSessionId) return;
    if (!started) {
      pending.push(frame);
      return;
    }
    deliver(frame);
  });

  let session: AgentTerminalSession;
  try {
    session = await invoke<AgentTerminalSession>("cmd_execute_agent_terminal", {
      sessionId: chatSessionId,
      prompt: options.prompt ?? null,
      agentId: options.agentId ?? null,
      modelId: options.modelId ?? null,
    });
  } catch (err) {
    unlisten();
    throw err;
  }

  started = true;
  for (const frame of pending) deliver(frame);
  pending.length = 0;

  const ptySessionId = session.sessionId;
  return {
    session,
    async sendInput(data) {
      await invoke<void>("cmd_send_agent_terminal_input", {
        sessionId: chatSessionId,
        ptySessionId,
        data: encodeBase64(data),
      });
    },
    async resize(rows, cols) {
      await invoke<void>("cmd_resize_agent_terminal", {
        sessionId: chatSessionId,
        ptySessionId,
        rows,
        cols,
      });
    },
    async close() {
      unlisten();
      await invoke<boolean>("cmd_close_agent_terminal", { sessionId: chatSessionId });
    },
  };
}

/** Browser transport: the webview reads the SSE stream itself, same-origin through the dev proxy. */
async function startViaHttp(
  chatSessionId: string,
  options: AgentTerminalOptions,
): Promise<AgentTerminalRun> {
  const base = (options.httpBaseUrl ?? "").replace(/\/+$/, "");
  const url = `${base}/api/chat/sessions/${encodeURIComponent(chatSessionId)}/terminal`;
  let unsubscribe: EventUnsubscribe = () => {};

  const session = await new Promise<AgentTerminalSession>((resolve, reject) => {
    let settled = false;
    unsubscribe = subscribeSse(url, {
      method: "POST",
      token: options.token,
      body: JSON.stringify({
        prompt: options.prompt ?? null,
        agentId: options.agentId ?? null,
        modelId: options.modelId ?? null,
      }),
      onEvent: (event, data) => {
        if (event === "meta") {
          try {
            const parsed = JSON.parse(data) as AgentTerminalSession;
            settled = true;
            resolve(parsed);
          } catch (err) {
            settled = true;
            reject(err);
          }
          return;
        }
        if (event === "log") {
          try {
            options.onChunk?.(decodeBase64(data));
          } catch (err) {
            options.onError?.(err);
          }
        }
      },
      onEnd: (data) => options.onEnd?.(data),
      onError: (err) => {
        if (!settled) {
          settled = true;
          reject(err);
          return;
        }
        options.onError?.(err);
      },
    });
  });

  const control = async (endpoint: string, body: Record<string, unknown>) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
    const response = await fetch(
      `${base}/api/chat/sessions/${encodeURIComponent(chatSessionId)}/${endpoint}`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );
    if (!response.ok) {
      throw new Error(
        i18n.t("common:errors.agentTerminalFailed", { endpoint, status: response.status }),
      );
    }
  };

  return {
    session,
    async sendInput(data) {
      await control("terminal/input", {
        sessionId: session.sessionId,
        data: encodeBase64(data),
      });
    },
    async resize(rows, cols) {
      await control("terminal/resize", { sessionId: session.sessionId, rows, cols });
    },
    async close() {
      unsubscribe();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
      await fetch(`${base}/api/chat/sessions/${encodeURIComponent(chatSessionId)}/terminal`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ sessionId: session.sessionId }),
      }).catch(() => {
        // The pane is already gone; a failed kill is the daemon's to reap.
      });
    },
  };
}
