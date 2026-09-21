import * as React from "react";
import { Button } from "@ivy-interactive/components/ui";
import { DialogShell, DialogShortcutHint } from "./DialogShell";
import type { RepoStatus } from "../../types/api";

export interface DirtyRepoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  dirtyRepos: RepoStatus[];
  onProceed: () => void;
  /** V1's `proceedLabel`: the dialog is reused by every dispatch it guards. */
  proceedLabel?: string;
}

/** V1's `MaxItemsShown`: three paths, then a count. A repo mid-refactor otherwise fills the dialog. */
const MAX_ITEMS_SHOWN = 3;

/**
 * The last guard before dispatch: a target repo has uncommitted work.
 *
 * The worktree the agent gets is branched from the last commit, so uncommitted
 * changes are simply absent from it — which is usually a surprise, and
 * occasionally deliberate. It asks closest to dispatch for that reason, and V1 treats proceeding as
 * the ordinary answer rather than a warning: `new Button(proceedLabel).Primary()`.
 *
 * V1's third button, *Sync Repos*, and the SyncRepo policy dialog behind it are not ported: V2 has
 * no SyncRepo dispatch path from the UI (see the report accompanying this pass). V1's richer
 * `PreflightResult` — untracked files, commits ahead of origin, detached HEAD, base branch — has no
 * counterpart in `RepoStatus` either, which carries porcelain lines and a count, so each repo is
 * summarised as the uncommitted changes it has.
 */
export function DirtyRepoDialog({
  isOpen,
  onClose,
  dirtyRepos,
  onProceed,
  proceedLabel = "Execute Anyway",
}: DirtyRepoDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Local Changes Detected"
      description={`⚠ ${dirtyRepos.length} ${
        dirtyRepos.length === 1 ? "repository has" : "repositories have"
      } uncommitted changes. They will not be included in the worktree the agent works in.`}
      testId="dirty-repo-dialog"
      initialFocusRef={cancelRef}
      // The last of the three execute guards to get the chord, and it is the odd one out that made
      // the chain inconsistent: `UnansweredQuestionsDialog` and `PendingAnnotationsDialog` both bind
      // Ctrl+Enter to their primary, so a user who learned it on the first guard found it dead on
      // this one. `onProceed` is V1's primary here too (`new Button(proceedLabel).Primary()`), and
      // proceeding is reversible in a way the confirms are not — the worktree simply lacks the
      // uncommitted changes, which are still on disk.
      shortcut="Ctrl+Enter"
      onShortcut={onProceed}
      footer={
        <>
          <Button ref={cancelRef} variant="outline" onClick={onClose} data-testid="dialog-cancel">
            Cancel
          </Button>
          <Button onClick={onProceed} data-testid="guard-proceed">
            {proceedLabel}
            <DialogShortcutHint shortcut="Ctrl+Enter" />
          </Button>
        </>
      }
    >
      <ul className="space-y-3">
        {dirtyRepos.map((repo) => {
          // The service already caps `changes`; `changeCount` is the true total, so the count of
          // what is not shown is measured against that rather than against the truncated list.
          const total = repo.changeCount ?? repo.changes.length;
          const shown = repo.changes.slice(0, MAX_ITEMS_SHOWN);
          const hidden = total - shown.length;
          // V1 leads each repo with its folder name and puts the full path underneath: the name is
          // what the operator recognises, the path is what disambiguates two checkouts of it.
          const name = repo.path.split(/[/\\]/).filter(Boolean).pop() ?? repo.path;
          return (
            <li key={repo.path} className="rounded-box border border-border p-3">
              <div className="text-sm font-semibold text-foreground">{name}</div>
              <div className="font-mono text-xs text-muted-foreground">{repo.path}</div>
              <div className="mt-2 text-xs text-foreground">
                {total} uncommitted {total === 1 ? "change" : "changes"}
              </div>
              <ul className="mt-1 space-y-0.5 font-mono text-xs text-muted-foreground">
                {shown.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
              {hidden > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">+{hidden} more</div>
              )}
            </li>
          );
        })}
      </ul>
    </DialogShell>
  );
}
