import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import * as React from "react";
import { bridge, type ReviewActionRun } from "../src/api/bridge";
import { planSummary } from "./fixtures/plan.fixture";
import type { Job } from "../src/types/api";

/**
 * The comment side of the review-action run loop, which needs the viewer driven directly.
 *
 * `WebViewer` collects comments through a service-worker proxy, an injected page agent and
 * `postMessage`, none of which exist in jsdom, so the real component can never raise a comment event
 * here. It is stubbed down to the two channels `AppPreviewView` actually uses - `OnEvent` out and the
 * command stream in - which is exactly the contract under test: what this view does with the events,
 * and what it writes back into the page.
 */
interface ViewerProps {
  url?: string;
  device?: string;
  actions?: Array<{ id: string; badge?: string; label?: string; primary?: boolean }>;
  commands?: { id: string };
  subscribeToStream?: (streamId: string, onData: (data: unknown) => void) => () => void;
  eventHandler?: (eventName: string, id: string, args: unknown[]) => void;
}

let viewer: ViewerProps | null = null;
/** Commands the view wrote into the viewer's stream, newest last. */
let commandsSeen: unknown[] = [];

vi.mock("@ivy-interactive/components/tendril", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ivy-interactive/components/tendril")>();
  const WebViewerStub: React.FC<ViewerProps> = (props) => {
    viewer = props;
    React.useEffect(() => {
      if (!props.commands?.id || !props.subscribeToStream) return;
      return props.subscribeToStream(props.commands.id, (data) => commandsSeen.push(data));
    }, [props.commands?.id, props.subscribeToStream]);
    return <div data-testid="web-viewer" />;
  };
  return { ...actual, WebViewer: WebViewerStub };
});

const { ReviewActionView } = await import("../src/views/ReviewActionView");

const plan = planSummary({ id: "00509", project: "Ivy-Tendril-V2", state: "Review" });
const PAGE = "http://localhost:5173/";

function stubRun() {
  const run: ReviewActionRun = {
    session: { sessionId: "s1", encoding: "base64", rows: 24, cols: 80 },
    sendInput: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  let onChunk: ((bytes: Uint8Array) => void) | undefined;
  vi.spyOn(bridge, "startReviewAction").mockImplementation((_p, _a, options) => {
    onChunk = options?.onChunk;
    return Promise.resolve(run);
  });
  return {
    feed: async (text: string) => {
      await act(async () => {
        onChunk?.(new TextEncoder().encode(text));
      });
    },
  };
}

/** One `CommentEvent` as the viewer reports it. */
function commentEvent(id: string, comment: string, extra: Record<string, unknown> = {}) {
  return {
    kind: "comment",
    id,
    tag: "button",
    selector: "div > button:nth-child(1)",
    comment,
    url: PAGE,
    ...extra,
  };
}

function raise(event: unknown) {
  act(() => {
    viewer?.eventHandler?.("OnEvent", "review-action-preview", [event]);
  });
}

async function renderPreviewing(jobs: Job[] = []) {
  const { feed } = stubRun();
  render(
    <ReviewActionView
      target={{ project: "Ivy-Tendril-V2", actionName: "Dev Server", planId: "00509" }}
      plan={plan}
      jobs={jobs}
      onClose={() => {}}
    />,
  );
  await feed(`  Local:   ${PAGE}\r\n`);
  await screen.findByTestId("web-viewer");
  return { feed };
}

beforeEach(() => {
  viewer = null;
  commandsSeen = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReviewActionView comment collection", () => {
  /**
   * `AppPreviewView.UpdateActions`: "an Update button with nothing behind it invites a change request
   * made of nothing", so the action appears only once there is a comment, badged with the count.
   */
  it("offers Update only once a comment exists, badged with the count", async () => {
    await renderPreviewing();
    expect(viewer?.actions).toEqual([]);

    raise(commentEvent("c1", "This heading is too green."));

    expect(viewer?.actions).toHaveLength(1);
    expect(viewer?.actions?.[0]).toMatchObject({ id: "update", badge: "1", primary: true });

    raise(commentEvent("c2", "And this button is misaligned."));
    expect(viewer?.actions?.[0]).toMatchObject({ badge: "2" });
    expect(viewer?.actions?.[0].label).toContain("Send 2 comments");
  });

  /** `CommentUpdatedEvent`: an edit replaces the text and leaves the pin's number alone. */
  it("applies an edit to the comment it names", async () => {
    await renderPreviewing();
    raise(commentEvent("c1", "Too green."));
    raise({ kind: "comment-edit", id: "c1", comment: "Too green, use the muted token." });
    raise({ kind: "action", id: "update" });

    const summary = await screen.findByTestId("suggest-changes-summary");
    expect(summary).toHaveTextContent("1. Too green, use the muted token.");
  });

  /**
   * `CommentDeletedEvent`: "a number is a position, so what is left closes ranks - the same thing the
   * pins in the page do". Deleting the first comment renumbers the second to 1.
   */
  it("closes ranks when a comment is deleted", async () => {
    await renderPreviewing();
    raise(commentEvent("c1", "First note."));
    raise(commentEvent("c2", "Second note."));
    raise({ kind: "comment-delete", id: "c1" });

    expect(viewer?.actions?.[0]).toMatchObject({ badge: "1" });

    raise({ kind: "action", id: "update" });
    const summary = await screen.findByTestId("suggest-changes-summary");
    expect(summary).toHaveTextContent("1. Second note.");
  });

  /**
   * `AppPreviewView`'s switch has no arm for console, network or capture events: "what the widget
   * reports beyond comments, navigation and its own toolbar is dropped on the floor". An app under
   * review logs continuously, so these must not reach the comment list at all.
   */
  it("drops the events V1 has no case for", async () => {
    await renderPreviewing();

    raise({ kind: "console", level: "log", text: "[vite] connected." });
    raise({ kind: "network-entry", url: PAGE, status: 200 });
    raise({ kind: "capture-saved", path: "/tmp/shot.png" });
    raise({ kind: "navigated", url: `${PAGE}settings`, canGoBack: true, canGoForward: false });
    raise({ kind: "select-mode", enabled: true });

    expect(viewer?.actions).toEqual([]);
  });

  /** `DeviceChangedEvent`: the viewport menu is the viewer's, so its choice is written back. */
  it("follows the viewer's viewport choice", async () => {
    await renderPreviewing();
    expect(viewer?.device).toBe("Desktop");

    raise({ kind: "device", device: "Tablet" });
    expect(viewer?.device).toBe("Tablet");
  });

  /** A comment carries the viewport it was left at, and the change request quotes it. */
  it("carries the viewport a comment was left at into the change request", async () => {
    vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "03400", status: "Queued" });
    await renderPreviewing();

    raise(commentEvent("c1", "Wraps badly here.", { device: "Mobile" }));
    raise({ kind: "action", id: "update" });

    fireEvent.click(await screen.findByTestId("dialog-confirm"));

    await waitFor(() => expect(bridge.startJob).toHaveBeenCalled());
    const args = vi.mocked(bridge.startJob).mock.calls[0][0] as { changeRequest: string };
    expect(args.changeRequest).toContain("viewport: Mobile");
    expect(args.changeRequest).toContain(`## ${PAGE}`);
  });
});

describe("ReviewActionView update dispatch", () => {
  /**
   * `AppPreviewView`'s `onSubmitted`: "the widget owns the pins, so clearing our list is only half of
   * it: without this the page stays marked up with feedback that has already been sent."
   */
  it("clears the pins in the page as well as its own list", async () => {
    vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "03401", status: "Queued" });
    await renderPreviewing();

    raise(commentEvent("c1", "Too green."));
    raise({ kind: "action", id: "update" });
    fireEvent.click(await screen.findByTestId("dialog-confirm"));

    await waitFor(() => expect(commandsSeen).toContainEqual({ command: "clear-comments" }));
    await waitFor(() => expect(viewer?.actions).toEqual([]));
    expect(screen.queryByTestId("suggest-changes-dialog")).not.toBeInTheDocument();
  });

  /**
   * `AppPreview.JobsToWaitFor` reaching `RetryPlanArgs.WaitForJobs`: everything unfinished on the plan,
   * not only the retries, because two agents rewriting one worktree is how a branch ends up with half
   * of each.
   */
  it("queues the request behind whatever the plan is already running", async () => {
    vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "03402", status: "Blocked" });
    await renderPreviewing([
      { id: "03390", type: "ExecutePlan", planId: "00509", project: "P", status: "Running" },
      { id: "03391", type: "RetryPlan", planId: "00509", project: "P", status: "Blocked" },
      { id: "03392", type: "CreatePr", planId: "00509", project: "P", status: "Completed" },
      { id: "03393", type: "RetryPlan", planId: "00777", project: "P", status: "Running" },
    ]);

    raise(commentEvent("c1", "Too green."));
    raise({ kind: "action", id: "update" });

    expect(await screen.findByTestId("suggest-changes-queue-note")).toHaveTextContent(
      /already has 2 job\(s\) in flight/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Queue Update" }));

    await waitFor(() =>
      expect(bridge.startJob).toHaveBeenCalledWith(
        expect.objectContaining({ waitForJobs: ["03390", "03391"] }),
      ),
    );
  });

  /**
   * `UpdateFromCommentsDialog.Build`'s `if (pending.IsEmpty) { dialogOpen.Set(false); return null; }`.
   * Without it the shared dialog reads an empty `appComments` as the diff-side Request Changes and
   * swaps itself for a different dialog while the reviewer is looking at it.
   */
  it("closes itself if the last comment goes away while it is open", async () => {
    await renderPreviewing();

    raise(commentEvent("c1", "Too green."));
    raise({ kind: "action", id: "update" });
    expect(await screen.findByTestId("suggest-changes-dialog")).toBeInTheDocument();

    raise({ kind: "comment-delete", id: "c1" });

    await waitFor(() =>
      expect(screen.queryByTestId("suggest-changes-dialog")).not.toBeInTheDocument(),
    );
  });

  /**
   * `AppPreview.CanRequestChanges`: Review, or a retry already in flight. Anything else gets V1's whole
   * alternate dialog, whose point is that the comments are kept rather than silently dropped.
   */
  it("refuses to send into a plan that is not taking changes, and keeps the comments", async () => {
    const startJob = vi.spyOn(bridge, "startJob");
    const { feed } = stubRun();
    render(
      <ReviewActionView
        target={{ project: "Ivy-Tendril-V2", actionName: "Dev Server", planId: "00509" }}
        plan={planSummary({ id: "00509", project: "Ivy-Tendril-V2", state: "Completed" })}
        jobs={[]}
        onClose={() => {}}
      />,
    );
    await feed(`  Local:   ${PAGE}\r\n`);
    await screen.findByTestId("web-viewer");

    raise(commentEvent("c1", "Too green."));
    raise({ kind: "action", id: "update" });

    expect(await screen.findByText(/is not taking changes/)).toBeInTheDocument();
    expect(screen.getByText(/comment\(s\) are still here/)).toBeInTheDocument();
    expect(startJob).not.toHaveBeenCalled();
    // Still collected, and still offered: the plan can come back to Review.
    expect(viewer?.actions?.[0]).toMatchObject({ badge: "1" });
  });

  /** A plan mid-retry is deliberately allowed: the reviewer keeps walking the app and queues more. */
  it("allows a plan that is already applying a retry", async () => {
    vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "03403", status: "Blocked" });
    const { feed } = stubRun();
    render(
      <ReviewActionView
        target={{ project: "Ivy-Tendril-V2", actionName: "Dev Server", planId: "00509" }}
        plan={planSummary({ id: "00509", project: "Ivy-Tendril-V2", state: "Executing" })}
        jobs={[
          { id: "03395", type: "RetryPlan", planId: "00509", project: "P", status: "Running" },
        ]}
        onClose={() => {}}
      />,
    );
    await feed(`  Local:   ${PAGE}\r\n`);
    await screen.findByTestId("web-viewer");

    raise(commentEvent("c1", "One more thing."));
    raise({ kind: "action", id: "update" });

    expect(await screen.findByText(/Update Plan #00509/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Queue Update" }));
    await waitFor(() => expect(bridge.startJob).toHaveBeenCalled());
  });
});
