import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentViewer } from "./AgentViewer.tsx";
import { AGENT_VIEWER_VIRTUALIZATION_THRESHOLD } from "./use-agent-viewer-virtualization.ts";

/**
 * The analytics under a run: total time, tokens, cost — and, for every one of them, whether it was
 * measured or worked out.
 *
 * Two properties matter beyond "it renders the number". First, an estimate has to be visibly an
 * estimate: a token count divided out of a character count and a cost multiplied out of a price list
 * are not figures anybody was billed, and presenting either as one is the failure mode this footer is
 * most able to cause. Second, the elapsed time ticks once a second, and the body it sits under is a
 * windowed list of up to 100k nodes — so the tick has to stay in the footer.
 */

/** Fixed so the elapsed figures below are arithmetic rather than a race with the clock. */
const START = "2026-09-16T12:00:00.000Z";

const renders = vi.hoisted(() => ({ nodes: 0 }));

// Counts how many times a *log node* renders, which is what says the tick stayed out of the body.
vi.mock("./render-node.tsx", async () => {
  const actual = await vi.importActual<typeof import("./render-node.tsx")>("./render-node.tsx");
  return {
    ...actual,
    AgentNode: (props: Parameters<typeof actual.AgentNode>[0]) => {
      renders.nodes++;
      return actual.AgentNode(props);
    },
  };
});

function textLine(at: string, text: string): string {
  return JSON.stringify({ kind: "text", timestamp: at, text, delta: true });
}

function resultLine(at: string, extra: Record<string, unknown>): string {
  return JSON.stringify({ kind: "result", timestamp: at, is_success: true, ...extra });
}

const REPORTED_USAGE = {
  input_tokens: 120,
  output_tokens: 4200,
  cache_read_tokens: 640_000,
  cache_write_tokens: 4459,
  reasoning_tokens: 0,
};

beforeEach(() => {
  renders.nodes = 0;
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date(START));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the agent viewer's metrics footer", () => {
  it("shows nothing at all for a viewer with no output yet", () => {
    render(<AgentViewer id="empty" eventHandler={() => {}} autoScroll={false} />);
    expect(screen.queryByTestId("agent-metrics-footer")).not.toBeInTheDocument();
  });

  it("shows the elapsed time of a run that has reported neither usage nor a result", () => {
    render(
      <AgentViewer
        id="live"
        jsonLines={[textLine(START, "working on it")]}
        eventHandler={() => {}}
        autoScroll={false}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(65_000);
    });

    expect(screen.getByTestId("agent-metrics-elapsed")).toHaveTextContent("1m 5s");
    // Nothing has reported a count, so the only count available is the one derived from the stream.
    const tokens = screen.getByTestId("agent-metrics-tokens");
    expect(tokens).toHaveAttribute("data-estimated", "true");
    expect(tokens).toHaveTextContent("~");
    // And no cost, because a run in flight has not been billed anything yet.
    expect(screen.queryByTestId("agent-metrics-cost")).not.toBeInTheDocument();
  });

  it("marks a token count the agent reported as measured, and drops the ~", () => {
    render(
      <AgentViewer
        id="reported"
        jsonLines={[
          textLine(START, "a".repeat(4000)),
          resultLine("2026-09-16T12:00:10.000Z", { usage: REPORTED_USAGE, duration_ms: 10_000 }),
        ]}
        eventHandler={() => {}}
        autoScroll={false}
      />,
    );

    const tokens = screen.getByTestId("agent-metrics-tokens");
    expect(tokens).toHaveAttribute("data-estimated", "false");
    expect(tokens).not.toHaveTextContent("~");
    // 648,779 reported, cache included — the estimate from 4000 characters would have said 1k.
    expect(tokens).toHaveTextContent("648.8k");
  });

  it("labels a billed cost differently from one it priced itself", () => {
    const billed = render(
      <AgentViewer
        id="billed"
        jsonLines={[
          resultLine("2026-09-16T12:00:10.000Z", {
            usage: { ...REPORTED_USAGE, cost_usd: 0.9412, cost_source: "agent" },
          }),
        ]}
        eventHandler={() => {}}
        autoScroll={false}
      />,
    );
    const measured = screen.getByTestId("agent-metrics-cost");
    expect(measured).toHaveAttribute("data-estimated", "false");
    expect(measured).toHaveTextContent("$0.9412");
    expect(measured).not.toHaveTextContent("~");
    expect(measured.getAttribute("title")).toMatch(/billed/i);
    billed.unmount();

    render(
      <AgentViewer
        id="priced"
        jsonLines={[
          resultLine("2026-09-16T12:00:10.000Z", {
            usage: { ...REPORTED_USAGE, cost_usd: 0.9412, cost_source: "estimated" },
          }),
        ]}
        eventHandler={() => {}}
        autoScroll={false}
      />,
    );
    const priced = screen.getByTestId("agent-metrics-cost");
    expect(priced).toHaveAttribute("data-estimated", "true");
    // Same number, and it must not read as the same claim.
    expect(priced).toHaveTextContent("~$0.9412");
    expect(priced.getAttribute("title")).toMatch(/list price/i);
  });

  it("prefers the duration the agent reported over its own reading of the clock", () => {
    render(
      <AgentViewer
        id="duration"
        jsonLines={[
          textLine(START, "hi"),
          // The agent says 3.88s; the stream's own timestamps span 10s, and the agent's figure wins.
          resultLine("2026-09-16T12:00:10.000Z", { duration_ms: 3880 }),
        ]}
        eventHandler={() => {}}
        autoScroll={false}
      />,
    );
    expect(screen.getByTestId("agent-metrics-elapsed")).toHaveTextContent("3s");
    expect(screen.getByTestId("agent-metrics-elapsed").getAttribute("title")).toMatch(/reported/i);
  });

  it("stops the clock on a finished run instead of ticking on past the end of it", () => {
    render(
      <AgentViewer
        id="finished"
        jsonLines={[textLine(START, "hi"), resultLine("2026-09-16T12:00:08.000Z", {})]}
        eventHandler={() => {}}
        autoScroll={false}
      />,
    );
    // No reported duration, so the span between the first and last event is the measurement.
    expect(screen.getByTestId("agent-metrics-elapsed")).toHaveTextContent("8s");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId("agent-metrics-elapsed")).toHaveTextContent("8s");
  });

  it("stops the clock for a run the caller says is over, even with no result on the wire", () => {
    // A killed or timed-out run never reports a result, and yesterday's dead job must not read "18h".
    render(
      <AgentViewer
        id="abandoned"
        jsonLines={[textLine(START, "hi"), textLine("2026-09-16T12:00:04.000Z", "and then")]}
        live={false}
        eventHandler={() => {}}
        autoScroll={false}
      />,
    );
    expect(screen.getByTestId("agent-metrics-elapsed")).toHaveTextContent("4s");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId("agent-metrics-elapsed")).toHaveTextContent("4s");
  });

  it("can be turned off", () => {
    render(
      <AgentViewer
        id="off"
        jsonLines={[textLine(START, "hi")]}
        showMetrics={false}
        eventHandler={() => {}}
        autoScroll={false}
      />,
    );
    expect(screen.queryByTestId("agent-metrics-footer")).not.toBeInTheDocument();
  });

  it("ticks without re-rendering a single node of the log", () => {
    const lines = Array.from({ length: 40 }, (_, i) =>
      textLine(new Date(Date.parse(START) + i).toISOString(), `line ${i}`),
    );
    const { container } = render(
      <AgentViewer
        id="tick"
        jsonLines={lines}
        virtualized={false}
        eventHandler={() => {}}
        autoScroll={false}
      />,
    );

    const before = renders.nodes;
    expect(before).toBeGreaterThan(0);
    expect(screen.getByTestId("agent-metrics-elapsed")).toHaveTextContent("0s");

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // The footer moved…
    expect(screen.getByTestId("agent-metrics-elapsed")).toHaveTextContent("3s");
    // …and nothing in the body did. Three seconds of a run 100k lines long would otherwise be three
    // re-renders and three re-measurements of a viewport of nodes.
    expect(renders.nodes).toBe(before);
    // The status row inside the body is untouched by the footer, and still says what it said.
    expect(container.querySelector(".aov-status-row")).toBeInTheDocument();
  });

  it("sits outside the windowed body, so it is never a node the virtualizer has to size", () => {
    const lines = Array.from({ length: AGENT_VIEWER_VIRTUALIZATION_THRESHOLD + 50 }, (_, i) =>
      textLine(new Date(Date.parse(START) + i).toISOString(), `line ${i}`),
    );
    const { container } = render(
      <AgentViewer id="windowed" jsonLines={lines} eventHandler={() => {}} autoScroll={false} />,
    );

    const footer = container.querySelector(".aov-metrics");
    expect(footer).not.toBeNull();
    // Not inside the scroller, not inside the spacer, and not one of the measured wrappers — which is
    // what keeps it out of `node-heights.ts` entirely.
    expect(footer!.closest(".aov-body")).toBeNull();
    expect(footer!.closest(".aov-virtual-canvas")).toBeNull();
    expect(footer!.closest(".aov-virtual-node")).toBeNull();
    expect(footer!.parentElement).toHaveClass("aov-shell");
  });

  /**
   * The rule over the strip is the boundary between scrolling log and fixed chrome, which is worth
   * drawing wherever the viewer is one element among others — and is not worth drawing where the
   * framing already rules off the viewer's edge. The job output sheet was stacking this rule under two
   * others within the first 50px of itself. Per instance rather than per stylesheet: the onboarding
   * project-agent run draws the viewer inside a card and still wants it.
   */
  it("draws its rule by default and drops it for a framing that already has one", () => {
    const line = [textLine(START, "hi")];

    const { container: withRule } = render(
      <AgentViewer id="ruled" jsonLines={line} eventHandler={() => {}} autoScroll={false} />,
    );
    expect(withRule.querySelector(".aov-metrics")).not.toHaveClass("aov-metrics-flush");

    const { container: flush } = render(
      <AgentViewer
        id="flush"
        jsonLines={line}
        showMetricsDivider={false}
        eventHandler={() => {}}
        autoScroll={false}
      />,
    );
    const footer = flush.querySelector(".aov-metrics");
    expect(footer).toHaveClass("aov-metrics-flush");
    // Only the border goes. The figures still render, and the strip is still the shell's own child
    // rather than a line of the log — dropping the rule must not become dropping the footer.
    expect(footer!.parentElement).toHaveClass("aov-shell");
    expect(footer!.closest(".aov-body")).toBeNull();
    expect(flush.querySelector('[data-testid="agent-metrics-elapsed"]')).toBeInTheDocument();
  });
});
