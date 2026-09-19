import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
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
  let onEnd: ((message: string) => void) | undefined;
  const spy = vi.spyOn(bridge, "startReviewAction").mockImplementation((_p, _a, options) => {
    onChunk = options?.onChunk;
    onEnd = options?.onEnd;
    return Promise.resolve(run);
  });
  return {
    close,
    spy,
    end: async (message: string) => {
      await act(async () => {
        onEnd?.(message);
      });
    },
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

  /**
   * The swap is one-way, as in V1's `ReviewActionApp`: "the terminal is the start of a review
   * action, not the point of one", so the tab becomes the app and stays it. The URL is shown by the
   * viewer's own address bar rather than by chrome of this view's own — `AppPreviewView` adds one
   * control to the widget, Update, and nothing else.
   */
  it("frames the app once the command prints its URL, and does not swap back", async () => {
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
    expect(screen.getByLabelText("Address")).toHaveAttribute("title", "http://localhost:5173/");
    expect(screen.queryByTestId("review-action-show-terminal")).not.toBeInTheDocument();
  });

  /** `Terminal.Loading($"Starting {action.Name}...")`, dismissed by the command's first output. */
  it("says which action it is starting until the command prints", async () => {
    const { feed } = stubRun();

    render(
      <ReviewActionView
        target={{ project: "Ivy-Tendril-V2", actionName: "Dev Server" }}
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText("Starting Dev Server…")).toBeInTheDocument();

    // An escape sequence is not output: a command whose first write hides the cursor has not
    // started printing yet.
    await feed("\x1b[?25l");
    expect(screen.getByText("Starting Dev Server…")).toBeInTheDocument();

    await feed("vite v5.0.0 building...\r\n");
    expect(screen.queryByText("Starting Dev Server…")).not.toBeInTheDocument();
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

  /**
   * `ReviewActionApp` samples the transcript on a 500ms interval rather than searching it per chunk,
   * and this is the case that depends on it: `detectAppUrl` prefers a loopback host over a LAN one
   * *wherever either appears*, which only means anything once both lines are in the transcript. A
   * per-chunk search would pin the viewer to the LAN address printed first, which is the wrong one.
   */
  it("prefers the local URL over a LAN address printed before it", async () => {
    const { feed } = stubRun();

    render(
      <ReviewActionView
        target={{ project: "Ivy-Tendril-V2", actionName: "Dev Server", planId: "00509" }}
        plan={plan}
        onClose={() => {}}
      />,
    );
    await screen.findByTestId("terminal");

    await feed("  Network: http://192.168.1.9:5173/\r\n");
    await feed("  Local:   http://localhost:5173/\r\n");

    await screen.findByTitle("Web content");
    expect(screen.getByLabelText("Address")).toHaveAttribute("title", "http://localhost:5173/");
  });

  /**
   * `Terminal.Closed(ptyHandle.Closed)`. A command that exited before printing is not still starting,
   * so the indicator goes rather than spinning over a dead pty for the rest of the session.
   */
  it("takes the starting indicator down when the process exits without printing", async () => {
    const { end } = stubRun();

    render(
      <ReviewActionView
        target={{ project: "Ivy-Tendril-V2", actionName: "Dev Server" }}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText("Starting Dev Server\u2026")).toBeInTheDocument();

    await end("pwsh exited with code 127");

    await waitFor(() =>
      expect(screen.queryByText("Starting Dev Server\u2026")).not.toBeInTheDocument(),
    );
  });

  /** The command never prints a URL, so the terminal is all there is - and it stays. */
  it("keeps the terminal for a command that never announces a URL", async () => {
    const { feed } = stubRun();

    render(
      <ReviewActionView
        target={{ project: "Ivy-Tendril-V2", actionName: "Dev Server", planId: "00509" }}
        plan={plan}
        onClose={() => {}}
      />,
    );
    await screen.findByTestId("terminal");

    // A docs link and a portless help URL: neither is a dev server announcing itself.
    await feed("see https://aka.ms/some-error and https://vitejs.dev/guide/\r\n");
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(screen.getByTestId("terminal")).toBeInTheDocument();
    expect(screen.queryByTitle("Web content")).not.toBeInTheDocument();
  });
});
