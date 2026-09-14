import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PlanDetailView } from "../../PlanDetailView";
import { bridge } from "../../../api/bridge";
import type { PlanDetail, RepoStatus } from "../../../types/api";
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

  it("hands the guard off to Update Plan instead of dispatching", async () => {
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
