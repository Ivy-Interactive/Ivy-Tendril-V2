import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { AgentViewer } from "./AgentViewer.tsx";

/**
 * The viewer has to fit the width it is given.
 *
 * Agent output is the worst content there is for this — absolute paths, URLs, base64, single-line JSON,
 * stack traces, all long runs with no break opportunity — and the sheet it opens in has a fixed width.
 * One such run in a box whose automatic minimum size is `min-content` pushes the viewer, and then the
 * sheet, wider than the space it was given.
 *
 * jsdom lays nothing out, so these pin the structure that bounds it instead, and they pin it on the
 * element that *holds* the string: a bounded wrapper around an unbounded child bounds nothing, which is
 * the whole reason this class of bug keeps coming back. Nothing here is allowed to be a clip — the path
 * the reader opened the sheet to read is not a layout detail to be thrown away — so each rule is
 * checked to be a wrap or a scroller.
 */
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "agent-output.css"),
  "utf-8",
);

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

/** Boxes that stand between the scroller and a string, each of which has to bound its own content. */
const BOUNDED_BOXES = [
  ".aov-body > *",
  ".aov-virtual-node",
  ".aov-markdown",
  ".aov-markdown pre",
  ".aov-tool",
  ".aov-tool-body",
  ".aov-tool-group",
  ".aov-tool-group-body",
  ".aov-tool-section",
  ".aov-tool-pre",
  ".aov-result",
  ".aov-result-body",
  ".aov-system",
  ".aov-thinking",
];

/** Boxes that hold free-form text directly and therefore have to say how a long run of it breaks. */
const TEXT_HOLDERS = [".aov-markdown", ".aov-result-body", ".aov-system", ".aov-thinking"];

/** Boxes that keep their line breaks and so have to offer a scroller instead of wrapping. */
const SCROLLING_HOLDERS = [".aov-tool-pre", ".aov-markdown pre"];

describe("agent-output.css horizontal containment", () => {
  it("bounds every box between the scroller and a string", () => {
    for (const selector of BOUNDED_BOXES) {
      const body = ruleBody(selector);
      expect(body, `${selector} needs min-width: 0`).toMatch(/min-width:\s*0/);
      expect(body, `${selector} needs max-width: 100%`).toMatch(/max-width:\s*100%/);
    }
  });

  it("keeps the scroller itself from being widened by its own content", () => {
    expect(ruleBody(".aov-body")).toMatch(/min-width:\s*0/);
  });

  it("lets prose wrap rather than clipping it", () => {
    for (const selector of TEXT_HOLDERS) {
      const body = ruleBody(selector);
      expect(body, `${selector} needs a wrap rule`).toMatch(
        /overflow-wrap:\s*(break-word|anywhere)|word-break:\s*break-(word|all)/,
      );
      // A clip would fit the layout by losing the end of the path, which is the thing being read.
      expect(body, `${selector} must not clip`).not.toMatch(/overflow(-x)?:\s*hidden/);
    }
  });

  it("gives a command or a blob its own horizontal scroller rather than clipping it", () => {
    for (const selector of SCROLLING_HOLDERS) {
      const body = ruleBody(selector);
      expect(body, `${selector} needs its own horizontal scroller`).toMatch(/overflow-x:\s*auto/);
      // `.aov-tool-pre` used to be `overflow: hidden`, which cut a long command off at the right edge.
      expect(body, `${selector} must not clip horizontally`).not.toMatch(
        /overflow:\s*hidden|overflow-x:\s*hidden/,
      );
    }
  });

  it("keeps a table's cells from widening the table past its own width", () => {
    expect(ruleBody(".aov-markdown th")).toMatch(/overflow-wrap:\s*break-word/);
  });

  it("lets the status pill's one line shrink so its ellipsis engages", () => {
    // Without `min-width: 0` the flex item's automatic minimum is the whole `nowrap` string, so the
    // pill overflows its own `max-width: 100%` instead of ellipsising.
    expect(ruleBody(".aov-status-event")).toMatch(/max-width:\s*100%/);
    expect(ruleBody(".aov-status-event-text")).toMatch(/min-width:\s*0/);
  });
});

/** A path with no space and no break opportunity in it, of the length agent output really produces. */
const PATHOLOGICAL_PATH = `/Users/somebody/git/org/${"very-long-directory-segment/".repeat(12)}file.ts`;

/** Minified JSON, which is what a tool input often is. */
const PATHOLOGICAL_JSON = JSON.stringify(
  Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`key_number_${i}`, `value_number_${i}`]),
  ),
);

function toolLines(input: Record<string, unknown>, result: string): string[] {
  return [
    JSON.stringify({
      kind: "tool_call",
      timestamp: "t",
      tool_use_id: "a",
      tool_name: "Bash",
      input,
    }),
    JSON.stringify({
      kind: "tool_result",
      timestamp: "t",
      tool_use_id: "a",
      output: result,
      is_error: false,
    }),
  ];
}

describe("AgentViewer with a pathological line", () => {
  it("puts a long path in prose inside the box that wraps it", () => {
    const { container } = render(
      <AgentViewer
        id="wide-prose"
        jsonLines={[
          JSON.stringify({ kind: "text", timestamp: "t", text: PATHOLOGICAL_PATH, delta: false }),
        ]}
        autoScroll={false}
        eventHandler={() => {}}
      />,
    );

    // The element the string is in, not an ancestor of it.
    const holder = [...container.querySelectorAll("*")].find(
      (node) => node.textContent === PATHOLOGICAL_PATH && node.children.length === 0,
    );
    expect(holder).toBeDefined();
    expect(holder!.closest(".aov-markdown")).not.toBeNull();
    expect(ruleBody(".aov-markdown")).toMatch(/overflow-wrap:\s*break-word/);
  });

  it("puts minified JSON in the box that scrolls it, and keeps all of it", () => {
    const { container } = render(
      <AgentViewer
        id="wide-tool"
        // A `command` on `Bash` reaches the IN block verbatim (`displayInput`), so what is asserted
        // below is the string itself rather than a re-encoding of it.
        jsonLines={toolLines({ command: PATHOLOGICAL_JSON }, PATHOLOGICAL_PATH)}
        autoScroll={false}
        eventHandler={() => {}}
      />,
    );

    // Expanding the card is what puts the blob on screen.
    fireEvent.click(container.querySelector(".aov-tool-header")!);

    const blocks = [...container.querySelectorAll<HTMLElement>(".aov-tool-pre")];
    expect(blocks).toHaveLength(2);
    // Not truncated: every character is still there for the reader to scroll to.
    expect(blocks[0].textContent).toContain(PATHOLOGICAL_JSON);
    expect(blocks[1].textContent).toBe(PATHOLOGICAL_PATH);
    // And the box holding it scrolls rather than clips.
    expect(ruleBody(".aov-tool-pre")).toMatch(/overflow-x:\s*auto/);
  });

  it("bounds the shell itself whatever it is dropped into", () => {
    const { container } = render(
      <AgentViewer
        id="wide-shell"
        jsonLines={[JSON.stringify({ kind: "text", timestamp: "t", text: PATHOLOGICAL_PATH })]}
        autoScroll={false}
        eventHandler={() => {}}
      />,
    );
    const shell = container.querySelector<HTMLElement>(".aov-shell");
    expect(shell?.style.maxWidth).toBe("100%");
    expect(shell?.style.minWidth).toBe("0px");
    // Contains vertically, and does *not* clip horizontally: a node that legitimately cannot wrap — a
    // command, a blob of JSON — has to stay reachable, and `overflow: hidden` here would cut it off at
    // the right edge with no way to scroll to the rest.
    expect(shell?.style.overflowY).toBe("hidden");
    expect(shell?.style.overflowX).not.toBe("hidden");
  });
});

/** Every horizontal-overflow declaration that applies to an element, nearest rule first. */
function horizontalOverflowOf(element: Element): string | undefined {
  const inline = (element as HTMLElement).style;
  if (inline.overflowX) return inline.overflowX;
  if (inline.overflow) return inline.overflow.split(/\s+/)[0];
  for (const className of [...element.classList].reverse()) {
    const body = RULES.get(`.${className}`);
    if (!body) continue;
    const x = /(?:^|;|\s)overflow-x\s*:\s*([^;]+)/.exec(body);
    if (x) return x[1].trim();
    const both = /(?:^|;|\s)overflow\s*:\s*([^;]+)/.exec(body);
    if (both) return both[1].trim().split(/\s+/)[0];
  }
  return undefined;
}

/**
 * Whether a long unbreakable run in `holder` can be reached.
 *
 * Either the string wraps where it sits, or the first box between it and the shell that has an opinion
 * about horizontal overflow lets you scroll to the rest. A `hidden` before any `auto` is a clip, which
 * fits the layout by throwing away the end of the very path the reader opened the sheet for — and it is
 * the assertion that would have caught the shell swallowing a code block's own scroller.
 */
function reachabilityOf(holder: Element): {
  wraps: boolean;
  clippedBy?: string;
  scrolledBy?: string;
} {
  for (let node: Element | null = holder; node; node = node.parentElement) {
    for (const className of node.classList) {
      const body = RULES.get(`.${className}`);
      if (
        body &&
        /overflow-wrap:\s*(break-word|anywhere)|word-break:\s*break-(word|all)/.test(body)
      ) {
        return { wraps: true };
      }
    }
    const overflow = horizontalOverflowOf(node);
    if (overflow === "hidden" || overflow === "clip") {
      return { wraps: false, clippedBy: node.className || node.tagName };
    }
    if (overflow === "auto" || overflow === "scroll") {
      return { wraps: false, scrolledBy: node.className || node.tagName };
    }
    if (node.classList.contains("aov-shell")) break;
  }
  return { wraps: false };
}

describe("a pathological line stays reachable", () => {
  /** A single-line command of the length a real agent produces, with nothing to break on. */
  const LONG_COMMAND = `rg --no-heading -n ${"'(?:aaa|bbb|ccc)-[0-9]{4}-segment'".repeat(8)}`;

  it("either wraps or scrolls, and is never clipped on the way to the shell", () => {
    const cases: { name: string; lines: string[]; needle: string }[] = [
      {
        name: "prose",
        lines: [JSON.stringify({ kind: "text", timestamp: "t", text: PATHOLOGICAL_PATH })],
        needle: PATHOLOGICAL_PATH,
      },
      {
        name: "thinking",
        lines: [JSON.stringify({ kind: "thinking", timestamp: "t", content: PATHOLOGICAL_PATH })],
        needle: PATHOLOGICAL_PATH,
      },
      {
        name: "result",
        lines: [
          JSON.stringify({
            kind: "result",
            timestamp: "t",
            is_success: true,
            response: PATHOLOGICAL_PATH,
          }),
        ],
        needle: PATHOLOGICAL_PATH,
      },
    ];

    for (const testCase of cases) {
      const { container, unmount } = render(
        <AgentViewer
          id={`reach-${testCase.name}`}
          jsonLines={testCase.lines}
          showThinking
          autoScroll={false}
          eventHandler={() => {}}
        />,
      );
      const holder = [...container.querySelectorAll("*")].find(
        (node) => node.textContent === testCase.needle && node.children.length === 0,
      );
      expect(holder, `${testCase.name}: the string has to be on screen`).toBeDefined();

      const reach = reachabilityOf(holder!);
      expect(reach.clippedBy, `${testCase.name} is clipped by .${reach.clippedBy}`).toBeUndefined();
      expect(
        reach.wraps || reach.scrolledBy !== undefined,
        `${testCase.name} neither wraps nor scrolls`,
      ).toBe(true);
      unmount();
    }
  });

  it("keeps a command that must not be re-wrapped reachable by scrolling it", () => {
    const { container } = render(
      <AgentViewer
        id="reach-command"
        jsonLines={toolLines({ command: LONG_COMMAND }, "done")}
        autoScroll={false}
        eventHandler={() => {}}
      />,
    );
    fireEvent.click(container.querySelector(".aov-tool-header")!);

    const holder = [...container.querySelectorAll("*")].find(
      (node) => node.textContent === LONG_COMMAND && node.children.length === 0,
    );
    expect(holder).toBeDefined();

    const reach = reachabilityOf(holder!);
    // A command keeps its line breaks, so wrapping is not the answer here — a scroller is.
    expect(reach.clippedBy, `clipped by .${reach.clippedBy}`).toBeUndefined();
    expect(reach.scrolledBy).toBe("aov-tool-pre");
  });
});
