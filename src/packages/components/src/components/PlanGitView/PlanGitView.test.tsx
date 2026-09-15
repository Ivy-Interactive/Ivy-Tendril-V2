import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import {
  PlanGitView,
  type PlanCommitRow,
  type PlanGitData,
  type PlanWorktreeSection,
} from "./PlanGitView";

function commit(overrides: Partial<PlanCommitRow> = {}): PlanCommitRow {
  const hash = overrides.hash ?? "aaaaaaa1111111111111111111111111111111111";
  return {
    hash,
    shortHash: hash.slice(0, 7),
    title: "Add the thing",
    fileCount: 3,
    ...overrides,
  };
}

function section(overrides: Partial<PlanWorktreeSection> = {}): PlanWorktreeSection {
  return {
    name: "Ivy-Tendril-V2",
    path: "/plans/00637/Worktrees/Ivy-Tendril-V2",
    branch: "tendril/00637",
    shortHash: "1234567",
    hasUncommittedChanges: false,
    commits: [commit()],
    parentRepoPath: "/repos/Ivy-Tendril-V2",
    baseBranch: "main",
    baseShortHash: "abcdef0",
    ...overrides,
  };
}

function data(overrides: Partial<PlanGitData> = {}): PlanGitData {
  return {
    worktrees: [section()],
    unassociatedCommits: [],
    unassociatedCommitRefStatus: {},
    ...overrides,
  };
}

const LOST = commit({ hash: "b".repeat(40), title: "Work held by nothing" });
const GONE = commit({ hash: "c".repeat(40), title: "Pruned already", fileCount: null });

afterEach(() => cleanup());

describe("PlanGitView commits-at-risk banner", () => {
  it("warns and names the short hash and recovery command for an unreachable commit", () => {
    render(
      <PlanGitView
        data={data({
          unassociatedCommits: [LOST],
          unassociatedCommitRefStatus: { [LOST.hash]: "unreachable" },
        })}
      />,
    );

    const banner = screen.getByTestId("commits-at-risk");
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent("reachable from no branch, tag or remote");
    expect(banner).toHaveTextContent(LOST.shortHash);
    expect(banner).toHaveTextContent("git branch recover/<name> <hash>");
  });

  it("uses the distinct not-found wording for a missing commit", () => {
    render(
      <PlanGitView
        data={data({
          unassociatedCommits: [GONE],
          unassociatedCommitRefStatus: { [GONE.hash]: "missing" },
        })}
      />,
    );

    const banner = screen.getByTestId("commits-at-risk");
    expect(banner).toHaveTextContent("not found in the plan's repos at all");
    expect(banner).toHaveTextContent(GONE.shortHash);
    expect(banner).not.toHaveTextContent("reachable from no branch");
  });

  it("renders both sentences when both buckets are populated", () => {
    render(
      <PlanGitView
        data={data({
          unassociatedCommits: [LOST, GONE],
          unassociatedCommitRefStatus: { [LOST.hash]: "unreachable", [GONE.hash]: "missing" },
        })}
      />,
    );

    const banner = screen.getByTestId("commits-at-risk");
    expect(banner).toHaveTextContent("reachable from no branch, tag or remote");
    expect(banner).toHaveTextContent("not found in the plan's repos at all");
  });

  // The false-alarm guard. A commit sitting safely on a merged branch must produce no warning at
  // all, or the warning stops meaning anything.
  it("shows no banner when every commit is reachable", () => {
    render(
      <PlanGitView
        data={data({
          unassociatedCommits: [LOST],
          unassociatedCommitRefStatus: { [LOST.hash]: "reachable" },
        })}
      />,
    );

    expect(screen.queryByTestId("commits-at-risk")).not.toBeInTheDocument();
  });

  it("treats a commit absent from the status map as reachable", () => {
    render(<PlanGitView data={data({ unassociatedCommits: [LOST] })} />);

    expect(screen.queryByTestId("commits-at-risk")).not.toBeInTheDocument();
  });

  it("reads as English for one commit and for several", () => {
    const { unmount } = render(
      <PlanGitView
        data={data({
          unassociatedCommits: [LOST],
          unassociatedCommitRefStatus: { [LOST.hash]: "unreachable" },
        })}
      />,
    );
    expect(screen.getByTestId("commits-at-risk")).toHaveTextContent(
      "1 commit is reachable from no",
    );
    unmount();

    const second = commit({ hash: "d".repeat(40) });
    render(
      <PlanGitView
        data={data({
          unassociatedCommits: [LOST, second],
          unassociatedCommitRefStatus: {
            [LOST.hash]: "unreachable",
            [second.hash]: "unreachable",
          },
        })}
      />,
    );
    expect(screen.getByTestId("commits-at-risk")).toHaveTextContent(
      "2 commits are reachable from no",
    );
  });
});

describe("PlanGitView commit rows", () => {
  it("badges an unreachable row, a missing row, and leaves a reachable row unbadged", () => {
    const safe = commit({ hash: "e".repeat(40), title: "Safely merged" });
    render(
      <PlanGitView
        data={data({
          unassociatedCommits: [LOST, GONE, safe],
          unassociatedCommitRefStatus: {
            [LOST.hash]: "unreachable",
            [GONE.hash]: "missing",
            [safe.hash]: "reachable",
          },
        })}
      />,
    );

    const rowOf = (row: PlanCommitRow) => screen.getByText(row.title).closest("td")!;
    expect(within(rowOf(LOST)).getByText("unreachable")).toBeInTheDocument();
    expect(within(rowOf(GONE)).getByText("not found")).toBeInTheDocument();
    expect(within(rowOf(safe)).queryByText(/unreachable|not found/)).not.toBeInTheDocument();
  });

  it("renders a dash for an unresolvable file count", () => {
    render(<PlanGitView data={data({ worktrees: [section({ commits: [GONE] })] })} />);

    expect(screen.getByText("–")).toBeInTheDocument();
  });

  it("shows (no commits) for a worktree that made none", () => {
    render(<PlanGitView data={data({ worktrees: [section({ commits: [] })] })} />);

    expect(screen.getByText("(no commits)")).toBeInTheDocument();
  });
});

describe("PlanGitView worktree sections", () => {
  it("explains the absence of worktrees differently per plan state", () => {
    const empty = data({ worktrees: [] });

    const completed = render(<PlanGitView data={empty} planState="Completed" />);
    expect(screen.getByText(/removed after the plan reached its final state/)).toBeInTheDocument();
    completed.unmount();

    const draft = render(<PlanGitView data={empty} planState="Draft" />);
    expect(
      screen.getByText(/never created, or were reclaimed by the stale reaper/),
    ).toBeInTheDocument();
    draft.unmount();

    render(<PlanGitView data={empty} planState="Executing" />);
    expect(screen.getByText(/removed, or were never created/)).toBeInTheDocument();
  });

  it("omits the Base row when the base branch is unknown", () => {
    const { unmount } = render(<PlanGitView data={data()} />);
    expect(screen.getByText("Base")).toBeInTheDocument();
    unmount();

    render(
      <PlanGitView
        data={data({ worktrees: [section({ baseBranch: null, baseShortHash: null })] })}
      />,
    );
    expect(screen.queryByText("Base")).not.toBeInTheDocument();
    expect(screen.getByText("Head")).toBeInTheDocument();
  });

  it("reports the branch, head and uncommitted flag", () => {
    render(<PlanGitView data={data({ worktrees: [section({ hasUncommittedChanges: true })] })} />);

    expect(screen.getByText("tendril/00637@1234567")).toBeInTheDocument();
    expect(screen.getByText("main@abcdef0")).toBeInTheDocument();
    expect(screen.getByText(/has uncommitted changes/)).toBeInTheDocument();
  });

  it("normalises Windows worktree paths for display", () => {
    render(
      <PlanGitView
        data={data({
          worktrees: [
            section({
              path: String.raw`D:\Plans\00637\Worktrees\Repo`,
              parentRepoPath: String.raw`D:\Repos\Repo`,
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText("D:/Plans/00637/Worktrees/Repo")).toBeInTheDocument();
    expect(screen.getByText("D:/Repos/Repo")).toBeInTheDocument();
  });
});

describe("PlanGitView pull requests and empty state", () => {
  it("lists pull requests and opens one through the callback", () => {
    const opened: string[] = [];
    const url = "https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/42";
    render(<PlanGitView data={data()} prs={[url]} onOpenUrl={(u) => opened.push(u)} />);

    screen.getByRole("button", { name: url }).click();
    expect(opened).toEqual([url]);
  });

  it("says so when there are no worktrees, commits or pull requests", () => {
    render(<PlanGitView data={data({ worktrees: [] })} prs={[]} />);

    expect(
      screen.getByText("This plan has no worktrees, commits, or pull requests yet."),
    ).toBeInTheDocument();
  });
});
