/**
 * The other diff tests mock `PlanDiffView` away, which is what let the tab ship for so long
 * rendering nothing: the patch handed down was correct as text but unparseable as a diff. These
 * cases use the real component, so the assertion is on what a reviewer actually sees.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PlanRevisionDiff } from "../src/views/PlanRevisionDiff";
import { bridge } from "../src/api/bridge";
import type { DraftComment } from "../src/types/api";

vi.mock("../src/api/events", () => ({
  onPlanEvent: () => Promise.resolve(() => {}),
}));

const REV_1 = "# Plan\n\n## Problem\n\nThe diff tab renders nothing at all.\n";
const REV_2 = "# Plan\n\n## Problem\n\nThe diff tab renders the real revisions.\n";

describe("PlanRevisionDiff with the real PlanDiffView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(bridge, "getRevision").mockImplementation(async (_id, number) =>
      number === 1 ? REV_1 : REV_2,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the changed lines rather than 'No diff to display'", async () => {
    vi.spyOn(bridge, "listDiffComments").mockResolvedValue([]);

    const { container } = render(<PlanRevisionDiff planId="00609" revisionCount={2} />);

    await waitFor(() =>
      expect(container.textContent).toContain("The diff tab renders the real revisions."),
    );
    expect(container.textContent).toContain("The diff tab renders nothing at all.");
    // gitdiff-parser finding no file is silent, so this is the only assertion that catches it.
    expect(screen.queryByText("No diff to display")).not.toBeInTheDocument();
  });

  it("shows a stored comment's text on the line it was filed against", async () => {
    const stored: DraftComment[] = [
      {
        // The change key gitdiff-parser assigns to the deleted line of the first hunk.
        filePath: "plan.md@1-2",
        changeKey: "D5",
        content: "Does this claim still hold?",
        lineNumber: 5,
        author: "Calm Niels",
        isResolved: false,
      },
      {
        filePath: "plan.md@7-8",
        changeKey: "D5",
        content: "Filed against a different revision pair.",
        lineNumber: 5,
        author: "Calm Niels",
        isResolved: false,
      },
    ];
    vi.spyOn(bridge, "listDiffComments").mockResolvedValue(stored);

    const { container } = render(<PlanRevisionDiff planId="00609" revisionCount={2} />);

    await waitFor(() => expect(container.textContent).toContain("Does this claim still hold?"));
    // The other pair's comment shares a change key but must not leak onto this diff.
    expect(container.textContent).not.toContain("Filed against a different revision pair.");
  });
});
