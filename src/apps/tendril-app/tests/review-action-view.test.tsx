import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ReviewActionView } from "../src/views/ReviewActionView";
import { bridge, type ReviewActionRun } from "../src/api/bridge";
import { planSummary } from "./fixtures/plan.fixture";

const plan = planSummary({ id: "00509", project: "Ivy-Tendril-V2", state: "Review" });

/**
 * Stands in for the pty. `feed` is the only thing the tests need: the view reads the URL out of the
 * command's own output, so the transcript is the input to everything that happens after it.
 */
function stubRun() {
  const close = vi.fn().mockResolvedValue(undefined);
  const run: ReviewActionRun = {
    session: { sessionId: "s1", encoding: "base64", rows: 24, cols: 80 },
    sendInput: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    close,
  };
  let onChunk: ((bytes: Uint8Array) => void) | undefined;
  const spy = vi.spyOn(bridge, "startReviewAction").mockImplementation((_p, _a, options) => {
    onChunk = options?.onChunk;
    return Promise.resolve(run);
  });
  return {
    close,
    spy,
    feed: async (text: string) => {
      await act(async () => {
        onChunk?.(new TextEncoder().encode(text));
      });
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReviewActionView", () => {
  it("starts the action itself, so the first line of output has somewhere to go", async () => {
    const { spy } = stubRun();

    render(
      <ReviewActionView
        target={{ project: "Ivy-Tendril-V2", actionName: "Dev Server", planId: "00509" }}
        plan={plan}
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        "Ivy-Tendril-V2",
        "Dev Server",
        expect.objectContaining({ planId: "00509" }),
      ),
    );
    expect(await screen.findByTestId("terminal")).toBeInTheDocument();
  });

  it("frames the app once the command prints its URL, and can go back to the terminal", async () => {
    const { feed } = stubRun();

    render(
      <ReviewActionView
        target={{ project: "Ivy-Tendril-V2", actionName: "Dev Server", planId: "00509" }}
        plan={plan}
        onClose={() => {}}
      />,
    );
    await screen.findByTestId("terminal");

    await feed("  \x1b[32m➜\x1b[0m  Local:   http://localhost:5173/\r\n");

    expect(await screen.findByTitle("Web content")).toBeInTheDocument();
    expect(screen.queryByTestId("terminal")).not.toBeInTheDocument();
    expect(screen.getByText("http://localhost:5173/")).toBeInTheDocument();

    // The command keeps printing after the app is up; the reviewer can still read it.
    fireEvent.click(screen.getByTestId("review-action-show-terminal"));
    expect(await screen.findByTestId("terminal")).toBeInTheDocument();
  });

  it("keeps the terminal for a project-scoped action, which has no plan to change", async () => {
    const { feed } = stubRun();

    render(
      <ReviewActionView
        target={{ project: "Ivy-Tendril-V2", actionName: "Dev Server" }}
        onClose={() => {}}
      />,
    );
    await screen.findByTestId("terminal");

    await feed("Local: http://localhost:5173/\r\n");

    expect(screen.getByTestId("terminal")).toBeInTheDocument();
    expect(screen.queryByTitle("Web content")).not.toBeInTheDocument();
  });

  it("stops watching the stream on close, and leaves the process running", async () => {
    const { close } = stubRun();

    const { unmount } = render(
      <ReviewActionView
        target={{ project: "Ivy-Tendril-V2", actionName: "Dev Server", planId: "00509" }}
        plan={plan}
        onClose={() => {}}
      />,
    );
    await screen.findByTestId("terminal");

    unmount();

    // `close` detaches the reader. Nothing here kills the pty: the app under review has to stay up.
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
});
