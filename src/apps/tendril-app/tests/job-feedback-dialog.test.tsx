import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobFeedbackDialog } from "../src/components/JobFeedbackDialog";
import { jobsStore } from "../src/state/jobsStore";
import { bridge } from "../src/api/bridge";

describe("JobFeedbackDialog", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <JobFeedbackDialog
        isOpen={false}
        action="relaunch"
        jobId="00042"
        jobType="ExecutePlan"
        prompt="Fix the bug"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders title, description and prompt for relaunch action", () => {
    render(
      <JobFeedbackDialog
        isOpen={true}
        action="relaunch"
        jobId="00042"
        jobType="ExecutePlan"
        prompt="Fix the bug in parser"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Relaunch Job #00042" })).toBeInTheDocument();
    expect(
      screen.getByText("Relaunch this ExecutePlan entirely from the beginning."),
    ).toBeInTheDocument();
    expect(screen.getByText("Fix the bug in parser")).toBeInTheDocument();
    expect(screen.getByTestId("job-feedback-submit")).toHaveTextContent("Relaunch");
  });

  it("renders title, description and submit label for retry action", () => {
    render(
      <JobFeedbackDialog
        isOpen={true}
        action="retry"
        jobId="00099"
        jobType="ExecutePlan"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Retry Last Step #00099" })).toBeInTheDocument();
    expect(
      screen.getByText("Retry the last step of this ExecutePlan in its worktree."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("job-feedback-submit")).toHaveTextContent("Retry");
  });

  it("submits trimmed feedback when entered", () => {
    const onSubmit = vi.fn();
    render(
      <JobFeedbackDialog
        isOpen={true}
        action="relaunch"
        jobId="00042"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const input = screen.getByTestId("job-feedback-input");
    fireEvent.change(input, { target: { value: "  Please use branch dev  " } });
    fireEvent.click(screen.getByTestId("job-feedback-submit"));

    expect(onSubmit).toHaveBeenCalledWith("Please use branch dev");
  });

  it("submits undefined when feedback is empty or whitespace", () => {
    const onSubmit = vi.fn();
    render(
      <JobFeedbackDialog
        isOpen={true}
        action="retry"
        jobId="00042"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const input = screen.getByTestId("job-feedback-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("job-feedback-submit"));

    expect(onSubmit).toHaveBeenCalledWith(undefined);
  });

  it("calls onClose when Cancel button is clicked", () => {
    const onClose = vi.fn();
    render(
      <JobFeedbackDialog
        isOpen={true}
        action="relaunch"
        jobId="00042"
        onClose={onClose}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("job-feedback-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("jobsStore relaunch and retry actions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates relaunchJob to bridge and refreshes jobs list", async () => {
    const relaunchMock = vi.spyOn(bridge, "relaunchJob").mockResolvedValue({
      status: "Ok",
      jobId: "00050",
    });
    const fetchJobsMock = vi.spyOn(jobsStore, "fetchJobs").mockResolvedValue([]);

    expect(jobsStore.canRelaunchJob()).toBe(true);
    const newId = await jobsStore.relaunchJob("00042", "run with more memory");

    expect(relaunchMock).toHaveBeenCalledWith("00042", "run with more memory");
    expect(fetchJobsMock).toHaveBeenCalled();
    expect(newId).toBe("00050");
  });

  it("delegates retryJob to bridge and refreshes jobs list", async () => {
    const retryMock = vi.spyOn(bridge, "retryJob").mockResolvedValue({
      status: "Ok",
      jobId: "00051",
    });
    const fetchJobsMock = vi.spyOn(jobsStore, "fetchJobs").mockResolvedValue([]);

    expect(jobsStore.canRetryJob()).toBe(true);
    const newId = await jobsStore.retryJob("00042", "retry after timeout");

    expect(retryMock).toHaveBeenCalledWith("00042", "retry after timeout");
    expect(fetchJobsMock).toHaveBeenCalled();
    expect(newId).toBe("00051");
  });
});
