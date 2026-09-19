import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PlanDetailView } from "../../PlanDetailView";
import { bridge } from "../../../api/bridge";
import type { Annotation, PlanDetail, RepoStatus } from "../../../types/api";
import { planDetail } from "../../../../tests/fixtures/plan.fixture";

/**
 * The invariant these tests pin: **no ExecutePlan dispatch escapes an open
 * guard.** `onExecute` fires either because no guard was collected, or because
 * the operator walked through every one of them.
 */

const UNANSWERED_FENCE = [
  "```questions",
  "questions:",
  "  - id: caching-strategy",
  "    header: Caching",
  "    title: Which caching strategy?",
  "    options:",
  "      - title: In-memory",
  "        value: in-memory",
  "      - title: Redis",
  "        value: redis",
  "```",
].join("\n");

const ANSWERED_FENCE = [
  "```questions",
  "questions:",
  "  - id: retry-scope",
  "    title: Per-request or per-session retries?",
  "    options:",
  "      - title: Per session",
  "        value: per-session",
  "      - title: Per request",
  "        value: per-request",
  "    answer: per-session",
  "```",
].join("\n");

const DIRTY: RepoStatus[] = [
  { path: "/repos/Tendril-App", isDirty: true, changes: [" M src/App.tsx"], changeCount: 1 },
];

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann-1",
    startOffset: 4,
    endOffset: 9,
    selectedText: "Plan",
    comment: "Narrow this down.",
    isResolved: false,
    ...overrides,
  };
}

function draftPlan(overrides: Partial<PlanDetail> = {}): PlanDetail {
  return planDetail({
    id: "00021",
    state: "Draft",
    revisionCount: 2,
    dependsOn: [],
    latestRevisionContent: "# Plan\n\n## Problem\n",
    ...overrides,
  });
}

function renderView(plan: PlanDetail, onExecute = vi.fn()) {
  render(<PlanDetailView plan={plan} onExecute={onExecute} />);
  return onExecute;
}

async function clickExecute() {
  fireEvent.click(screen.getByRole("button", { name: "Execute Plan" }));
  // `handleExecute` awaits repo status before deciding, so let it settle.
  await waitFor(() => expect(bridge.getRepoStatus).toHaveBeenCalled());
}

beforeEach(() => {
  vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
  vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
  vi.spyOn(bridge, "getRepoStatus").mockResolvedValue([]);
  vi.spyOn(bridge, "listAnnotations").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pre-execution guard chain", () => {
  it("dispatches straight away when no guard fires", async () => {
    const onExecute = renderView(draftPlan());

    await clickExecute();

    await waitFor(() => expect(onExecute).toHaveBeenCalledWith("00021"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("blocks on pending annotations without dispatching", async () => {
    const onExecute = renderView(
      draftPlan({ revisionCount: 1, latestRevisionContent: ANSWERED_FENCE }),
    );

    await clickExecute();

    expect(await screen.findByTestId("pending-annotations-dialog")).toBeInTheDocument();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("blocks on an unresolved annotation from the store", async () => {
    vi.spyOn(bridge, "listAnnotations").mockResolvedValue([annotation()]);
    // Revision 2 with no fences, so the store is the only thing that can fire it.
    const onExecute = renderView(draftPlan());

    await clickExecute();

    const dialog = await screen.findByTestId("pending-annotations-dialog");
    // V1's `Message(1, 0)`, and its header for an annotations-only count.
    expect(
      within(dialog).getByText(/1 annotation that haven't been incorporated/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Unincorporated Annotations")).toBeInTheDocument();
    expect(within(dialog).getByTestId("guard-proceed")).toHaveTextContent(
      "Discard Annotations & Execute",
    );
    expect(onExecute).not.toHaveBeenCalled();
  });

  /**
   * The two counts are not discarded alike, which is why V1 hands the dialog both rather than their
   * sum: annotations live only in the UI, so declining throws them away, while answers are already in
   * the revision file and the agent honours them as written.
   */
  it("names an unfolded answer as an answer, and offers to execute without updating", async () => {
    const onExecute = renderView(
      draftPlan({ revisionCount: 1, latestRevisionContent: ANSWERED_FENCE }),
    );

    await clickExecute();

    const dialog = await screen.findByTestId("pending-annotations-dialog");
    expect(within(dialog).getByText("Unincorporated Answers")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/1 answered question that haven't been incorporated/),
    ).toBeInTheDocument();
    // Nothing to discard, so the decline button does not offer to.
    expect(within(dialog).getByTestId("guard-proceed")).toHaveTextContent(
      "Execute Without Updating",
    );
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("does not block on an annotation that is already resolved", async () => {
    vi.spyOn(bridge, "listAnnotations").mockResolvedValue([annotation({ isResolved: true })]);
    const onExecute = renderView(draftPlan());

    await clickExecute();

    await waitFor(() => expect(onExecute).toHaveBeenCalledWith("00021"));
    expect(screen.queryByTestId("pending-annotations-dialog")).not.toBeInTheDocument();
  });

  it("counts store annotations and unfolded answers together, naming each", async () => {
    vi.spyOn(bridge, "listAnnotations").mockResolvedValue([
      annotation(),
      annotation({ id: "ann-2" }),
    ]);
    const onExecute = renderView(
      draftPlan({ revisionCount: 1, latestRevisionContent: ANSWERED_FENCE }),
    );

    await clickExecute();

    // V1's `Message(2, 1)`. The badge on the Update Plan button is their sum, but the warning has to
    // say which is which, because executing without updating discards one and honours the other.
    const dialog = await screen.findByTestId("pending-annotations-dialog");
    expect(within(dialog).getByText("Unincorporated Changes")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /2 annotations and 1 answered question that haven't been incorporated/,
      ),
    ).toBeInTheDocument();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("does not let an unreadable annotation list block execution forever", async () => {
    vi.spyOn(bridge, "listAnnotations").mockRejectedValue(new Error("service unreachable"));
    const onExecute = renderView(draftPlan());

    await clickExecute();

    await waitFor(() => expect(onExecute).toHaveBeenCalledWith("00021"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("blocks on unanswered questions without dispatching, and lists them", async () => {
    const onExecute = renderView(draftPlan({ latestRevisionContent: UNANSWERED_FENCE }));

    await clickExecute();

    const dialog = await screen.findByTestId("unanswered-questions-dialog");
    // The revision body renders the same fence as a questions callout, so the
    // assertion is scoped to the dialog rather than the document.
    expect(within(dialog).getByText("Which caching strategy?")).toBeInTheDocument();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("blocks on a dirty repo without dispatching, and lists its changes", async () => {
    vi.spyOn(bridge, "getRepoStatus").mockResolvedValue(DIRTY);
    const onExecute = renderView(draftPlan());

    await clickExecute();

    const dialog = await screen.findByTestId("dirty-repo-dialog");
    expect(within(dialog).getByText("/repos/Tendril-App")).toBeInTheDocument();
    // Testing Library normalizes the porcelain line's leading space away.
    expect(within(dialog).getByText("M src/App.tsx")).toBeInTheDocument();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("dispatches exactly once after proceeding through all three guards", async () => {
    vi.spyOn(bridge, "getRepoStatus").mockResolvedValue(DIRTY);
    const onExecute = renderView(
      draftPlan({
        revisionCount: 1,
        latestRevisionContent: `${ANSWERED_FENCE}\n\n${UNANSWERED_FENCE}`,
      }),
    );

    await clickExecute();

    expect(await screen.findByTestId("pending-annotations-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("guard-proceed"));
    expect(onExecute).not.toHaveBeenCalled();

    expect(await screen.findByTestId("unanswered-questions-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("guard-proceed"));
    expect(onExecute).not.toHaveBeenCalled();

    expect(await screen.findByTestId("dirty-repo-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("guard-proceed"));

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onExecute).toHaveBeenCalledWith("00021");
  });

  it("dispatches nothing when a guard is cancelled", async () => {
    const onExecute = renderView(draftPlan({ latestRevisionContent: UNANSWERED_FENCE }));

    await clickExecute();
    expect(await screen.findByTestId("unanswered-questions-dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("dialog-cancel"));

    await waitFor(() =>
      expect(screen.queryByTestId("unanswered-questions-dialog")).not.toBeInTheDocument(),
    );
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("dispatches nothing when a guard is dismissed with Escape", async () => {
    vi.spyOn(bridge, "getRepoStatus").mockResolvedValue(DIRTY);
    const onExecute = renderView(draftPlan());

    await clickExecute();
    expect(await screen.findByTestId("dirty-repo-dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("dirty-repo-dialog")).not.toBeInTheDocument());
    expect(onExecute).not.toHaveBeenCalled();
  });

  /**
   * The questions guard's middle button is V2's own: V1 offers *Answer Questions*, which navigated to a
   * questions view V2 does not have, so this opens the free-text update dialog instead. Unlike the
   * pending-work guard's *Update Plan*, there is no prompt to generate here — nothing has been decided
   * yet — so it asks rather than submitting.
   */
  it("hands the questions guard off to the free-text Update Plan dialog", async () => {
    const onExecute = renderView(draftPlan({ latestRevisionContent: UNANSWERED_FENCE }));

    await clickExecute();
    expect(await screen.findByTestId("unanswered-questions-dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("guard-update-plan"));

    expect(await screen.findByTestId("update-plan-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("unanswered-questions-dialog")).not.toBeInTheDocument();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("does not let an unreadable repo status block execution forever", async () => {
    vi.spyOn(bridge, "getRepoStatus").mockRejectedValue(new Error("service unreachable"));
    const onExecute = renderView(draftPlan());

    await clickExecute();

    await waitFor(() => expect(onExecute).toHaveBeenCalledWith("00021"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

/**
 * `PendingAnnotationsDialog`'s four-way footer.
 *
 * The dialog exists because "execute anyway" is a real but *inferior* choice: the answers are on disk
 * and the agent will honour them as written, it just will not have folded them into the plan first. So
 * the four buttons are four different decisions rather than a warning with an OK, and the one that
 * resolves the warning is the only filled button.
 */
describe("the pending-work guard's four actions", () => {
  const answeredDraft = () =>
    draftPlan({ revisionCount: 1, latestRevisionContent: ANSWERED_FENCE });

  beforeEach(() => {
    vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "00400", status: "Started" });
    vi.spyOn(bridge, "deleteAnnotation").mockResolvedValue([]);
  });

  it("offers Cancel, Update Plan, the decline and Update Plan & Execute as the primary", async () => {
    renderView(answeredDraft());
    await clickExecute();

    const dialog = await screen.findByTestId("pending-annotations-dialog");
    expect(within(dialog).getByTestId("dialog-cancel")).toHaveTextContent("Cancel");
    expect(within(dialog).getByTestId("guard-update-plan")).toHaveTextContent("Update Plan");
    expect(within(dialog).getByTestId("guard-proceed")).toHaveTextContent(
      "Execute Without Updating",
    );
    // V1's label, not a shorthand, and the only button that is not `.Outline()`.
    const primary = within(dialog).getByTestId("guard-update-and-execute");
    expect(primary).toHaveTextContent("Update Plan & Execute");
    for (const outline of ["dialog-cancel", "guard-update-plan", "guard-proceed"]) {
      expect(within(dialog).getByTestId(outline).className).toContain("border-input");
    }
    expect(primary.className).not.toContain("border-input");
  });

  /** `onUpdate()` stops after the update: V1 calls `SubmitAnnotationsUpdate` and nothing else. */
  it("Update Plan folds the answer in and does not execute", async () => {
    const onExecute = renderView(answeredDraft());
    await clickExecute();
    await screen.findByTestId("pending-annotations-dialog");

    fireEvent.click(screen.getByTestId("guard-update-plan"));

    await waitFor(() => expect(bridge.startJob).toHaveBeenCalledTimes(1));
    const args = vi.mocked(bridge.startJob).mock.calls[0][0];
    expect(args.type).toBe("UpdatePlan");
    expect(args.folderPath).toBe("00021");
    // `BuildUpdatePrompt`'s answers half, which is the whole instruction the job needs.
    expect(args.instructions).toContain("I answered 1 question in this plan's `questions` blocks.");
    expect(args.instructions).toContain("delete that");
    expect(onExecute).not.toHaveBeenCalled();
  });

  /**
   * `onUpdateAndExecute` is a compound: `ContinueExecute([SubmitAnnotationsUpdate(...)], ...)`. The
   * ExecutePlan is parked behind the UpdatePlan with `WaitForJobs`, which is why it cannot go through
   * `onExecute` — that callback carries only a plan id.
   */
  it("Update Plan & Execute parks the execute behind the update", async () => {
    const onExecute = renderView(answeredDraft());
    await clickExecute();
    await screen.findByTestId("pending-annotations-dialog");

    fireEvent.click(screen.getByTestId("guard-update-and-execute"));

    await waitFor(() => expect(bridge.startJob).toHaveBeenCalledTimes(2));
    const [update, execute] = vi.mocked(bridge.startJob).mock.calls.map((call) => call[0]);
    expect(update.type).toBe("UpdatePlan");
    expect(execute.type).toBe("ExecutePlan");
    expect(execute.waitForJobs).toEqual(["00400"]);
    // Not the ungated dispatch: that one would run immediately, beside the update rather than after it.
    expect(onExecute).not.toHaveBeenCalled();
    expect(screen.queryByTestId("pending-annotations-dialog")).not.toBeInTheDocument();
  });

  /**
   * "Updating retires the questions it folds in, so there is nothing left to warn about on this path —
   * the warning would be about a state the job is on its way to fixing."
   */
  it("skips the unanswered-questions guard on the update-and-execute path", async () => {
    renderView(
      draftPlan({
        revisionCount: 1,
        latestRevisionContent: `${ANSWERED_FENCE}\n\n${UNANSWERED_FENCE}`,
      }),
    );
    await clickExecute();
    await screen.findByTestId("pending-annotations-dialog");

    fireEvent.click(screen.getByTestId("guard-update-and-execute"));

    await waitFor(() => expect(bridge.startJob).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("unanswered-questions-dialog")).not.toBeInTheDocument();
  });

  /** A dirty repo is still asked about: the update does nothing about uncommitted changes. */
  it("still asks about a dirty repo, and carries the update's job id past it", async () => {
    vi.spyOn(bridge, "getRepoStatus").mockResolvedValue(DIRTY);
    renderView(
      draftPlan({
        revisionCount: 1,
        latestRevisionContent: `${ANSWERED_FENCE}\n\n${UNANSWERED_FENCE}`,
      }),
    );
    await clickExecute();
    await screen.findByTestId("pending-annotations-dialog");

    fireEvent.click(screen.getByTestId("guard-update-and-execute"));

    // The update went, and the execute is waiting on the repo question rather than on nothing.
    await waitFor(() => expect(bridge.startJob).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("dirty-repo-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("unanswered-questions-dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("guard-proceed"));

    await waitFor(() => expect(bridge.startJob).toHaveBeenCalledTimes(2));
    const execute = vi.mocked(bridge.startJob).mock.calls[1][0];
    expect(execute.type).toBe("ExecutePlan");
    expect(execute.waitForJobs).toEqual(["00400"]);
  });

  /** A refused update must not be followed by an execute, and must not throw the annotations away. */
  it("does not execute when the update is refused", async () => {
    vi.spyOn(bridge, "listAnnotations").mockResolvedValue([annotation()]);
    vi.spyOn(bridge, "startJob").mockRejectedValue(new Error("daemon unreachable"));
    const onExecute = renderView(draftPlan());
    await clickExecute();
    await screen.findByTestId("pending-annotations-dialog");

    fireEvent.click(screen.getByTestId("guard-update-and-execute"));

    await waitFor(() =>
      expect(screen.getByTestId("plan-action-error")).toHaveTextContent(/Update Plan failed/),
    );
    expect(bridge.startJob).toHaveBeenCalledTimes(1);
    expect(onExecute).not.toHaveBeenCalled();
    expect(bridge.deleteAnnotation).not.toHaveBeenCalled();
  });
});
