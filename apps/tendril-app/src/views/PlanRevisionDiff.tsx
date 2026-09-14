import React, { useEffect, useMemo, useState } from "react";
import { createTwoFilesPatch } from "diff";
import { PlanDiffView } from "@spacecorps/components-storybook/tendril";
import { bridge } from "../api/bridge";
import { describeBridgeError } from "../types/api";

interface PlanRevisionDiffProps {
  planId: string;
  /** `PlanDetail.revisionCount` — revisions are numbered 1..revisionCount. */
  revisionCount: number;
}

/** Build a unified diff between two revisions of a plan's `plan.md`. */
export function buildRevisionPatch(
  oldRevision: number,
  newRevision: number,
  oldContent: string,
  newContent: string,
): string {
  return createTwoFilesPatch(
    `plan.md (revision ${oldRevision})`,
    `plan.md (revision ${newRevision})`,
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: 3 },
  );
}

/**
 * Diff View tab: compares two real revisions fetched from the service, rather
 * than the hand-written patch this tab used to render.
 */
export const PlanRevisionDiff: React.FC<PlanRevisionDiffProps> = ({ planId, revisionCount }) => {
  const revisions = useMemo(
    () => Array.from({ length: revisionCount }, (_, i) => i + 1),
    [revisionCount],
  );

  const [oldRevision, setOldRevision] = useState(Math.max(1, revisionCount - 1));
  const [newRevision, setNewRevision] = useState(Math.max(1, revisionCount));
  const [contents, setContents] = useState<{ old: string; new: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the selectors inside 1..revisionCount when the plan gains revisions.
  useEffect(() => {
    setOldRevision((prev) => Math.min(Math.max(1, prev), Math.max(1, revisionCount)));
    setNewRevision((prev) => Math.min(Math.max(1, prev), Math.max(1, revisionCount)));
  }, [revisionCount]);

  useEffect(() => {
    if (revisionCount < 2) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    Promise.all([bridge.getRevision(planId, oldRevision), bridge.getRevision(planId, newRevision)])
      .then(([oldContent, newContent]) => {
        if (cancelled) return;
        setContents({ old: oldContent, new: newContent });
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setContents(null);
        setError(describeBridgeError(err));
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [planId, oldRevision, newRevision, revisionCount]);

  if (revisionCount < 2) {
    return (
      <p data-testid="diff-single-revision" className="text-sm text-slate-400">
        This plan has only one revision, so there is nothing to compare yet. A diff appears once
        CreatePlan or RetryPlan writes a new revision.
      </p>
    );
  }

  const patch = contents
    ? buildRevisionPatch(oldRevision, newRevision, contents.old, contents.new)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <label className="flex items-center gap-2">
          <span>Compare revision</span>
          <select
            aria-label="Old revision"
            value={oldRevision}
            onChange={(e) => setOldRevision(Number(e.target.value))}
            className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-slate-200"
          >
            {revisions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span>against</span>
          <select
            aria-label="New revision"
            value={newRevision}
            onChange={(e) => setNewRevision(Number(e.target.value))}
            className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-slate-200"
          >
            {revisions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="text-slate-500">
          {revisionCount} revision{revisionCount === 1 ? "" : "s"} on disk
        </span>
      </div>

      {isLoading && (
        <p data-testid="diff-loading" className="text-xs text-slate-500">
          Loading revisions {oldRevision} and {newRevision}...
        </p>
      )}

      {error && (
        <div
          data-testid="diff-error"
          className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-300"
        >
          {error}
        </div>
      )}

      {patch !== null &&
        !error &&
        (oldRevision === newRevision || contents?.old === contents?.new ? (
          <p data-testid="diff-identical" className="text-sm text-slate-400">
            Revisions {oldRevision} and {newRevision} are identical.
          </p>
        ) : (
          <PlanDiffView
            id="plan-diff"
            diff={patch}
            viewType="Unified"
            filePath="plan.md"
            oldRevision={String(oldRevision)}
            newRevision={String(newRevision)}
            language="markdown"
          />
        ))}
    </div>
  );
};
