import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreatePrDialog } from "../CreatePrDialog";
import { bridge } from "../../../api/bridge";
import { planSummary, verification } from "../../../../tests/fixtures/plan.fixture";

// `canCreatePr` refuses a plan with a failing or pending verification, and the
// shared fixture ships one of each — so the plan under test is an all-green one.
const plan = planSummary({
  id: "00021",
  state: "Review",
  verifications: [verification("NpmLint", "Pass"), verification("RustTest", "Pass")],
});

function mockStartJob() {
  return vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "03007" });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CreatePrDialog option pass-through", () => {
  it("dispatches the promptware defaults when nothing is changed", async () => {
    const startJob = mockStartJob();
    const onJobStarted = vi.fn();

    render(<CreatePrDialog isOpen onClose={vi.fn()} plan={plan} onJobStarted={onJobStarted} />);

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(startJob).toHaveBeenCalledWith({
        type: "CreatePr",
        folderPath: "00021",
        merge: true,
        draft: false,
        deleteBranch: true,
        includeArtifacts: true,
        solveMergeConflicts: true,
      }),
    );
    await waitFor(() => expect(onJobStarted).toHaveBeenCalledWith({ jobId: "03007" }));
  });

  it("flips exactly the keys the operator toggled and nothing else", async () => {
    const startJob = mockStartJob();

    render(<CreatePrDialog isOpen onClose={vi.fn()} plan={plan} />);

    fireEvent.click(screen.getByLabelText(/Merge when checks pass/));
    fireEvent.click(screen.getByLabelText(/Open as draft/));
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(startJob).toHaveBeenCalledWith({
        type: "CreatePr",
        folderPath: "00021",
        merge: false,
        draft: true,
        deleteBranch: true,
        includeArtifacts: true,
        solveMergeConflicts: true,
      }),
    );
  });

  it("splits a comma-separated reviewer list into an array", async () => {
    const startJob = mockStartJob();

    render(<CreatePrDialog isOpen onClose={vi.fn()} plan={plan} />);

    fireEvent.change(screen.getByLabelText("Reviewers"), { target: { value: "a, b" } });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(startJob).toHaveBeenCalled());
    expect(startJob.mock.calls[0][0]).toMatchObject({ reviewers: ["a", "b"] });
  });

  it("omits an empty comment and an empty reviewer list rather than sending blanks", async () => {
    const startJob = mockStartJob();

    render(<CreatePrDialog isOpen onClose={vi.fn()} plan={plan} />);

    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Reviewers"), { target: { value: " , " } });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(startJob).toHaveBeenCalled());
    const args = startJob.mock.calls[0][0];
    expect(args).not.toHaveProperty("comment");
    expect(args).not.toHaveProperty("reviewers");
  });

  it("passes a typed comment through", async () => {
    const startJob = mockStartJob();

    render(<CreatePrDialog isOpen onClose={vi.fn()} plan={plan} />);

    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "Read the guard chain first." },
    });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(startJob).toHaveBeenCalled());
    expect(startJob.mock.calls[0][0]).toMatchObject({ comment: "Read the guard chain first." });
  });

  it("offers no assignee field — V2 folds an assignee into the reviewer list", () => {
    render(<CreatePrDialog isOpen onClose={vi.fn()} plan={plan} />);

    expect(screen.queryByLabelText(/assignee/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no separate assignee field/i)).toBeInTheDocument();
  });

  it("dispatches nothing until the operator confirms", () => {
    const startJob = mockStartJob();

    render(<CreatePrDialog isOpen onClose={vi.fn()} plan={plan} />);
    fireEvent.click(screen.getByLabelText(/Open as draft/));

    expect(startJob).not.toHaveBeenCalled();
  });

  it("surfaces a rejection in the dialog and stays open", async () => {
    vi.spyOn(bridge, "startJob").mockRejectedValue({
      code: "Conflict",
      message: "A job is already running for plan 00021",
    });
    const onClose = vi.fn();

    render(<CreatePrDialog isOpen onClose={onClose} plan={plan} />);
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "A job is already running for plan 00021",
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("surfaces the client-side gate's reason rather than dispatching a doomed job", async () => {
    const startJob = mockStartJob();

    render(
      <CreatePrDialog
        isOpen
        onClose={vi.fn()}
        plan={planSummary({
          id: "00021",
          state: "Review",
          verifications: [verification("RustTest", "Fail")],
        })}
      />,
    );

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("verifications failed (RustTest)"),
    );
    expect(startJob).not.toHaveBeenCalled();
  });
});
