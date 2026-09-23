import * as React from "react";
import { Archive, GitCommitHorizontal, GitPullRequest } from "lucide-react";
import { Button } from "../ui/button";
import { Trans, useTranslation } from "@/i18n/uiDialogs";
import { DialogShell } from "./DialogShell";

/**
 * How a SyncRepo job treats the local work it finds, as `SyncRepoArgs.untrackedChangesPolicy`
 * spells it (V1 `UntrackedChangesPolicy`). These are wire values: compared and sent, never shown.
 */
export type SyncRepoPolicy = "Stash" | "Commit" | "PullRequest";

export interface SyncRepoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Each dirty repo's base branch. One distinct branch is named in the copy; several are not. */
  baseBranches: string[];
  /** Some repo has modified or staged files. */
  hasUncommitted: boolean;
  /** Some repo has untracked files. */
  hasUntracked: boolean;
  /** Starts SyncRepo for every dirty repo with the chosen policy. */
  onSync: (policy: SyncRepoPolicy) => void;
}

/**
 * V1's SyncRepo policy dialog (`DirtyRepoDialog.BuildPolicyDialog`): how SyncRepo should reconcile
 * the local work before the repo is brought up to date. Three answers, all V1 `.Primary()`, and
 * `.Width(Size.Rem(40))`.
 *
 * V1 words the subject by what it found - uncommitted changes, untracked files, or both - and names
 * the target branch only when every repo shares one: "never fabricate a joined name". Both are
 * whole sentences per case here (a `context` each), so a translator never assembles one from parts.
 */
export function SyncRepoDialog({
  isOpen,
  onClose,
  baseBranches,
  hasUncommitted,
  hasUntracked,
  onSync,
}: SyncRepoDialogProps) {
  const { t } = useTranslation("uiDialogs");
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  const branches = [...new Set(baseBranches.filter((b) => b.trim() !== ""))];
  // V1's `(hasUncommitted, hasUntracked) switch`, whose fallback is the uncommitted wording.
  const subject = hasUncommitted && hasUntracked ? "both" : hasUntracked ? "untracked" : undefined;

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("syncRepo.title")}
      testId="sync-repo-dialog"
      width="rem40"
      // Three equally weighted answers, none of them the obvious default, so no chord: Cancel is
      // where focus lands and every policy is a deliberate click.
      initialFocusRef={cancelRef}
      footerClassName="flex-wrap"
      footer={
        <>
          <Button ref={cancelRef} variant="outline" onClick={onClose} data-testid="dialog-cancel">
            {t("actions.cancel")}
          </Button>
          <Button onClick={() => onSync("Stash")} data-testid="sync-repo-stash">
            <Archive className="size-4" aria-hidden />
            {t("syncRepo.stash")}
          </Button>
          <Button onClick={() => onSync("Commit")} data-testid="sync-repo-commit">
            <GitCommitHorizontal className="size-4" aria-hidden />
            {t("syncRepo.commit")}
          </Button>
          <Button onClick={() => onSync("PullRequest")} data-testid="sync-repo-pull-request">
            <GitPullRequest className="size-4" aria-hidden />
            {t("syncRepo.pullRequest")}
          </Button>
        </>
      }
    >
      <p data-testid="sync-repo-body">
        {branches.length === 1 ? (
          <Trans
            ns="uiDialogs"
            i18nKey="syncRepo.body"
            context={subject}
            values={{ branch: branches[0] }}
            components={{ code: <code className="font-mono text-foreground" /> }}
          />
        ) : (
          t("syncRepo.bodyEachBranch", { context: subject })
        )}
      </p>
    </DialogShell>
  );
}
