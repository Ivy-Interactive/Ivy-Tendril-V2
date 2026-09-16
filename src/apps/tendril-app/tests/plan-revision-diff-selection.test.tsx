import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PlanRevisionDiff } from "../src/views/PlanRevisionDiff";
import { bridge } from "../src/api/bridge";

/**
 * Which revisions the Diff View tab compares.
 *
 * V1 has no revision picker on this widget at all (`ChangesTabView` diffs git-changed files), so the
 * rule here is V2's own and stated in the view: the newest pair by default, and a pair the operator
 * has chosen is left alone.
 */
beforeEach(() => {
  vi.spyOn(bridge, "listDiffComments").mockResolvedValue([]);
  vi.spyOn(bridge, "getRevision").mockImplementation((_id: string, n?: number) =>
    Promise.resolve(`# Revision ${n}\n`),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PlanRevisionDiff revision selection", () => {
  it("lands on the newest pair once the revision count arrives after mount", async () => {
    const { rerender } = render(<PlanRevisionDiff planId="00021" revisionCount={0} />);

    expect(screen.getByTestId("diff-single-revision")).toBeInTheDocument();

    rerender(<PlanRevisionDiff planId="00021" revisionCount={4} />);

    await waitFor(() => expect(screen.getByLabelText("Old revision")).toHaveValue("3"));
    expect(screen.getByLabelText("New revision")).toHaveValue("4");
    expect(screen.queryByTestId("diff-identical")).not.toBeInTheDocument();
  });

  it("follows a newly written revision while the selection is still on the head", async () => {
    const { rerender } = render(<PlanRevisionDiff planId="00021" revisionCount={4} />);

    await waitFor(() => expect(screen.getByLabelText("New revision")).toHaveValue("4"));

    // An UpdatePlan run wrote revision 5 while the tab was open.
    rerender(<PlanRevisionDiff planId="00021" revisionCount={5} />);

    await waitFor(() => expect(screen.getByLabelText("New revision")).toHaveValue("5"));
    expect(screen.getByLabelText("Old revision")).toHaveValue("4");
  });

  it("leaves a pair the operator chose where they put it", async () => {
    const { rerender } = render(<PlanRevisionDiff planId="00021" revisionCount={4} />);

    await waitFor(() => expect(screen.getByLabelText("New revision")).toHaveValue("4"));

    const newSelect = screen.getByLabelText("New revision") as HTMLSelectElement;
    newSelect.value = "2";
    newSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => expect(screen.getByLabelText("New revision")).toHaveValue("2"));

    rerender(<PlanRevisionDiff planId="00021" revisionCount={5} />);

    expect(screen.getByLabelText("New revision")).toHaveValue("2");
  });
});
