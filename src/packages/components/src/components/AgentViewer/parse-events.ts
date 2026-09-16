import { StreamMetricsAccumulator, type StreamMetrics } from "./stream-metrics.ts";
import type { EventWire, PresentationEvent, ToolUsePresentation } from "./types.ts";

/**
 * Turns eventwire lines into the events the viewer renders, one line at a time.
 *
 * The one-shot [`parseEventWireStream`] is a thin wrapper over this, and the resumable form is what
 * live output needs: the viewer used to re-`split`, re-`JSON.parse` and re-fold the *entire* stream
 * every time a line arrived, which at 100k lines is a 6.9MB string and ~40ms of work **per appended
 * line** — quadratic in the length of the run, and the reason a long job's viewer became unusable long
 * before the DOM did. Feeding the parser only the new lines makes an append cost the new lines.
 *
 * [`events`](#events) is a live array, mutated in place as lines arrive rather than rebuilt, so a
 * consumer must watch [`version`](#version) rather than the array's identity. Mutating in place is
 * also what keeps a node's position stable for its whole life, which is what the virtualizer's
 * measurement cache and the reader's scroll offset are keyed on.
 */
export class EventWireStreamParser {
  /**
   * Every presentation event parsed so far, in render order. Only ever appended to, with two
   * exceptions that both keep positions intact: the open text node's `text` grows as deltas arrive,
   * and a second `result` replaces the first where it already is.
   */
  readonly events: PresentationEvent[] = [];

  /** Bumped whenever {@link events} changed in any way. */
  version = 0;

  /** Where the one `result` node lives, or `-1`. Kept so a repeat result needs no scan. */
  resultIndex = -1;

  private readonly tools = new Map<string, ToolUsePresentation>();

  /**
   * The run's own analytics, folded from the same lines. Kept here rather than derived from the events
   * because half of what it counts — a reported usage, the characters of an `[stderr]` line — is on the
   * wire and not in the presentation model, and because folding it per line is what keeps it off the
   * quadratic this class exists to avoid.
   */
  private readonly metricsFold = new StreamMetricsAccumulator();

  /** The text node currently accumulating deltas, and its accumulated text. */
  private open: {
    node: Extract<PresentationEvent, { kind: "assistant-text" }> | null;
    text: string;
  } = { node: null, text: "" };

  /** Feeds complete eventwire lines, in order. Blank and unparseable lines are skipped. */
  push(lines: readonly string[], from = 0): void {
    for (let i = from; i < lines.length; i++) {
      this.pushLine(lines[i]);
    }
  }

  pushLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Skip malformed lines gracefully.
      return;
    }
    if (!parsed || typeof parsed !== "object" || !("kind" in parsed)) return;
    this.apply(parsed as EventWire);
  }

  /**
   * Elapsed time, tokens and cost for everything folded so far, and whether each figure was reported
   * or worked out. A stable object while nothing has changed.
   */
  get metrics(): StreamMetrics {
    return this.metricsFold.metrics;
  }

  private apply(evt: EventWire): void {
    this.metricsFold.add(evt);

    switch (evt.kind) {
      case "session_init":
        this.closeText();
        this.append({ kind: "system", model: evt.model, sessionId: evt.session_id });
        break;

      case "text":
        // `[stderr]` lines are the agent's diagnostics, not its answer.
        if (evt.text?.startsWith("[stderr]")) break;
        this.appendText(evt.text, evt.delta);
        break;

      case "thinking":
        this.closeText();
        this.append({ kind: "thinking", text: evt.content });
        break;

      case "tool_call": {
        this.closeText();
        const tool: ToolUsePresentation = {
          toolUseId: evt.tool_use_id,
          name: evt.tool_name,
          description: evt.description,
          input: evt.input ?? {},
        };
        this.tools.set(evt.tool_use_id, tool);
        this.append({ kind: "tool-use", tool });
        break;
      }

      case "tool_result": {
        const existing = this.tools.get(evt.tool_use_id);
        if (existing) {
          existing.result = evt.output ?? "";
          existing.isError = evt.is_error;
          // No new node, but the tool card it belongs to now says something different.
          this.version++;
        }
        break;
      }

      case "result": {
        this.closeText();
        if (this.resultIndex >= 0) {
          this.events[this.resultIndex] = { kind: "result", wire: evt };
          this.version++;
        } else {
          this.resultIndex = this.events.length;
          this.append({ kind: "result", wire: evt });
        }
        break;
      }

      case "error":
        this.closeText();
        this.append({ kind: "error", message: evt.message });
        break;

      case "status": {
        this.closeText();
        const msg = evt.text ?? evt.message;
        if (msg && msg.trim().length > 0) {
          this.append({ kind: "status", text: msg.trim(), timestamp: evt.timestamp });
        }
        break;
      }

      default:
        break;
    }
  }

  private append(event: PresentationEvent): void {
    this.events.push(event);
    this.version++;
  }

  /**
   * Adds a chunk of assistant prose. A delta extends the open node; a whole message closes whatever
   * was open and starts a new one.
   *
   * The node is only created once the accumulated text has something in it, which is what keeps a run
   * of whitespace-only chunks from occupying a position — the same thing the older fold achieved by
   * only pushing at flush time.
   */
  private appendText(text: string, delta: boolean | undefined): void {
    if (!delta) {
      this.closeText();
      this.open.text = text;
    } else {
      this.open.text += text;
    }

    if (this.open.node) {
      this.open.node.text = this.open.text;
      this.version++;
    } else if (this.open.text.trim().length > 0) {
      const node: Extract<PresentationEvent, { kind: "assistant-text" }> = {
        kind: "assistant-text",
        text: this.open.text,
      };
      this.open.node = node;
      this.append(node);
    }
  }

  private closeText(): void {
    this.open.node = null;
    this.open.text = "";
  }
}

/**
 * Every presentation event in a complete eventwire stream.
 *
 * For output that is still arriving, use {@link EventWireStreamParser} directly and feed it the new
 * lines; calling this again with a longer string re-does all the work already done.
 */
export function parseEventWireStream(jsonStream: string): PresentationEvent[] {
  const parser = new EventWireStreamParser();
  parser.push(jsonStream.split("\n"));
  return parser.events;
}
