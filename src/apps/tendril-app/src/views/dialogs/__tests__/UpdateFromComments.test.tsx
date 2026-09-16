import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SuggestChangesDialog } from "../SuggestChangesDialog";
import { bridge } from "../../../api/bridge";
import type { AppComment } from "../../../utils/appComments";
import { planSummary } from "../../../../tests/fixtures/plan.fixture";
import { job } from "../../../../tests/fixtures/job.fixture";

/**
 * The app-preview half of `SuggestChangesDialog`, which is V1's
 * `Apps/ReviewAction/UpdateFromCommentsDialog`. Handing it `appComments` is what selects it.
 */

const APP_URL = "http://localhost:5173/";

function comment(overrides: Partial<AppComment> = {}): AppComment {
  return {
    id: "c1",
    number: 1,
    tag: "button",
    selector: "div > button:nth-child(1)",
    comment: "This should be green.",
    ...overrides,
  };
}

const plan = planSummary({ id: "00021", state: "Review" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SuggestChangesDialog, app-preview mode", () => {
  it("is V1's Update Plan dialog, counting the comments it will send", () => {
    render(
      <SuggestChangesDialog
        isOpen
        onClose={vi.fn()}
        plan={plan}
        appUrl={APP_URL}
        appComments={[comment(), comment({ id: "c2", number: 2 })]}
      />,
    );

    expect(screen.getByText("Update Plan #00021")).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 comment(s) from the running app will be sent to the agent as a change request.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dialog-confirm")).toHaveTextContent("Update");
  });

  it("groups the comments under the page each was left on, not the page in view", () => {
    const other = "http://localhost:5173/settings";
    render(
      <SuggestChangesDialog
        isOpen
        onClose={vi.fn()}
        plan={plan}
        appUrl={APP_URL}
        appComments={[
          comment(),
          comment({ id: "c2", number: 2, url: other, comment: "Wrong copy here." }),
        ]}
      />,
    );

    const summary = screen.getByTestId("suggest-changes-summary");
    expect(summary).toHaveTextContent(APP_URL);
    expect(summary).toHaveTextContent(other);
  });

  it("names where a comment points: the resolved source, or the selector when nothing resolved", () => {
    render(
      <SuggestChangesDialog
        isOpen
        onClose={vi.fn()}
        plan={plan}
        appUrl={APP_URL}
        appComments={[
          comment({
            debugJson: JSON.stringify({ source: { file: "src/SaveButton.tsx", line: 42 } }),
          }),
          comment({ id: "c2", number: 2, tag: "" }),
        ]}
      />,
    );

    expect(screen.getByText("button · src/SaveButton.tsx:42")).toBeInTheDocument();
    // No source resolved and no tag: V1 falls back to the selector, and to the word "element".
    expect(screen.getByText("element · div > button:nth-child(1)")).toBeInTheDocument();
  });

  it("queues behind the plan's unfinished jobs and says so", async () => {
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "03007", status: "Blocked" });

    render(
      <SuggestChangesDialog
        isOpen
        onClose={vi.fn()}
        plan={plan}
        appUrl={APP_URL}
        appComments={[comment()]}
        planJobs={[
          job({ id: "00158", type: "RetryPlan", status: "Running" }),
          job({ id: "00159", type: "ExecutePlan", status: "Blocked" }),
          // Finished, so nothing waits on it.
          job({ id: "00157", type: "ExecutePlan", status: "Completed" }),
        ]}
      />,
    );

    expect(screen.getByTestId("suggest-changes-queue-note")).toHaveTextContent(
      "already has 2 job(s) in flight",
    );
    const confirm = screen.getByTestId("dialog-confirm");
    expect(confirm).toHaveTextContent("Queue Update");

    fireEvent.click(confirm);

    await waitFor(() => expect(startJob).toHaveBeenCalled());
    expect(startJob.mock.calls[0][0]).toMatchObject({
      type: "RetryPlan",
      folderPath: "00021",
      waitForJobs: ["00158", "00159"],
    });
  });

  it("sends no waitForJobs at all when nothing is in flight", async () => {
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "03007", status: "Queued" });

    render(
      <SuggestChangesDialog
        isOpen
        onClose={vi.fn()}
        plan={plan}
        appUrl={APP_URL}
        appComments={[comment()]}
        planJobs={[job({ status: "Completed" })]}
      />,
    );

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(startJob).toHaveBeenCalled());
    expect(screen.queryByTestId("suggest-changes-queue-note")).not.toBeInTheDocument();
    expect(startJob.mock.calls[0][0]).not.toHaveProperty("waitForJobs");
  });

  it("assembles the change request from the comments when the caller pre-filled none", async () => {
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "03007", status: "Queued" });

    render(
      <SuggestChangesDialog
        isOpen
        onClose={vi.fn()}
        plan={plan}
        appUrl={APP_URL}
        appComments={[comment()]}
      />,
    );

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(startJob).toHaveBeenCalled());
    const sent = startJob.mock.calls[0][0].changeRequest as string;
    expect(sent).toContain(`Feedback from reviewing the running app at ${APP_URL}`);
    expect(sent).toContain(`## ${APP_URL}`);
    expect(sent).toContain("This should be green.");
  });

  /**
   * `AppPreview.CanRequestChanges`: Review, or a retry already in flight. Anything else gets V1's
   * other dialog, whose whole job is to say the comments were not thrown away.
   */
  it("refuses a plan that is not taking changes, and keeps the comments", async () => {
    const startJob = vi.spyOn(bridge, "startJob");

    render(
      <SuggestChangesDialog
        isOpen
        onClose={vi.fn()}
        plan={planSummary({ id: "00021", state: "Completed" })}
        appUrl={APP_URL}
        appComments={[comment(), comment({ id: "c2", number: 2 })]}
      />,
    );

    expect(screen.getByText("Plan #00021 is not taking changes")).toBeInTheDocument();
    expect(screen.getByText(/The 2 comment\(s\) are still here/)).toBeInTheDocument();
    expect(screen.getByTestId("dialog-cancel")).toHaveTextContent("Close");
    expect(screen.queryByTestId("dialog-confirm")).not.toBeInTheDocument();
    expect(startJob).not.toHaveBeenCalled();
  });

  it("still accepts changes while a retry it started is running", () => {
    render(
      <SuggestChangesDialog
        isOpen
        onClose={vi.fn()}
        plan={planSummary({ id: "00021", state: "Executing" })}
        appUrl={APP_URL}
        appComments={[comment()]}
        planJobs={[job({ id: "00158", type: "RetryPlan", status: "Running" })]}
      />,
    );

    expect(screen.getByText("Update Plan #00021")).toBeInTheDocument();
    expect(screen.getByTestId("dialog-confirm")).toHaveTextContent("Queue Update");
  });

  it("surfaces a rejection without closing", async () => {
    vi.spyOn(bridge, "startJob").mockRejectedValue(new Error("Service unavailable"));
    const onClose = vi.fn();

    render(
      <SuggestChangesDialog
        isOpen
        onClose={onClose}
        plan={plan}
        appUrl={APP_URL}
        appComments={[comment()]}
      />,
    );

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Service unavailable"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SuggestChangesDialog, diff-side inline comments", () => {
  it("counts the inline comments in the callout and in the submit label", () => {
    render(<SuggestChangesDialog isOpen onClose={vi.fn()} plan={plan} inlineCommentCount={3} />);

    expect(screen.getByTestId("suggest-changes-inline-note")).toHaveTextContent(
      "3 inline comment(s) on file diffs will be included with your feedback.",
    );
    expect(screen.getByTestId("dialog-confirm")).toHaveTextContent("Request Changes (3 inline)");
  });

  it("submits with an empty field when inline comments carry the request", async () => {
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "03007", status: "Queued" });
    const clearDiffComments = vi.spyOn(bridge, "clearDiffComments").mockResolvedValue(undefined);

    render(<SuggestChangesDialog isOpen onClose={vi.fn()} plan={plan} inlineCommentCount={2} />);

    const confirm = screen.getByTestId("dialog-confirm");
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(startJob).toHaveBeenCalledWith({
        type: "RetryPlan",
        folderPath: "00021",
        changeRequest: "Look at inline comments, implement changes, and come back with a new plan.",
      }),
    );
    // V1's `ClearDraftCommentsAsync`: the comments have been sent, so the drafts go.
    await waitFor(() => expect(clearDiffComments).toHaveBeenCalledWith("00021"));
  });

  it("leaves the draft comments alone when there were none to send", async () => {
    vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "03007", status: "Queued" });
    const clearDiffComments = vi.spyOn(bridge, "clearDiffComments").mockResolvedValue(undefined);

    render(<SuggestChangesDialog isOpen onClose={vi.fn()} plan={plan} />);

    fireEvent.change(screen.getByLabelText("Change request"), { target: { value: "Rename it" } });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(bridge.startJob).toHaveBeenCalled());
    expect(clearDiffComments).not.toHaveBeenCalled();
  });
});
