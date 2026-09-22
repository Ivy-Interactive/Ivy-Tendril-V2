import * as React from "react";
import { Button } from "../ui/button";
import { useTranslation } from "@/i18n/uiDialogs";
import { DialogShell, DialogShortcutHint } from "./DialogShell";
/**
 * A repository with uncommitted work, as this dialog renders it.
 *
 * Declared here rather than imported from the app, for the reason `PlanGitView` gives for owning
 * its own shapes: this is the component that renders them and it cannot import from the app. The
 * app's `RepoStatus` DTO is structurally identical and satisfies this, so the call site passes it
 * straight through.
 */
export interface DirtyRepo {
  path: string;
  isDirty: boolean;
  /** `git status --porcelain` lines, capped by the service. */
  changes: string[];
  /** Total changed entries, which may exceed `changes.length`. */
  changeCount?: number;
  error?: string;
}

export interface DirtyRepoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  dirtyRepos: DirtyRepo[];
  onProceed: () => void;
  /**
   * V1's `proceedLabel`: the dialog is reused by every dispatch it guards. Omitted, the button reads
   * "Execute Anyway", translated.
   */
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
  proceedLabel,
}: DirtyRepoDialogProps) {
  const { t } = useTranslation("uiDialogs");
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("dirtyRepo.title")}
      description={t("dirtyRepo.description", { count: dirtyRepos.length })}
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
            {t("actions.cancel")}
          </Button>
          <Button onClick={onProceed} data-testid="guard-proceed">
            {proceedLabel ?? t("dirtyRepo.proceed")}
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
                {t("dirtyRepo.changeCount", { count: total })}
              </div>
              <ul className="mt-1 space-y-0.5 font-mono text-xs text-muted-foreground">
                {shown.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
              {hidden > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("dirtyRepo.moreChanges", { count: hidden })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </DialogShell>
  );
}
