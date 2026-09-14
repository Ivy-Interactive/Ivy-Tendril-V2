import * as React from "react";
import { Button } from "@ivy-interactive/components/ui";
import { DialogShell } from "./DialogShell";
import type { RepoStatus } from "../../types/api";

export interface DirtyRepoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  dirtyRepos: RepoStatus[];
  onProceed: () => void;
}

/**
 * The last guard before dispatch: a target repo has uncommitted work.
 *
 * The worktree the agent gets is branched from the last commit, so uncommitted
 * changes are simply absent from it — which is usually a surprise, and
 * occasionally deliberate. It asks closest to dispatch for that reason.
 */
export function DirtyRepoDialog({ isOpen, onClose, dirtyRepos, onProceed }: DirtyRepoDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Uncommitted changes"
      description={`⚠ ${dirtyRepos.length} ${
        dirtyRepos.length === 1 ? "repository has" : "repositories have"
      } uncommitted changes. They will not be included in the worktree the agent works in.`}
      testId="dirty-repo-dialog"
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="outline" onClick={onClose} data-testid="dialog-cancel">
            Cancel
          </Button>
          <Button variant="warning" onClick={onProceed} data-testid="guard-proceed">
            Execute Anyway
          </Button>
        </>
      }
    >
      <ul className="space-y-3">
        {dirtyRepos.map((repo) => {
          const hidden = (repo.changeCount ?? repo.changes.length) - repo.changes.length;
          return (
            <li key={repo.path} className="rounded-box border border-border p-3">
              <div className="font-mono text-xs text-foreground">{repo.path}</div>
              <ul className="mt-2 space-y-0.5 font-mono text-xs text-muted-foreground">
                {repo.changes.map((change) => (
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
