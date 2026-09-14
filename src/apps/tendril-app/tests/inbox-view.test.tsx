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
  perPage: 25,
  hasMore: false,
  ...overrides,
});

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

  // The pagination bar is unmounted while `isLoading` is true and its buttons are
  // disabled during a refetch, so a spy assertion alone is not enough to know the
  // controls are clickable — the spy fires before the fetch settles.
  const waitForInboxIdle = async () => {
    await waitFor(() => {
      expect(screen.queryByTestId("inbox-loading")).not.toBeInTheDocument();
      expect(screen.getByTestId("inbox-pagination")).toBeInTheDocument();
    });
  };

  it("renders category switcher and responds to category selection changes", async () => {
    render(<InboxView projects={mockProjects} />);

    expect(screen.getByTestId("inbox-view")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /my issues/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /review requests/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /project issues/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 1, 25);
    });

    // Switch to Review Requests
    const reviewRequestsTab = screen.getByRole("tab", { name: /review requests/i });
    fireEvent.click(reviewRequestsTab);

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "review-requests", 1, 25);
    });

    // Switch to Project Issues
    const projectIssuesTab = screen.getByRole("tab", { name: /project issues/i });
    fireEvent.click(projectIssuesTab);

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(
        mockProjects[0].repos[0],
        "project-issues",
        1,
        25,
      );
    });
  });

  it("renders issue list item cards with badges, author, and comment counts", async () => {
    render(<InboxView projects={mockProjects} />);

    await waitFor(() => {
      expect(screen.getByTestId("issue-card-101")).toBeInTheDocument();
      expect(screen.getByTestId("issue-card-102")).toBeInTheDocument();
    });

    // Verify card 101 content
    const card101 = screen.getByTestId("issue-card-101");
    expect(within(card101).getByText("#101")).toBeInTheDocument();
    expect(within(card101).getByText("Add offline cache for plans")).toBeInTheDocument();
    expect(within(card101).getByText("@alice")).toBeInTheDocument();
    expect(within(card101).getByText("5")).toBeInTheDocument(); // Comments count
    expect(within(card101).getByText("feature")).toBeInTheDocument();
    expect(within(card101).getByText("priority-high")).toBeInTheDocument();
  });

  it("filters issues correctly by search keyword, label selection, and assignee selection", async () => {
    render(<InboxView projects={mockProjects} />);

    await waitFor(() => {
      expect(screen.getByTestId("issue-card-101")).toBeInTheDocument();
      expect(screen.getByTestId("issue-card-102")).toBeInTheDocument();
    });

    const searchInput = screen.getByRole("searchbox", { name: /search issues/i });

    // Filter by title keyword
    fireEvent.change(searchInput, { target: { value: "contrast" } });
    expect(screen.queryByTestId("issue-card-101")).not.toBeInTheDocument();
    expect(screen.getByTestId("issue-card-102")).toBeInTheDocument();

    // Reset search
    fireEvent.change(searchInput, { target: { value: "" } });
    expect(screen.getByTestId("issue-card-101")).toBeInTheDocument();
    expect(screen.getByTestId("issue-card-102")).toBeInTheDocument();

    // Filter by label chip
    const bugLabelChip = screen.getByRole("button", { name: /bug/i });
    fireEvent.click(bugLabelChip);
    expect(screen.queryByTestId("issue-card-101")).not.toBeInTheDocument();
    expect(screen.getByTestId("issue-card-102")).toBeInTheDocument();

    // Toggle off label filter
    fireEvent.click(bugLabelChip);
    expect(screen.getByTestId("issue-card-101")).toBeInTheDocument();

    // Filter by assignee chip
    const aliceAssigneeChip = screen.getByRole("button", { name: /@alice/i });
    fireEvent.click(aliceAssigneeChip);
    expect(screen.getByTestId("issue-card-101")).toBeInTheDocument();
    expect(screen.queryByTestId("issue-card-102")).not.toBeInTheDocument();
  });

  it("triggers plan creation with prefilled issue title, description, and sourceUrl when Create Plan is clicked", async () => {
    const handleOpenModal = vi.fn();
    render(<InboxView projects={mockProjects} onOpenNewPlanModal={handleOpenModal} />);

    await waitFor(() => {
      expect(screen.getByTestId("create-plan-btn-101")).toBeInTheDocument();
    });

    const createPlanBtn = screen.getByTestId("create-plan-btn-101");
    fireEvent.click(createPlanBtn);

    expect(handleOpenModal).toHaveBeenCalledTimes(1);
    const prefillArg = handleOpenModal.mock.calls[0][0];
    expect(prefillArg.title).toBe("Add offline cache for plans");
    expect(prefillArg.description).toContain("Task from GitHub Issue #101");
    expect(prefillArg.description).toContain("Operators need offline caching");
    expect(prefillArg.sourceUrl).toBe("https://github.com/SpaceCorps/Tendril-App/issues/101");
    expect(prefillArg.project).toBe("Tendril-App");
  });

  it("displays empty state when no issues match filters or list is empty", async () => {
    vi.spyOn(bridge, "listGitHubIssues").mockResolvedValue(makePage([]));
    render(<InboxView projects={mockProjects} />);

    await waitFor(() => {
      expect(screen.getByTestId("inbox-empty")).toBeInTheDocument();
      expect(screen.getByText(/no issues found/i)).toBeInTheDocument();
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

  it("supports paging forward and backward through results via Next/Previous controls", async () => {
    render(<InboxView projects={mockProjects} />);

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 1, 25);
    });
    await waitForInboxIdle();

    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 2, 25);
    });
    await waitForInboxIdle();

    fireEvent.click(screen.getByRole("button", { name: /previous/i }));

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenLastCalledWith(undefined, "my-issues", 1, 25);
    });
    await waitForInboxIdle();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  });

  it("resets to the first page and requests the new page size when the page size changes", async () => {
    render(<InboxView projects={mockProjects} />);

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 1, 25);
    });
    await waitForInboxIdle();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 2, 25);
    });
    await waitForInboxIdle();

    fireEvent.change(screen.getByLabelText(/page size/i), { target: { value: "50" } });

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenLastCalledWith(undefined, "my-issues", 1, 50);
    });
  });

  it("resets to the first page when a search filter is applied while viewing a later page", async () => {
    render(<InboxView projects={mockProjects} />);

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 1, 25);
    });
    await waitForInboxIdle();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 2, 25);
    });
    await waitForInboxIdle();

    fireEvent.change(screen.getByRole("searchbox", { name: /search issues/i }), {
      target: { value: "bug" },
    });

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenLastCalledWith(undefined, "my-issues", 1, 25);
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
        expect(screen.getByTestId("issue-card-101")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("inbox-check-now"));

      await waitFor(() => {
        expect(screen.getByTestId("inbox-proposal-error")).toHaveTextContent(/not the master/i);
      });
      // The GitHub issues below are unaffected: the two fetches are independent.
      expect(screen.getByTestId("issue-card-101")).toBeInTheDocument();
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
      expect(screen.getByTestId("issue-card-101")).toBeInTheDocument();
      expect(screen.queryByTestId("inbox-proposals")).not.toBeInTheDocument();
    });
  });
});
