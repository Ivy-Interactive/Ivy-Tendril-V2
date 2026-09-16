import { describe, expect, it } from "vite-plus/test";

import { EventWireStreamParser } from "./parse-events.ts";
import { CHARS_PER_TOKEN, deriveStreamMetrics } from "./stream-metrics.ts";
import type { EventWire } from "./types.ts";

/**
 * The run's own analytics, and — the part worth testing — which of them anybody actually measured.
 *
 * The vectors here are V1's `stream-metrics.test.ts` plus the provenance V1 had no field for: a
 * reported usage has to beat the estimate, a priced cost has to stay distinguishable from a billed one,
 * and a run in flight has to be able to say how long it has been going without either.
 */

describe("deriveStreamMetrics", () => {
  it("reports nothing for an empty stream", () => {
    expect(deriveStreamMetrics([])).toEqual({ tokensEstimated: true, costEstimated: false });
  });

  it("takes the start time from the first event and the end from the last", () => {
    const metrics = deriveStreamMetrics([
      { kind: "session_init", timestamp: "2026-09-09T10:00:00Z", session_id: "s1" },
      { kind: "text", timestamp: "2026-09-09T10:00:05Z", text: "hi", delta: false },
    ]);
    expect(metrics.startedAt).toBe("2026-09-09T10:00:00Z");
    // The last event of *any* kind: a run that was killed never reports a result, and its last line is
    // still the last thing it did.
    expect(metrics.endedAt).toBe("2026-09-09T10:00:05Z");
  });

  it("estimates tokens from the text, thinking and tool payloads of a run in flight", () => {
    const metrics = deriveStreamMetrics([
      { kind: "text", timestamp: "t1", text: "a".repeat(400), delta: true },
      { kind: "thinking", timestamp: "t2", content: "b".repeat(400) },
      {
        kind: "tool_result",
        timestamp: "t3",
        tool_use_id: "x",
        output: "c".repeat(400),
        is_error: false,
      },
    ]);
    expect(metrics.tokensEstimated).toBe(true);
    // 1200 characters of payload at ~4 characters per token.
    expect(metrics.tokens).toBe(1200 / CHARS_PER_TOKEN);
    // Nothing has reported money, so there is no cost to label either way.
    expect(metrics.costUsd).toBeUndefined();
    expect(metrics.costEstimated).toBe(false);
  });

  it("counts a tool call's name and arguments", () => {
    const metrics = deriveStreamMetrics([
      {
        kind: "tool_call",
        timestamp: "t1",
        tool_use_id: "x",
        tool_name: "Read",
        input: { file_path: "/repo/a.ts" },
      },
    ]);
    const payload = "Read".length + JSON.stringify({ file_path: "/repo/a.ts" }).length;
    expect(metrics.tokens).toBe(Math.round(payload / CHARS_PER_TOKEN));
    expect(metrics.tokensEstimated).toBe(true);
  });

  it("prefers the usage a finished run reports over the estimate", () => {
    const metrics = deriveStreamMetrics([
      { kind: "text", timestamp: "t1", text: "a".repeat(4000), delta: false },
      {
        kind: "result",
        timestamp: "t2",
        is_success: true,
        usage: {
          input_tokens: 1200,
          output_tokens: 80,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          reasoning_tokens: 0,
        },
      },
    ]);
    // 4000 characters would have estimated 1000; the reported figure wins and stops being an estimate.
    expect(metrics.tokensEstimated).toBe(false);
    expect(metrics.tokens).toBe(1280);
  });

  it("counts the cache traffic a long run is mostly made of", () => {
    // The shape of the run this was verified against: $0.94 and 648,779 tokens, all but 8k of it cache.
    const metrics = deriveStreamMetrics([
      {
        kind: "result",
        timestamp: "t1",
        is_success: true,
        usage: {
          input_tokens: 120,
          output_tokens: 4200,
          cache_read_tokens: 640_000,
          cache_write_tokens: 4459,
          reasoning_tokens: 0,
        },
      },
    ]);
    // Input and output alone would read 4,320 for a run that spent 648,779.
    expect(metrics.tokens).toBe(648_779);
    expect(metrics.tokensEstimated).toBe(false);
  });

  it("carries a billed cost as measured and a priced one as an estimate", () => {
    const billed = deriveStreamMetrics([
      {
        kind: "result",
        timestamp: "t1",
        is_success: true,
        duration_ms: 3880,
        usage: {
          input_tokens: 120,
          output_tokens: 4200,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          reasoning_tokens: 0,
          cost_usd: 0.9412,
          cost_source: "agent",
        },
      },
    ]);
    expect(billed.costUsd).toBe(0.9412);
    expect(billed.costEstimated).toBe(false);
    expect(billed.durationMs).toBe(3880);

    const priced = deriveStreamMetrics([
      {
        kind: "result",
        timestamp: "t1",
        is_success: true,
        usage: {
          input_tokens: 120,
          output_tokens: 4200,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          reasoning_tokens: 0,
          cost_usd: 0.0642,
          cost_source: "estimated",
        },
      },
    ]);
    expect(priced.costUsd).toBe(0.0642);
    expect(priced.costEstimated).toBe(true);
  });

  it("treats a reported zero as no charge rather than as a cost of nothing", () => {
    // A subscription-plan run reports its tokens and bills nothing; "$0.0000" would be a claim about
    // the price of the run rather than about the absence of a bill.
    const metrics = deriveStreamMetrics([
      {
        kind: "result",
        timestamp: "t1",
        is_success: true,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          reasoning_tokens: 0,
          cost_usd: 0,
          cost_source: "agent",
        },
      },
    ]);
    expect(metrics.costUsd).toBeUndefined();
    expect(metrics.tokens).toBe(30);
  });

  it("ignores events it cannot count", () => {
    const wires: EventWire[] = [
      {
        kind: "error",
        timestamp: "t1",
        message: "boom",
        is_retryable: false,
        is_auth_error: false,
      },
    ];
    expect(deriveStreamMetrics(wires)).toEqual({
      startedAt: "t1",
      endedAt: "t1",
      tokensEstimated: true,
      costEstimated: false,
    });
  });

  it("counts the stderr lines the viewer declines to render", () => {
    // Not part of the answer, but the agent produced those characters and was charged for them.
    const metrics = deriveStreamMetrics([
      { kind: "text", timestamp: "t1", text: `[stderr] ${"x".repeat(391)}`, delta: true },
    ]);
    expect(metrics.tokens).toBe(100);
  });

  it("keeps the last result's account of the run rather than adding results up", () => {
    // `EventWireStreamParser` replaces a result with a re-reported one, so the metrics must too:
    // accumulating would double a re-delivered run's tokens and its bill.
    const usage = {
      input_tokens: 100,
      output_tokens: 100,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      cost_usd: 0.5,
      cost_source: "agent" as const,
    };
    const metrics = deriveStreamMetrics([
      { kind: "result", timestamp: "t1", is_success: true, usage },
      { kind: "result", timestamp: "t2", is_success: true, usage },
    ]);
    expect(metrics.tokens).toBe(200);
    expect(metrics.costUsd).toBe(0.5);
  });
});

describe("EventWireStreamParser.metrics", () => {
  const line = (wire: EventWire) => JSON.stringify(wire);

  it("folds the same metrics the one-shot derivation produces", () => {
    const wires: EventWire[] = [
      { kind: "session_init", timestamp: "2026-09-09T10:00:00Z", session_id: "s1" },
      { kind: "text", timestamp: "2026-09-09T10:00:01Z", text: "hello", delta: true },
      {
        kind: "result",
        timestamp: "2026-09-09T10:00:09Z",
        is_success: true,
        duration_ms: 9000,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_tokens: 1,
          cache_write_tokens: 2,
          reasoning_tokens: 0,
          cost_usd: 0.01,
          cost_source: "agent",
        },
      },
    ];

    const parser = new EventWireStreamParser();
    // A line at a time, which is how live output arrives.
    for (const wire of wires) parser.pushLine(line(wire));

    expect(parser.metrics).toEqual(deriveStreamMetrics(wires));
    expect(parser.metrics.tokens).toBe(18);
  });

  it("hands back the same object while nothing has changed", () => {
    const parser = new EventWireStreamParser();
    parser.pushLine(line({ kind: "text", timestamp: "t1", text: "hi", delta: true }));
    const first = parser.metrics;
    expect(parser.metrics).toBe(first);

    // A line that changes nothing countable must not churn the object either — the footer takes it as
    // a prop, and a new identity per line is a re-render per line.
    parser.pushLine("not json");
    expect(parser.metrics).toBe(first);

    parser.pushLine(line({ kind: "text", timestamp: "t2", text: "more", delta: true }));
    expect(parser.metrics).not.toBe(first);
  });
});
