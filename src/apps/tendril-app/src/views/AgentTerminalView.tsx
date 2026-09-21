import React from "react";
import { Terminal, type TerminalHandle } from "@ivy-interactive/components/tendril";
import { HeaderLayout } from "@ivy-interactive/components/ui";
import { Terminal as TerminalIcon } from "lucide-react";
import type { AgentTerminalRun } from "../api/agentTerminal";
import {
  acquireAgentTerminal,
  releaseAgentTerminal,
  type AgentTerminalSink,
} from "../state/agentTerminalRuns";
import { NewChatModeButtons } from "../components/chat/NewChatModeButtons";
import { chatStore } from "../state/chatStore";
import { describeBridgeError } from "../types/api";
import type { ChatMode } from "../state/appearance";
import type { ChatSession } from "../types/chat";

export interface AgentTerminalViewProps {
  /** The chat session this pane belongs to. Also what authorises the spawn, daemon-side. */
  sessionId: string;
  /** A task typed for the agent on launch, as `AgentAppArgs.Prompt` is. */
  prompt?: string;
  /**
   * Starts a new chat, `TerminalSessionHeader`'s `OnCreateSession`. The pane passes an explicit
   * `terminal` override rather than letting the default decide: a "New" button inside a terminal
   * that opened the chat view instead would be the one press whose meaning is unambiguous from
   * where it sits.
   */
  onNewSession?: (override?: ChatMode) => void;
}

/**
 * The agent's own terminal, as a chat session — V1's `AgentApp`.
 *
 * The other half of V1's chat modes: `ChatLauncher.TargetFor` reads `chatMode` and sends a session
 * either to the chat view or here, where the agent draws its own interface and Tendril renders bytes.
 * Nothing is parsed and no messages are written to the session; V1's terminal sessions hold at most
 * the one prompt that named them (`TendrilAppShell.EnsureTerminalSession`).
 *
 * The frame is `HeaderLayout` with `scrollContent={false}`: V1 is `Layout.Vertical().Gap(0).Full()`
 * with a 48px header over a terminal at `Height(Size.Full())`, and xterm.js owns its own scrollback —
 * an outer scroller would fight it for the scroll position. The page itself is registered full-bleed
 * in `navigation.ts`, so this draws to the frame's edges rather than removing padding of its own.
 */
export const AgentTerminalView: React.FC<AgentTerminalViewProps> = ({
  sessionId,
  prompt,
  onNewSession,
}) => {
  const [session, setSession] = React.useState<ChatSession | null>(null);
  const [closed, setClosed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const terminalRef = React.useRef<TerminalHandle | null>(null);
  const runRef = React.useRef<AgentTerminalRun | null>(null);
  /**
   * Output that arrived before the emulator was on screen. An agent prints its banner immediately, so
   * without this the first frame is lost to a ref that is not attached yet. Nothing is buffered once
   * the terminal is gone: the pane does not come back.
   */
  const pendingRef = React.useRef<Uint8Array[]>([]);
  const retiredRef = React.useRef(false);
  /**
   * The grid the emulator last reported, held so the pty can be told about it once there is a pty to
   * tell. `Terminal` announces its size as soon as it has measured itself -- unconditionally, so that
   * "a terminal that happened to open at its default size" still reports -- and that is reliably
   * *before* the daemon has answered the spawn, so `onResize`'s `runRef.current?.resize(...)` found
   * null and dropped the only size report that was ever going to be made. The agent then drew its
   * interface to an 80x24 default that had nothing to do with the pane, which is the "it did not
   * properly resize" half of the report. Re-fitting on reveal cannot stand in for this: the addon
   * raises `onResize` only when the grid actually *changed*, so a pane that is already the right size
   * stays silent.
   */
  const gridRef = React.useRef<{ rows: number; cols: number } | null>(null);

  const write = React.useCallback((bytes: Uint8Array) => {
    const handle = terminalRef.current;
    if (handle) handle.write(bytes);
    else if (!retiredRef.current) pendingRef.current.push(bytes);
  }, []);

  const attachTerminal = React.useCallback((handle: TerminalHandle | null) => {
    terminalRef.current = handle;
    if (!handle) {
      pendingRef.current = [];
      retiredRef.current = true;
      return;
    }
    for (const chunk of pendingRef.current) handle.write(chunk);
    pendingRef.current = [];
  }, []);

  // The header names the conversation, so it reads the session the same way the chat view does.
  React.useEffect(() => {
    let cancelled = false;
    void chatStore
      .fetchSession(sessionId)
      .then((loaded) => {
        if (!cancelled) setSession(loaded);
      })
      .catch(() => {
        // A pane whose title could not be read still runs; the fallback label covers it.
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  React.useEffect(() => {
    let cancelled = false;
    const sink: AgentTerminalSink = {
      onChunk: write,
      onEnd: (message) => {
        // Printed into the transcript rather than into chrome above it: the agent's own last words
        // and the host's report belong in one scrollback, which is where a reader is looking.
        write(new TextEncoder().encode(`\r\n\x1b[2m${message}\x1b[0m\r\n`));
        setClosed(true);
      },
    };

    // Acquired rather than started: the registry owns the agent, so StrictMode's second invocation
    // adopts the run the first one started instead of spawning a second pty against the same chat
    // session id. Ending it is still what a real unmount does; see `releaseAgentTerminal`.
    void acquireAgentTerminal(sessionId, prompt, sink)
      .then((run) => {
        if (cancelled) return;
        runRef.current = run;
        // Either the size report that arrived before this run existed, or -- when the registry hands
        // back an agent another mount started -- this pane's grid, which may differ from the one it
        // was fitted to.
        const grid = gridRef.current;
        if (grid) void run.resize(grid.rows, grid.cols);
      })
      .catch((err) => {
        if (!cancelled) setError(describeBridgeError(err));
      });

    return () => {
      cancelled = true;
      runRef.current = null;
      releaseAgentTerminal(sessionId, sink);
    };
  }, [sessionId, prompt, write]);

  const title = session?.title?.trim() || "Agent";

  return (
    <HeaderLayout
      scrollContent={false}
      contentClassName="p-0"
      data-testid="agent-terminal-view"
      header={
        // V1's `TerminalSessionHeader`: a fixed 48px strip naming the session, with the actions that
        // belong to the pane rather than to the agent.
        <div className="flex h-12 items-center gap-2 pl-5 pr-2">
          <TerminalIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium" title={title}>
            {title}
          </span>
          {/* The same pair the chat header carries, so the chat-UI mode stays reachable from a
              terminal: in terminal mode this view *is* the chat, and a lone "New" here would leave
              the other mode with no button anywhere on screen. */}
          {onNewSession && <NewChatModeButtons onNewChat={onNewSession} size="sm" />}
        </div>
      }
    >
      {error ? (
        <p className="p-4 text-sm text-muted-foreground" data-testid="agent-terminal-error">
          {error}
        </p>
      ) : (
        /*
         * `closed` rather than `readOnly`: both refuse keystrokes and hide the cursor, but only
         * `closed` also takes the starting indicator down, which is the honest answer for an agent
         * that exited before printing anything. The loading overlay waits for *visible* output, so a
         * cursor-hide or a title sequence does not dismiss it — V1's `.Loading($"Starting {agent}...")`.
         */
        <Terminal
          ref={attachTerminal}
          className="h-full"
          closed={closed}
          loading
          loadingText={`Starting ${session?.agentId?.trim() || "agent"}…`}
          onInput={(data) => void runRef.current?.sendInput(data)}
          onResize={(rows, cols) => {
            // Recorded as well as forwarded: a report that lands before the spawn returns is replayed
            // when it does, and is what a later mount re-reports after adopting a running agent.
            gridRef.current = { rows, cols };
            void runRef.current?.resize(rows, cols);
          }}
        />
      )}
    </HeaderLayout>
  );
};
