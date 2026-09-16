import { describe, expect, it } from "vite-plus/test";

import { EventWireStreamParser, parseEventWireStream } from "./parse-events.ts";

/**
 * Feeding the parser a line at a time has to produce exactly what parsing the whole stream produces.
 *
 * That equivalence is the whole licence for the incremental path: the viewer used to re-fold the entire
 * stream on every appended line, which at 100k lines is ~39ms of work per line and quadratic over the
 * run. It now folds only the new lines — 0.004ms — and this is what says the shortcut is not a
 * different answer.
 */

/** Every wire shape the fold treats specially, in an order that exercises all of them. */
const STREAM = [
  { kind: "session_init", timestamp: "t", session_id: "s1", model: "opus" },
  { kind: "text", timestamp: "t", text: "   ", delta: true },
  { kind: "text", timestamp: "t", text: "Looking", delta: true },
  { kind: "text", timestamp: "t", text: " at it.", delta: true },
  { kind: "thinking", timestamp: "t", content: "hmm" },
  { kind: "tool_call", timestamp: "t", tool_use_id: "a", tool_name: "Read", input: { p: 1 } },
  { kind: "tool_call", timestamp: "t", tool_use_id: "b", tool_name: "Bash", input: { p: 2 } },
  { kind: "tool_result", timestamp: "t", tool_use_id: "a", output: "ok", is_error: false },
  { kind: "text", timestamp: "t", text: "[stderr] noise", delta: true },
  { kind: "tool_result", timestamp: "t", tool_use_id: "b", output: "boom", is_error: true },
  { kind: "tool_result", timestamp: "t", tool_use_id: "gone", output: "?", is_error: false },
  { kind: "status", timestamp: "t", text: "  Working  " },
  { kind: "status", timestamp: "t", message: "   " },
  { kind: "text", timestamp: "t", text: "Whole message", delta: false },
  { kind: "error", timestamp: "t", message: "nope", is_retryable: false, is_auth_error: false },
  { kind: "file_change", timestamp: "t", file_path: "a", change_kind: "edit" },
  { kind: "result", timestamp: "t", is_success: false, response: "first" },
  { kind: "text", timestamp: "t", text: "after", delta: false },
  { kind: "result", timestamp: "t", is_success: true, response: "second" },
];

const LINES = STREAM.map((event) => JSON.stringify(event));

describe("EventWireStreamParser", () => {
  it("produces the same events line by line as the one-shot parse does", () => {
    const parser = new EventWireStreamParser();
    for (const line of LINES) parser.pushLine(line);
    expect(parser.events).toEqual(parseEventWireStream(LINES.join("\n")));
  });

  it("produces the same events whatever size the chunks arrive in", () => {
    const whole = parseEventWireStream(LINES.join("\n"));
    for (const chunk of [1, 2, 3, 5, 7, LINES.length]) {
      const parser = new EventWireStreamParser();
      for (let i = 0; i < LINES.length; i += chunk) {
        parser.push(LINES.slice(0, Math.min(i + chunk, LINES.length)), i);
      }
      expect(parser.events, `chunks of ${chunk}`).toEqual(whole);
    }
  });

  it("bumps the version for a change that adds no event, and not for one that changes nothing", () => {
    const parser = new EventWireStreamParser();
    parser.pushLine(
      JSON.stringify({ kind: "tool_call", timestamp: "t", tool_use_id: "a", tool_name: "Read" }),
    );
    const afterCall = parser.version;

    // A result fills in the card that is already on screen: no new node, but a different render.
    parser.pushLine(
      JSON.stringify({
        kind: "tool_result",
        timestamp: "t",
        tool_use_id: "a",
        output: "ok",
        is_error: false,
      }),
    );
    expect(parser.version).toBeGreaterThan(afterCall);
    const afterResult = parser.version;

    // A result for a tool nobody called, a blank status, and junk all change nothing at all.
    parser.pushLine(
      JSON.stringify({
        kind: "tool_result",
        timestamp: "t",
        tool_use_id: "?",
        output: "x",
        is_error: false,
      }),
    );
    parser.pushLine(JSON.stringify({ kind: "status", timestamp: "t", text: "  " }));
    parser.pushLine("not json");
    parser.pushLine("");
    expect(parser.version).toBe(afterResult);
  });

  it("keeps a node's position for its whole life, which the window's measurements depend on", () => {
    const parser = new EventWireStreamParser();
    parser.pushLine(JSON.stringify({ kind: "text", timestamp: "t", text: "one", delta: false }));
    parser.pushLine(
      JSON.stringify({ kind: "tool_call", timestamp: "t", tool_use_id: "a", tool_name: "Read" }),
    );
    const textNode = parser.events[0];
    const toolNode = parser.events[1];

    parser.pushLine(JSON.stringify({ kind: "result", timestamp: "t", is_success: true }));
    expect(parser.resultIndex).toBe(2);
    // A repeat result replaces the first where it sits rather than appending a second summary.
    parser.pushLine(JSON.stringify({ kind: "result", timestamp: "t", is_success: false }));
    expect(parser.events).toHaveLength(3);
    expect(parser.resultIndex).toBe(2);
    // And nothing above it moved, nor was re-created.
    expect(parser.events[0]).toBe(textNode);
    expect(parser.events[1]).toBe(toolNode);
  });

  it("grows the open prose node in place as deltas arrive", () => {
    const parser = new EventWireStreamParser();
    parser.pushLine(JSON.stringify({ kind: "text", timestamp: "t", text: "Hel", delta: true }));
    const node = parser.events[0];
    parser.pushLine(JSON.stringify({ kind: "text", timestamp: "t", text: "lo", delta: true }));
    expect(parser.events).toHaveLength(1);
    expect(parser.events[0]).toBe(node);
    expect(node).toEqual({ kind: "assistant-text", text: "Hello" });
  });
});
