import { startAgentTerminal, type AgentTerminalRun } from "../api/agentTerminal";

/**
 * One interactive agent per chat session, shared across the mounts of the pane that shows it.
 *
 * `AgentTerminalView` used to start its agent directly in a mount effect, which React StrictMode
 * double-invokes: run, clean up, run again. The cleanup could not undo the first start, because the
 * start is asynchronous and `runRef` was still null when it fired -- so both invocations reached
 * `startAgentTerminal` and **two ptys were spawned for one chat session**. That single fault produces
 * all three symptoms of the bug report at once:
 *
 * - *"a bunch of letters/numbers"* -- both ptys tag their frames with the same **chat** session id, so
 *   `startViaTauri`'s `frame.chatSessionId !== chatSessionId` filter passes both and two agents'
 *   interleaved ANSI lands in one emulator.
 * - *"I can't type into it"* -- the native bridge's `READERS` map is keyed by chat session id too
 *   (`agent_terminal_bridge.rs`), so the second spawn overwrites the first's entry, and the retired
 *   mount's `close()` then aborts whichever reader is registered *now*: the live one.
 * - *"it did not properly resize"* -- `onResize` reaches one pty; the other keeps its default grid and
 *   keeps drawing at that width.
 *
 * `chatStore.init` already solves this class of problem the same way: hold the in-flight promise
 * *synchronously*, so a second invocation adopts the first one's work instead of repeating it. The
 * extra piece needed here is the close. A cleanup cannot end the agent immediately, because under
 * StrictMode a remount for the same session follows in the same commit, so a release only *schedules*
 * the close and an acquire that arrives first cancels it. A genuine unmount is one tick later and
 * otherwise unchanged: closing still ends the agent, which is the contract `close()` documents.
 *
 * Output is routed through a swappable sink rather than the callback the starting mount closed over,
 * so a remount re-points the live stream at the terminal now on screen instead of writing into a
 * handle that has been detached.
 */

/** Where a pane's output goes. Swapped, not re-subscribed, when the pane remounts. */
export interface AgentTerminalSink {
  onChunk: (bytes: Uint8Array) => void;
  /** The agent's exit message, after which no more output arrives. */
  onEnd: (message: string) => void;
}

type Frame = { kind: "chunk"; bytes: Uint8Array } | { kind: "end"; message: string };

/**
 * Output that arrived while no pane was attached is replayed to the next one. The gap is one tick
 * wide -- between a StrictMode cleanup and the remount that follows it -- but an agent prints its
 * banner the instant it starts, which is exactly what lands in that gap.
 *
 * Capped because a release that is never followed by an acquire holds this until its close fires, and
 * a chatty agent should not be able to grow it without bound in the meantime. Dropping the oldest
 * frames matches the emulator's own scrollback behaviour.
 */
const MAX_DETACHED_FRAMES = 256;

interface Entry {
  promise: Promise<AgentTerminalRun>;
  /** Null between a release and either its close firing or the next acquire adopting the entry. */
  sink: AgentTerminalSink | null;
  detached: Frame[];
  closeTimer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, Entry>();

function push(entry: Entry, frame: Frame): void {
  if (entry.sink) {
    if (frame.kind === "chunk") entry.sink.onChunk(frame.bytes);
    else entry.sink.onEnd(frame.message);
    return;
  }
  entry.detached.push(frame);
  if (entry.detached.length > MAX_DETACHED_FRAMES) entry.detached.shift();
}

/**
 * The agent for `sessionId`, started if it is not already running.
 *
 * `prompt` is only read when the agent is actually started: it is `AgentAppArgs.Prompt`, the task
 * typed at launch, and a session already running has consumed it. A second acquire carrying a
 * different prompt therefore reuses the run rather than restarting it -- restarting would discard the
 * transcript the pane exists to show.
 */
export function acquireAgentTerminal(
  sessionId: string,
  prompt: string | undefined,
  sink: AgentTerminalSink,
): Promise<AgentTerminalRun> {
  const existing = entries.get(sessionId);
  if (existing) {
    if (existing.closeTimer !== null) {
      clearTimeout(existing.closeTimer);
      existing.closeTimer = null;
    }
    existing.sink = sink;
    const replay = existing.detached;
    existing.detached = [];
    for (const frame of replay) {
      if (frame.kind === "chunk") sink.onChunk(frame.bytes);
      else sink.onEnd(frame.message);
    }
    return existing.promise;
  }

  const entry: Entry = {
    promise: undefined as unknown as Promise<AgentTerminalRun>,
    sink,
    detached: [],
    closeTimer: null,
  };
  entry.promise = startAgentTerminal(sessionId, {
    prompt,
    // Read off the entry on every frame rather than captured, so a remount's sink receives the output
    // of the run the previous mount started.
    onChunk: (bytes) => push(entry, { kind: "chunk", bytes }),
    onEnd: (message) => push(entry, { kind: "end", message }),
  });
  entries.set(sessionId, entry);
  // A start that failed leaves nothing to reuse, and keeping the rejected promise would make every
  // later acquire fail with an error from a pane that is long gone. The caller still sees the
  // rejection through the promise it was handed; this only forgets it.
  entry.promise.catch(() => {
    if (entries.get(sessionId) === entry) entries.delete(sessionId);
  });
  return entry.promise;
}

/**
 * Gives up a pane's claim on the agent, ending it unless another mount claims it first.
 *
 * `sink` identifies the caller: a cleanup that runs *after* a newer mount has taken the entry over
 * must not take the stream away from it. React orders StrictMode's cleanup before the remount, but an
 * effect re-run caused by a changed dependency has no such guarantee.
 */
export function releaseAgentTerminal(sessionId: string, sink: AgentTerminalSink): void {
  const entry = entries.get(sessionId);
  if (!entry || entry.sink !== sink) return;

  entry.sink = null;
  if (entry.closeTimer !== null) return;
  entry.closeTimer = setTimeout(() => {
    // Re-read rather than trusting the closure: an acquire landing in this same tick clears the
    // timer, but only this check stops a stale timer from deleting an entry that has been adopted.
    if (entries.get(sessionId) !== entry || entry.sink !== null) return;
    entries.delete(sessionId);
    void entry.promise
      .then((run) => run.close())
      .catch(() => {
        // Nothing to close: the start failed, and its rejection reached the pane already.
      });
  }, 0);
}

/** Test seam: vitest keeps one module instance per file, and this registry outlives a render. */
export function resetAgentTerminalRunsForTesting(): void {
  for (const entry of entries.values()) {
    if (entry.closeTimer !== null) clearTimeout(entry.closeTimer);
  }
  entries.clear();
}
