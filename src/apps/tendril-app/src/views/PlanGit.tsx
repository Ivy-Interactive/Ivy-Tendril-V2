import React, { useCallback, useEffect, useState } from "react";
import { bridge } from "../api/bridge";
import {
  describeBridgeError,
  type CommitRefStatus,
  type CommitRow,
  type PlanGit as PlanGitData,
} from "../types/api";

interface PlanGitProps {
  planId: string;
}

const STATUS_CLASS: Record<CommitRefStatus, string> = {
  Reachable: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  Unreachable: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  Missing: "bg-rose-500/20 text-rose-200 border-rose-500/50",
};

const STATUS_LABEL: Record<CommitRefStatus, string> = {
  Reachable: "Reachable",
  Unreachable: "Lost work",
  Missing: "Missing",
};

/** `Unreachable` and `Missing` are the two verdicts that mean work is about to be destroyed. */
function isAtRisk(status: CommitRefStatus | undefined): boolean {
  return status === "Unreachable" || status === "Missing";
}

function fileSummary(row: CommitRow): string {
  if (row.fileCount === undefined) return "";
  return row.fileCount === 1 ? "1 file" : `${row.fileCount} files`;
}

const CommitLine: React.FC<{ row: CommitRow; status?: CommitRefStatus }> = ({ row, status }) => (
  <li className="flex flex-wrap items-baseline gap-2">
    <span className="font-mono text-xs text-muted-foreground" title={row.hash}>
      {row.shortHash}
    </span>
    <span className="text-sm text-foreground">{row.title || "(unresolved commit)"}</span>
    {row.fileCount !== undefined && (
      <span className="text-xs text-muted-foreground/70">{fileSummary(row)}</span>
    )}
    {status && (
      <span
        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_CLASS[status]}`}
      >
        {STATUS_LABEL[status]}
      </span>
    )}
  </li>
);

/**
 * The plan's git state: one card per surviving worktree with the commits it made, and the commits no
 * worktree accounts for.
 *
 * The warning at the top is the reason this tab exists. A plan's worktree and branch are removed
 * once its PR merges, and a commit that was never pushed is then held by nothing at all — it lives
 * on as a loose object until the next `git gc` in that repo deletes it, silently. Nowhere else in
 * the UI would say so: the metadata tab lists the same hashes and looks perfectly healthy.
 */
export const PlanGit: React.FC<PlanGitProps> = ({ planId }) => {
  const [data, setData] = useState<PlanGitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await bridge.getPlanGit(planId));
      setError(null);
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusOf = (hash: string): CommitRefStatus | undefined =>
    data?.unassociatedCommitRefStatus[hash];

  const atRisk = (data?.unassociatedCommits ?? []).filter((row) => isAtRisk(statusOf(row.hash)));
  const isEmpty =
    data !== null && data.worktrees.length === 0 && data.unassociatedCommits.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Git
        </h4>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {atRisk.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/50 bg-rose-500/10 p-4 text-rose-200"
        >
          <p className="text-sm font-semibold uppercase tracking-wide">
            Lost work: {atRisk.length} {atRisk.length === 1 ? "commit is" : "commits are"} not
            reachable from any branch, tag or remote
          </p>
          <p className="mt-1 text-xs text-rose-200/80">
            This work survives only as loose git objects. The next <code>git gc</code> in the
            repository will delete it. Recover it now — create a branch or tag at the commit, or
            cherry-pick it somewhere that is pushed.
          </p>
          <ul className="mt-3 space-y-1">
            {atRisk.map((row) => (
              <CommitLine key={row.hash} row={row} status={statusOf(row.hash)} />
            ))}
          </ul>
        </div>
      )}

      {data?.worktrees.map((worktree) => (
        <div key={worktree.path} className="rounded-xl border border-border bg-card/40 p-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground">{worktree.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {worktree.branch || "detached HEAD"}
            </span>
            <span className="font-mono text-xs text-muted-foreground/70">{worktree.shortHash}</span>
            {worktree.hasUncommittedChanges && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                Uncommitted changes
              </span>
            )}
          </div>

          <p className="mt-1 break-all font-mono text-xs text-muted-foreground/70">
            {worktree.path}
          </p>

          {worktree.baseBranch && (
            <p className="mt-1 text-xs text-muted-foreground">
              Based on{" "}
              <span className="font-mono">
                {worktree.baseBranch}
                {worktree.baseShortHash ? ` @ ${worktree.baseShortHash}` : ""}
              </span>
            </p>
          )}

          <ul className="mt-3 space-y-1">
            {worktree.commits.length > 0 ? (
              worktree.commits.map((row) => <CommitLine key={row.hash} row={row} />)
            ) : (
              <li className="text-sm text-muted-foreground/70">No commits in this worktree</li>
            )}
          </ul>
        </div>
      ))}

      {data && data.unassociatedCommits.length > 0 && (
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Commits without a worktree
          </h4>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Recorded on the plan but reached by no worktree the plan still has — usually because the
            worktree was removed after the PR merged.
          </p>
          <ul className="mt-3 space-y-1">
            {data.unassociatedCommits.map((row) => (
              <CommitLine key={row.hash} row={row} status={statusOf(row.hash)} />
            ))}
          </ul>
        </div>
      )}

      {isEmpty && !error && (
        <p className="text-sm text-muted-foreground/70">No worktrees or commits recorded</p>
      )}
    </div>
  );
};
