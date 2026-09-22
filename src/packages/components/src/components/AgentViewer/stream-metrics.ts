import type { EventWire } from "./types.ts";

/** The usual rule of thumb for English prose and code; see `tokensEstimated` below. */
export const CHARS_PER_TOKEN = 4;

/**
 * What a run can say about itself: how long it took, how much it consumed, and what it cost — plus,
 * for each of those, whether the figure was reported or worked out.
 *
 * The provenance is the point. Only the terminal `result` event carries a provider's own usage, so a
 * run in flight can be counted no other way than from its own text, and a run whose provider bills by
 * subscription reports no money at all. Both gaps are fillable and both are filled, but a number
 * divided out of a character count or multiplied out of a price list is not the same claim as one the
 * agent reported, and the UI has to be able to tell the reader which it is holding.
 */
export interface StreamMetrics {
  /** Timestamp of the first event, so a caller can tick an elapsed timer against it. */
  startedAt?: string;
  /**
   * Timestamp of the most recent event of any kind, so a caller that knows the run is over can measure
   * the span it actually occupied instead of ticking on from its start.
   *
   * The last event rather than the terminal `result` on purpose: a run that was killed, timed out or
   * abandoned never reports a result, and its last line is still the last thing it did.
   */
  endedAt?: string;
  /**
   * How long the run took **by the agent's own reckoning**, from the result event. Absent for a run
   * in flight and for a provider that does not report one, in which case a caller with both
   * {@link startedAt} and {@link endedAt} can measure the span itself.
   */
  durationMs?: number;
  /** Tokens consumed so far, or undefined when the stream says nothing yet. */
  tokens?: number;
  /**
   * True when {@link tokens} was derived from the stream's own text rather than reported. Callers
   * render an estimate with a "~".
   *
   * Also true for a stream that has said nothing at all, matching V1: there is no reported figure, so
   * there is nothing to present as one.
   */
  tokensEstimated: boolean;
  /** What the run cost in USD, when either the agent reported it or the model could be priced. */
  costUsd?: number;
  /**
   * True when {@link costUsd} was priced from the token counts rather than billed — `cost_source:
   * "estimated"` on the wire. Meaningless when there is no cost, and `false` then.
   */
  costEstimated: boolean;
}

/**
 * What a stream that has said nothing amounts to. Shared, and never mutated: an accumulator's snapshot
 * is rebuilt rather than edited, so every viewer waiting on its first line can hold this same object —
 * which is also what keeps a footer from re-rendering while there is nothing to show it.
 */
const EMPTY: StreamMetrics = Object.freeze({ tokensEstimated: true, costEstimated: false });

/**
 * Folds a stream's metrics as its lines arrive, rather than re-deriving them from the whole stream on
 * every line.
 *
 * One `add` per line, which is what lets `EventWireStreamParser` carry these alongside the events it
 * is already folding. Re-scanning every wire per appended line is the quadratic that made a long run's
 * viewer unusable, and a token count is not worth paying it for.
 */
export class StreamMetricsAccumulator {
  private startedAt?: string;
  private endedAt?: string;
  private durationMs?: number;
  private characters = 0;
  private reported = 0;
  private costUsd?: number;
  private costEstimated = false;
  private cached: StreamMetrics | null = EMPTY;

  /**
   * Counts one wire. Returns whether it changed anything, so a caller can skip work when it did not.
   *
   * Every wire is counted, including the `[stderr]` text the viewer declines to render as part of the
   * answer: the agent still produced those characters and was still charged for them.
   */
  add(wire: EventWire): boolean {
    let changed = false;

    if (wire.timestamp) {
      if (!this.startedAt) this.startedAt = wire.timestamp;
      if (this.endedAt !== wire.timestamp) {
        this.endedAt = wire.timestamp;
        changed = true;
      }
    }

    switch (wire.kind) {
      case "text":
        changed = this.count(wire.text?.length ?? 0) || changed;
        break;
      case "thinking":
        changed = this.count(wire.content?.length ?? 0) || changed;
        break;
      case "tool_call":
        changed =
          this.count(
            wire.tool_name.length + (wire.input ? JSON.stringify(wire.input).length : 0),
          ) || changed;
        break;
      case "tool_result":
        changed = this.count(wire.output?.length ?? 0) || changed;
        break;
      case "result": {
        // Assigned rather than accumulated, because `EventWireStreamParser` treats a second result as
        // a *replacement* of the first — one run, one terminal account of itself. Adding them up would
        // let a re-reported result double the run's tokens and its bill.
        const usage = wire.usage;
        if (usage) {
          // Input + output tokens only, excluding cache buckets (matching V1 and job.tokens total).
          this.reported =
            (usage.input_tokens ?? 0) +
            (usage.output_tokens ?? 0);
          this.costUsd = usage.cost_usd != null && usage.cost_usd > 0 ? usage.cost_usd : undefined;
          this.costEstimated = usage.cost_source === "estimated";
        }
        if (wire.duration_ms != null && wire.duration_ms > 0) this.durationMs = wire.duration_ms;
        changed = true;
        break;
      }
      default:
        break;
    }

    if (changed) this.cached = null;
    return changed;
  }

  /**
   * The metrics as they stand. A stable object while nothing has changed, so a consumer may compare it
   * by identity instead of re-deriving.
   */
  get metrics(): StreamMetrics {
    if (this.cached) return this.cached;

    const base = {
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      durationMs: this.durationMs,
      costUsd: this.costUsd,
      costEstimated: this.costUsd != null && this.costEstimated,
    };

    if (this.reported > 0) {
      this.cached = { ...base, tokens: this.reported, tokensEstimated: false };
    } else if (this.characters > 0) {
      this.cached = {
        ...base,
        tokens: Math.round(this.characters / CHARS_PER_TOKEN),
        tokensEstimated: true,
      };
    } else {
      this.cached = { ...base, tokensEstimated: true };
    }
    return this.cached;
  }

  private count(characters: number): boolean {
    if (characters <= 0) return false;
    this.characters += characters;
    return true;
  }
}

/**
 * The metrics of a complete list of wires.
 *
 * A one-shot fold over {@link StreamMetricsAccumulator}, for a caller that has all the wires already.
 * Output that is still arriving should use the accumulator — or read
 * `EventWireStreamParser.metrics`, which keeps one.
 */
export function deriveStreamMetrics(wires: readonly EventWire[]): StreamMetrics {
  const accumulator = new StreamMetricsAccumulator();
  for (const wire of wires) accumulator.add(wire);
  return accumulator.metrics;
}
