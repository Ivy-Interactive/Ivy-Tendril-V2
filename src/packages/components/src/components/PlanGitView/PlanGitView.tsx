import React, { useCallback } from "react";
import { Copy, GitBranchPlus, GitCommitHorizontal } from "lucide-react";
import { IconButton } from "../ui/IconButton";

/**
 * Whether a ref still holds a commit the plan recorded, in the repo it was made in.
 *
 * `unreachable` and `missing` are lost work. Once a plan's worktree and branch are gone, its
 * commits are held alive only by whatever ref the merge left behind; when nothing holds one it
 * survives as a loose object that the next `git gc` in that repo prunes.
 */
export type CommitRefStatus = "reachable" | "unreachable" | "missing";

/** One of a plan's recorded commits, resolved against a repo that still holds it. */
export interface PlanCommitRow {
  hash: string;
  shortHash: string;
  /** The commit's subject line, or empty when no repo could resolve the hash. */
  title: string;
  /** Files the commit touched, or absent when no repo could resolve the hash. */
  fileCount?: number | null;
}

/** A worktree the plan still has on disk, and the commits reachable from its HEAD. */
export interface PlanWorktreeSection {
  name: string;
  path: string;
  /** HEAD's branch, or empty for a detached HEAD. */
  branch: string;
  shortHash: string;
  hasUncommittedChanges: boolean;
  commits: PlanCommitRow[];
  parentRepoPath?: string | null;
  baseBranch?: string | null;
  baseShortHash?: string | null;
}

/**
 * The Git tab's data for one plan.
 *
 * Commits listed under a worktree section are ancestors of that worktree's HEAD and so reachable by
 * definition. Only the unassociated ones carry a status, because those are exactly the commits that
 * can turn out to be reachable from nothing at all.
 */
export interface PlanGitData {
  worktrees: PlanWorktreeSection[];
  unassociatedCommits: PlanCommitRow[];
  /** Keyed by full commit hash. Absent means reachable. */
  unassociatedCommitRefStatus: Record<string, CommitRefStatus>;
}

export interface PlanGitViewProps {
  data: PlanGitData;
  prs?: string[];
  planState?: string;
  onOpenUrl?: (url: string) => void;
}

/** `1 commit is` / `3 commits are`, so a sentence built from a count still reads as English. */
function count(n: number): string {
  return n === 1 ? "1 commit is" : `${n} commits are`;
}

/** Worktree paths are stored as git reports them, so a Windows plan carries backslashes. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Why a plan has no worktrees, which depends entirely on where the plan got to. A completed plan
 * losing its worktrees is housekeeping; a plan still executing without one is a problem.
 */
function noWorktreesReason(planState: string | undefined): string {
  switch (planState) {
    case "Completed":
    case "Skipped":
    case "Icebox":
      return "The worktrees were removed after the plan reached its final state.";
    case "Failed":
    case "Draft":
      return "The worktrees were never created, or were reclaimed by the stale reaper once the plan sat idle past its window.";
    default:
      return "The worktrees were removed, or were never created.";
  }
}

/**
 * `owner/repo` from a PR URL, which is what names the row; the URL itself if it will not parse.
 *
 * Mirrors `PullRequestApp.ExtractRepo`. Its companion `IsValidUrl` is deliberately not mirrored: it
 * accepts only `github.com/../../pull/N`, and dropping everything else here would silently hide a
 * PR link this view was handed. Whether a plan's recorded PR is a real one belongs to whatever
 * writes `prs`, not to the renderer.
 */
function extractRepo(prUrl: string): string {
  try {
    const segments = new URL(prUrl).pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (segments.length >= 2) return `${segments[0]}/${segments[1]}`;
  } catch {
    // Not a URL after all; the raw value is the best label available.
  }
  return prUrl;
}

const AT_RISK_BADGE: Partial<Record<CommitRefStatus, string>> = {
  unreachable: "unreachable",
  missing: "not found",
};

const Hashes: React.FC<{ rows: PlanCommitRow[] }> = ({ rows }) => (
  <>
    {rows.map((row, i) => (
      <React.Fragment key={row.hash}>
        {i > 0 && ", "}
        <code className="font-mono">{row.shortHash}</code>
      </React.Fragment>
    ))}
  </>
);

/** One row of a commit table: short hash, subject, file count. */
const CommitTable: React.FC<{
  rows: PlanCommitRow[];
  statusOf?: (hash: string) => CommitRefStatus | undefined;
}> = ({ rows, statusOf }) => (
  <table className="mt-3 w-full text-left text-sm">
    <thead>
      <tr className="text-xs uppercase tracking-wide text-muted-foreground/70">
        <th scope="col" className="py-1 pr-3 font-medium">
          Commit
        </th>
        <th scope="col" className="py-1 pr-3 font-medium">
          Message
        </th>
        <th scope="col" className="w-16 py-1 text-right font-medium">
          Files
        </th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => {
        const badge = statusOf ? AT_RISK_BADGE[statusOf(row.hash) ?? "reachable"] : undefined;
        return (
          <tr key={row.hash} className="border-t border-border/50">
            <td className="py-1 pr-3 align-top font-mono text-xs text-muted-foreground">
              <span title={row.hash}>{row.shortHash}</span>
            </td>
            <td className="py-1 pr-3 align-top text-foreground">
              {row.title || <span className="text-muted-foreground/70">(unresolved commit)</span>}
              {badge && (
                <span className="ml-2 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-destructive">
                  {badge}
                </span>
              )}
            </td>
            <td className="w-16 py-1 text-right align-top text-xs text-muted-foreground/70">
              {row.fileCount === null || row.fileCount === undefined ? "–" : row.fileCount}
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex gap-2">
    <dt className="w-24 shrink-0 text-muted-foreground/70">{label}</dt>
    <dd className="break-all font-mono text-muted-foreground">{value}</dd>
  </div>
);

/**
 * A plan's git state: one section per surviving worktree with the plan's commits grouped under the
 * worktree that made them, the commits no worktree accounts for below, and the plan's pull requests.
 *
 * The warning at the very top is the reason this view exists. Nowhere else in the UI distinguishes a
 * commit safely on a merged branch from one held by nothing at all — the metadata tab lists the same
 * hashes and looks perfectly healthy either way. A commit reachable from no ref lives on only as a
 * loose object until the next `git gc` deletes it, so this says so while it can still be rescued.
 *
 * Presentational: props in, no fetching. The caller owns the fetch, because the at-risk count also
 * badges the tab button and so has to be known before the tab is ever opened.
 */
export const PlanGitView: React.FC<PlanGitViewProps> = ({
  data,
  prs = [],
  planState,
  onOpenUrl,
}) => {
  const statusOf = useCallback(
    (hash: string): CommitRefStatus | undefined => data.unassociatedCommitRefStatus[hash],
    [data.unassociatedCommitRefStatus],
  );

  const unreachable = data.unassociatedCommits.filter((r) => statusOf(r.hash) === "unreachable");
  const missing = data.unassociatedCommits.filter((r) => statusOf(r.hash) === "missing");

  const prRows = prs.map((url) => ({ repository: extractRepo(url), url }));

  const isEmpty =
    data.worktrees.length === 0 && data.unassociatedCommits.length === 0 && prs.length === 0;

  const copyPath = (path: string) => {
    void navigator.clipboard?.writeText(path);
  };

  return (
    <div className="space-y-6">
      {(unreachable.length > 0 || missing.length > 0) && (
        <div
          role="alert"
          data-testid="commits-at-risk"
          className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive"
        >
          <p className="text-sm font-semibold uppercase tracking-wide">Commits at risk</p>

          {unreachable.length > 0 && (
            <p>
              {count(unreachable.length)} reachable from no branch, tag or remote:{" "}
              <Hashes rows={unreachable} />. They exist only as loose objects, so the next{" "}
              <code className="font-mono">git gc</code> in the repo destroys them. Give one a ref to
              keep it:{" "}
              <code className="font-mono">git branch recover/&lt;name&gt; &lt;hash&gt;</code>.
            </p>
          )}

          {missing.length > 0 && (
            <p>
              {count(missing.length)} not found in the plan's repos at all:{" "}
              <Hashes rows={missing} />. Either the object was already pruned, or the repo it was
              made in is not one of the plan's repos.
            </p>
          )}
        </div>
      )}

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Worktrees
        </h4>

        {data.worktrees.length === 0 ? (
          <div className="mt-2 flex flex-col items-center gap-1 rounded-xl border border-border bg-card/40 p-4 text-center">
            <GitBranchPlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground/70">{noWorktreesReason(planState)}</p>
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            {data.worktrees.map((worktree) => (
              <div key={worktree.path} className="rounded-xl border border-border bg-card/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{worktree.name}</span>
                  <IconButton
                    label={`Copy path to ${worktree.name}`}
                    tooltip={false}
                    size="xs"
                    variant="outline"
                    className="border-border bg-transparent hover:bg-muted"
                    onClick={() => copyPath(normalizePath(worktree.path))}
                  >
                    <Copy className="h-3 w-3" />
                  </IconButton>
                </div>

                <dl className="mt-2 space-y-1 text-xs">
                  {worktree.parentRepoPath && (
                    <DetailRow label="Repository" value={normalizePath(worktree.parentRepoPath)} />
                  )}
                  {worktree.baseBranch && (
                    <DetailRow
                      label="Base"
                      value={
                        worktree.baseShortHash
                          ? `${worktree.baseBranch}@${worktree.baseShortHash}`
                          : worktree.baseBranch
                      }
                    />
                  )}
                  <DetailRow label="Worktree" value={normalizePath(worktree.path)} />
                  <DetailRow
                    label="Head"
                    value={`${worktree.branch || "detached HEAD"}@${worktree.shortHash}`}
                  />
                </dl>

                {worktree.hasUncommittedChanges && (
                  <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning">
                    This worktree has uncommitted changes. They belong to no commit, so nothing at
                    all is keeping them.
                  </p>
                )}

                {worktree.commits.length > 0 ? (
                  <CommitTable rows={worktree.commits} />
                ) : (
                  <div className="mt-3 flex flex-col items-center gap-1 rounded-lg border border-border bg-card/40 p-3 text-center">
                    <GitCommitHorizontal
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <p className="text-sm text-muted-foreground/70">(no commits)</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {data.unassociatedCommits.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Commits
          </h4>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Recorded on the plan but reached from no worktree the plan still has — usually because
            the worktree was removed once the PR merged.
          </p>
          <div className="mt-2 rounded-xl border border-border bg-card/40 p-4">
            <CommitTable rows={data.unassociatedCommits} statusOf={statusOf} />
          </div>
        </section>
      )}

      {prs.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pull Requests
          </h4>
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground/70">
                <th scope="col" className="py-1 pr-3 font-medium">
                  Repository
                </th>
                <th scope="col" className="py-1 font-medium">
                  PR
                </th>
              </tr>
            </thead>
            <tbody>
              {prRows.map(({ repository, url }) => (
                <tr key={url} className="border-t border-border/50">
                  <td className="py-1 pr-3 align-top font-mono text-xs text-muted-foreground">
                    {repository}
                  </td>
                  <td className="py-1 align-top">
                    <button
                      type="button"
                      onClick={() => onOpenUrl?.(url)}
                      className="break-all text-left text-sm text-primary hover:underline"
                    >
                      {url}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {isEmpty && (
        <p className="text-sm text-muted-foreground/70">
          This plan has no worktrees, commits, or pull requests yet.
        </p>
      )}
    </div>
  );
};
