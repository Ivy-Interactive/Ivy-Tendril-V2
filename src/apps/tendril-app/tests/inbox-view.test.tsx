import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { InboxView } from "../src/views/InboxView";
import { bridge } from "../src/api/bridge";
import type {
  GitHubIssue,
  GitHubIssuesPage,
  InboxProposal,
  ProjectSummary,
  SweepReport,
} from "../src/types/api";

const makePage = (
  issues: GitHubIssue[],
  overrides: Partial<GitHubIssuesPage> = {},
): GitHubIssuesPage => ({
  issues,
  totalCount: issues.length,
  page: 1,
  perPage: 50,
  hasMore: false,
  ...overrides,
});

/**
 * V1's `IssuesTableView` sets `c.BatchSize = 50`, so that is the page the view asks the daemon for.
 */
const PAGE_SIZE = 50;

/** A table row by its `data-row-id`, which the DataTable sets from `getRowId` (the issue number). */
const issueRow = (number: number): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-row-id="${number}"]`);

describe("InboxView Component & Triage Tests", () => {
  let listGitHubIssuesSpy: MockInstance;
  let listInboxProposalsSpy: MockInstance;

  const mockProjects: ProjectSummary[] = [
    {
      name: "Tendril-App",
      repos: ["/Users/test/.tendril/Projects/Tendril-App/Repos/SpaceCorps/Tendril-App"],
      verifications: ["RustClippy", "RustBuild", "RustTest"],
    },
  ];

  const mockIssues: GitHubIssue[] = [
    {
      number: 101,
      title: "Add offline cache for plans",
      body: "Operators need offline caching when service disconnects.",
      state: "open",
      author: { login: "alice", name: "Alice Developer" },
      assignees: [{ login: "alice" }],
      labels: [
        { id: "l1", name: "feature", color: "a2eeef", description: "New feature" },
        { id: "l2", name: "priority-high", color: "b60205" },
      ],
      commentsCount: 5,
      createdAt: "2026-09-01T10:00:00Z",
      updatedAt: "2026-09-02T12:00:00Z",
      url: "https://github.com/SpaceCorps/Tendril-App/issues/101",
      repository: { name: "Tendril-App", nameWithOwner: "SpaceCorps/Tendril-App" },
      isPullRequest: false,
    },
    {
      number: 102,
      title: "Fix dark mode contrast on badges",
      body: "Label text is unreadable against light backgrounds.",
      state: "open",
      author: { login: "bob", name: "Bob Smith" },
      assignees: [{ login: "carol" }],
      labels: [{ id: "l3", name: "bug", color: "d73a4a" }],
      commentsCount: 2,
      createdAt: "2026-09-03T14:00:00Z",
      updatedAt: "2026-09-03T15:00:00Z",
      url: "https://github.com/SpaceCorps/Tendril-App/issues/102",
      repository: { name: "Tendril-App", nameWithOwner: "SpaceCorps/Tendril-App" },
      isPullRequest: false,
    },
  ];

  beforeEach(() => {
    listGitHubIssuesSpy = vi
      .spyOn(bridge, "listGitHubIssues")
      .mockResolvedValue(makePage(mockIssues, { hasMore: true, totalCount: 60 }));
    vi.spyOn(bridge, "loadUiState").mockResolvedValue(null);
    vi.spyOn(bridge, "saveUiState").mockResolvedValue(undefined);
    // The view fetches pending proposals on mount independently of the issue list, so every test
    // needs this stubbed even when it is not what is being asserted.
    listInboxProposalsSpy = vi.spyOn(bridge, "listInboxProposals").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The table (and with it the pagination footer) is unmounted while the first load is in flight,
  // so a spy assertion alone is not enough to know the controls are clickable — the spy fires
  // before the fetch settles.
  const waitForInboxIdle = async () => {
    await waitFor(() => {
      expect(screen.queryByTestId("inbox-loading")).not.toBeInTheDocument();
      expect(screen.getByTestId("inbox-issue-table")).toBeInTheDocument();
    });
  };

  it("renders the category rail and responds to category selection changes", async () => {
    render(<InboxView projects={mockProjects} />);

    // V1's `SidebarView` rows, with V1's labels: "My issues", "Reviews", and one row per project
    // under an expandable "Projects".
    expect(screen.getByTestId("inbox-view")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /my issues/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^reviews$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /projects/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Tendril-App" })).toBeInTheDocument();

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 1, PAGE_SIZE);
    });

    fireEvent.click(screen.getByRole("tab", { name: /^reviews$/i }));

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "review-requests", 1, PAGE_SIZE);
    });

    fireEvent.click(screen.getByRole("tab", { name: "Tendril-App" }));

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(
        mockProjects[0].repos[0],
        "project-issues",
        1,
        PAGE_SIZE,
      );
    });
  });

  it("renders one table row per issue, with V1's Issue, Repository, Labels and Assignees columns", async () => {
    render(<InboxView projects={mockProjects} />);

    await waitFor(() => {
      expect(issueRow(101)).not.toBeNull();
      expect(issueRow(102)).not.toBeNull();
    });

    const table = screen.getByTestId("inbox-issue-table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim());
    expect(headers).toEqual(expect.arrayContaining(["Issue", "Repository", "Labels", "Assignees"]));

    const row101 = issueRow(101)!;
    expect(within(row101).getByText("#101 Add offline cache for plans")).toBeInTheDocument();
    expect(within(row101).getByText("SpaceCorps/Tendril-App")).toBeInTheDocument();
    expect(within(row101).getByText("feature")).toBeInTheDocument();
    expect(within(row101).getByText("priority-high")).toBeInTheDocument();
    expect(within(row101).getByText("alice")).toBeInTheDocument();
  });

  it("filters issues by search keyword, label selection, and assignee selection", async () => {
    render(<InboxView projects={mockProjects} />);

    await waitFor(() => {
      expect(issueRow(101)).not.toBeNull();
      expect(issueRow(102)).not.toBeNull();
    });

    const searchInput = screen.getByRole("searchbox", { name: /search issues/i });

    // Filter by title keyword
    fireEvent.change(searchInput, { target: { value: "contrast" } });
    expect(issueRow(101)).toBeNull();
    expect(issueRow(102)).not.toBeNull();

    // Reset search
    fireEvent.change(searchInput, { target: { value: "" } });
    expect(issueRow(101)).not.toBeNull();
    expect(issueRow(102)).not.toBeNull();

    // The Labels column's filter, which V1 gets from `c.AllowFiltering = true`.
    fireEvent.click(screen.getByRole("button", { name: "Filter by label..." }));
    fireEvent.click(screen.getByRole("option", { name: "bug" }));
    expect(issueRow(101)).toBeNull();
    expect(issueRow(102)).not.toBeNull();

    // A multi-select keeps its menu open, so the same option toggles the filter back off.
    fireEvent.click(screen.getByRole("option", { name: "bug" }));
    expect(issueRow(101)).not.toBeNull();
    fireEvent.mouseDown(document.body);

    // The Assignees column's filter.
    fireEvent.click(screen.getByRole("button", { name: "Filter by assignee..." }));
    fireEvent.click(screen.getByRole("option", { name: "alice" }));
    expect(issueRow(101)).not.toBeNull();
    expect(issueRow(102)).toBeNull();
  });

  it("opens the New Plan dialog prefilled when a single issue is fired off in Tendril", async () => {
    const handleOpenModal = vi.fn();
    render(<InboxView projects={mockProjects} onOpenNewPlanModal={handleOpenModal} />);

    await waitFor(() => expect(issueRow(101)).not.toBeNull());

    // V1's first row action, in V1's order and with V1's label.
    const actions = within(issueRow(101)!).getAllByRole("button");
    expect(actions.map((b) => b.getAttribute("aria-label")).filter(Boolean)).toEqual([
      "Fire off in Tendril",
      "View Details",
      "Open in GitHub",
    ]);

    fireEvent.click(within(issueRow(101)!).getByRole("button", { name: "Fire off in Tendril" }));

    expect(handleOpenModal).toHaveBeenCalledTimes(1);
    const prefillArg = handleOpenModal.mock.calls[0][0];
    expect(prefillArg.title).toBe("Add offline cache for plans");
    expect(prefillArg.description).toContain("Task from GitHub Issue #101");
    expect(prefillArg.description).toContain("Operators need offline caching");
    expect(prefillArg.sourceUrl).toBe("https://github.com/SpaceCorps/Tendril-App/issues/101");
    expect(prefillArg.project).toBe("Tendril-App");
  });

  it("fires off a multi-issue selection straight through, as V1's bulk button does", async () => {
    const startJobSpy = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "00042", status: "Queued" });
    render(<InboxView projects={mockProjects} />);

    await waitFor(() => expect(issueRow(101)).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    expect(screen.getByTestId("inbox-selection-summary")).toHaveTextContent("2 of 2 selected");

    fireEvent.click(screen.getByRole("button", { name: /Fire off in Tendril \(2\)/ }));

    await waitFor(() => {
      expect(startJobSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("inbox-fire-notice")).toHaveTextContent(
        "Fired off 2 issues in Tendril",
      );
    });
    expect(startJobSpy.mock.calls[0][0]).toMatchObject({
      type: "CreatePlan",
      project: "Tendril-App",
      sourceUrl: "https://github.com/SpaceCorps/Tendril-App/issues/101",
    });
    // V1 drops the fired issues from the selection.
    expect(screen.getByTestId("inbox-selection-summary")).toHaveTextContent("0 of 2 selected");
  });

  it("hands the selected issues to chat as V1's InboxChatPrompt does", async () => {
    const onOpenChat = vi.fn();
    render(<InboxView projects={mockProjects} onOpenChat={onOpenChat} />);

    await waitFor(() => expect(issueRow(101)).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    fireEvent.click(screen.getByTestId("inbox-open-chat"));

    expect(onOpenChat).toHaveBeenCalledTimes(1);
    const [prompt, title] = onOpenChat.mock.calls[0];
    expect(prompt).toContain("Let's discuss 2 GitHub issues I selected in the Tendril Inbox.");
    expect(prompt).toContain("## SpaceCorps/Tendril-App#101: Add offline cache for plans");
    expect(prompt).toContain("Labels: feature, priority-high");
    expect(prompt).toContain("Assignees: alice");
    expect(title).toBe("2 issues");
  });

  it("displays V1's empty state when the category has no issues", async () => {
    vi.spyOn(bridge, "listGitHubIssues").mockResolvedValue(makePage([]));
    render(<InboxView projects={mockProjects} />);

    // `NoContentView("No Issues Found", "No issues match the selected view.")`.
    await waitFor(() => {
      expect(screen.getByTestId("inbox-empty")).toBeInTheDocument();
      expect(screen.getByText("No Issues Found")).toBeInTheDocument();
      expect(screen.getByText("No issues match the selected view.")).toBeInTheDocument();
    });
  });

  it("uses V1's Reviews wording when no pull request needs review", async () => {
    vi.spyOn(bridge, "listGitHubIssues").mockResolvedValue(makePage([]));
    render(<InboxView projects={mockProjects} />);

    fireEvent.click(screen.getByRole("tab", { name: /^reviews$/i }));

    // `NoContentView("All Caught Up!", "No pull requests currently require your review.")`.
    await waitFor(() => {
      expect(screen.getByText("All Caught Up!")).toBeInTheDocument();
      expect(
        screen.getByText("No pull requests currently require your review."),
      ).toBeInTheDocument();
    });
  });

  it("displays error state when bridge call rejects", async () => {
    vi.spyOn(bridge, "listGitHubIssues").mockRejectedValue({
      code: "UNAUTHENTICATED",
      message: "GitHub CLI is not authenticated. Please run 'gh auth login'",
    });

    render(<InboxView projects={mockProjects} />);

    await waitFor(() => {
      expect(screen.getByTestId("inbox-error")).toBeInTheDocument();
      expect(screen.getByText(/github cli is not authenticated/i)).toBeInTheDocument();
      expect(screen.getByText("$ gh auth login")).toBeInTheDocument();
    });
  });

  it("supports paging forward and backward through results via the table's own footer", async () => {
    render(<InboxView projects={mockProjects} />);

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 1, PAGE_SIZE);
    });
    await waitForInboxIdle();

    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 2, PAGE_SIZE);
    });
    await waitForInboxIdle();

    fireEvent.click(screen.getByRole("button", { name: /previous page/i }));

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenLastCalledWith(undefined, "my-issues", 1, PAGE_SIZE);
    });
    await waitForInboxIdle();
    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();
  });

  it("resets to the first page and requests the new page size when the page size changes", async () => {
    render(<InboxView projects={mockProjects} />);

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 1, PAGE_SIZE);
    });
    await waitForInboxIdle();

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 2, PAGE_SIZE);
    });
    await waitForInboxIdle();

    fireEvent.change(screen.getByLabelText(/rows per page/i), { target: { value: "25" } });

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenLastCalledWith(undefined, "my-issues", 1, 25);
    });
  });

  it("resets to the first page when a search filter is applied while viewing a later page", async () => {
    render(<InboxView projects={mockProjects} />);

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 1, PAGE_SIZE);
    });
    await waitForInboxIdle();

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 2, PAGE_SIZE);
    });
    await waitForInboxIdle();

    fireEvent.change(screen.getByRole("searchbox", { name: /search issues/i }), {
      target: { value: "bug" },
    });

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenLastCalledWith(undefined, "my-issues", 1, PAGE_SIZE);
    });
  });

  describe("background polling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("silently refetches on the configured interval and stops once disabled", async () => {
      render(<InboxView projects={mockProjects} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(listGitHubIssuesSpy).toHaveBeenCalledTimes(1);

      fireEvent.change(screen.getByLabelText(/auto-refresh interval/i), {
        target: { value: "30s" },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(listGitHubIssuesSpy).toHaveBeenCalledTimes(2);

      fireEvent.change(screen.getByLabelText(/auto-refresh interval/i), {
        target: { value: "off" },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(listGitHubIssuesSpy).toHaveBeenCalledTimes(2);
    });

    it("clears the polling interval on unmount", async () => {
      const { unmount } = render(<InboxView projects={mockProjects} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(listGitHubIssuesSpy).toHaveBeenCalledTimes(1);

      fireEvent.change(screen.getByLabelText(/auto-refresh interval/i), {
        target: { value: "30s" },
      });

      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(listGitHubIssuesSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("auto-accept settings", () => {
    it("opens the settings dialog from V1's gear, which is the only path to the check interval", async () => {
      vi.spyOn(bridge, "getConfig").mockResolvedValue({
        codingAgent: "claude",
        inbox: { autoAcceptAssignedIssues: true, checkIntervalMinutes: 30 },
      });

      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();

      fireEvent.click(await screen.findByTestId("inbox-auto-accept-settings"));

      // The interval had no reachable control at all before this dialog existed.
      const select = (await screen.findByLabelText("Check Interval")) as HTMLSelectElement;
      expect(select.value).toBe("30");
    });

    it("re-reads the badge after a save rather than assuming what was written", async () => {
      const getConfig = vi
        .spyOn(bridge, "getConfig")
        .mockResolvedValue({ codingAgent: "claude", inbox: { autoAcceptAssignedIssues: false } });
      vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);

      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();
      await waitFor(() =>
        expect(screen.getByTestId("inbox-auto-accept")).toHaveTextContent("Auto-Accept: Off"),
      );

      fireEvent.click(screen.getByTestId("inbox-auto-accept-settings"));
      fireEvent.click(await screen.findByLabelText("Auto-Accept Assigned Issues"));

      // The badge's own re-read is what turns it on, so the service stays the source of truth.
      getConfig.mockResolvedValue({
        codingAgent: "claude",
        inbox: { autoAcceptAssignedIssues: true },
      });
      fireEvent.click(screen.getByTestId("dialog-confirm"));

      await waitFor(() =>
        expect(screen.getByTestId("inbox-auto-accept")).toHaveTextContent("Auto-Accept: On"),
      );
    });

    it("refetches the proposals a check imported, since the list behind the dialog is now stale", async () => {
      vi.spyOn(bridge, "getConfig").mockResolvedValue({ codingAgent: "claude", inbox: {} });
      vi.spyOn(bridge, "checkInbox").mockResolvedValue({
        imported: [],
        accepted: 0,
        skipped: 0,
        errors: [],
        outcome: "Ran",
      });

      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();
      await waitFor(() => expect(listInboxProposalsSpy).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByTestId("inbox-auto-accept-settings"));
      fireEvent.click(await screen.findByTestId("auto-accept-check-now"));

      await waitFor(() => expect(listInboxProposalsSpy).toHaveBeenCalledTimes(2));
    });
  });

  describe("imported proposals", () => {
    const proposal = (id: number, number: number): InboxProposal => ({
      id,
      number,
      repository: "SpaceCorps/Tendril-App",
      title: `Swept issue ${number}`,
      body: "Assigned to me by someone else.",
      issueUrl: `https://github.com/SpaceCorps/Tendril-App/issues/${number}`,
      project: "Tendril-App",
      state: "Pending",
      discovered: "2026-09-10T09:00:00Z",
      updated: "2026-09-10T09:00:00Z",
    });

    const report = (overrides: Partial<SweepReport> = {}): SweepReport => ({
      imported: [],
      accepted: 0,
      skipped: 0,
      errors: [],
      outcome: "Ran",
      ...overrides,
    });

    it("hides the panel entirely when nothing has been imported", async () => {
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => {
        expect(listInboxProposalsSpy).toHaveBeenCalled();
      });
      expect(screen.queryByTestId("inbox-proposals")).not.toBeInTheDocument();
      // The manual trigger is always available: it is how a user gets the first proposal.
      expect(screen.getByTestId("inbox-check-now")).toBeInTheDocument();
    });

    it("renders a card per pending proposal with its repo and target project", async () => {
      listInboxProposalsSpy.mockResolvedValue([proposal(1, 101), proposal(2, 102)]);
      render(<InboxView projects={mockProjects} />);

      const card = await waitFor(() => screen.getByTestId("proposal-card-1"));
      expect(within(card).getByText(/#101 Swept issue 101/)).toBeInTheDocument();
      expect(within(card).getByText(/SpaceCorps\/Tendril-App/)).toBeInTheDocument();
      expect(within(card).getByText(/Tendril-App/)).toBeInTheDocument();
      expect(screen.getByTestId("proposal-card-2")).toBeInTheDocument();
      expect(screen.getByTestId("accept-proposal-1")).toBeInTheDocument();
      expect(screen.getByTestId("dismiss-proposal-1")).toBeInTheDocument();
    });

    it("runs a check and refetches proposals, reporting what the sweep did", async () => {
      const checkInboxSpy = vi
        .spyOn(bridge, "checkInbox")
        .mockResolvedValue(report({ imported: [proposal(1, 101)], skipped: 3 }));
      listInboxProposalsSpy.mockResolvedValueOnce([]).mockResolvedValueOnce([proposal(1, 101)]);

      render(<InboxView projects={mockProjects} />);
      await waitFor(() => {
        expect(listInboxProposalsSpy).toHaveBeenCalledTimes(1);
      });

      fireEvent.click(screen.getByTestId("inbox-check-now"));

      await waitFor(() => {
        expect(checkInboxSpy).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("proposal-card-1")).toBeInTheDocument();
      });
      expect(screen.getByTestId("inbox-check-summary")).toHaveTextContent("Imported 1, skipped 3.");
    });

    it("says so when a sweep is already in flight rather than reporting an empty import", async () => {
      vi.spyOn(bridge, "checkInbox").mockResolvedValue(report({ outcome: "AlreadyRunning" }));
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => {
        expect(screen.getByTestId("inbox-check-now")).toBeEnabled();
      });
      fireEvent.click(screen.getByTestId("inbox-check-now"));

      await waitFor(() => {
        expect(screen.getByTestId("inbox-check-summary")).toHaveTextContent(
          "A check is already running.",
        );
      });
    });

    it("surfaces a failed check without blanking the issue list", async () => {
      vi.spyOn(bridge, "checkInbox").mockRejectedValue({
        code: "CONFLICT",
        message: "This daemon is not the master",
      });
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => {
        expect(issueRow(101)).not.toBeNull();
      });
      fireEvent.click(screen.getByTestId("inbox-check-now"));

      await waitFor(() => {
        expect(screen.getByTestId("inbox-proposal-error")).toHaveTextContent(/not the master/i);
      });
      // The GitHub issues below are unaffected: the two fetches are independent.
      expect(issueRow(101)).not.toBeNull();
      expect(screen.queryByTestId("inbox-error")).not.toBeInTheDocument();
    });

    it("accepts a proposal and drops it from the panel once it is no longer pending", async () => {
      const acceptSpy = vi
        .spyOn(bridge, "acceptInboxProposal")
        .mockResolvedValue({ jobId: "00042" });
      listInboxProposalsSpy.mockResolvedValueOnce([proposal(1, 101)]).mockResolvedValueOnce([]);

      render(<InboxView projects={mockProjects} />);
      await waitFor(() => screen.getByTestId("accept-proposal-1"));

      fireEvent.click(screen.getByTestId("accept-proposal-1"));

      await waitFor(() => {
        expect(acceptSpy).toHaveBeenCalledWith(1);
        expect(screen.queryByTestId("inbox-proposals")).not.toBeInTheDocument();
      });
    });

    it("dismisses a proposal and refetches", async () => {
      const dismissSpy = vi.spyOn(bridge, "dismissInboxProposal").mockResolvedValue(undefined);
      listInboxProposalsSpy.mockResolvedValueOnce([proposal(1, 101)]).mockResolvedValueOnce([]);

      render(<InboxView projects={mockProjects} />);
      await waitFor(() => screen.getByTestId("dismiss-proposal-1"));

      fireEvent.click(screen.getByTestId("dismiss-proposal-1"));

      await waitFor(() => {
        expect(dismissSpy).toHaveBeenCalledWith(1);
        expect(listInboxProposalsSpy).toHaveBeenCalledTimes(2);
      });
    });

    it("keeps the proposal on screen and shows why when a decision fails", async () => {
      vi.spyOn(bridge, "acceptInboxProposal").mockRejectedValue({
        code: "CONFLICT",
        message: "Inbox proposal 1 is already Accepted",
      });
      listInboxProposalsSpy.mockResolvedValue([proposal(1, 101)]);

      render(<InboxView projects={mockProjects} />);
      await waitFor(() => screen.getByTestId("accept-proposal-1"));

      fireEvent.click(screen.getByTestId("accept-proposal-1"));

      await waitFor(() => {
        expect(screen.getByTestId("inbox-proposal-error")).toHaveTextContent(/already Accepted/);
      });
      expect(screen.getByTestId("proposal-card-1")).toBeInTheDocument();
    });

    it("does not blank the issue list when the proposals route is unavailable", async () => {
      // An older daemon that has never heard of `/api/inbox/proposals`.
      listInboxProposalsSpy.mockRejectedValue({
        code: "LIST_INBOX_PROPOSALS_FAILED",
        message: "404 Not Found",
      });
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => {
        expect(screen.getByTestId("inbox-proposal-error")).toBeInTheDocument();
      });
      expect(issueRow(101)).not.toBeNull();
      expect(screen.queryByTestId("inbox-proposals")).not.toBeInTheDocument();
    });
  });
});
