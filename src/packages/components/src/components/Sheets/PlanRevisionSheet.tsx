import { PlanMarkdown } from "../PlanMarkdown";
import { SheetPanel } from "../ui/sheet-panel";
import { useTranslation } from "@/i18n/uiPanels";

export interface PlanRevisionSheetProps {
  /** Whether the sheet is showing. */
  open: boolean;
  onClose: () => void;
  planId?: string | null;
  planTitle?: string | null;
  /** The plan's latest revision as markdown; `null` while it is loading. Blank is "not found". */
  revision: string | null;
  /** The read failed. Shown in place of the revision. */
  error?: string | null;
  /** Where the plan serves its wireframes, so a `wireframe` fence previews as on the plan page. */
  wireframeBaseUrl?: string;
  /** A local file link in the revision. V1 opens it in its `FileSheet`. */
  onFileClick?: (path: string) => void;
}

/**
 * A plan's latest revision, opened from a Pull Requests row. Port of V1
 * `Apps/PullRequest/PullRequestApp.cs:37` (`planSheet`): `ReadLatestRevision` rendered as
 * article-styled markdown that may link local files, or "Plan not found or empty.".
 *
 * The title is `#id title` rather than V1's bare `plan?.Title ?? folderName`: the Pull Requests
 * table leads with the plan id, and the sheet is read against it. V2 reads the revision over IPC
 * where V1 read it in-process, hence the loading and error states V1 does not have.
 */
export function PlanRevisionSheet({
  open,
  onClose,
  planId,
  planTitle,
  revision,
  error,
  wireframeBaseUrl,
  onFileClick,
}: PlanRevisionSheetProps) {
  const { t } = useTranslation("uiPanels");
  const title =
    planId && planTitle
      ? `#${planId} ${planTitle}`
      : planTitle || (planId ? `#${planId}` : t("planRevisionSheet.titleFallback"));

  return (
    <SheetPanel open={open} onClose={onClose} title={title} data-testid="pr-plan-sheet">
      {error ? (
        <p className="text-xs text-destructive" data-testid="pr-plan-sheet-error">
          {error}
        </p>
      ) : revision === null ? (
        <p className="text-sm text-muted-foreground">{t("planRevisionSheet.loadingRevision")}</p>
      ) : revision.trim() === "" ? (
        <p className="text-sm text-muted-foreground">{t("planRevisionSheet.notFound")}</p>
      ) : (
        <PlanMarkdown
          id="pr-plan-revision"
          content={revision}
          wireframeBaseUrl={wireframeBaseUrl}
          article
          dangerouslyAllowLocalFiles
          onFileClick={onFileClick ? (path) => onFileClick(path) : undefined}
        />
      )}
    </SheetPanel>
  );
}
