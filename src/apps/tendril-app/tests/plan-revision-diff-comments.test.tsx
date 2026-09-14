import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  PlanRevisionDiff,
  commentsForRevisionPair,
  revisionAnchor,
} from "../src/views/PlanRevisionDiff";
import { bridge } from "../src/api/bridge";
import type { DraftComment } from "../src/types/api";

/** Captured `onPlanEvent` handlers, so a test can push a daemon broadcast at the component. */
const planEventHandlers: Array<(payload: unknown) => void> = [];
const unlistenPlanEvent = vi.fn();

vi.mock("../src/api/events", () => ({
  onPlanEvent: (handler: (payload: unknown) => void) => {
    planEventHandlers.push(handler);
    return Promise.resolve(unlistenPlanEvent);
  },
}));

/**
 * A stand-in for `PlanDiffView` that exposes the two things this wiring is responsible for: the
 * comments handed down, and the three comment events handed back up.
 */
vi.mock("@ivy-interactive/components/tendril", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    PlanDiffView: ({
      filePath,
      comments = [],
      eventHandler,
    }: {
      filePath?: string;
      comments?: DraftComment[];
      eventHandler?: (name: string, id: string, args: unknown[]) => void;
    }) => (
      <div data-testid="plan-diff-view" data-file-path={filePath}>
        <ul data-testid="rendered-comments">
          {comments.map((c) => (
            <li key={`${c.filePath}:${c.changeKey}`} data-change-key={c.changeKey}>
              {c.content}
            </li>
          ))}
        </ul>
        <button
          data-testid="add-comment"
          onClick={() =>
            eventHandler?.("OnAddComment", "plan-diff", [
              {
                filePath,
                changeKey: "I42",
                content: "Newly written",
                lineNumber: 42,
                author: "Calm Niels",
                isResolved: false,
              },
            ])
          }
        >
          add
        </button>
        <button
          data-testid="delete-comment"
          onClick={() => eventHandler?.("OnDeleteComment", "plan-diff", [comments[0]])}
        >
          delete
        </button>
        <button
          data-testid="unrelated-event"
          onClick={() => eventHandler?.("OnCopyLine", "plan-diff", [{ text: "nothing to save" }])}
        >
          other
        </button>
      </div>
    ),
  };
});

const REV_1 = "# Plan\n\n## Problem\n\nThe review vanishes.\n";
const REV_2 = "# Plan\n\n## Problem\n\nThe review survives.\n";

function comment(filePath: string, changeKey: string, content: string): DraftComment {
  return { filePath, changeKey, content, lineNumber: 10, author: "Calm Niels", isResolved: false };
}

describe("commentsForRevisionPair", () => {
  const scoped = comment(revisionAnchor(1, 2), "I10", "On the 1-2 diff");
  const otherPair = comment(revisionAnchor(2, 3), "I10", "On the 2-3 diff");
  const legacy = comment("plan.md", "I10", "Written by the original Tendril");

  it("keeps this pair's comments and drops another pair's", () => {
    expect(commentsForRevisionPair([scoped, otherPair], 1, 2)).toEqual([scoped]);
    expect(commentsForRevisionPair([scoped, otherPair], 2, 3)).toEqual([otherPair]);
  });

  it("shows an unscoped legacy comment on every pair", () => {
    // Case 9: a migrated review names no revision pair, so hiding it on all but one would lose it.
    expect(commentsForRevisionPair([legacy], 1, 2)).toEqual([legacy]);
    expect(commentsForRevisionPair([legacy], 2, 3)).toEqual([legacy]);
    expect(commentsForRevisionPair([legacy, scoped], 1, 2)).toEqual([legacy, scoped]);
  });
});

describe("PlanRevisionDiff draft comments", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    planEventHandlers.length = 0;
    unlistenPlanEvent.mockClear();
    vi.spyOn(bridge, "getRevision").mockImplementation(async (_id, number) =>
      number === 1 ? REV_1 : REV_2,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads a plan's comments and renders the ones belonging to the shown pair", async () => {
    vi.spyOn(bridge, "listDiffComments").mockResolvedValue([
      comment(revisionAnchor(1, 2), "I10", "Scoped to this diff"),
      comment(revisionAnchor(5, 6), "I11", "Belongs to another diff"),
      comment("plan.md", "I12", "Legacy, shown everywhere"),
    ]);

    render(<PlanRevisionDiff planId="00609" revisionCount={2} />);

    await waitFor(() => expect(screen.getByTestId("plan-diff-view")).toBeInTheDocument());
    expect(bridge.listDiffComments).toHaveBeenCalledWith("00609");

    const rendered = await screen.findByTestId("rendered-comments");
    await waitFor(() => expect(rendered.textContent).toContain("Scoped to this diff"));
    expect(rendered.textContent).toContain("Legacy, shown everywhere");
    expect(rendered.textContent).not.toContain("Belongs to another diff");
  });

  it("saves a new comment under the revision-pair path and shows what came back", async () => {
    vi.spyOn(bridge, "listDiffComments").mockResolvedValue([]);
    const upsert = vi
      .spyOn(bridge, "upsertDiffComment")
      .mockResolvedValue([comment(revisionAnchor(1, 2), "I42", "Newly written")]);

    render(<PlanRevisionDiff planId="00609" revisionCount={2} />);
    await waitFor(() => expect(screen.getByTestId("plan-diff-view")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("add-comment"));

    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith(
        "00609",
        expect.objectContaining({ filePath: "plan.md@1-2", changeKey: "I42" }),
      ),
    );
    // State comes from the response, not from a local guess.
    await waitFor(() =>
      expect(screen.getByTestId("rendered-comments").textContent).toContain("Newly written"),
    );
  });

  it("deletes by the comment's own path and key, and ignores unrelated widget events", async () => {
    const existing = comment("plan.md", "I10", "Legacy comment");
    vi.spyOn(bridge, "listDiffComments").mockResolvedValue([existing]);
    const remove = vi.spyOn(bridge, "deleteDiffComment").mockResolvedValue([]);
    const upsert = vi.spyOn(bridge, "upsertDiffComment");

    render(<PlanRevisionDiff planId="00609" revisionCount={2} />);
    await waitFor(() =>
      expect(screen.getByTestId("rendered-comments").textContent).toContain("Legacy comment"),
    );

    fireEvent.click(screen.getByTestId("unrelated-event"));
    expect(remove).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("delete-comment"));

    // The legacy comment's own bare path, not the pair anchor it is displayed under.
    await waitFor(() => expect(remove).toHaveBeenCalledWith("00609", "plan.md", "I10"));
    await waitFor(() =>
      expect(screen.getByTestId("rendered-comments").textContent).not.toContain("Legacy comment"),
    );
  });

  it("refetches on a broadcast for this plan and ignores one for another", async () => {
    const list = vi
      .spyOn(bridge, "listDiffComments")
      .mockResolvedValue([comment(revisionAnchor(1, 2), "I10", "First load")]);

    render(<PlanRevisionDiff planId="00609" revisionCount={2} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(planEventHandlers.length).toBeGreaterThan(0));

    const emit = (payload: unknown) => planEventHandlers.forEach((h) => h(payload));

    // Another plan's change, and a plan event of another kind, are both none of this tab's business.
    emit({ type: "plan.diff_comments_changed", planId: "00610", count: 3 });
    emit({ type: "state", planId: "00609" });
    emit("not an object at all");
    expect(list).toHaveBeenCalledTimes(1);

    list.mockResolvedValue([comment(revisionAnchor(1, 2), "I10", "Reloaded from the broadcast")]);
    emit({ type: "plan.diff_comments_changed", planId: "00609", count: 1 });

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId("rendered-comments").textContent).toContain(
        "Reloaded from the broadcast",
      ),
    );
  });

  it("shows a rejected save without taking the diff away", async () => {
    vi.spyOn(bridge, "listDiffComments").mockResolvedValue([]);
    vi.spyOn(bridge, "upsertDiffComment").mockRejectedValue({
      code: "UPSERT_DIFF_COMMENT_FAILED",
      message: "Failed to save diff comment on plan '00609' (503 Service Unavailable)",
      details: null,
    });

    render(<PlanRevisionDiff planId="00609" revisionCount={2} />);
    await waitFor(() => expect(screen.getByTestId("plan-diff-view")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("add-comment"));

    await waitFor(() =>
      expect(screen.getByTestId("diff-error")).toHaveTextContent(/Failed to save diff comment/),
    );
    // The reviewer keeps the diff they were reading, so they can retry rather than start over.
    expect(screen.getByTestId("plan-diff-view")).toBeInTheDocument();
  });

  it("reports a failed comment load and still renders the diff", async () => {
    vi.spyOn(bridge, "listDiffComments").mockRejectedValue({
      code: "LIST_DIFF_COMMENTS_FAILED",
      message: "Failed to list diff comments for plan '00609' (500 Internal Server Error)",
      details: null,
    });

    render(<PlanRevisionDiff planId="00609" revisionCount={2} />);

    await waitFor(() =>
      expect(screen.getByTestId("diff-error")).toHaveTextContent(/Failed to list diff comments/),
    );
    expect(screen.getByTestId("plan-diff-view")).toBeInTheDocument();
  });
});
