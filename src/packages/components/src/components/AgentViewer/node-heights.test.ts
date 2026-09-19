import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import type { RenderNode } from "./group-events.ts";
import {
  AGENT_MARKDOWN_LINE_HEIGHT,
  AGENT_NODE_HEIGHT_ESTIMATES,
  AGENT_VIEWER_NODE_GAP,
  estimateAgentNodeHeight,
} from "./node-heights.ts";
import type { PresentationEvent, ResultWire } from "./types.ts";

/**
 * The estimates have to be the heights these nodes actually render at.
 *
 * `DataTable`'s were 3–11px taller than any row it could draw, which is what made a fresh table's
 * scroll height a lie and its load-more threshold fire early — invisible, because `measureElement`
 * corrected every row on mount. Here the same drift would put every node below the window at the wrong
 * offset. jsdom applies no CSS, so this derives each number from the stylesheet the component ships
 * instead, and a padding change that forgets `node-heights.ts` fails here.
 */
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "agent-output.css"),
  "utf-8",
);

/**
 * Every declaration block, keyed by the selectors that carry it, comments stripped.
 *
 * Scanned rather than substring-searched: `.aov-tool-header` also occurs inside
 * `.aov-tool.open > .aov-tool-header`, and every selector occurs inside the prose of a comment, so
 * `indexOf` reads the wrong block for most of the rules below. The nested blocks of `@keyframes`
 * surface here as junk rules named after their offsets, which nothing looks up.
 */
const RULES: Map<string, string> = (() => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const map = new Map<string, string>();
  for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of match[1].split(",")) {
      const key = selector.trim();
      if (key.length > 0 && !map.has(key)) map.set(key, match[2]);
    }
  }
  return map;
})();

function ruleBody(selector: string): string {
  const body = RULES.get(selector);
  if (body === undefined) throw new Error(`No rule for ${selector}`);
  return body;
}

/** A single declaration's value out of a rule. */
function declaration(selector: string, property: string): string {
  const body = ruleBody(selector);
  const match = new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`).exec(body);
  if (!match) throw new Error(`No ${property} in ${selector}`);
  return match[1].trim();
}

function px(selector: string, property: string): number {
  const value = declaration(selector, property);
  const first = /(-?[\d.]+)px/.exec(value);
  if (!first) throw new Error(`${property} of ${selector} is not a px length: ${value}`);
  return Number.parseFloat(first[1]);
}

/** `padding: <v> <h>` — the vertical half, doubled, which is what a box adds to its content. */
function verticalPadding(selector: string, property = "padding"): number {
  const value = declaration(selector, property);
  const parts = value.split(/\s+/);
  const vertical = /(-?[\d.]+)px/.exec(parts[0]);
  if (!vertical) throw new Error(`${property} of ${selector} has no px vertical part: ${value}`);
  return Number.parseFloat(vertical[1]) * 2;
}

/** `margin: <v> <h>` or `margin: <v> 0`, both sides. */
function verticalMargin(selector: string): number {
  return verticalPadding(selector, "margin");
}

const SHELL_FONT_SIZE = px(".aov-shell", "font-size");
const SHELL_LINE_HEIGHT = Number.parseFloat(declaration(".aov-shell", "line-height"));

/** One line of text at a given font size, with the shell's line-height, as a browser reports it. */
function lineBox(fontSize = SHELL_FONT_SIZE, lineHeight = SHELL_LINE_HEIGHT): number {
  return Math.round(fontSize * lineHeight);
}

describe("AGENT_NODE_HEIGHT_ESTIMATES", () => {
  it("sizes a collapsed tool card at its own padding around one header line", () => {
    const expected = verticalPadding(".aov-tool") + verticalPadding(".aov-tool-header") + lineBox();
    expect(AGENT_NODE_HEIGHT_ESTIMATES["tool-use"]).toBe(expected);
  });

  it("agrees with the header height the stylesheet declares for its own sticky offsets", () => {
    // `--aov-tool-header-h` is what a nested tool header is pushed down by, so it is the stylesheet's
    // own statement of how tall a header is. The estimate has to match it or one of the two is wrong.
    const headerHeight = px(".aov-shell", "--aov-tool-header-h");
    expect(AGENT_NODE_HEIGHT_ESTIMATES["tool-use"]).toBe(
      headerHeight + verticalPadding(".aov-tool"),
    );
  });

  it("sizes a collapsed tool group like the card it stands in for", () => {
    const expected =
      verticalPadding(".aov-tool-group") +
      verticalPadding(".aov-tool-group-header") +
      lineBox(px(".aov-tool-group-header", "font-size"));
    expect(AGENT_NODE_HEIGHT_ESTIMATES["tool-group"]).toBe(expected);
    expect(AGENT_NODE_HEIGHT_ESTIMATES["tool-group"]).toBe(AGENT_NODE_HEIGHT_ESTIMATES["tool-use"]);
  });

  it("sizes one line of assistant prose at its markdown metrics plus its own margins", () => {
    const markdownLine = lineBox(
      px(".aov-markdown", "font-size"),
      Number.parseFloat(declaration(".aov-markdown", "line-height")),
    );
    expect(AGENT_MARKDOWN_LINE_HEIGHT).toBe(markdownLine);
    expect(AGENT_NODE_HEIGHT_ESTIMATES["assistant-text"]).toBe(
      verticalMargin(".aov-assistant") + markdownLine,
    );
  });

  it("sizes a session line at its padding around one line", () => {
    expect(AGENT_NODE_HEIGHT_ESTIMATES.system).toBe(
      verticalPadding(".aov-system") + lineBox(px(".aov-system", "font-size")),
    );
  });

  it("sizes a thinking line at one line, since it has no vertical padding", () => {
    expect(() => declaration(".aov-thinking", "padding")).toThrow();
    expect(AGENT_NODE_HEIGHT_ESTIMATES.thinking).toBe(lineBox());
  });

  it("sizes a status pill at its padding and border around one 12px line", () => {
    const border = 1 * 2;
    expect(AGENT_NODE_HEIGHT_ESTIMATES.status).toBe(
      verticalPadding(".aov-status-event") + border + lineBox(px(".aov-status-event", "font-size")),
    );
  });

  it("sizes a result summary at its box around a header, a body and a stats row", () => {
    const box = px(".aov-result", "margin-top") + 1 * 2 + verticalPadding(".aov-result", "padding");
    const header = lineBox() + px(".aov-result-header", "margin-bottom");
    const body = lineBox() + verticalMargin(".aov-result-body");
    const stats =
      lineBox(px(".aov-result-stats", "font-size")) + px(".aov-result-stats", "margin-top");
    expect(AGENT_NODE_HEIGHT_ESTIMATES.result).toBe(box + header + body + stats);
    // An error is the same box without the stats row, which is the only difference between the two.
    expect(AGENT_NODE_HEIGHT_ESTIMATES.error).toBe(box + header + body);
  });

  it("carries the body's gap, which is part of what gets measured while windowed", () => {
    expect(AGENT_VIEWER_NODE_GAP).toBe(px(".aov-body", "gap"));
    // The wrapper reproduces that gap as padding, so the two must be the same number.
    expect(px(".aov-virtual-node", "padding-bottom")).toBe(AGENT_VIEWER_NODE_GAP);
  });
});

const wire: ResultWire = { kind: "result", timestamp: "", is_success: true };

function single(event: PresentationEvent): RenderNode {
  return { kind: "single", index: 0, event };
}

describe("estimateAgentNodeHeight", () => {
  it("adds the gap to every node, because the gap is inside the measured box", () => {
    expect(estimateAgentNodeHeight(single({ kind: "result", wire }))).toBe(
      AGENT_NODE_HEIGHT_ESTIMATES.result + AGENT_VIEWER_NODE_GAP,
    );
    expect(estimateAgentNodeHeight({ kind: "tool-group", index: 0, tools: [] })).toBe(
      AGENT_NODE_HEIGHT_ESTIMATES["tool-group"] + AGENT_VIEWER_NODE_GAP,
    );
  });

  it("scales prose by the lines it can count without laying anything out", () => {
    const one = estimateAgentNodeHeight(single({ kind: "assistant-text", text: "one line" }));
    const four = estimateAgentNodeHeight(single({ kind: "assistant-text", text: "a\nb\nc\nd" }));
    expect(one).toBe(AGENT_NODE_HEIGHT_ESTIMATES["assistant-text"] + AGENT_VIEWER_NODE_GAP);
    expect(four).toBe(one + 3 * AGENT_MARKDOWN_LINE_HEIGHT);
  });

  it("never estimates a node at nothing, which would collapse the scroll height", () => {
    const kinds: RenderNode[] = [
      single({ kind: "assistant-text", text: "" }),
      single({ kind: "thinking", text: "" }),
      single({ kind: "system" }),
      single({ kind: "status", text: "" }),
      single({ kind: "error", message: "" }),
      single({ kind: "tool-use", tool: { toolUseId: "t", name: "Read", input: {} } }),
    ];
    for (const node of kinds) {
      expect(estimateAgentNodeHeight(node)).toBeGreaterThan(AGENT_VIEWER_NODE_GAP);
    }
  });
});
