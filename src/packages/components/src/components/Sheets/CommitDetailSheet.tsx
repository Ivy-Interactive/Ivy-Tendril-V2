import React from "react";
import { Copy } from "lucide-react";
import { copyToClipboard } from "../../lib/clipboard";
import { Badge } from "../ui/badge";
import { Callout } from "../ui/callout";
import { IconButton } from "../ui/IconButton";
import { SheetPanel } from "../ui/sheet-panel";
import { Spinner } from "../ui/spinner";
import { PlanDiffView } from "../PlanDiffView/PlanDiffView";
import { useTranslation, type TFunction } from "@/i18n/uiReview";

/** One file a commit touched, as `git diff-tree --name-status` names it (`A`, `M`, `D`, `R100`, …). */
export interface CommitDetailFile {
  status: string;
  path: string;
}

/** One file's section of the commit's patch, split out of `git show` the way the Changes tab is. */
export interface CommitDetailChange {
  filePath: string;
  diff: string;
  additions: number;
  deletions: number;
}

/**
 * V1's `PlanContentHelpers.CommitDetailData` (`Title`, `Diff`, `Files`), with the diff already split
 * per file. The app's `PlanCommitDetail` passes straight through.
 */
export interface CommitDetail {
  hash: string;
  /** The commit's subject line. */
  title: string;
  /** The repo or worktree the commit was found in. */
  repository?: string | null;
  files: CommitDetailFile[];
  changes: CommitDetailChange[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface CommitDetailSheetProps {
  /** The commit to show, by hash, or null when the sheet is closed. */
  hash: string | null;
  onClose: () => void;
  /** The commit, once read. `null` once the read has answered that no repo holds it. */
  detail?: CommitDetail | null;
  /** The read is still out. */
  loading?: boolean;
  /** Why the read failed. */
  error?: string | null;
}

/** V1's `hash[..7]`. */
const shortHash = (hash: string) => (hash.length > 7 ? hash.slice(0, 7) : hash);

/** `RenderCommitDetailSheet`'s file badges: Added is Success, Deleted is Destructive, else Outline. */
function fileBadge(
  status: string,
  t: TFunction,
): { label: string; variant: "success" | "destructive" | "outline" } {
  switch (status.charAt(0)) {
    case "A":
      return { label: t("commitSheet.fileStatus.added"), variant: "success" };
    case "D":
      return { label: t("commitSheet.fileStatus.deleted"), variant: "destructive" };
    case "R":
      return { label: t("commitSheet.fileStatus.renamed"), variant: "outline" };
    default:
      return { label: t("commitSheet.fileStatus.modified"), variant: "outline" };
  }
}

/**
 * V1's `Apps/Views/Sheets/CommitDetailSheet.cs`, rendered by `PlanContentHelpers.RenderCommitDetailSheet`
 * (`Helpers/PlanContentHelpers.cs:253`): a commit a plan recorded, opened from the Git tab.
 *
 * V1's three bodies are kept in V1's order:
 *
 * - with a diff, the `+N −M` totals and then one collapsible, collapsed `DiffView` per file - the
 *   same per-file split the Changes tab shows, so a large commit opens as a list of file headers;
 * - with only a file list (a merge, or a diff git would not print), the **Changed Files** list with
 *   V1's Added / Deleted / Modified badges;
 * - and "Loading...", "Failed to load commit: …" or "Commit not found." while there is neither.
 *
 * The title is V1's `Commit {shortHash} — {title}`. The full hash is one click away in the header,
 * which V1 does not have: it is the thing a reviewer pastes into a terminal.
 *
 * Presentational: the host resolves the commit against the plan's repos and passes the read's state
 * in. The app's connected wrapper is `views/sheets/CommitDetailSheet.tsx`.
 */
export const CommitDetailSheet: React.FC<CommitDetailSheetProps> = ({
  hash,
  onClose,
  detail,
  loading = false,
  error,
}) => {
  const { t } = useTranslation("uiReview");
  const short = hash ? shortHash(hash) : "";
  const title =
    detail?.title && !loading
      ? t("commitSheet.title", { hash: short, title: detail.title })
      : t("commitSheet.titleUntitled", { hash: short });

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div
        data-testid="commit-sheet-loading"
        className="flex h-32 items-center justify-center text-muted-foreground"
      >
        <Spinner size="lg" aria-label={t("commitSheet.loadingLabel", { hash: short })} />
      </div>
    );
  } else if (error) {
    body = (
      <Callout.Error data-testid="commit-sheet-error">
        {t("commitSheet.failed", { error })}
      </Callout.Error>
    );
  } else if (!detail) {
    body = (
      <p data-testid="commit-sheet-not-found" className="text-sm text-muted-foreground">
        {t("commitSheet.notFound")}
      </p>
    );
  } else if (detail.changes.length > 0) {
    body = (
      <div className="space-y-3" data-testid="commit-sheet-diff">
        <p className="text-xs tabular-nums" data-testid="commit-sheet-totals">
          <span className="text-success">+{detail.totalAdditions}</span>{" "}
          <span className="text-destructive">−{detail.totalDeletions}</span>
        </p>
        {detail.changes.map((change) => (
          <PlanDiffView
            key={change.filePath}
            id={`commit-${detail.hash}-${change.filePath}`}
            diff={change.diff}
            filePath={change.filePath}
            collapsible
            defaultCollapsed
          />
        ))}
      </div>
    );
  } else if (detail.files.length > 0) {
    body = (
      <div className="space-y-2" data-testid="commit-sheet-files">
        <h3 className="text-sm font-semibold text-foreground">{t("commitSheet.changedFiles")}</h3>
        <ul className="space-y-1">
          {detail.files.map((file) => {
            const badge = fileBadge(file.status, t);
            return (
              <li key={`${file.status}:${file.path}`} className="flex items-center gap-2 text-sm">
                <Badge variant={badge.variant} className="shrink-0">
                  {badge.label}
                </Badge>
                <span className="min-w-0 break-all font-mono text-xs text-foreground">
                  {file.path}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  } else {
    body = (
      <p data-testid="commit-sheet-empty" className="text-sm text-muted-foreground">
        {t("commitSheet.noChanges")}
      </p>
    );
  }

  return (
    <SheetPanel
      open={hash !== null}
      onClose={onClose}
      data-testid="commit-detail-sheet"
      title={title}
      description={
        detail?.repository ? (
          <span className="font-mono" title={detail.repository}>
            {detail.repository}
          </span>
        ) : (
          t("commitSheet.description", { hash: short })
        )
      }
      hideDescription={!detail?.repository}
      actions={
        hash && (
          <IconButton
            label={t("commitSheet.copyHash")}
            size="md"
            tone="muted"
            data-testid="commit-sheet-copy-hash"
            onClick={() => void copyToClipboard(hash)}
          >
            <Copy className="size-4" aria-hidden="true" />
          </IconButton>
        )
      }
    >
      {body}
    </SheetPanel>
  );
};
