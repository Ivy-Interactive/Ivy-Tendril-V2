import React from "react";
import { Terminal, type TerminalHandle } from "@ivy-interactive/components/tendril";
import { Button, HeaderLayout } from "@ivy-interactive/components/ui";
import { Plus, Terminal as TerminalIcon } from "lucide-react";
import { startAgentTerminal, type AgentTerminalRun } from "../api/agentTerminal";
import { chatStore } from "../state/chatStore";
import { describeBridgeError } from "../types/api";
import type { ChatSession } from "../types/chat";

export interface AgentTerminalViewProps {
  /** The chat session this pane belongs to. Also what authorises the spawn, daemon-side. */
  sessionId: string;
  /** A task typed for the agent on launch, as `AgentAppArgs.Prompt` is. */
  prompt?: string;
  /** Starts a new terminal chat, `TerminalSessionHeader`'s `OnCreateSession`. */
  onNewSession?: () => void;
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

    void (async () => {
      try {
        const run = await startAgentTerminal(sessionId, {
          prompt,
          onChunk: write,
          onEnd: (message) => {
            // Printed into the transcript rather than into chrome above it: the agent's own last words
            // and the host's report belong in one scrollback, which is where a reader is looking.
            write(new TextEncoder().encode(`\r\n\x1b[2m${message}\x1b[0m\r\n`));
            setClosed(true);
          },
        });
        if (cancelled) {
          void run.close();
          return;
        }
        runRef.current = run;
      } catch (err) {
        if (!cancelled) setError(describeBridgeError(err));
      }
    })();

    return () => {
      cancelled = true;
      // Ends the agent, not just the reading of it: an interactive session has nothing to serve once
      // its pane is gone, and leaving one running would leak a model session per closed tab.
      const run = runRef.current;
      runRef.current = null;
      if (run) void run.close();
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
          {onNewSession && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onNewSession}
              data-testid="agent-terminal-new"
              title="New terminal chat"
            >
              <Plus className="size-4" aria-hidden="true" />
              New
            </Button>
          )}
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
          onResize={(rows, cols) => void runRef.current?.resize(rows, cols)}
        />
      )}
    </HeaderLayout>
  );
};

export default AgentTerminalView;
