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

  it("shows the chat's name as the only thing in the title area", () => {
    render(<ChatHeader {...headerProps} />);

    expect(screen.getByRole("heading", { name: "Planning" })).toBeInTheDocument();
    // No message count and no streaming pill: V1's header carries the name and nothing else.
    expect(screen.queryByText(/message/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Streaming/)).not.toBeInTheDocument();
  });

  it("keeps the options menu out of the header until a session is selected", () => {
    const { rerender } = render(<ChatHeader {...headerProps} />);
    expect(screen.queryByRole("button", { name: /Chat options/i })).not.toBeInTheDocument();

    rerender(<ChatHeader {...headerProps} editable />);
    expect(screen.getByRole("button", { name: /Chat options/i })).toBeInTheDocument();
  });

  it("renames the chat inline from the options menu", () => {
    const onRename = vi.fn();
    render(<ChatHeader {...headerProps} editable onRename={onRename} />);

    fireEvent.click(screen.getByRole("button", { name: /Chat options/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit name/i }));

    const input = screen.getByRole("textbox", { name: /Chat name/i });
    fireEvent.change(input, { target: { value: "Dark mode toggle" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRename).toHaveBeenCalledWith("Dark mode toggle");
  });

  it("offers Delete chat from the options menu and closes it on use", () => {
    const onDelete = vi.fn();
    render(<ChatHeader {...headerProps} editable onDelete={onDelete} />);

    expect(screen.queryByRole("menuitem", { name: /Delete chat/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Chat options/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete chat/i }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: /Delete chat/i })).not.toBeInTheDocument();
  });

  it("starts a new chat from the header button", () => {
    const onNewChat = vi.fn();
    render(<ChatHeader {...headerProps} onNewChat={onNewChat} />);

    fireEvent.click(screen.getByRole("button", { name: /New chat/i }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
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
    expect(within(list).getByText("Spawned Jobs (1)")).toBeInTheDocument();

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
});

describe("system event rows", () => {
  it("renders a completion as a timeline note with a plan link, not a bubble", () => {
    const onOpenPlan = vi.fn();
    render(
      <ChatMessageRow
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
