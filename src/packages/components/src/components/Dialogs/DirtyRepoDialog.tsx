import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Trans, useTranslation } from "@/i18n/uiDialogs";
import { DialogShell, DialogShortcutHint } from "./DialogShell";
import { SyncRepoDialog, type SyncRepoPolicy } from "./SyncRepoDialog";
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
  /**
   * The branch the repo syncs to, when the caller knows it (the project-scoped status does). Named in
   * the create-plan context line and in the SyncRepo policy dialog.
   */
  baseBranch?: string;
}

/**
 * Which dispatch the dialog is guarding. The two differ in what a dirty tree *means*: ExecutePlan
 * branches a worktree from the last commit, so the changes are simply absent from it; CreatePlan
 * reads the checkout as it is, so the plan is written against changes ExecutePlan will not have.
 */
export type DirtyRepoPurpose = "execute" | "createPlan";

export interface DirtyRepoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  dirtyRepos: DirtyRepo[];
  onProceed: () => void;
  /**
   * V1's `proceedLabel`: the dialog is reused by every dispatch it guards. Omitted, the button reads
   * "Execute Anyway" (or "Create Without Syncing" for `purpose="createPlan"`), translated.
   */
  proceedLabel?: string;
  /** Picks the copy for the guarded dispatch. Defaults to `execute`, which is what it always said. */
  purpose?: DirtyRepoPurpose;
  /**
   * V1's third button, *Sync Repos*: bring the repos up to date with a SyncRepo job each before the
   * guarded job runs. Local work is reconciled by the policy the operator picks in
   * {@link SyncRepoDialog}, which opens in place of this dialog when there is local work to
   * reconcile. Omitted, the button is not offered.
   */
  onSyncRepos?: (policy: SyncRepoPolicy) => void;
}

/** V1's `MaxItemsShown`: three paths, then a count. A repo mid-refactor otherwise fills the dialog. */
const MAX_ITEMS_SHOWN = 3;

/** A `git status --porcelain` line for a file git does not track. */
const isUntracked = (line: string) => line.startsWith("??");

/**
 * The last guard before dispatch: a target repo has uncommitted work.
 *
 * The worktree the agent gets is branched from the last commit, so uncommitted
 * changes are simply absent from it — which is usually a surprise, and
 * occasionally deliberate. It asks closest to dispatch for that reason, and V1 treats proceeding as
 * the ordinary answer rather than a warning: `new Button(proceedLabel).Primary()`.
 *
 * `purpose="createPlan"` is V1's `CreatePlanDialogLauncher` use: "Create Without Syncing", and a
 * context line per repo saying that the plan is written against this state while ExecutePlan will
 * branch from `origin/<baseBranch>`.
 *
 * V1's third button, *Sync Repos*, is offered when the caller passes `onSyncRepos`: with local work
 * to reconcile it swaps this dialog for {@link SyncRepoDialog} (V1's `showPolicy`), and otherwise
 * syncs straight away with the `Stash` policy, as V1 does for a repo that is only ahead of origin.
 * V1's richer `PreflightResult` — commits ahead of origin, detached HEAD — has no counterpart in
 * `RepoStatus`, which carries porcelain lines and a count, so each repo is summarised as the
 * uncommitted changes it has, and untracked files are told apart by their `??` prefix.
 */
export function DirtyRepoDialog({
  isOpen,
  onClose,
  dirtyRepos,
  onProceed,
  proceedLabel,
  purpose = "execute",
  onSyncRepos,
}: DirtyRepoDialogProps) {
  const { t } = useTranslation("uiDialogs");
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  // V1's `showPolicy`: reset whenever the dialog closes, so the next opening starts on the list.
  const [showPolicy, setShowPolicy] = React.useState(false);
  React.useEffect(() => {
    if (!isOpen) setShowPolicy(false);
  }, [isOpen]);

  const hasUntracked = dirtyRepos.some((repo) => repo.changes.some(isUntracked));
  // A change the service capped away is counted as uncommitted: the safer reading of "unknown".
  const hasUncommitted = dirtyRepos.some(
    (repo) =>
      repo.changes.some((line) => !isUntracked(line)) ||
      (repo.changeCount ?? repo.changes.length) > repo.changes.length,
  );

  const handleSyncRepos = () => {
    if (!onSyncRepos) return;
    // V1: "If there is local work to reconcile, ask how to handle it; otherwise sync straight away."
    if (hasUncommitted || hasUntracked) {
      setShowPolicy(true);
      return;
    }
    onSyncRepos("Stash");
  };

  if (showPolicy && onSyncRepos) {
    return (
      <SyncRepoDialog
        isOpen={isOpen}
        onClose={onClose}
        baseBranches={dirtyRepos.map((repo) => repo.baseBranch ?? "")}
        hasUncommitted={hasUncommitted}
        hasUntracked={hasUntracked}
        onSync={onSyncRepos}
      />
    );
  }

  const createPlan = purpose === "createPlan";

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("dirtyRepo.title")}
      description={
        createPlan
          ? t("dirtyRepo.createPlan.description", { count: dirtyRepos.length })
          : t("dirtyRepo.description", { count: dirtyRepos.length })
      }
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
      // V1's footer is `Layout.Horizontal().Gap(2).Right()`; with Sync Repos it is three buttons, so
      // it wraps rather than pushing the last off a narrow window.
      footerClassName={onSyncRepos ? "flex-wrap" : undefined}
      footer={
        <>
          <Button ref={cancelRef} variant="outline" onClick={onClose} data-testid="dialog-cancel">
            {t("actions.cancel")}
          </Button>
          <Button onClick={onProceed} data-testid="guard-proceed">
            {proceedLabel ??
              (createPlan ? t("dirtyRepo.createPlan.proceed") : t("dirtyRepo.proceed"))}
            <DialogShortcutHint shortcut="Ctrl+Enter" />
          </Button>
          {/* `new Button("Sync Repos").Primary().Icon(Icons.RefreshCw)` */}
          {onSyncRepos && (
            <Button onClick={handleSyncRepos} data-testid="guard-sync-repos">
              <RefreshCw className="size-4" aria-hidden />
              {t("dirtyRepo.syncRepos")}
            </Button>
          )}
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
              {/* V1 closes every repo's section with the caller's `contextMessage`, its
                  `origin/<baseBranch>` resolved to that repo's branch. */}
              {createPlan && repo.baseBranch && (
                <p className="mt-2 text-xs text-muted-foreground" data-testid="dirty-repo-context">
                  <Trans
                    ns="uiDialogs"
                    i18nKey="dirtyRepo.createPlan.context"
                    values={{ branch: `origin/${repo.baseBranch}` }}
                    components={{ code: <code className="font-mono text-foreground" /> }}
                  />
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </DialogShell>
  );
}
