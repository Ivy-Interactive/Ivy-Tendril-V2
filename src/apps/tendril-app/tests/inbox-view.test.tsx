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

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrl(url),
}));

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
    openUrl.mockReset();
    openUrl.mockResolvedValue(undefined);
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
    expect(screen.getByTestId("category-my-issues")).toBeInTheDocument();
    expect(screen.getByTestId("category-review-requests")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /projects/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Tendril-App" })).toBeInTheDocument();

    await waitFor(() => {
      expect(listGitHubIssuesSpy).toHaveBeenCalledWith(undefined, "my-issues", 1, PAGE_SIZE);
    });

    fireEvent.click(screen.getByTestId("category-review-requests"));

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
    // V1's denominator is `allIssues.Count`, the whole category, which is the daemon's `totalCount`.
    expect(screen.getByTestId("inbox-selection-summary")).toHaveTextContent("2 of 60 selected");

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
    expect(screen.getByTestId("inbox-selection-summary")).toHaveTextContent("0 of 60 selected");
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

    fireEvent.click(screen.getByTestId("category-review-requests"));

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

    // Mount also primes the inactive category's rail badge, exactly as V1's second standing query
    // does, so the fetches for the displayed category have to be counted on their own.
    const fetchesForDisplayedCategory = () =>
      listGitHubIssuesSpy.mock.calls.filter((call) => call[1] === "my-issues").length;

    it("silently refetches on the configured interval and stops once disabled", async () => {
      render(<InboxView projects={mockProjects} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchesForDisplayedCategory()).toBe(1);

      fireEvent.change(screen.getByLabelText(/auto-refresh interval/i), {
        target: { value: "30s" },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(fetchesForDisplayedCategory()).toBe(2);

      fireEvent.change(screen.getByLabelText(/auto-refresh interval/i), {
        target: { value: "off" },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(fetchesForDisplayedCategory()).toBe(2);
    });

    it("clears the polling interval on unmount", async () => {
      const { unmount } = render(<InboxView projects={mockProjects} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchesForDisplayedCategory()).toBe(1);

      fireEvent.change(screen.getByLabelText(/auto-refresh interval/i), {
        target: { value: "30s" },
      });

      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(fetchesForDisplayedCategory()).toBe(1);
    });

    it("polls the swept proposals on the same tick, since nothing pushes a sweep result", async () => {
      // The app's filesystem-change handler for `inbox` is an explicit no-op and the daemon emits no
      // event for a sweep at all, so a pass that ran server-side is only ever noticed by this poll.
      render(<InboxView projects={mockProjects} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(listInboxProposalsSpy).toHaveBeenCalledTimes(1);

      fireEvent.change(screen.getByLabelText(/auto-refresh interval/i), {
        target: { value: "30s" },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(listInboxProposalsSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("rail counts", () => {
    it("carries a count on both fixed categories before either has been visited", async () => {
      // V1 keeps `inbox:my-issues` and `inbox:review-requests` running as two standing queries, so
      // `myIssuesCount` and `reviewsCount` are both live from the first render (`InboxApp.cs:202`).
      listGitHubIssuesSpy.mockImplementation((_repo?: string, category?: string) =>
        Promise.resolve(
          category === "review-requests"
            ? makePage([], { totalCount: 7 })
            : makePage(mockIssues, { totalCount: 60 }),
        ),
      );

      render(<InboxView projects={mockProjects} />);

      await waitFor(() => {
        expect(screen.getByTestId("category-review-requests")).toHaveTextContent("7");
        expect(screen.getByTestId("category-my-issues")).toHaveTextContent("60");
      });
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

  describe("bulk selection", () => {
    /** Two single-issue pages, so a selection has to survive leaving the page it was made on. */
    const pagedFetch = (_repo?: string, _category?: string, page?: number) =>
      Promise.resolve(
        page === 2
          ? makePage([mockIssues[1]], { page: 2, hasMore: false, totalCount: 60 })
          : makePage([mockIssues[0]], { page: 1, hasMore: true, totalCount: 60 }),
      );

    it("fires off issues selected on a page that is no longer listed", async () => {
      // V1 resolves the selection against `allIssues`, every issue in the category, because it
      // fetched the lot and paged the table client-side (`ContentView.cs:402-404`). V2 holds one
      // server page, so this used to show `(2)` on the button and then fire nothing at all.
      const startJobSpy = vi
        .spyOn(bridge, "startJob")
        .mockResolvedValue({ jobId: "00042", status: "Queued" });
      listGitHubIssuesSpy.mockImplementation(pagedFetch);

      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();
      await waitFor(() => expect(issueRow(101)).not.toBeNull());

      fireEvent.click(screen.getByRole("button", { name: "Select All" }));
      expect(screen.getByTestId("inbox-selection-summary")).toHaveTextContent("1 of 60 selected");

      fireEvent.click(screen.getByRole("button", { name: /next page/i }));
      await waitFor(() => expect(issueRow(102)).not.toBeNull());
      expect(issueRow(101)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Select All" }));
      expect(screen.getByTestId("inbox-selection-summary")).toHaveTextContent("2 of 60 selected");

      fireEvent.click(screen.getByRole("button", { name: /Fire off in Tendril \(2\)/ }));

      await waitFor(() => expect(startJobSpy).toHaveBeenCalledTimes(2));
      expect(startJobSpy.mock.calls.map((call) => call[0].sourceUrl)).toEqual([
        mockIssues[0].url,
        mockIssues[1].url,
      ]);
    });

    it("clears a cross-page selection on Deselect All, as V1's does over its whole list", async () => {
      listGitHubIssuesSpy.mockImplementation(pagedFetch);

      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();

      fireEvent.click(screen.getByRole("button", { name: "Select All" }));
      fireEvent.click(screen.getByRole("button", { name: /next page/i }));
      await waitFor(() => expect(issueRow(102)).not.toBeNull());
      fireEvent.click(screen.getByRole("button", { name: "Select All" }));
      expect(screen.getByTestId("inbox-selection-summary")).toHaveTextContent("2 of 60 selected");

      fireEvent.click(screen.getByRole("button", { name: "Deselect All" }));

      expect(screen.getByTestId("inbox-selection-summary")).toHaveTextContent("0 of 60 selected");
    });

    it("reports how many landed and keeps only the unfired issues selected on a failure", async () => {
      // V1 skips any issue whose inbox file already exists (`InboxApp.cs:169`), so pressing the
      // button again after a failure never fires the same issue twice. A `CreatePlan` job has no
      // such guard, so what landed has to leave the selection.
      const startJobSpy = vi
        .spyOn(bridge, "startJob")
        .mockResolvedValueOnce({ jobId: "00042", status: "Queued" })
        .mockRejectedValueOnce({ code: "GITHUB_ERROR", message: "the daemon went away" });

      render(<InboxView projects={mockProjects} />);
      await waitFor(() => expect(issueRow(101)).not.toBeNull());

      fireEvent.click(screen.getByRole("button", { name: "Select All" }));
      fireEvent.click(screen.getByRole("button", { name: /Fire off in Tendril \(2\)/ }));

      await waitFor(() =>
        expect(screen.getByTestId("inbox-fire-notice")).toHaveTextContent(
          /Fired off 1 of 2\. Failed on #102/,
        ),
      );
      expect(startJobSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("inbox-selection-summary")).toHaveTextContent("1 of 60 selected");
    });
  });

  describe("project issues", () => {
    it("says a project's remotes resolve to nothing instead of querying without a repo", async () => {
      // V1 `InboxApp.cs:98-103`. The daemon's search branch drops the `repo:` qualifier when no repo
      // is given, so the query that used to be issued here searched the whole of GitHub.
      render(<InboxView projects={[{ name: "No-Remotes", repos: [], verifications: [] }]} />);
      await waitForInboxIdle();

      fireEvent.click(screen.getByRole("tab", { name: "No-Remotes" }));

      await waitFor(() =>
        expect(screen.getByTestId("inbox-error")).toHaveTextContent(
          "No git remotes resolved for project No-Remotes.",
        ),
      );
      expect(listGitHubIssuesSpy.mock.calls.some((call) => call[1] === "project-issues")).toBe(
        false,
      );
    });

    it("drops pull requests from an issues category and keeps them under Reviews", async () => {
      // The daemon serves a project's issues from `repos/{slug}/issues`, which GitHub answers with
      // pull requests too; V1's project query is `gh` issue search and never returned any.
      const pr: GitHubIssue = {
        ...mockIssues[0],
        number: 103,
        title: "A pull request",
        isPullRequest: true,
      };
      listGitHubIssuesSpy.mockResolvedValue(makePage([mockIssues[0], pr], { totalCount: 2 }));

      render(<InboxView projects={mockProjects} />);

      await waitFor(() => expect(issueRow(101)).not.toBeNull());
      expect(issueRow(103)).toBeNull();

      fireEvent.click(screen.getByTestId("category-review-requests"));

      await waitFor(() => expect(issueRow(103)).not.toBeNull());
    });

    it("counts the dropped pull requests out of the footer and the selection summary", async () => {
      // The user's report: "it says showing first 50, but lol wtf i made select all its only 44".
      // A page of 50 that holds 6 pull requests renders 44 rows, and both numbers beside it used
      // to come from the server instead: the footer read "Showing 1-50 of 51" and Select All
      // filled 44 while the summary claimed 51. The PR drop is a client-side narrowing exactly as
      // the search box is, so it has to count as one.
      const page = Array.from({ length: 50 }, (_, i) => ({
        ...mockIssues[0],
        number: 200 + i,
        title: `Issue ${200 + i}`,
        isPullRequest: i >= 44,
      }));
      listGitHubIssuesSpy.mockResolvedValue(
        makePage(page, { hasMore: true, totalCount: 51, perPage: PAGE_SIZE }),
      );

      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();
      await waitFor(() => expect(issueRow(200)).not.toBeNull());

      expect(issueRow(244)).toBeNull();
      expect(document.querySelectorAll("[data-row-id]").length).toBe(44);
      expect(screen.getByText("Showing 1–44 of 44")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Select All" }));
      expect(screen.getByTestId("inbox-selection-summary")).toHaveTextContent("44 of 44 selected");
    });
  });

  describe("issue urls and target projects", () => {
    it("leaves an unconfigured repository to auto-detection rather than the first project", async () => {
      // V1 `InboxApp.cs:171-173`: outside the Project category the repository decides, and a
      // repository that matches no project falls back to the literal `Auto`.
      const handleOpenModal = vi.fn();
      listGitHubIssuesSpy.mockResolvedValue(
        makePage([
          { ...mockIssues[0], repository: { name: "Other", nameWithOwner: "Someone/Other" } },
        ]),
      );

      render(<InboxView projects={mockProjects} onOpenNewPlanModal={handleOpenModal} />);
      await waitFor(() => expect(issueRow(101)).not.toBeNull());

      fireEvent.click(within(issueRow(101)!).getByRole("button", { name: "Fire off in Tendril" }));

      expect(handleOpenModal.mock.calls[0][0].project).toBe("Auto");
    });

    it("builds the GitHub url from the repository when the issue carries none", async () => {
      // V1 `InboxApp.ResolveIssueUrl`; opening the empty string opened a blank window instead.
      listGitHubIssuesSpy.mockResolvedValue(makePage([{ ...mockIssues[0], url: "" }]));

      render(<InboxView projects={mockProjects} />);
      await waitFor(() => expect(issueRow(101)).not.toBeNull());

      fireEvent.click(within(issueRow(101)!).getByRole("button", { name: "Open in GitHub" }));

      await waitFor(() =>
        expect(openUrl).toHaveBeenCalledWith(
          "https://github.com/SpaceCorps/Tendril-App/issues/101",
        ),
      );
    });
  });

  describe("pagination edges", () => {
    it("keeps the pagination footer on an empty page past the first", async () => {
      // V1 pages one in-memory list and can never land here. `NoContentView` in the table's place
      // takes the footer with it, which is the only control that gets back to page one.
      listGitHubIssuesSpy.mockImplementation((_repo?: string, _category?: string, page?: number) =>
        Promise.resolve(
          page === 2
            ? makePage([], { page: 2, hasMore: false, totalCount: 60 })
            : makePage(mockIssues, { hasMore: true, totalCount: 60 }),
        ),
      );

      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();

      fireEvent.click(screen.getByRole("button", { name: /next page/i }));

      await waitFor(() => expect(issueRow(101)).toBeNull());
      expect(screen.queryByTestId("inbox-empty")).not.toBeInTheDocument();

      const previous = screen.getByRole("button", { name: /previous page/i });
      expect(previous).toBeEnabled();
      fireEvent.click(previous);

      await waitFor(() => expect(issueRow(101)).not.toBeNull());
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

    it("shows the swept proposals on My Issues only", async () => {
      // V1 keeps the whole Auto-Accept surface on My Issues (`ContentView.cs:429`), and these rows
      // are what that sweep produced: they are not scoped to a category or a project.
      listInboxProposalsSpy.mockResolvedValue([proposal(1, 101)]);
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => expect(screen.getByTestId("inbox-proposals")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("category-review-requests"));
      expect(screen.queryByTestId("inbox-proposals")).not.toBeInTheDocument();
      expect(screen.queryByTestId("inbox-check-now")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("category-my-issues"));
      expect(screen.getByTestId("inbox-proposals")).toBeInTheDocument();
    });

    it("revalidates the issue list after a manual check, as V1's onRefresh does", async () => {
      // `AutoAcceptSettingsDialog.cs:50` awaits `onRefresh()` after the pass, and the pass itself
      // invalidates the my-issues query (`AssignedIssuesAutoImportService.cs:93`): a sweep that
      // accepted an issue changes what is assigned to you.
      vi.spyOn(bridge, "checkInbox").mockResolvedValue(report());
      const myIssuesFetches = () =>
        listGitHubIssuesSpy.mock.calls.filter((call) => call[1] === "my-issues").length;

      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();
      const before = myIssuesFetches();

      fireEvent.click(screen.getByTestId("inbox-check-now"));

      await waitFor(() => expect(myIssuesFetches()).toBe(before + 1));
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

    it("says a sweep failed per-project rather than reporting an empty import", async () => {
      // `SweepReport.errors` collects per-project `gh` failures and is never fatal, so a pass in
      // which every project failed still reports `Ran` with nothing imported. Reading only
      // `imported` and `skipped` made that indistinguishable from "nothing is assigned to you" -
      // the silence V1's `InboxRecoverySummary` was written to end.
      vi.spyOn(bridge, "checkInbox").mockResolvedValue(
        report({ errors: ["Tendril-App: gh exited with status 1"] }),
      );
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => expect(screen.getByTestId("inbox-check-now")).toBeEnabled());
      fireEvent.click(screen.getByTestId("inbox-check-now"));

      await waitFor(() =>
        expect(screen.getByTestId("inbox-check-summary")).toHaveTextContent(
          "1 error: Tendril-App: gh exited with status 1",
        ),
      );
    });

    it("reports the plans an auto-accepting sweep started, which leave no card behind", async () => {
      // With auto-accept on, the sweep inserts the proposal and accepts it in the same pass, so the
      // panel below stays empty and `accepted` is the only evidence anything happened.
      vi.spyOn(bridge, "checkInbox").mockResolvedValue(
        report({ imported: [proposal(1, 101)], accepted: 1 }),
      );
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => expect(screen.getByTestId("inbox-check-now")).toBeEnabled());
      fireEvent.click(screen.getByTestId("inbox-check-now"));

      await waitFor(() =>
        expect(screen.getByTestId("inbox-check-summary")).toHaveTextContent(
          "Imported 1, skipped 0. 1 started a plan straight away.",
        ),
      );
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

  /**
   * V1 `SidebarListRow.BuildSubItem` colours a project's marker with `config.GetProjectColor`, and
   * `SettingsApp.cs:120-121` reduces to "the configured colour, else `Colors.Slate`". The colour now
   * reaches the view: `ProjectConfig.color` -> the bridge's `ProjectSummaryDto` -> `ProjectSummary`.
   *
   * The shape is the Settings project rail's, deliberately: `Box().Background(color)
   * .BorderRadius(Rounded).Width(Size.Units(3)).Height(Size.Units(3))` — 0.75rem at 0.5rem radius.
   */
  describe("project colour in the category rail", () => {
    const dot = (project: string) => screen.getByTestId(`inbox-project-${project}-dot`);

    it("gives each project a dot in its configured colour", async () => {
      render(
        <InboxView
          projects={[
            { name: "Tendril", color: "Emerald", repos: [], verifications: [] },
            { name: "Ivy", color: "Purple", repos: [], verifications: [] },
          ]}
        />,
      );
      await waitForInboxIdle();

      // The name resolves through the package's single `ivyColorVar`, so the token, not a hex literal.
      expect(dot("Tendril")).toHaveAttribute("data-color", "Emerald");
      expect(dot("Tendril").style.backgroundColor).toBe("var(--emerald, currentColor)");
      expect(dot("Ivy")).toHaveAttribute("data-color", "Purple");
      expect(dot("Ivy").style.backgroundColor).toBe("var(--purple, currentColor)");
    });

    /** V1's `?? Colors.Slate`: no colour configured is a neutral dot, not the absence of one. */
    it("falls back to Slate for a project with no colour", async () => {
      render(
        <InboxView
          projects={[
            { name: "Tendril", repos: [], verifications: [] },
            { name: "Ivy", color: "   ", repos: [], verifications: [] },
          ]}
        />,
      );
      await waitForInboxIdle();

      expect(dot("Tendril")).toHaveAttribute("data-color", "Slate");
      expect(dot("Tendril").style.backgroundColor).toBe("var(--slate, currentColor)");
      expect(dot("Ivy")).toHaveAttribute("data-color", "Slate");
    });

    /** `Size.Units(3)` with `BorderRadius.Rounded`, which the framework resolves to 0.5rem. */
    it("matches the Settings rail's 0.75rem swatch rather than inventing a size", async () => {
      render(
        <InboxView projects={[{ name: "Tendril", color: "Blue", repos: [], verifications: [] }]} />,
      );
      await waitForInboxIdle();

      expect(dot("Tendril").className).toContain("size-3");
      // `rounded-box` is `--radius-boxes`, which is the same 0.5rem this asserted as a literal before
      // the swatch moved onto the shared radius token.
      expect(dot("Tendril").className).toContain("rounded-box");
      expect(dot("Tendril").className).not.toContain("rounded-full");
    });

    /** `BuildSubItem` renders icon *or* colour, never both — so this row keeps its folder icon. */
    it("leaves the no-projects row its icon and gives it no dot", async () => {
      render(<InboxView projects={[]} />);
      await waitForInboxIdle();

      const row = screen.getByTestId("inbox-no-projects");
      expect(row).toHaveTextContent("No projects in settings");
      expect(row.querySelector("[data-color]")).toBeNull();
      expect(row.querySelector("svg")).not.toBeNull();
    });
  });

  /**
   * The issues table bounds its own height instead of growing and taking the page's scroller with it.
   *
   * jsdom does no layout, so the height itself is not observable here; the *chain* that produces it
   * is. Every link matters, and `min-h-0` most of all: a flex child's default `min-height: auto`
   * refuses to shrink below its content, which is exactly how a bounded table becomes a scrolling
   * page. Inbox stays registered padded (`APP_DESCRIPTORS`), so `h-full` here is what turns the
   * shell's definite-height content frame into a definite height for this column.
   */
  describe("issues table height", () => {
    it("hangs a definite-height column off the shell's frame", async () => {
      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();

      const root = screen.getByTestId("inbox-view");
      expect(root.className).toContain("h-full");
      expect(root.className).toContain("min-h-0");

      // The content column: a flex column that may shrink, with the table as its growing child.
      const column = screen.getByTestId("inbox-content");
      expect(column.className).toContain("flex-col");
      expect(column.className).toContain("flex-1");
      expect(column.className).toContain("min-h-0");
      expect(column.parentElement).toBe(root);
      expect(column.contains(screen.getByTestId("inbox-issue-table"))).toBe(true);

      // The rail is the column's sibling and scrolls itself, so it cannot grow the frame either.
      const rail = screen.getByRole("tablist", { name: "Inbox categories" });
      expect(rail.className).toContain("overflow-y-auto");
    });

    it("gives the table `fillHeight`'s bounded viewport rather than the page scroller", async () => {
      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();

      // `data-testid` lands on the `<table>`; walk out through the wrappers `fillHeight` builds.
      const table = screen.getByTestId("inbox-issue-table");
      const viewport = table.parentElement as HTMLElement;
      const box = viewport.parentElement as HTMLElement;
      const wrapper = box.parentElement as HTMLElement;

      // The scroll viewport is bounded and is the element that scrolls.
      expect(viewport.className).toContain("min-h-0");
      expect(viewport.className).toContain("flex-1");
      // `fillHeight`'s bordered box: takes the remaining height and clips, so nothing escapes it.
      expect(box.className).toContain("min-h-0");
      expect(box.className).toContain("flex-1");
      expect(box.className).toContain("overflow-hidden");
      // The table's own root claims the column's leftover height.
      expect(wrapper.className).toContain("min-h-0");
      expect(wrapper.className).toContain("flex-1");
      // No view-level scroller: the frame owns the page scroll, the table owns the rows'.
      expect(screen.getByTestId("inbox-view").className).not.toContain("overflow-y-auto");
    });
  });
});
