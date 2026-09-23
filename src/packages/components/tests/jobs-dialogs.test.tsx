import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  ClearJobsDialog,
  DebugWithAgentDialog,
  DeleteJobDialog,
  ReportBugDialog,
  RerunJobDialog,
  StopAllJobsDialog,
  describeJobClearPrompt,
  rerunSupportsFeedback,
} from "../src/components/Dialogs/index.ts";
import {
  JobCostSheet,
  JobDebugSheet,
  JobOutputSheet,
  JobPromptSheet,
  buildJobCostBuckets,
  formatJobDebugPrompt,
} from "../src/components/Sheets/index.ts";

/** The Jobs sheets and dialogs: V1's copy, and the rules that decide what can be pressed. */

describe("job confirms", () => {
  it("DeleteJobDialog carries V1's copy and a destructive Delete", () => {
    const onConfirm = vi.fn();
    render(<DeleteJobDialog isOpen onClose={() => {}} onConfirm={onConfirm} />);
    expect(screen.getByTestId("job-delete-dialog")).toHaveTextContent("Delete Job");
    expect(screen.getByTestId("job-delete-dialog")).toHaveTextContent(
      "Are you sure you want to delete this job? This cannot be undone.",
    );
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("StopAllJobsDialog names the count, singular and plural", () => {
    const { rerender } = render(
      <StopAllJobsDialog isOpen onClose={() => {}} onConfirm={() => {}} count={3} />,
    );
    expect(screen.getByTestId("stop-all-dialog")).toHaveTextContent("Stop all 3 active jobs?");
    rerender(<StopAllJobsDialog isOpen onClose={() => {}} onConfirm={() => {}} count={1} />);
    expect(screen.getByTestId("stop-all-dialog")).toHaveTextContent("Stop 1 active job?");
  });

  it("ClearJobsDialog arms nothing until there is a count to confirm", () => {
    expect(describeJobClearPrompt("failed", null)).toMatchObject({
      title: "Clear Failed",
      body: "Counting failed jobs…",
      confirmDisabled: true,
    });
    expect(describeJobClearPrompt("failed", 0).confirmDisabled).toBe(true);
    expect(describeJobClearPrompt("all", 412)).toMatchObject({
      confirmLabel: "Clear 412",
      confirmDisabled: false,
    });

    render(
      <ClearJobsDialog
        isOpen
        onClose={() => {}}
        onConfirm={() => {}}
        scope="failed"
        count={null}
      />,
    );
    expect(screen.getByTestId("dialog-confirm")).toBeDisabled();
  });
});

describe("RerunJobDialog", () => {
  it("offers feedback only where it can be folded in", () => {
    expect(rerunSupportsFeedback({ type: "ExecutePlan" })).toBe(true);
    expect(rerunSupportsFeedback({ type: "CreatePlan" })).toBe(false);
    expect(rerunSupportsFeedback({ type: "CreatePlan", planId: "00412" })).toBe(true);
    expect(rerunSupportsFeedback({ type: "CreatePr" })).toBe(false);
  });

  it("sends trimmed feedback, and none when the box is left empty", async () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <RerunJobDialog
        isOpen
        onClose={() => {}}
        typeLabel="ExecutePlan"
        supportsFeedback
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByTestId("rerun-job-dialog")).toHaveTextContent("Rerun ExecutePlan");
    fireEvent.change(screen.getByTestId("rerun-job-feedback"), {
      target: { value: "  use the other API  " },
    });
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    expect(onConfirm).toHaveBeenLastCalledWith("use the other API");

    rerender(
      <RerunJobDialog
        isOpen
        onClose={() => {}}
        typeLabel="CreatePr"
        supportsFeedback={false}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByTestId("rerun-job-feedback")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await waitFor(() => expect(onConfirm).toHaveBeenLastCalledWith(undefined));
  });
});

describe("ReportBugDialog", () => {
  it("says the report is public, and sends nothing without a description", () => {
    const onSubmit = vi.fn();
    render(<ReportBugDialog isOpen onClose={() => {}} onSubmit={onSubmit} />);
    expect(screen.getByTestId("report-bug-dialog")).toHaveTextContent("public GitHub issue");
    expect(screen.getByTestId("dialog-confirm")).toBeDisabled();

    fireEvent.change(screen.getByTestId("report-bug-description"), {
      target: { value: "It hung" },
    });
    fireEvent.change(screen.getByTestId("report-bug-github-user"), { target: { value: " octo " } });
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    expect(onSubmit).toHaveBeenCalledWith("It hung", "octo");
  });
});

describe("DebugWithAgentDialog", () => {
  it("names the agent and passes the focus through, trimmed", () => {
    const onConfirm = vi.fn();
    render(
      <DebugWithAgentDialog isOpen onClose={() => {}} agentLabel="Codex" onConfirm={onConfirm} />,
    );
    expect(screen.getByTestId("debug-with-agent-dialog")).toHaveTextContent("Debug with Codex");
    fireEvent.change(screen.getByTestId("debug-with-agent-focus"), {
      target: { value: " the timeout " },
    });
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledWith("the timeout");
  });

  it("builds V1's prompt, in English, from the Copy Details block", () => {
    const prompt = formatJobDebugPrompt(
      { id: "01184", type: "ExecutePlan", status: "Failed", project: "Tendril" },
      "the timeout",
    );
    expect(prompt).toMatch(/^I want to debug job 01184 /);
    expect(prompt).toContain("/tendril-debug-job");
    expect(prompt).toContain("In particular, focus on: the timeout");
    expect(prompt).toContain("Job Id: 01184");
  });
});

describe("Jobs sheets", () => {
  it("JobCostSheet lists the reported buckets and marks an estimate", () => {
    expect(buildJobCostBuckets({ inputTokens: 10, cacheWriteTokens: undefined })).toEqual([
      { kind: "input", tokens: 10 },
    ]);
    render(
      <JobCostSheet
        isOpen
        onClose={() => {}}
        title="Cost & Tokens"
        job={{
          type: "ExecutePlan",
          cost: 1.5,
          costSource: "estimated",
          inputTokens: 1000,
          cacheReadTokens: 2000,
        }}
        formatType={(type) => `label:${type}`}
      />,
    );
    expect(screen.getByTestId("job-cost-breakdown")).toHaveTextContent("Cache read");
    expect(screen.getByTestId("job-cost-sheet")).toHaveTextContent("~$1.5000");
    expect(screen.getByTestId("job-cost-sheet")).toHaveTextContent("label:ExecutePlan");
  });

  it("JobPromptSheet says so when a job carries no prompt", () => {
    render(<JobPromptSheet isOpen onClose={() => {}} prompt="   " />);
    expect(screen.getByTestId("job-prompt-sheet")).toHaveTextContent("Full Prompt");
    expect(screen.getByTestId("job-prompt-empty")).toBeInTheDocument();
  });

  it("JobOutputSheet renders its body, or V1's callout for a job with none", () => {
    const { rerender } = render(
      <JobOutputSheet isOpen onClose={() => {}} title="ExecutePlan 00412">
        <div data-testid="fake-body">log</div>
      </JobOutputSheet>,
    );
    expect(screen.getByTestId("fake-body")).toBeInTheDocument();

    rerender(
      <JobOutputSheet
        isOpen
        onClose={() => {}}
        title="ExecutePlan 00412"
        status={{ status: "Blocked" }}
      />,
    );
    expect(screen.getByTestId("job-status-callout")).toHaveTextContent("Job Blocked");
    expect(screen.getByTestId("job-status-callout")).toHaveTextContent(
      "Waiting for dependencies or preceding jobs to complete.",
    );

    rerender(<JobOutputSheet isOpen onClose={() => {}} title="Job Output" />);
    expect(screen.getByTestId("job-output-empty")).toHaveTextContent("No output available.");
  });

  it("JobDebugSheet shows Report Bug and Debug with {agent} only when asked to", () => {
    const job = { id: "01184", type: "ExecutePlan", status: "Failed", project: "Tendril" };
    const onReportBug = vi.fn();
    const { rerender } = render(<JobDebugSheet isOpen onClose={() => {}} job={job} />);
    expect(screen.queryByTestId("job-debug-report-bug")).not.toBeInTheDocument();
    expect(screen.queryByTestId("job-debug-with-agent")).not.toBeInTheDocument();

    rerender(
      <JobDebugSheet
        isOpen
        onClose={() => {}}
        job={job}
        onReportBug={onReportBug}
        onDebugWithAgent={() => {}}
        debugAgentLabel="Claude"
      />,
    );
    fireEvent.click(screen.getByTestId("job-debug-report-bug"));
    expect(onReportBug).toHaveBeenCalled();
    expect(screen.getByTestId("job-debug-with-agent")).toHaveTextContent("Debug with Claude");
  });
});
