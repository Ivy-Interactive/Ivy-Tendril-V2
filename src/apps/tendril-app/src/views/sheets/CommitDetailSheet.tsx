import React, { useEffect, useState } from "react";
import { CommitDetailSheet as CommitDetailSheetView } from "@ivy-interactive/components/dialogs";
import { bridge } from "../../api/bridge";
import { describeBridgeError, type PlanCommitDetail } from "../../types/api";

export interface CommitDetailSheetProps {
  /** The plan that recorded the commit: its repos and worktrees are where the hash is looked up. */
  planId: string | null | undefined;
  /** The commit, by full or short hash, or null when the sheet is closed. */
  hash: string | null;
  onClose: () => void;
}

/** A read's outcome, keyed by the hash it answers so a reopened sheet never shows the last commit. */
type CommitRead =
  | { hash: string; status: "loaded"; detail: PlanCommitDetail | null }
  | { hash: string; status: "failed"; error: string };

/**
 * The connected half of V1's `CommitDetailSheet` (`Apps/Views/Sheets/CommitDetailSheet.cs`): V1's
 * `commitQuery`, which walks `selectedPlan.GetEffectiveRepoPaths(config)` until one repo knows the
 * hash, is `getPlanCommit` here (`commands::plan_files`), and the library sheet renders the answer.
 */
export const CommitDetailSheet: React.FC<CommitDetailSheetProps> = ({ planId, hash, onClose }) => {
  const [read, setRead] = useState<CommitRead | null>(null);

  useEffect(() => {
    if (!planId || !hash) return;
    let cancelled = false;
    bridge.getPlanCommit(planId, hash).then(
      (detail) => {
        if (!cancelled) setRead({ hash, status: "loaded", detail });
      },
      (err: unknown) => {
        if (!cancelled) setRead({ hash, status: "failed", error: describeBridgeError(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [planId, hash]);

  const current = read && read.hash === hash ? read : null;

  return (
    <CommitDetailSheetView
      hash={hash}
      onClose={onClose}
      loading={hash !== null && current === null}
      detail={current?.status === "loaded" ? current.detail : undefined}
      error={current?.status === "failed" ? current.error : null}
    />
  );
};
