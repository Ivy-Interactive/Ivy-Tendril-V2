import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanRevisionDiff, buildRevisionPatch } from "../src/views/PlanRevisionDiff";
import { bridge } from "../src/api/bridge";

vi.mock("@ivy-interactive/components/tendril", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // The real PlanDiffView pulls in refractor/react-diff-view; the contract
    // under test is the patch text handed to it, so render it verbatim.
    PlanDiffView: ({
      diff,
      filePath,
      oldRevision,
      newRevision,
    }: {
      diff?: string;
      filePath?: string;
      oldRevision?: string;
      newRevision?: string;
    }) => (
      <pre
        data-testid="plan-diff-view"
        data-file-path={filePath}
        data-old-revision={oldRevision}
        data-new-revision={newRevision}
      >
        {diff}
      </pre>
    ),
  };
});

const REV_1 = "# Plan\n\n## Problem\n\nThe diff tab lies.\n";
const REV_2 = "# Plan\n\n## Problem\n\nThe diff tab shows real revisions.\n";

describe("buildRevisionPatch", () => {
  it("produces a unified patch with the changed lines", () => {
    const patch = buildRevisionPatch(1, 2, REV_1, REV_2);

    expect(patch).toContain("--- plan.md (revision 1)");
    expect(patch).toContain("+++ plan.md (revision 2)");
    expect(patch).toContain("-The diff tab lies.");
    expect(patch).toContain("+The diff tab shows real revisions.");
  });

  it("does not invent changes when the revisions match", () => {
    const patch = buildRevisionPatch(2, 2, REV_2, REV_2);

    // No hunk header means no reported change.
    expect(patch).not.toContain("@@");
  });

  it("reports added lines rather than a fixed one-line change", () => {
    const patch = buildRevisionPatch(
      1,
      2,
      "# Plan\n",
      "# Plan\n\n## Solution\n\nStep one.\nStep two.\n",
    );

    expect(patch).toContain("+## Solution");
    expect(patch).toContain("+Step one.");
    expect(patch).toContain("+Step two.");
  });
});

describe("PlanRevisionDiff", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the two selected revisions and renders their real diff", async () => {
    const getRevision = vi
      .spyOn(bridge, "getRevision")
      .mockImplementation(async (_id, number) => (number === 1 ? REV_1 : REV_2));

    render(<PlanRevisionDiff planId="00021" revisionCount={2} />);

    await waitFor(() => expect(screen.getByTestId("plan-diff-view")).toBeInTheDocument());

    expect(getRevision).toHaveBeenCalledWith("00021", 1);
    expect(getRevision).toHaveBeenCalledWith("00021", 2);

    const view = screen.getByTestId("plan-diff-view");
    expect(view.textContent).toContain("-The diff tab lies.");
    expect(view.textContent).toContain("+The diff tab shows real revisions.");
    expect(view.getAttribute("data-file-path")).toBe("plan.md");
    expect(view.getAttribute("data-old-revision")).toBe("1");
    expect(view.getAttribute("data-new-revision")).toBe("2");
  });

  it("bounds both selectors by revisionCount", async () => {
    const getRevision = vi.spyOn(bridge, "getRevision").mockResolvedValue(REV_1);

    render(<PlanRevisionDiff planId="00021" revisionCount={3} />);
    await waitFor(() => expect(getRevision).toHaveBeenCalledTimes(2));

    const oldSelect = screen.getByLabelText("Old revision") as HTMLSelectElement;
    const newSelect = screen.getByLabelText("New revision") as HTMLSelectElement;

    expect(Array.from(oldSelect.options).map((o) => o.value)).toEqual(["1", "2", "3"]);
    expect(Array.from(newSelect.options).map((o) => o.value)).toEqual(["1", "2", "3"]);
    // Defaults compare the newest revision against the one before it.
    expect(oldSelect.value).toBe("2");
    expect(newSelect.value).toBe("3");
  });

  it("refetches when the operator picks a different revision", async () => {
    const getRevision = vi.spyOn(bridge, "getRevision").mockResolvedValue(REV_1);

    render(<PlanRevisionDiff planId="00021" revisionCount={3} />);
    await waitFor(() => expect(getRevision).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText("Old revision"), {
      target: { value: "1" },
    });

    await waitFor(() => expect(getRevision).toHaveBeenCalledWith("00021", 1));
  });

  it("shows an empty state instead of a diff for a single-revision plan", () => {
    const getRevision = vi.spyOn(bridge, "getRevision");

    render(<PlanRevisionDiff planId="00021" revisionCount={1} />);

    expect(screen.getByTestId("diff-single-revision")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-diff-view")).not.toBeInTheDocument();
    expect(getRevision).not.toHaveBeenCalled();
  });

  it("surfaces a bridge rejection instead of rendering an empty diff", async () => {
    vi.spyOn(bridge, "getRevision").mockRejectedValue({
      code: "GET_REVISION_FAILED",
      message: "Failed to get revision for plan '00021' (404 Not Found)",
      details: null,
    });

    render(<PlanRevisionDiff planId="00021" revisionCount={2} />);

    await waitFor(() =>
      expect(screen.getByTestId("diff-error")).toHaveTextContent(/Failed to get revision/),
    );
    expect(screen.queryByTestId("plan-diff-view")).not.toBeInTheDocument();
  });

  it("says so when the two chosen revisions are identical", async () => {
    vi.spyOn(bridge, "getRevision").mockResolvedValue(REV_1);

    render(<PlanRevisionDiff planId="00021" revisionCount={2} />);

    await waitFor(() => expect(screen.getByTestId("diff-identical")).toBeInTheDocument());
  });
});
