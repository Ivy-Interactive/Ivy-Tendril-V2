import { Check, ExternalLink, X, Zap } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SheetPanel } from "../ui/sheet-panel";
import { PlanMarkdown } from "../PlanMarkdown";
import { useFormatters, useTranslation } from "@/i18n/uiPanels";

/**
 * An issue or review request as the sheet renders it.
 *
 * Declared here rather than borrowed from the app's `GitHubIssue`: the component that renders a
 * shape owns it. The fields are already resolved - `repoLabel` and `url` are what the Inbox table
 * shows and opens - so the sheet makes no decision the table would have to agree with.
 */
export interface InboxSheetItem {
  number: number;
  title: string;
  /** Markdown. Blank reads "No description provided.". */
  body: string;
  /** The repository badge, `owner/repo`. Omitted, no badge. */
  repoLabel?: string;
  assignees: readonly string[];
  labels: readonly string[];
  /** The GitHub page. Omitted, the issue sheet shows no GitHub button (V1 shows one only when a url resolves). */
  url?: string;
}

/** A pending auto-accept proposal: the issue sheet then offers Accept / Dismiss instead of Fire off. */
export interface InboxSheetProposal {
  /** The project Accept starts the plan in, named in its tooltip. */
  project: string;
}

export interface InboxIssueSheetProps {
  /** The item, or `null` for closed. */
  item: InboxSheetItem | null;
  /**
   * Which of V1's two sheets this is. `issue` (My Issues, a project's issues) carries the labels and
   * the row's own decision; `review` (Review Requests) carries only Open on GitHub.
   */
  kind: "issue" | "review";
  onClose: () => void;
  onOpenGitHub: (url: string) => void;
  /** Issue sheet only: the proposal awaiting a decision, if there is one. */
  proposal?: InboxSheetProposal | null;
  /** A decision on {@link proposal} is in flight: Accept and Dismiss are disabled. */
  isDeciding?: boolean;
  /** Accepts {@link proposal}. The sheet only ever shows one, so it hands back no id. */
  onAccept?: () => void;
  /** Dismisses {@link proposal} for good. */
  onDismiss?: () => void;
  /** Issue sheet only, when there is no proposal: V1's "Fire off in Tendril". */
  onFireOff?: () => void;
  isFiring?: boolean;
  /**
   * A local file link in the body. V1 opens it in its `FileSheet`
   * (`FileSheet.CreateLinkClickHandler(openFile)`); omitted, local links are left to the markdown.
   */
  onFileClick?: (path: string) => void;
}

/**
 * The Inbox's details sheet. Port of V1 `Apps/Inbox/ContentView.cs`'s two `UseTrigger` sheets: the
 * issue sheet (`:166`) and the review sheet (`:202`), which share everything but their header's
 * right-hand side.
 *
 * Both: the title `#number title`, the repository badge, "Assigned: ..." when anyone is, and the
 * body as article-styled markdown that may link local files - or "No description provided.".
 *
 * - **Issue**: a ghost GitHub button when the issue has a url, the labels as outline badges, and the
 *   row's own decision - Accept / Dismiss while an auto-accept proposal is pending, Fire off in
 *   Tendril otherwise. V1's sheet has only the GitHub button; V2 added the decision so the sheet a
 *   reader opens to judge an issue is also where they can act on it.
 * - **Review**: a primary Open on GitHub. V1 also shows a branch badge here, which the app's issue
 *   record has no field for.
 *
 * No action closes the sheet by itself; the app decides (it closes after a decision, as the row
 * actions do).
 */
export function InboxIssueSheet({
  item,
  kind,
  onClose,
  onOpenGitHub,
  proposal,
  isDeciding = false,
  onAccept,
  onDismiss,
  onFireOff,
  isFiring = false,
  onFileClick,
}: InboxIssueSheetProps) {
  const { t } = useTranslation("uiPanels");
  const format = useFormatters();
  const isReview = kind === "review";
  const url = item?.url;

  return (
    <SheetPanel
      open={item !== null}
      onClose={onClose}
      title={item ? `#${item.number} ${item.title}` : t("inboxSheet.titleFallback")}
      data-testid="inbox-issue-sheet"
      bodyClassName="space-y-3"
    >
      {item && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {item.repoLabel && (
                <Badge variant="secondary" density="Small">
                  {item.repoLabel}
                </Badge>
              )}
              {item.assignees.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t("inboxSheet.assigned", {
                    assignees: format.list([...item.assignees], { type: "unit", style: "short" }),
                  })}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isReview ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={!url}
                  onClick={() => url && onOpenGitHub(url)}
                >
                  <ExternalLink aria-hidden="true" />
                  {t("inboxSheet.openOnGitHub")}
                </Button>
              ) : (
                <>
                  {url && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onOpenGitHub(url)}
                    >
                      <ExternalLink aria-hidden="true" />
                      {/* A brand name, not translated. */}
                      GitHub
                    </Button>
                  )}
                  {proposal ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        title={t("inboxSheet.dismiss.tooltip")}
                        disabled={isDeciding || !onDismiss}
                        onClick={() => onDismiss?.()}
                      >
                        <X aria-hidden="true" />
                        {t("inboxSheet.dismiss.label")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        title={t("inboxSheet.accept.tooltip", { project: proposal.project })}
                        disabled={isDeciding || !onAccept}
                        onClick={() => onAccept?.()}
                      >
                        <Check aria-hidden="true" />
                        {t("inboxSheet.accept.label")}
                      </Button>
                    </>
                  ) : (
                    onFireOff && (
                      <Button type="button" size="sm" disabled={isFiring} onClick={onFireOff}>
                        <Zap aria-hidden="true" />
                        {t("inboxSheet.fireOff")}
                      </Button>
                    )
                  )}
                </>
              )}
            </div>
          </div>

          {!isReview && item.labels.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {item.labels.map((label) => (
                <Badge key={label} variant="outline" density="Small">
                  {label}
                </Badge>
              ))}
            </div>
          )}

          {item.body.trim() ? (
            <PlanMarkdown
              id="inbox-issue-body"
              content={item.body}
              article
              dangerouslyAllowLocalFiles
              onFileClick={onFileClick ? (path) => onFileClick(path) : undefined}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("inboxSheet.noDescription")}</p>
          )}
        </>
      )}
    </SheetPanel>
  );
}
