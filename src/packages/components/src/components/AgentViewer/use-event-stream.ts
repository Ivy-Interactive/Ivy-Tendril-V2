import { useRef } from "react";

import { EventWireStreamParser } from "./parse-events.ts";
import type { StreamMetrics } from "./stream-metrics.ts";
import type { PresentationEvent } from "./types.ts";

export interface AgentEventStreamSources {
  /**
   * Identifies the output being shown. A change means the viewer was pointed somewhere else, which is
   * the one thing that cannot be told apart from an append by looking at the lines.
   */
  id: string;
  /** A complete stream as one string. Replaced wholesale; not read incrementally. */
  jsonStream?: string;
  /**
   * Eventwire lines, **append-only**: index `i` must always hold the same line it held last render.
   * Only the lines past the ones already folded in are read, so an append costs the append.
   *
   * The array's identity is deliberately ignored — only its length is read — so a caller may hand over
   * the same array it keeps mutating, which is what makes a growing log free to pass. A caller that
   * needs to *replace* the lines changes {@link id}.
   */
  jsonLines?: readonly string[];
  /** Lines received over a `stream` subscription. Append-only on the same terms as `jsonLines`. */
  streamedLines: readonly string[];
}

export interface AgentEventStreamState {
  /**
   * Every presentation event so far. A **live** array, mutated in place as lines arrive, so its
   * identity says nothing — watch {@link version}.
   */
  events: PresentationEvent[];
  /** Bumped whenever `events` changed. The dependency every derived value keys off. */
  version: number;
  /** Position of the one `result` event, or `-1`. */
  resultIndex: number;
  /**
   * The run's elapsed time, tokens and cost, folded from the same lines. Its identity changes only when
   * one of the figures did, so a consumer may hand it straight to a memoized child.
   */
  metrics: StreamMetrics;
  /** Changes only when the stream was *replaced*, never when it grew. */
  sourceKey: string;
}

interface Ingest {
  parser: EventWireStreamParser;
  generation: number;
  jsonStream: string | undefined;
  jsonLinesSeen: number;
  streamedSeen: number;
}

function freshIngest(generation: number): Ingest {
  return {
    parser: new EventWireStreamParser(),
    generation,
    jsonStream: undefined,
    jsonLinesSeen: 0,
    streamedSeen: 0,
  };
}

/**
 * Folds a viewer's incoming lines into presentation events, incrementally.
 *
 * The fold runs during render rather than in an effect, because what it produces *is* what this render
 * shows: deferring it would paint one frame behind the output. That is safe because it is idempotent —
 * it only ever consumes lines past the ones already consumed — so React invoking the render twice, as
 * it does under `StrictMode`, folds each line exactly once.
 */
export function useAgentEventStream({
  id,
  jsonStream,
  jsonLines,
  streamedLines,
}: AgentEventStreamSources): AgentEventStreamState {
  const idRef = useRef(id);
  const ingestRef = useRef<Ingest | null>(null);
  if (ingestRef.current === null) ingestRef.current = freshIngest(0);

  const jsonLineCount = jsonLines?.length ?? 0;

  // Three things mean "different output", not "more output": a different viewer id, a different
  // whole-string stream, and a line source that got *shorter* — none of which can be folded onto
  // what is already here.
  const replaced =
    idRef.current !== id ||
    ingestRef.current.jsonStream !== jsonStream ||
    jsonLineCount < ingestRef.current.jsonLinesSeen ||
    streamedLines.length < ingestRef.current.streamedSeen;

  if (replaced) {
    idRef.current = id;
    ingestRef.current = freshIngest(ingestRef.current.generation + 1);
  }

  const ingest = ingestRef.current;

  if (ingest.jsonStream !== jsonStream) {
    ingest.jsonStream = jsonStream;
    if (jsonStream) ingest.parser.push(jsonStream.split("\n"));
  }
  if (jsonLines && jsonLineCount > ingest.jsonLinesSeen) {
    ingest.parser.push(jsonLines, ingest.jsonLinesSeen);
    ingest.jsonLinesSeen = jsonLineCount;
  }
  if (streamedLines.length > ingest.streamedSeen) {
    ingest.parser.push(streamedLines, ingest.streamedSeen);
    ingest.streamedSeen = streamedLines.length;
  }

  return {
    events: ingest.parser.events,
    version: ingest.parser.version,
    resultIndex: ingest.parser.resultIndex,
    metrics: ingest.parser.metrics,
    sourceKey: `${id}#${ingest.generation}`,
  };
}

/**
 * The one assistant-text event a `result` repeats verbatim, or `-1`.
 *
 * A provider that ends a run by restating its final message as the result's `response` would otherwise
 * print it twice. There is at most one `result` event — a repeat replaces the first where it sits — so
 * this is the only pair that can qualify, and knowing where the result is makes the check a constant
 * rather than a scan of every adjacent pair on every appended line.
 */
export function suppressedTextIndex(events: PresentationEvent[], resultIndex: number): number {
  if (resultIndex <= 0) return -1;
  const result = events[resultIndex];
  const previous = events[resultIndex - 1];
  if (result?.kind !== "result" || previous?.kind !== "assistant-text") return -1;
  return result.wire.response?.trim() === previous.text.trim() ? resultIndex - 1 : -1;
}
