import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ChatHeader } from "../src/views/ChatHeader";
import { ChatMessageRow } from "../src/views/ChatMessageRow";
import { isCompletedJob, isFailedJob, isRunningJob, resolveJobState } from "../src/utils/jobStatus";
import type { Job, JobStatus } from "../src/types/api";
import type { ChatMessage } from "../src/types/chat";

// Radix's popover collision detection is slow under jsdom, and this file opens one per test.
vi.setConfig({ testTimeout: 120_000 });
const POPOVER_TIMEOUT = { timeout: 60_000 };

const job = (id: string, status: JobStatus, extra: Partial<Job> = {}): Job => ({
  id,
  type: "ExecutePlan",
  project: "Ivy-Tendril-V2",
  status,
  ...extra,
});

const systemMessage = (id: string, content: string): ChatMessage => ({
  id,
  role: "system",
  content,
  timestamp: "2026-09-07T12:00:00Z",
});

const headerProps = {
  title: "Planning",
  isGenerating: false,
  autoScrollEnabled: true,
  onToggleAutoScroll: () => {},
};

describe("job status predicates", () => {
  it("treats every pre-terminal status as running", () => {
    for (const status of ["Running", "Pending", "Queued", "Blocked"] as JobStatus[]) {
      expect(isRunningJob(job("j", status))).toBe(true);
    }
    expect(isRunningJob(job("j", "Completed"))).toBe(false);
  });

  it("treats a timeout and a stop as failures", () => {
    expect(isFailedJob(job("j", "Timeout"))).toBe(true);
    expect(isFailedJob(job("j", "Stopped"))).toBe(true);
    expect(isFailedJob(job("j", "Failed"))).toBe(true);
    expect(isCompletedJob(job("j", "Completed"))).toBe(true);
    expect(isFailedJob(job("j", "Completed"))).toBe(false);
  });
});

describe("resolveJobState", () => {
  const finished = systemMessage(
    "s1",
    "[System Event] Job 900 (ExecutePlan) for '00059: Add dark mode' has finished with status: Completed",
  );

  it("prefers the live job list", () => {
    expect(resolveJobState("900", [job("900", "Running")], [finished])).toBe("running");
  });

  it("recovers the outcome from the transcript once the job has aged out", () => {
    expect(resolveJobState("900", [], [finished])).toBe("completed");
    expect(
      resolveJobState(
        "901",
        [],
        [
          systemMessage(
            "s2",
            "[System Event] Job 901 (ExecutePlan) for '00060: X' has finished with status: Failed (RustTest)",
          ),
        ],
      ),
    ).toBe("failed");
  });

  it("is unknown without a job id, a live job or a terminal event", () => {
    expect(resolveJobState(undefined, [job("900", "Running")], [])).toBe("unknown");
    expect(resolveJobState("902", [], [finished])).toBe("unknown");
    expect(
      resolveJobState(
        "903",
        [],
        [
          systemMessage(
            "s3",
            "[System Event] Manual approval granted and execution started for plan '00061: Y' (Job 903)",
          ),
        ],
      ),
    ).toBe("unknown");
  });
});

describe("ChatHeader", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("omits the message count until there is a session", () => {
    const { rerender } = render(<ChatHeader {...headerProps} title="No Active Chat" />);
    expect(screen.queryByText(/message/)).not.toBeInTheDocument();

    rerender(<ChatHeader {...headerProps} messageCount={1} />);
    expect(screen.getByText("1 message")).toBeInTheDocument();

    rerender(<ChatHeader {...headerProps} messageCount={4} />);
    expect(screen.getByText("4 messages")).toBeInTheDocument();
  });

  it("hides the jobs pill until the conversation has started one", () => {
    const { rerender } = render(<ChatHeader {...headerProps} />);
    expect(screen.queryByTestId("chat-jobs-badge")).not.toBeInTheDocument();

    rerender(<ChatHeader {...headerProps} jobs={[job("900", "Running")]} />);
    expect(screen.getByTestId("chat-jobs-badge")).toHaveTextContent("1 running");
  });

  it("counts the failures once nothing is running", () => {
    render(<ChatHeader {...headerProps} jobs={[job("900", "Completed"), job("901", "Failed")]} />);
    expect(screen.getByTestId("chat-jobs-badge")).toHaveTextContent("2 jobs (1 failed)");
  });

  it("opens a job's plan from the list", async () => {
    const onOpenPlan = vi.fn();
    render(
      <ChatHeader
        {...headerProps}
        jobs={[job("900", "Completed", { planId: "00059", planTitle: "Add dark mode" })]}
        onOpenPlan={onOpenPlan}
      />,
    );

    fireEvent.click(screen.getByTestId("chat-jobs-badge"));
    const list = await waitFor(() => screen.getByRole("dialog"), POPOVER_TIMEOUT);
    expect(within(list).getByText("Spawned jobs (1)")).toBeInTheDocument();

    fireEvent.click(within(list).getByTitle("Open plan"));
    expect(onOpenPlan).toHaveBeenCalledWith("00059");
  });

  it("offers the review action only once every job has finished", async () => {
    const onReviewJobs = vi.fn();
    const { rerender } = render(
      <ChatHeader
        {...headerProps}
        jobs={[job("900", "Completed"), job("901", "Running")]}
        onReviewJobs={onReviewJobs}
      />,
    );

    fireEvent.click(screen.getByTestId("chat-jobs-badge"));
    await waitFor(() => screen.getByRole("dialog"), POPOVER_TIMEOUT);
    expect(screen.queryByTestId("chat-jobs-review")).not.toBeInTheDocument();

    rerender(
      <ChatHeader
        {...headerProps}
        jobs={[job("900", "Completed"), job("901", "Failed")]}
        onReviewJobs={onReviewJobs}
      />,
    );

    fireEvent.click(screen.getByTestId("chat-jobs-review"));
    expect(onReviewJobs).toHaveBeenCalledTimes(1);
    // Acting on the list closes it, so the composer it drafted into is visible.
    await waitFor(
      () => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      POPOVER_TIMEOUT,
    );
  });

  it("renders the agent picker slot and the auto-scroll state", () => {
    const onToggleAutoScroll = vi.fn();
    render(
      <ChatHeader
        {...headerProps}
        autoScrollEnabled={false}
        onToggleAutoScroll={onToggleAutoScroll}
        agentPicker={<button type="button">Agent slot</button>}
      />,
    );

    expect(screen.getByText("Agent slot")).toBeInTheDocument();
    const toggle = screen.getByTestId("chat-autoscroll-toggle");
    expect(toggle).toHaveTextContent("Auto-scroll: OFF");
    fireEvent.click(toggle);
    expect(onToggleAutoScroll).toHaveBeenCalledTimes(1);
  });

  it("shows the streaming indicator only while generating", () => {
    const { rerender } = render(<ChatHeader {...headerProps} />);
    expect(screen.queryByText("Streaming...")).not.toBeInTheDocument();

    rerender(<ChatHeader {...headerProps} isGenerating />);
    expect(screen.getByText("Streaming...")).toBeInTheDocument();
  });
});

describe("system event rows", () => {
  const rowProps = { isCopied: false, onCopy: () => {}, onCreatePlan: () => {} };

  it("renders a completion as a timeline note with a plan link, not a bubble", () => {
    const onOpenPlan = vi.fn();
    render(
      <ChatMessageRow
        {...rowProps}
        onOpenPlan={onOpenPlan}
        message={systemMessage(
          "s1",
          "[System Event] Job 900 (ExecutePlan) for '00059: Add dark mode' has finished with status: Completed. Please review.",
        )}
      />,
    );

    const note = screen.getByTestId("chat-system-event");
    expect(note).toHaveAttribute("data-kind", "completed");
    expect(note).toHaveTextContent("Completed plan");
    // The instructions addressed to the agent are not shown to the reader.
    expect(note).not.toHaveTextContent("Please review");

    fireEvent.click(screen.getByTestId("chat-system-event-plan"));
    expect(onOpenPlan).toHaveBeenCalledWith("00059");
  });

  it("shows the plan as plain text when there is nothing to open it with", () => {
    render(
      <ChatMessageRow
        {...rowProps}
        message={systemMessage(
          "s1",
          "[System Event] Job 900 (ExecutePlan) for '00059: Add dark mode' has finished with status: Failed (NpmTest)",
        )}
      />,
    );

    expect(screen.queryByTestId("chat-system-event-plan")).not.toBeInTheDocument();
    const note = screen.getByTestId("chat-system-event");
    expect(note).toHaveAttribute("data-kind", "failed");
    expect(note).toHaveTextContent("#59 Add dark mode");
    expect(note).toHaveTextContent("NpmTest");
  });

  it("leaves a user message as a bubble", () => {
    render(
      <ChatMessageRow
        {...rowProps}
        message={{
          id: "u1",
          role: "user",
          content: "[System Event] not really",
          timestamp: "2026-09-07T12:00:00Z",
        }}
      />,
    );

    expect(screen.queryByTestId("chat-system-event")).not.toBeInTheDocument();
    expect(screen.getByText("[System Event] not really")).toBeInTheDocument();
  });
});
