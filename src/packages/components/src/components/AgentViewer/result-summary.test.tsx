import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResultSummary } from "./result-summary.tsx";
import type { ResultWire } from "./types.ts";

/**
 * The terminal block under a run: what it answered or why it stopped, and the stats row beside it.
 *
 * The failure vectors are V1's `result-summary.test.tsx` — they exist because a failed run used to
 * render a bare "❌ Error" with the reason the agent gave sitting unread on the wire. The stats vectors
 * are new, and are the same distinction the metrics footer makes: a cost Tendril worked out from a price
 * list must not read like one the agent billed.
 */

const usage = {
  input_tokens: 120,
  output_tokens: 4200,
  cache_read_tokens: 640_000,
  cache_write_tokens: 4459,
  reasoning_tokens: 0,
};

describe("ResultSummary", () => {
  it("renders the error text when is_success is false and error is set", () => {
    const wire: ResultWire = {
      kind: "result",
      timestamp: "2026-05-22T10:00:00Z",
      is_success: false,
      exit_code: -1,
      error: "Agent timed out: no output received for 5 minutes (idle timeout threshold exceeded).",
    };

    render(<ResultSummary wire={wire} />);

    expect(
      screen.getByText(
        "Agent timed out: no output received for 5 minutes (idle timeout threshold exceeded).",
      ),
    ).toBeInTheDocument();
  });

  it("renders the terminated/timed-out fallback when neither error nor response is present", () => {
    const wire: ResultWire = {
      kind: "result",
      timestamp: "2026-05-22T10:00:00Z",
      is_success: false,
      exit_code: -1,
    };

    render(<ResultSummary wire={wire} />);

    expect(
      screen.getByText("Agent process was terminated or timed out (exit code -1)."),
    ).toBeInTheDocument();
  });

  it("renders both the error and the response when both are present", () => {
    const wire: ResultWire = {
      kind: "result",
      timestamp: "2026-05-22T10:00:00Z",
      is_success: false,
      exit_code: 1,
      error: "Agent process exited with code 1: boom",
      response: "Partial progress before the crash.",
    };

    render(<ResultSummary wire={wire} />);

    expect(screen.getByText("Agent process exited with code 1: boom")).toBeInTheDocument();
    expect(screen.getByText("Partial progress before the crash.")).toBeInTheDocument();
  });

  it("renders no error block when is_success is true and a response is present", () => {
    const wire: ResultWire = {
      kind: "result",
      timestamp: "2026-05-22T10:00:00Z",
      is_success: true,
      response: "Task completed successfully.",
    };

    render(<ResultSummary wire={wire} />);

    expect(screen.getByText("Task completed successfully.")).toBeInTheDocument();
    expect(screen.queryByText(/terminated or timed out/)).not.toBeInTheDocument();
    expect(screen.queryByText("❌ Error")).not.toBeInTheDocument();
  });

  it("renders nothing at all rather than an empty box", () => {
    const { container } = render(
      <ResultSummary wire={{ kind: "result", timestamp: "t", is_success: true }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("reports the duration, the tokens and the cache traffic the run consumed", () => {
    render(
      <ResultSummary
        wire={{
          kind: "result",
          timestamp: "t",
          is_success: true,
          duration_ms: 3880,
          response: "Done.",
          usage: { ...usage, cost_usd: 0.9412, cost_source: "agent" },
        }}
      />,
    );

    expect(screen.getByText("Duration: 3.9s")).toBeInTheDocument();
    expect(screen.getByText("Tokens: 120 in / 4,200 out")).toBeInTheDocument();
    // Most of this run's bill; a stats row that omitted it left the cost beside it unaccountable.
    expect(screen.getByText("Cache: 640,000 read / 4,459 write")).toBeInTheDocument();
  });

  it("distinguishes a cost the agent billed from one priced off the model's list rate", () => {
    const billed = render(
      <ResultSummary
        wire={{
          kind: "result",
          timestamp: "t",
          is_success: true,
          usage: { ...usage, cost_usd: 0.9412, cost_source: "agent" },
        }}
      />,
    );
    expect(screen.getByText("Cost: $0.9412")).toHaveAttribute("data-estimated", "false");
    billed.unmount();

    render(
      <ResultSummary
        wire={{
          kind: "result",
          timestamp: "t",
          is_success: true,
          usage: { ...usage, cost_usd: 0.9412, cost_source: "estimated" },
        }}
      />,
    );
    const priced = screen.getByText("Cost: ~$0.9412");
    expect(priced).toHaveAttribute("data-estimated", "true");
    expect(priced.getAttribute("title")).toMatch(/list price/i);
  });
});
