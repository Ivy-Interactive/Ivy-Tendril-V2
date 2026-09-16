import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createTwoFilesPatch } from "diff";
import { PlanDiffView } from "@ivy-interactive/components/tendril";
import { bridge } from "../api/bridge";
import { onPlanEvent } from "../api/events";
import { describeBridgeError, type DraftComment } from "../types/api";

interface PlanRevisionDiffProps {
  planId: string;
  /** `PlanDetail.revisionCount` — revisions are numbered 1..revisionCount. */
  revisionCount: number;
}

/**
 * Build a unified diff between two revisions of a plan's `plan.md`.
 *
 * The `diff --git` line is required, not decorative: `PlanDiffView` parses with
 * `react-diff-view`'s `parseDiff`, which is `gitdiff-parser` and recognises no file at all without
 * it. A bare `createTwoFilesPatch` body parses to zero files, which is how this tab came to render
 * "No diff to display" for every plan.
 */
export function buildRevisionPatch(
  oldRevision: number,
  newRevision: number,
  oldContent: string,
  newContent: string,
): string {
  const body = createTwoFilesPatch(
    `plan.md (revision ${oldRevision})`,
    `plan.md (revision ${newRevision})`,
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: 3 },
  );
  return `diff --git a/plan.md b/plan.md\n${body}`;
}

/**
 * The path comments on this revision pair are filed under.
 *
 * A change key only identifies a line within one particular diff, so the same key means a different
 * line for every pair of revisions. Scoping the path keeps a comment attached to the diff it was
 * written against instead of reappearing on an unrelated line.
 */
export function revisionAnchor(oldRevision: number, newRevision: number): string {
  return `plan.md@${oldRevision}-${newRevision}`;
}

/** The bare path the original Tendril wrote, before comments were scoped to a revision pair. */
export const LEGACY_ANCHOR = "plan.md";

/**
 * Comments to render for one revision pair: this pair's own, plus every unscoped legacy comment.
 *
 * A legacy comment names no pair, so showing it on one arbitrarily chosen pair would hide a migrated
 * review everywhere else. Showing it on all of them keeps it reachable.
 */
export function commentsForRevisionPair(
  comments: DraftComment[],
  oldRevision: number,
  newRevision: number,
): DraftComment[] {
  const anchor = revisionAnchor(oldRevision, newRevision);
  return comments.filter((c) => c.filePath === anchor || c.filePath === LEGACY_ANCHOR);
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
  const [comments, setComments] = useState<DraftComment[]>([]);

  /**
   * Keep the selectors inside `1..revisionCount`, and keep them on the newest pair while that is
   * where they already were.
   *
   * Two cases the plain clamp got wrong. Mounting before the plan detail has landed puts both
   * selectors at 1, and clamping alone leaves them there once the real count arrives — the tab then
   * reports revisions 1 and 1 as identical instead of showing the latest diff. And an UpdatePlan or
   * RetryPlan run writing a new revision while the tab is open left the pair pointing at the previous
   * head, so the newly written revision was the one thing the diff did not show. A selection the
   * operator has deliberately moved off the head is left exactly where they put it.
   */
  const previousCount = useRef(revisionCount);
  useEffect(() => {
    const before = previousCount.current;
    previousCount.current = revisionCount;
    const ceiling = Math.max(1, revisionCount);
    const wasAtHead = before < 2 || newRevision === Math.max(1, before);

    if (wasAtHead && revisionCount > before) {
      setOldRevision(Math.max(1, revisionCount - 1));
      setNewRevision(ceiling);
      return;
    }
    setOldRevision((prev) => Math.min(Math.max(1, prev), ceiling));
    setNewRevision((prev) => Math.min(Math.max(1, prev), ceiling));
    // `newRevision` is read to decide whether the selection is still on the head; re-running this
    // whenever it changes would fight the operator's own choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Comments load once per plan, not per revision pair: the store holds every anchor at once, and
  // the filter below picks the ones this pair shows, so moving the selectors needs no refetch.
  const loadComments = useCallback(
    (signal?: { cancelled: boolean }) =>
      bridge
        .listDiffComments(planId)
        .then((loaded) => {
          if (signal?.cancelled) return;
          setComments(loaded);
        })
        .catch((err) => {
          if (signal?.cancelled) return;
          setError(describeBridgeError(err));
        }),
    [planId],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void loadComments(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadComments]);

  // Another window, or a job, can change this plan's comments; the daemon broadcasts when that
  // happens so the list here does not go stale.
  useEffect(() => {
    const signal = { cancelled: false };
    let unlisten: (() => void) | undefined;

    void onPlanEvent((payload) => {
      const event = payload as { type?: string; planId?: string } | null;
      if (event?.type !== "plan.diff_comments_changed") return;
      // Every plan shares the one `plan-event` channel, so another plan's change is not ours.
      if (event.planId !== planId) return;
      void loadComments();
    })
      .then((fn) => {
        if (signal.cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        // No live updates while the bridge is down. The list still refreshes after every write and
        // on remount, so this costs freshness rather than correctness.
      });

    return () => {
      signal.cancelled = true;
      unlisten?.();
    };
  }, [planId, loadComments]);

  const visibleComments = useMemo(
    () => commentsForRevisionPair(comments, oldRevision, newRevision),
    [comments, oldRevision, newRevision],
  );

  const eventHandler = useCallback(
    (eventName: string, _widgetId: string, args: unknown[]) => {
      const isDelete = eventName === "OnDeleteComment";
      if (!isDelete && eventName !== "OnAddComment" && eventName !== "OnUpdateComment") return;

      const comment = args[0] as DraftComment | undefined;
      if (!comment) return;

      // The response is the store's whole list, so state comes from what was persisted rather than
      // from a local guess that could disagree with it.
      const write = isDelete
        ? bridge.deleteDiffComment(planId, comment.filePath, comment.changeKey)
        : bridge.upsertDiffComment(planId, comment);

      write.then(setComments).catch((err) => setError(describeBridgeError(err)));
    },
    [planId],
  );

  if (revisionCount < 2) {
    return (
      <p data-testid="diff-single-revision" className="text-sm text-muted-foreground">
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
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          <span>Compare revision</span>
          <select
            aria-label="Old revision"
            value={oldRevision}
            onChange={(e) => setOldRevision(Number(e.target.value))}
            className="rounded border border-border bg-background px-2 py-1 text-foreground"
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
            className="rounded border border-border bg-background px-2 py-1 text-foreground"
          >
            {revisions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="text-muted-foreground/70">
          {revisionCount} revision{revisionCount === 1 ? "" : "s"} on disk
        </span>
      </div>

      {isLoading && (
        <p data-testid="diff-loading" className="text-xs text-muted-foreground/70">
          Loading revisions {oldRevision} and {newRevision}...
        </p>
      )}

      {error && (
        <div
          data-testid="diff-error"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {/*
        The diff is gated on `patch`, not on `error`: a failed revision fetch clears `contents` and
        so already hides it, whereas a rejected comment write must leave the reviewer's diff — and
        their unsaved place in it — on screen next to the message.
      */}
      {patch !== null &&
        (oldRevision === newRevision || contents?.old === contents?.new ? (
          <p data-testid="diff-identical" className="text-sm text-muted-foreground">
            Revisions {oldRevision} and {newRevision} are identical.
          </p>
        ) : (
          <PlanDiffView
            id="plan-diff"
            diff={patch}
            viewType="Unified"
            filePath={revisionAnchor(oldRevision, newRevision)}
            oldRevision={String(oldRevision)}
            newRevision={String(newRevision)}
            language="markdown"
            comments={visibleComments}
            eventHandler={eventHandler}
          />
        ))}
    </div>
  );
};
