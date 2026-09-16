import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PlanDetailView } from "../src/views/PlanDetailView";
import { bridge } from "../src/api/bridge";
import { planDetail, planGit } from "./fixtures/plan.fixture";
import type { Annotation, PlanDetail } from "../src/types/api";

/**
 * The plan tab's annotation wiring, from `Apps/Plans/PlanTabView.cs`:
 *
 * ```
 * new PlanMarkdown(annotatedContent).Article().DangerouslyAllowLocalFiles()
 *     .Annotations(annotations.Value)
 *     .OnAnnotationsChange(a => { annotations.Set(a); SaveAnnotationsAsync(folderPath, a); })
 * ```
 *
 * None of it was passed in V2, which left `PlanMarkdown`'s whole annotation subsystem unreachable —
 * and with it the PendingAnnotations execute guard, since nothing in the app could create an
 * annotation for it to count.
 */

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann-1",
    startOffset: 2,
    endOffset: 6,
    selectedText: "Plan",
    comment: "Narrow this down.",
    isResolved: false,
    ...overrides,
  };
}

function draft(overrides: Partial<PlanDetail> = {}): PlanDetail {
  return planDetail({
    id: "00021",
    state: "Draft",
    dependsOn: [],
    latestRevisionContent: "# Plan\n\nSome prose.\n",
    ...overrides,
  });
}

beforeEach(() => {
  vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
  vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
  vi.spyOn(bridge, "listPullRequests").mockResolvedValue([]);
  vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
  vi.spyOn(bridge, "getRepoStatus").mockResolvedValue([]);
  vi.spyOn(bridge, "listProjects").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("plan annotations", () => {
  it("reads the plan's annotations so PlanMarkdown can render its highlights", async () => {
    const listAnnotations = vi.spyOn(bridge, "listAnnotations").mockResolvedValue([annotation()]);

    render(<PlanDetailView plan={draft()} />);

    await waitFor(() => expect(listAnnotations).toHaveBeenCalledWith("00021"));
    // The highlight is applied to the rendered prose by `applyAnnotationHighlights`, which only runs
    // at all because `annotations` is now supplied.
    await waitFor(() =>
      expect(document.querySelector("[data-annotation-id='ann-1']")).not.toBeNull(),
    );
  });

  /**
   * V1: "Annotation offsets anchor to the plan text; drop them if the content changed underneath
   * (plan updated, edited, or revised)."
   */
  it("re-reads them when the revision text changes underneath", async () => {
    const listAnnotations = vi.spyOn(bridge, "listAnnotations").mockResolvedValue([]);
    const plan = draft();
    const { rerender } = render(<PlanDetailView plan={plan} />);

    await waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(1));

    rerender(
      <PlanDetailView plan={{ ...plan, latestRevisionContent: "# Plan\n\nRewritten.\n" }} />,
    );

    await waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(2));
  });

  it("does not re-read them for a refetch that left the text alone", async () => {
    const listAnnotations = vi.spyOn(bridge, "listAnnotations").mockResolvedValue([]);
    const plan = draft();
    const { rerender } = render(<PlanDetailView plan={plan} />);

    await waitFor(() => expect(listAnnotations).toHaveBeenCalledTimes(1));
    rerender(<PlanDetailView plan={{ ...plan }} />);

    expect(listAnnotations).toHaveBeenCalledTimes(1);
  });

  it("survives an unreadable annotation list without blanking the plan", async () => {
    vi.spyOn(bridge, "listAnnotations").mockRejectedValue(new Error("service unreachable"));

    render(<PlanDetailView plan={draft()} />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Plan" })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("plan-action-error")).not.toBeInTheDocument();
  });
});
