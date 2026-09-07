import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { InboxView } from "../src/views/InboxView";
import { bridge } from "../src/api/bridge";
import type { GitHubIssue, ProjectSummary } from "../src/types/api";

describe("InboxView Component & Triage Tests", () => {
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
    vi.spyOn(bridge, "listGitHubIssues").mockResolvedValue(mockIssues);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders category switcher and responds to category selection changes", async () => {
    render(<InboxView projects={mockProjects} />);

    expect(screen.getByTestId("inbox-view")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /my issues/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /review requests/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /project issues/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(bridge.listGitHubIssues).toHaveBeenCalledWith(undefined, "my-issues");
    });

    // Switch to Review Requests
    const reviewRequestsTab = screen.getByRole("tab", { name: /review requests/i });
    fireEvent.click(reviewRequestsTab);

    await waitFor(() => {
      expect(bridge.listGitHubIssues).toHaveBeenCalledWith(undefined, "review-requests");
    });

    // Switch to Project Issues
    const projectIssuesTab = screen.getByRole("tab", { name: /project issues/i });
    fireEvent.click(projectIssuesTab);

    await waitFor(() => {
      expect(bridge.listGitHubIssues).toHaveBeenCalledWith(
        mockProjects[0].repos[0],
        "project-issues"
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
    const { getByText } = within(card101);
    expect(getByText("#101")).toBeInTheDocument();
    expect(getByText("Add offline cache for plans")).toBeInTheDocument();
    expect(getByText("@alice")).toBeInTheDocument();
    expect(getByText("5")).toBeInTheDocument(); // Comments count
    expect(getByText("feature")).toBeInTheDocument();
    expect(getByText("priority-high")).toBeInTheDocument();
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
    vi.spyOn(bridge, "listGitHubIssues").mockResolvedValue([]);
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
});
