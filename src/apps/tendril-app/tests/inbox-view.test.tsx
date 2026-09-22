import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { InboxView, describeSweep } from "../src/views/InboxView";
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

/** The user's "issues list can get long": a full page of rows for the layout to absorb. */
const LONG_PAGE = PAGE_SIZE;

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

  /** `LONG_PAGE` rows off one fixture, each distinct enough to search for. */
  const longIssuePage = (): GitHubIssuesPage =>
    makePage(
      Array.from({ length: LONG_PAGE }, (_, i) => ({
        ...mockIssues[0],
        number: 300 + i,
        title: `Issue ${300 + i} in a list long enough to scroll`,
      })),
      { hasMore: true, totalCount: 600, perPage: PAGE_SIZE },
    );

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
    const proposal = (
      id: number,
      number: number,
      overrides: Partial<InboxProposal> = {},
    ): InboxProposal => ({
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
      ...overrides,
    });

    const report = (overrides: Partial<SweepReport> = {}): SweepReport => ({
      imported: [],
      accepted: 0,
      skipped: 0,
      errors: [],
      outcome: "Ran",
      ...overrides,
    });

    /** A button in one row's actions cell, which is where Accept now lives. */
    const rowButton = (number: number, name: string): HTMLElement =>
      within(issueRow(number)!).getByRole("button", { name });

    /**
     * Picks an entry from a row's overflow menu, which is where Dismiss lives. By keyboard, for the
     * reason `jobs-bulk-clears.test.tsx` gives: Radix's trigger opens on a primary-button
     * `pointerDown`, which jsdom cannot synthesise, and on `Enter`, which it can.
     */
    const pickRowMenuItem = async (number: number, name: string) => {
      fireEvent.keyDown(rowButton(number, "More actions"), { key: "Enter" });
      fireEvent.click(await screen.findByRole("menuitem", { name }));
    };

    /** Any row's Awaiting decision mark. */
    const anyAwaitingMark = () => document.querySelector('[data-testid^="inbox-awaiting-mark-"]');

    /** The rendered rows' ids, top to bottom. */
    const rowOrder = () =>
      Array.from(document.querySelectorAll("[data-row-id]")).map((row) =>
        row.getAttribute("data-row-id"),
      );

    /** The table's column headers, by their text, as the column test above reads them. */
    const columnHeaders = () =>
      within(screen.getByTestId("inbox-issue-table"))
        .getAllByRole("columnheader")
        .map((th) => th.textContent?.trim())
        .filter(Boolean);

    /** The DataTable's root, which is what its `className` lands on (see the height tests). */
    const tableRoot = () =>
      screen.getByTestId("inbox-issue-table").parentElement!.parentElement!.parentElement!;

    it("marks no row and adds no filter when nothing has been imported", async () => {
      render(<InboxView projects={mockProjects} />);

      await waitForInboxIdle();
      await waitFor(() => {
        expect(listInboxProposalsSpy).toHaveBeenCalled();
      });
      expect(anyAwaitingMark()).toBeNull();
      expect(screen.queryByTestId("inbox-awaiting-filter")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
      // The manual trigger is always available: it is how a user gets the first proposal.
      expect(screen.getByTestId("inbox-check-now")).toBeInTheDocument();
    });

    /**
     * The reported bug: "why in my issues I see two tables? just have 1 datatable with all issues."
     * Every swept proposal is an issue assigned to you, which My Issues lists too, so the card list
     * above the table showed the same issues a second time.
     */
    it("marks a swept issue on its own row instead of listing it a second time", async () => {
      listInboxProposalsSpy.mockResolvedValue([
        // A project named unlike the repository, so the tooltip is seen to name the project.
        proposal(1, 101, { project: "Plans-Core" }),
        proposal(2, 102),
      ]);
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-1")).toBeInTheDocument());

      // One table, and each issue in it once.
      const content = screen.getByTestId("inbox-content");
      expect(within(content).getAllByRole("table")).toHaveLength(1);
      expect(screen.queryByTestId("inbox-proposals")).not.toBeInTheDocument();
      expect(document.querySelectorAll('[data-row-id="101"]')).toHaveLength(1);
      expect(document.querySelectorAll('[data-row-id="102"]')).toHaveLength(1);

      // The row keeps the live issue's own data; the proposal only adds its mark, in the Issue
      // cell beside the title, so the columns are still exactly V1's.
      const row101 = issueRow(101)!;
      const title = within(row101).getByText("#101 Add offline cache for plans");
      expect(within(row101).getByText("feature")).toBeInTheDocument();
      const mark = within(row101).getByRole("img", { name: "Awaiting decision" });
      expect(mark).toBe(within(row101).getByTestId("inbox-awaiting-mark-1"));
      expect(mark.closest("td")).toBe(title.closest("td"));
      // An icon, not a text badge: the title beside it is what the width is for.
      expect(mark.textContent).toBe("");
      expect(columnHeaders()).toEqual([
        "Select all rows",
        "Issue",
        "Repository",
        "Labels",
        "Assignees",
        "Row actions",
      ]);
      // What the card used to print: the project Accept would plan the issue in.
      expect(mark).toHaveAttribute(
        "title",
        expect.stringContaining("Accept starts a plan in Plans-Core"),
      );

      // The card's Accept takes Fire off's slot; View Details keeps its own; Open in GitHub and
      // the permanent Dismiss share an overflow menu, so the row still has three slots.
      expect(
        within(row101)
          .getAllByRole("button")
          .map((b) => b.getAttribute("aria-label"))
          .filter(Boolean),
      ).toEqual(["Accept", "View Details", "More actions"]);
      expect(within(row101).queryByRole("button", { name: "Dismiss" })).toBeNull();
      expect(within(issueRow(102)!).getByTestId("inbox-awaiting-mark-2")).toBeInTheDocument();
    });

    /**
     * Measured in Chromium in the shell at 1440x900: a fourth row action widened the actions column
     * from `w-28` to `w-48`, which took the Issue column from 154px to 67px on every row - and with
     * it the titles of the issues awaiting a decision.
     */
    it("keeps the actions column at its width while a row awaits a decision", async () => {
      listInboxProposalsSpy.mockResolvedValue([proposal(1, 101)]);
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-1")).toBeInTheDocument());
      expect(tableRoot().className).toContain("[&_table.ivy-data-table_th:last-child]:w-28");
      expect(tableRoot().className).not.toContain("w-48");
    });

    /**
     * The Issue column is V1's `45%` in a fixed layout, which gets only what V1's fixed columns
     * leave: nothing at all in the shell's default 1280x800 window (measured in Chromium). The
     * floor makes the table scroll sideways instead, as V1's grid does, so a title - the thing an
     * Accept or Dismiss is decided on - is always on screen. Reviews declare different columns and
     * never needed it.
     */
    it("keeps the Issue column from collapsing on the issue categories only", async () => {
      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();
      expect(tableRoot().className).toContain("[&_table.ivy-data-table]:min-w-[53rem]");

      fireEvent.click(screen.getByTestId("category-review-requests"));
      await waitForInboxIdle();
      await waitFor(() => expect(columnHeaders()).toContain("Pull Request"));
      expect(tableRoot().className).not.toContain("min-w-[53rem]");
    });

    it("puts the issues awaiting a decision first", async () => {
      listInboxProposalsSpy.mockResolvedValue([proposal(2, 102)]);
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-2")).toBeInTheDocument());

      expect(rowOrder()).toEqual(["102", "101"]);
      // The unmarked row keeps V1's three actions.
      expect(within(issueRow(101)!).queryByRole("button", { name: "Accept" })).toBeNull();
      expect(rowButton(101, "Fire off in Tendril")).toBeInTheDocument();
    });

    it("keeps a proposal whose issue is no longer listed, once the page is the whole category", async () => {
      // Closed or unassigned since the sweep found it: My Issues no longer lists it, but the
      // proposal is still pending, and without a row of its own nothing could decide it.
      listGitHubIssuesSpy.mockResolvedValue(makePage(mockIssues));
      listInboxProposalsSpy.mockResolvedValue([proposal(9, 999), proposal(1, 101)]);
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => expect(issueRow(999)).not.toBeNull());
      expect(rowOrder()).toEqual(["999", "101", "102"]);
      expect(within(issueRow(999)!).getByText("#999 Swept issue 999")).toBeInTheDocument();
      expect(within(issueRow(999)!).getByTestId("inbox-awaiting-mark-9")).toBeInTheDocument();
      // Counted like any other row, so the footer and the summary describe what is on screen.
      expect(screen.getByTestId("inbox-selection-summary")).toHaveTextContent("0 of 3 selected");
      expect(screen.getByText("Showing 1–3 of 3")).toBeInTheDocument();
    });

    /**
     * The whole category on one page, but with no room left on it. Adding the rows anyway made the
     * footer count one past the page, offer a page two, and land on an empty table when it was
     * followed - with the added rows gone too, since page two is not the whole category.
     */
    it("does not add unlisted proposals that would push the footer onto a second page", async () => {
      const nearlyFull = Array.from({ length: 48 }, (_, i) => ({
        ...mockIssues[0],
        number: 300 + i,
        title: `Issue ${300 + i}`,
      }));
      listGitHubIssuesSpy.mockResolvedValue(makePage(nearlyFull));
      listInboxProposalsSpy.mockResolvedValue([
        proposal(1, 901),
        proposal(2, 902),
        proposal(3, 903),
      ]);
      render(<InboxView projects={mockProjects} />);

      await waitForInboxIdle();
      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-filter")).toBeInTheDocument());
      expect(issueRow(901)).toBeNull();
      expect(screen.getByText("Showing 1–48 of 48")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled();

      // Still reachable: the filter's count and rows are every proposal.
      const filter = screen.getByTestId("inbox-awaiting-filter");
      expect(filter).toHaveTextContent("Awaiting3");
      fireEvent.click(filter);
      await waitFor(() => expect(rowOrder()).toEqual(["901", "902", "903"]));
      expect(screen.getByText("Showing 1–3 of 3")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled();
    });

    it("leaves an unlisted proposal to the Awaiting decision filter while other pages may list it", async () => {
      // The default page reports `hasMore`, so #999 may simply be on page two.
      listInboxProposalsSpy.mockResolvedValue([proposal(9, 999), proposal(1, 101)]);
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-1")).toBeInTheDocument());
      expect(issueRow(999)).toBeNull();

      const filter = screen.getByTestId("inbox-awaiting-filter");
      expect(filter).toHaveTextContent("Awaiting2");
      expect(filter).toHaveAttribute(
        "title",
        "Show only the assigned issues awaiting your decision",
      );
      expect(filter).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(filter);

      // Every proposal, on this page or not, and nothing else.
      await waitFor(() => expect(issueRow(999)).not.toBeNull());
      expect(issueRow(101)).not.toBeNull();
      expect(issueRow(102)).toBeNull();
      expect(filter).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("inbox-selection-summary")).toHaveTextContent("0 of 2 selected");

      fireEvent.click(filter);
      await waitFor(() => expect(issueRow(102)).not.toBeNull());
      expect(issueRow(999)).toBeNull();
    });

    /**
     * The filter's rows are every pending proposal, whichever server page is loaded. Paged by the
     * server's page they rendered in full on every page under a footer claiming a slice of them,
     * and Next fetched a server page that changed nothing. The table pages them itself.
     */
    it("pages the Awaiting decision filter itself when it holds more than a page", async () => {
      listInboxProposalsSpy.mockResolvedValue(
        Array.from({ length: 12 }, (_, i) => proposal(i + 1, 900 + i)),
      );
      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();

      fireEvent.change(screen.getByLabelText(/rows per page/i), { target: { value: "10" } });
      await waitFor(() =>
        expect(listGitHubIssuesSpy).toHaveBeenLastCalledWith(undefined, "my-issues", 1, 10),
      );
      await waitForInboxIdle();
      const fetchesBefore = listGitHubIssuesSpy.mock.calls.length;

      fireEvent.click(await screen.findByTestId("inbox-awaiting-filter"));
      await waitFor(() => expect(screen.getByText("Showing 1–10 of 12")).toBeInTheDocument());
      expect(document.querySelectorAll("[data-row-id]")).toHaveLength(10);
      expect(rowOrder()[0]).toBe("900");

      fireEvent.click(screen.getByRole("button", { name: /next page/i }));
      await waitFor(() => expect(screen.getByText("Showing 11–12 of 12")).toBeInTheDocument());
      expect(rowOrder()).toEqual(["910", "911"]);
      expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled();
      // Nothing fetched: the server's page has nothing to add to a list the daemon gave in full.
      expect(listGitHubIssuesSpy.mock.calls.length).toBe(fetchesBefore);
    });

    it("returns to the first server page when the filter is turned on from a later one", async () => {
      listInboxProposalsSpy.mockResolvedValue([proposal(1, 101)]);
      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();

      fireEvent.click(screen.getByRole("button", { name: /next page/i }));
      await waitFor(() =>
        expect(listGitHubIssuesSpy).toHaveBeenLastCalledWith(undefined, "my-issues", 2, PAGE_SIZE),
      );
      await waitForInboxIdle();

      fireEvent.click(screen.getByTestId("inbox-awaiting-filter"));
      await waitFor(() =>
        expect(listGitHubIssuesSpy).toHaveBeenLastCalledWith(undefined, "my-issues", 1, PAGE_SIZE),
      );
    });

    it("turns the filter off once nothing is left to decide, so the next sweep is not hidden", async () => {
      vi.spyOn(bridge, "acceptInboxProposal").mockResolvedValue({ jobId: "00042" });
      vi.spyOn(bridge, "checkInbox").mockResolvedValue(report({ imported: [proposal(2, 102)] }));
      listInboxProposalsSpy
        .mockResolvedValueOnce([proposal(1, 101)])
        .mockResolvedValueOnce([])
        .mockResolvedValue([proposal(2, 102)]);
      render(<InboxView projects={mockProjects} />);

      fireEvent.click(await screen.findByTestId("inbox-awaiting-filter"));
      await waitFor(() => expect(issueRow(102)).toBeNull());

      fireEvent.click(rowButton(101, "Accept"));
      await waitFor(() =>
        expect(screen.queryByTestId("inbox-awaiting-filter")).not.toBeInTheDocument(),
      );

      fireEvent.click(screen.getByTestId("inbox-check-now"));
      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-2")).toBeInTheDocument());
      expect(screen.getByTestId("inbox-awaiting-filter")).toHaveAttribute("aria-pressed", "false");
      expect(rowOrder()).toEqual(["102", "101"]);
    });

    it("builds no row from a proposal before the first page has arrived", async () => {
      // Until then `issues` is not this page's answer, so a proposal cannot be told to be unlisted.
      listGitHubIssuesSpy.mockReturnValue(new Promise(() => {}));
      listInboxProposalsSpy.mockResolvedValue([proposal(9, 999)]);
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => expect(listInboxProposalsSpy).toHaveBeenCalled());
      await act(async () => {});
      expect(screen.getByTestId("inbox-loading")).toBeInTheDocument();
      expect(issueRow(999)).toBeNull();
    });

    it("fires off a row built from a proposal like any other row", async () => {
      const handleOpenModal = vi.fn();
      listGitHubIssuesSpy.mockResolvedValue(makePage(mockIssues));
      listInboxProposalsSpy.mockResolvedValue([proposal(9, 999)]);
      render(<InboxView projects={mockProjects} onOpenNewPlanModal={handleOpenModal} />);

      await waitFor(() => expect(issueRow(999)).not.toBeNull());
      fireEvent.click(within(issueRow(999)!).getByRole("checkbox"));
      fireEvent.click(screen.getByTestId("inbox-fire-off"));

      expect(handleOpenModal).toHaveBeenCalledTimes(1);
      expect(handleOpenModal.mock.calls[0][0]).toMatchObject({
        title: "Swept issue 999",
        sourceUrl: "https://github.com/SpaceCorps/Tendril-App/issues/999",
        project: "Tendril-App",
      });
    });

    it("marks the swept issues on My Issues only", async () => {
      // V1 keeps the whole Auto-Accept surface on My Issues (`ContentView.cs:429`), and these rows
      // are what that sweep produced: they are not scoped to a category or a project.
      listInboxProposalsSpy.mockResolvedValue([proposal(1, 101)]);
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-1")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("category-review-requests"));
      await waitForInboxIdle();
      await waitFor(() => expect(issueRow(101)).not.toBeNull());
      expect(screen.queryByTestId("inbox-awaiting-mark-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("inbox-awaiting-filter")).not.toBeInTheDocument();
      expect(screen.queryByTestId("inbox-check-now")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("category-my-issues"));
      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-1")).toBeInTheDocument());
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

    it("runs a check and marks what it imported, reporting what the sweep did", async () => {
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
        expect(within(issueRow(101)!).getByTestId("inbox-awaiting-mark-1")).toBeInTheDocument();
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

    it("reports the plans an auto-accepting sweep started, which leave nothing to decide", async () => {
      // With auto-accept on, the sweep inserts the proposal and accepts it in the same pass, so no
      // row is marked as awaiting a decision and `accepted` is the only evidence anything happened.
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

    it("accepts from the row and unmarks it once it is no longer pending", async () => {
      const acceptSpy = vi
        .spyOn(bridge, "acceptInboxProposal")
        .mockResolvedValue({ jobId: "00042" });
      listInboxProposalsSpy.mockResolvedValueOnce([proposal(1, 101)]).mockResolvedValueOnce([]);

      render(<InboxView projects={mockProjects} />);
      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-1")).toBeInTheDocument());

      fireEvent.click(rowButton(101, "Accept"));

      await waitFor(() => {
        expect(acceptSpy).toHaveBeenCalledWith(1);
        expect(screen.queryByTestId("inbox-awaiting-mark-1")).not.toBeInTheDocument();
      });
      // Still assigned to you, so still listed - as an ordinary row with Fire off back.
      expect(issueRow(101)).not.toBeNull();
      expect(rowButton(101, "Fire off in Tendril")).toBeInTheDocument();
      expect(anyAwaitingMark()).toBeNull();
    });

    /**
     * The daemon keeps `Dismissed` for good, so Dismiss is a labelled entry in the row's menu
     * rather than an icon button one slot from Accept. The menu keeps Open in GitHub, whose slot it
     * took.
     */
    it("dismisses from the row's menu and refetches", async () => {
      const dismissSpy = vi.spyOn(bridge, "dismissInboxProposal").mockResolvedValue(undefined);
      listInboxProposalsSpy.mockResolvedValueOnce([proposal(1, 101)]).mockResolvedValueOnce([]);

      render(<InboxView projects={mockProjects} />);
      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-1")).toBeInTheDocument());

      fireEvent.keyDown(rowButton(101, "More actions"), { key: "Enter" });
      const menu = await screen.findByRole("menu");
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item) => item.textContent),
      ).toEqual(["Open in GitHub", "Dismiss"]);
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Dismiss" }));

      await waitFor(() => {
        expect(dismissSpy).toHaveBeenCalledWith(1);
        expect(listInboxProposalsSpy).toHaveBeenCalledTimes(2);
      });
      await waitFor(() =>
        expect(screen.queryByTestId("inbox-awaiting-mark-1")).not.toBeInTheDocument(),
      );
    });

    it("opens the issue on GitHub from the row's menu", async () => {
      listInboxProposalsSpy.mockResolvedValue([proposal(1, 101)]);
      render(<InboxView projects={mockProjects} />);
      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-1")).toBeInTheDocument());

      await pickRowMenuItem(101, "Open in GitHub");

      await waitFor(() =>
        expect(openUrl).toHaveBeenCalledWith(
          "https://github.com/SpaceCorps/Tendril-App/issues/101",
        ),
      );
    });

    it("offers the same decision in the issue's details sheet", async () => {
      const acceptSpy = vi
        .spyOn(bridge, "acceptInboxProposal")
        .mockResolvedValue({ jobId: "00042" });
      listInboxProposalsSpy.mockResolvedValue([proposal(1, 101)]);

      render(<InboxView projects={mockProjects} />);
      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-1")).toBeInTheDocument());

      fireEvent.click(rowButton(101, "View Details"));
      const sheet = await screen.findByRole("dialog");
      expect(within(sheet).getByRole("button", { name: "Dismiss" })).toHaveAttribute(
        "title",
        expect.stringContaining("will not propose this issue again"),
      );
      expect(within(sheet).queryByRole("button", { name: /Fire off in Tendril/ })).toBeNull();

      fireEvent.click(within(sheet).getByRole("button", { name: "Accept" }));

      await waitFor(() => expect(acceptSpy).toHaveBeenCalledWith(1));
    });

    /** A second Accept would reach the daemon as a CONFLICT, which is what the card guarded too. */
    it("disables the decision everywhere while it is in flight", async () => {
      let settle: (value: { jobId: string }) => void = () => {};
      const acceptSpy = vi
        .spyOn(bridge, "acceptInboxProposal")
        .mockReturnValue(new Promise((resolve) => (settle = resolve)));
      listInboxProposalsSpy.mockResolvedValue([proposal(1, 101)]);

      render(<InboxView projects={mockProjects} />);
      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-1")).toBeInTheDocument());

      fireEvent.click(rowButton(101, "Accept"));
      await waitFor(() => expect(rowButton(101, "Accept")).toBeDisabled());
      fireEvent.click(rowButton(101, "Accept"));
      expect(acceptSpy).toHaveBeenCalledTimes(1);

      fireEvent.click(rowButton(101, "View Details"));
      const sheet = await screen.findByRole("dialog");
      expect(within(sheet).getByRole("button", { name: "Accept" })).toBeDisabled();
      expect(within(sheet).getByRole("button", { name: "Dismiss" })).toBeDisabled();

      await act(async () => settle({ jobId: "00042" }));
      expect(within(sheet).getByRole("button", { name: "Accept" })).toBeEnabled();
    });

    it("keeps the row marked and shows why when a decision fails", async () => {
      vi.spyOn(bridge, "acceptInboxProposal").mockRejectedValue({
        code: "CONFLICT",
        message: "Inbox proposal 1 is already Accepted",
      });
      listInboxProposalsSpy.mockResolvedValue([proposal(1, 101)]);

      render(<InboxView projects={mockProjects} />);
      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-1")).toBeInTheDocument());

      fireEvent.click(rowButton(101, "Accept"));

      await waitFor(() => {
        expect(screen.getByTestId("inbox-proposal-error")).toHaveTextContent(/already Accepted/);
      });
      expect(within(issueRow(101)!).getByTestId("inbox-awaiting-mark-1")).toBeInTheDocument();
      expect(rowButton(101, "Accept")).toBeEnabled();
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
      expect(anyAwaitingMark()).toBeNull();
    });

    it("keeps the proposals decidable when the GitHub list fails", async () => {
      // They come from the daemon, not from GitHub, and deciding on them worked through a GitHub
      // outage while they were a list of their own.
      listGitHubIssuesSpy.mockRejectedValue({ code: "GITHUB_ERROR", message: "rate limited" });
      listInboxProposalsSpy.mockResolvedValue([proposal(1, 101)]);
      render(<InboxView projects={mockProjects} />);

      await waitFor(() => expect(screen.getByTestId("inbox-error")).toBeInTheDocument());
      await waitFor(() => expect(issueRow(101)).not.toBeNull());
      expect(within(issueRow(101)!).getByText("#101 Swept issue 101")).toBeInTheDocument();
      expect(rowButton(101, "Accept")).toBeInTheDocument();
    });

    it("says where the rest of a partly auto-accepted sweep went", () => {
      expect(
        describeSweep(report({ imported: [proposal(1, 101), proposal(2, 102)], accepted: 1 })),
      ).toBe(
        "Imported 2, skipped 0. 1 started a plan straight away (the rest await your decision).",
      );
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

    /**
     * The reported bug, as a test: "issues list can get long and then you scroll away the inbox
     * sidebar". A long list must not lengthen the *view*, because the view sits inside the shell's
     * `overflow-y-auto` frame (`CONTENT_PADDED_CLASS`, `ShellLayout.tsx:75`) and the rail sits
     * inside that same frame — so the moment the view outgrows it, scrolling to read the list
     * scrolls the rail off the top.
     */
    it("keeps the scroll inside the table when the list is long, not on the page", async () => {
      listGitHubIssuesSpy.mockResolvedValue(longIssuePage());
      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();
      await waitFor(() => expect(issueRow(300)).not.toBeNull());
      expect(document.querySelectorAll("[data-row-id]").length).toBe(LONG_PAGE);

      // Every row is mounted — the rows are real height the layout has to absorb somewhere.
      const table = screen.getByTestId("inbox-issue-table");
      const viewport = table.parentElement as HTMLElement;
      expect(viewport.className).toContain("overflow-auto");

      // ...and the place it is absorbed is that viewport: it is the nearest scroller to the rows,
      // and every ancestor between it and the view root either clips or refuses to grow.
      let node = viewport.parentElement as HTMLElement;
      const root = screen.getByTestId("inbox-view");
      while (node !== root) {
        expect(node.className).not.toContain("overflow-y-auto");
        expect(node.className).not.toContain("overflow-auto");
        node = node.parentElement as HTMLElement;
      }
      // The view root is `h-full`, so it is the frame's height whatever the row count is.
      expect(root.className).toContain("h-full");
      expect(root.className).not.toContain("h-auto");
    });

    it("leaves the rail in place, and scrolling itself, once the list is long", async () => {
      listGitHubIssuesSpy.mockResolvedValue(longIssuePage());
      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();
      await waitFor(() => expect(issueRow(300)).not.toBeNull());

      // Still mounted, still the view root's first child, still beside the content rather than
      // above it: the rail cannot be pushed anywhere by a list it is not inside.
      const root = screen.getByTestId("inbox-view");
      const rail = screen.getByRole("tablist", { name: "Inbox categories" });
      expect(rail.parentElement).toBe(root);
      expect(root.firstElementChild).toBe(rail);
      expect(root.className).toContain("flex");
      expect(screen.getByTestId("category-my-issues")).toBeInTheDocument();

      // `shrink-0` so the list cannot squeeze it, `overflow-y-auto` so a long project list scrolls
      // the rail and not the page — the sidebar's half of the same bug.
      expect(rail.className).toContain("shrink-0");
      expect(rail.className).toContain("overflow-y-auto");
      expect(rail.contains(screen.getByTestId("inbox-issue-table"))).toBe(false);
    });

    /**
     * A filter you can only reach by scrolling past everything it filters is the same bug wearing a
     * different hat. The filters live in the `DataTable` toolbar (as `PullRequestsView` puts them),
     * which `fillHeight` renders `shrink-0` *above* the scroll viewport — so they are outside the
     * thing that scrolls, not at the end of it.
     *
     * The controls are looked up *inside* the toolbar rather than across the document, and that is
     * load-bearing for the suite, not style. A label or accessible-name query asks every candidate
     * element for its `labels`, and jsdom answers that by walking the whole document and asking each
     * node for its `control` — which, for a `<label for>`, is another walk of the document to find
     * the id (`HTMLLabelElement-impl.js`, `helpers/form-controls.js`). A long page carries 51 of
     * those labels (the `DataTable`'s sr-only "Select row N" and "Select all rows") and ~280
     * labelable buttons, so one document-wide `getByLabelText` here cost ~1s on an idle machine and
     * over 5s on a loaded one: the test timed out, and its orphaned continuation then typed into the
     * next test's search box and failed that one too. Scoped to the toolbar, only its own few
     * controls are asked. It still fails if the search box leaves the toolbar, since `within` then
     * finds nothing.
     */
    it("keeps the filter bar above the rows instead of at the end of them", async () => {
      listGitHubIssuesSpy.mockResolvedValue(longIssuePage());
      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();
      await waitFor(() => expect(issueRow(300)).not.toBeNull());

      // The toolbar is the table's own `shrink-0` chrome, and it precedes the viewport's box.
      const table = screen.getByTestId("inbox-issue-table");
      const viewport = table.parentElement as HTMLElement;
      const tableRoot = viewport.parentElement?.parentElement as HTMLElement;
      const toolbar = tableRoot.firstElementChild as HTMLElement;
      const search = within(toolbar).getByLabelText("Search issues");

      // Not inside the scroller, so no amount of scrolling can move it off screen.
      expect(viewport.contains(search)).toBe(false);
      const labelFilter = within(toolbar).getByRole("button", { name: "Filter by label..." });
      const assigneeFilter = within(toolbar).getByRole("button", { name: "Filter by assignee..." });
      expect(viewport.contains(labelFilter)).toBe(false);
      expect(viewport.contains(assigneeFilter)).toBe(false);

      expect(toolbar.className).toContain("shrink-0");
      expect(
        toolbar.compareDocumentPosition(viewport) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // And it still filters, from where it sits: the point of pinning it.
      fireEvent.change(search, { target: { value: "Issue 301" } });
      await waitFor(() => expect(issueRow(300)).toBeNull());
      expect(issueRow(301)).not.toBeNull();
      expect(screen.getByLabelText("Search issues")).toBeInTheDocument();
    });

    /**
     * The proposals used to be a second list above the table, and the one that broke the page: an
     * unbounded flex child kept its content height as its flex basis and left the bounded table
     * nothing to fill, which is why it once needed a `HeaderLayout` and a height cap of its own.
     * As rows of the table they are inside the table's own scroller, so a sweep that imports a
     * whole page's worth takes no height from the column at all.
     */
    it("keeps a whole page of awaiting issues inside the table's own scroller", async () => {
      listInboxProposalsSpy.mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => ({
          id: i + 1,
          number: 300 + i,
          repository: "SpaceCorps/Tendril-App",
          title: `Swept issue ${300 + i}`,
          body: "Assigned to me by someone else.",
          issueUrl: `https://github.com/SpaceCorps/Tendril-App/issues/${300 + i}`,
          project: "Tendril-App",
          state: "Pending",
          discovered: "2026-09-10T09:00:00Z",
          updated: "2026-09-10T09:00:00Z",
        })),
      );
      listGitHubIssuesSpy.mockResolvedValue(longIssuePage());
      render(<InboxView projects={mockProjects} />);
      await waitForInboxIdle();
      await waitFor(() => expect(screen.getByTestId("inbox-awaiting-mark-25")).toBeInTheDocument());

      // No panel of its own, and no row twice.
      expect(screen.queryByTestId("inbox-proposals")).not.toBeInTheDocument();
      expect(
        screen.getByTestId("inbox-content").querySelector('[data-slot="header-layout"]'),
      ).toBeNull();
      expect(document.querySelectorAll("[data-row-id]").length).toBe(LONG_PAGE);

      // Every marked row is in the table's viewport, and that viewport is still the only scroller
      // between the rows and the view root.
      const table = screen.getByTestId("inbox-issue-table");
      const viewport = table.parentElement as HTMLElement;
      expect(viewport.className).toContain("overflow-auto");
      expect(viewport.contains(screen.getByTestId("inbox-awaiting-mark-1"))).toBe(true);
      expect(viewport.contains(screen.getByTestId("inbox-awaiting-mark-25"))).toBe(true);
      let node = viewport.parentElement as HTMLElement;
      const root = screen.getByTestId("inbox-view");
      while (node !== root) {
        expect(node.className).not.toContain("overflow-y-auto");
        expect(node.className).not.toContain("overflow-auto");
        node = node.parentElement as HTMLElement;
      }
      expect(root.className).not.toContain("overflow");
    });
  });
});
