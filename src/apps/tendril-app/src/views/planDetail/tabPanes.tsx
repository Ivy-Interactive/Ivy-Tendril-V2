import React from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { WandSparkles } from "lucide-react";
import { copyToClipboard } from "@ivy-interactive/components";
import { formatList } from "@ivy-interactive/components/i18n";
import { Button, Callout, Densities } from "@ivy-interactive/components/ui";
import {
  PlanGitView,
  PlanMarkdown,
  type PlanMarkdownProps,
} from "@ivy-interactive/components/tendril";
import type { Annotation, Job, PlanDetail, PlanGitData, RecommendationItem } from "../../types/api";
import { ErrorBanner } from "../../components/ErrorBanner";
import { RecommendationCard } from "../../components/RecommendationCard";
import { PlanPullRequests } from "../PlanPullRequests";
import { PlanRevisionDiff } from "../PlanRevisionDiff";
import { useTranslation } from "../../i18n";
import { useEnumLabels } from "../../i18n/enumLabels";
import {
  DetailRow,
  ExecutionFailedCallout,
  planLinkLabel,
  type LifecycleDialog,
  type PlanDetailTab,
  type PlanRunAction,
} from "./helpers";

/** A list of plan links, `#21, #22` in English - the separator the Details rows always used. */
const planLinkList = (folders: string[]) =>
  formatList(folders.map(planLinkLabel), { type: "unit", style: "short" });

/**
 * The plan document has no table of contents, and that is deliberate.
 *
 * `PlanMarkdown`'s `StickyContent` slot is left empty here exactly as V1 leaves it: V1's plan page
 * never fills it. A contents panel was added into that slot earlier at the user's request and then
 * removed at theirs — it competed with the chat beside it for the width that matters more, and dropping
 * it returns the page to V1's own layout rather than diverging from it.
 *
 * The slot itself stays in the components package. It is V1's own slot, and V1 simply passes nothing.
 */

interface PlanPaneProps {
  plan: PlanDetail;
  effectivePlan: PlanDetail;
  jobs: Job[];
  emptyBodyReason: "writing" | "never" | "unreadable" | null;
  canOpenUpdateDialog: boolean;
  setActiveDialog: React.Dispatch<React.SetStateAction<LifecycleDialog | null>>;
  revisionContent: string;
  wireframeBaseUrl: string | undefined;
  annotations: Annotation[];
  scrollTo: { questionId: string; token: number } | null;
  handleAnnotationsChange: (next: Annotation[]) => void;
  applyAnswer: (questionId: string, answer: string[]) => Promise<void>;
}

type PlanDocumentPaneProps = Omit<
  PlanMarkdownProps,
  "article" | "dangerouslyAllowLocalFiles" | "flow" | "width" | "height"
> & {
  /** Blocks that come before the document — a failed plan's callout — at the other tab bodies' inset. */
  lead?: React.ReactNode;
  /**
   * Shown in the document's place, at the same inset, when there is no document to render yet:
   * the summary still loading, a plan whose body was never written.
   */
  placeholder?: React.ReactNode;
  "data-testid"?: string;
};

/**
 * A markdown document as a tab body: the Plans app's Plan tab, and the Review app's Summary and Plan
 * tabs.
 *
 * All three are V1's bare `PlanMarkdown` — `PlanTabView`, `SummaryTabView` and
 * `Review/Tabs/PlanTabView` each return `new PlanMarkdown(...).Article().DangerouslyAllowLocalFiles()
 * .Height(Size.Full())` with nothing around it — because the widget owns its own scroll, its inset
 * and its max-width. `Review/ContentView.cs` spells out why that matters: "Summary and Plan are
 * PlanMarkdown, which owns its own scroll, inset and max-width, so neither is wrapped in Cap():
 * wrapped, each would be inset twice and the two tabs would start their text in different places."
 *
 * The Review app's tabs were wrapped anyway, in the same `overflow-y-auto` + `px-8 py-6` + measure
 * cap the Details tab gets. Inside `PlanWorkspace` the markdown already pads itself 24px/32px
 * (`.pws-content .pmv-markdown`), and the wrapper's `px-8` / `py-6` added another 34.56px / 25.92px
 * on top (`--spacing` is 0.27rem here, not Tailwind's 0.25rem). A review summary therefore started
 * about 67px in and 50px down against the plan page's 32px and 24px, inside a narrower column, with
 * a second scroller around the widget's own. Every document tab now goes through this one component,
 * so the inset is decided in exactly one place and the two apps cannot drift apart again.
 *
 * `lead` and `placeholder` are the only things that sit beside the document. They get the `px-8` /
 * `pt-6` inset every other tab body gets (`OtherTabsPane`, V1's `Cap()` `Padding(8, 6, …)`).
 *
 * `lead` stacks above the document rather than scrolling with it, as `PlanTabView.Build` stacks the
 * failure callout above a full-height `PlanMarkdown`. That leaves the document only what the lead
 * does not take, so the lead is capped at 40% of the pane and scrolls on its own past that: a failed
 * plan quoting a long status message, or listing many failed verifications, in a short window would
 * otherwise squeeze the document to nothing and leave it unreachable.
 */
export const PlanDocumentPane: React.FC<PlanDocumentPaneProps> = ({
  lead,
  placeholder,
  "data-testid": testId,
  ...markdown
}) => (
  <div className="flex min-h-0 flex-1 flex-col" data-testid={testId}>
    {lead ? (
      <div className="max-h-[40%] w-full max-w-[var(--content-measure)] shrink-0 overflow-y-auto px-8 pt-6">
        {lead}
      </div>
    ) : null}
    {placeholder ? (
      <div className="w-full max-w-[var(--content-measure)] px-8 py-6">{placeholder}</div>
    ) : (
      <PlanMarkdown {...markdown} article dangerouslyAllowLocalFiles />
    )}
  </div>
);

/**
 * The plan document pane.
 *
 * Not wrapped in a scroll container of its own: `PlanTabView.Build` notes "PlanMarkdown owns its own
 * scroll, so the Plan tab is not wrapped in Cap()".
 */
export const PlanPane: React.FC<PlanPaneProps> = ({
  plan,
  effectivePlan,
  jobs,
  emptyBodyReason,
  canOpenUpdateDialog,
  setActiveDialog,
  revisionContent,
  wireframeBaseUrl,
  annotations,
  scrollTo,
  handleAnnotationsChange,
  applyAnswer,
}) => {
  const { t } = useTranslation("plans");
  return (
    <PlanDocumentPane
      /* `PlanTabView.Build`: a failed plan leads with why, above the plan itself. */
      lead={
        effectivePlan.state === "Failed" && (
          <ExecutionFailedCallout plan={effectivePlan} jobs={jobs} />
        )
      }
      /* An absent body is prose, not a document: rendering it through `PlanMarkdown` is what made it
          indistinguishable from a real plan.

          All three reasons go through `Callout`, the library primitive `ErrorBanner` already wraps,
          rather than the three different treatments this used to have (two bare `<p>`s and one
          banner). One shape, three variants: the severity is the only thing that differs, which is
          what `Callout`'s variants are for. `Small` density and the icon are `ErrorBanner`'s
          choices, kept so the `unreadable` case renders exactly as it did.

          The document itself is hidden entirely while the body is absent: `PlanMarkdown` with an
          empty string is what used to require the fake-heading placeholder. */
      placeholder={
        emptyBodyReason === "writing" ? (
          <Callout.Info
            data-testid="revision-writing"
            density={Densities.Small}
            icon={false}
            className="text-sm"
          >
            {t("planPane.writing")}
          </Callout.Info>
        ) : emptyBodyReason === "never" ? (
          <Callout.Warning
            data-testid="revision-never-written"
            density={Densities.Small}
            icon={false}
            className="text-sm"
          >
            <p>{t("planPane.neverWritten")}</p>
            {/* The button, not the sentence "Run Update Plan to draft it".

                That sentence was a dead end precisely here. The badged *Update Plan* secondary is
                gated on `pendingWork > 0` -- unresolved annotations plus answered questions -- and
                a plan with no revision has neither, because there is no body to annotate or answer
                against. So the only control that remained was an unlabeled wand glyph in the
                topbar, which folds into an overflow menu below 720px. The instruction named a
                button the reader could not find.

                `canOpenUpdateDialog` is the same predicate that decides whether that wand renders,
                so this button appears exactly when the dialog is reachable and is absent when it
                is not -- rather than telling the reader to do something impossible. */}
            {canOpenUpdateDialog && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3"
                data-testid="revision-never-written-update"
                onClick={() => setActiveDialog("update")}
              >
                <WandSparkles className="size-4" aria-hidden="true" />
                {t("planPane.neverWrittenUpdate")}
              </Button>
            )}
          </Callout.Warning>
        ) : emptyBodyReason === "unreadable" ? (
          <ErrorBanner data-testid="revision-unreadable">
            {t("planPane.unreadable", { count: plan.revisionCount ?? 0 })}
          </ErrorBanner>
        ) : null
      }
      /* `PlanTabView.Build` composes this as
          `new PlanMarkdown(annotatedContent).Article().DangerouslyAllowLocalFiles()
           .Annotations(...).OnAnnotationsChange(...).OnAnswersChange(onAnswerChanged)
           .ScrollTo(scrollTo)`. `OnAnswersChange` is what makes the questions in the document
          answerable at all; without it `PlanMarkdown` passes `undefined` as its answer callback and
          "undefined puts every callout in read-only mode". */
      id="plan-markdown"
      content={revisionContent}
      wireframeBaseUrl={wireframeBaseUrl}
      annotations={annotations}
      scrollTo={scrollTo}
      events={["OnAnnotationsChange", "OnAnswersChange"]}
      eventHandler={(evt: string, _id: string, args?: unknown[]) => {
        if (evt === "OnAnnotationsChange") {
          const next = args?.[0];
          if (Array.isArray(next)) handleAnnotationsChange(next as Annotation[]);
          return;
        }
        if (evt !== "OnAnswersChange") return;
        const payload = args?.[0] as { questionId?: string; answer?: unknown } | undefined;
        if (!payload?.questionId) return;
        // `null` on the wire means the key goes; a list is the answer. Either way the merge takes
        // a list, and an empty one removes the `answer` key.
        const value = Array.isArray(payload.answer)
          ? (payload.answer as unknown[]).map((entry) => String(entry))
          : [];
        void applyAnswer(payload.questionId, value);
      }}
    />
  );
};

interface OtherTabsPaneProps {
  plan: PlanDetail;
  effectivePlan: PlanDetail;
  effectiveTab: PlanDetailTab;
  recommendations: RecommendationItem[];
  handleOpenDialog: (title: string, action: "Accept" | "Decline") => void;
  gitData: PlanGitData | null;
  gitError: string | null;
  runAction: (
    id: PlanRunAction,
    action: ((planId: string) => void | Promise<void>) | undefined,
  ) => Promise<boolean>;
}

/** Every tab body but the Plan tab's, which owns its own scroll. */
export const OtherTabsPane: React.FC<OtherTabsPaneProps> = ({
  plan,
  effectivePlan,
  effectiveTab,
  recommendations,
  handleOpenDialog,
  gitData,
  gitError,
  runAction,
}) => {
  const { t } = useTranslation("plans");
  const labels = useEnumLabels();
  return (
    /* V1 wraps each of these tabs in `ContentView.Cap()`:
     `Layout.Vertical().Scroll().HideScrollbar().Width(Size.Full()).Height(Size.Full())
      | (Layout.Vertical().Padding(8, 6, 8, 4).Width(Size.Full().Max(Size.Units(200))) | inner)`.
     The scroll and the 8/6 inset were ported; `Max(Size.Units(200))` — 50rem, the reading measure
     `.pmv-markdown` already caps itself at — was not, so on a wide window a Details row or a Git
     path ran the full width while the Plan tab beside it stopped half way. The cap is on an inner
     element rather than on the scroller so the scrollbar stays at the pane's right edge, where
     `HideScrollbar()` puts V1's. */
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="w-full max-w-[var(--content-measure)] px-8 py-6">
        {effectiveTab === "diff" && (
          <PlanRevisionDiff planId={plan.id} revisionCount={plan.revisionCount ?? 0} />
        )}

        {effectiveTab === "recommendations" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t("recommendationsTab.title")}
              </h3>
              <p className="text-xs text-muted-foreground">{t("recommendationsTab.description")}</p>
            </div>

            {recommendations.length === 0 ? (
              <p data-testid="no-recommendations" className="text-xs text-muted-foreground/70">
                {t("recommendationsTab.empty", { jobType: labels.jobType("ExecutePlan") })}
              </p>
            ) : (
              <div className="space-y-3">
                {recommendations.map((rec) => (
                  <RecommendationCard
                    key={rec.title}
                    recommendation={rec}
                    onAccept={(title) => handleOpenDialog(title, "Accept")}
                    onDecline={(title) => handleOpenDialog(title, "Decline")}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {effectiveTab === "git" && (
          <>
            {gitError ? (
              <p data-testid="git-tab-error" className="text-xs text-destructive">
                {gitError}
              </p>
            ) : gitData ? (
              <PlanGitView
                data={gitData}
                prs={plan.prs ?? []}
                planState={effectivePlan.state}
                onOpenUrl={(url) => void openPath(url)}
              />
            ) : (
              <p className="text-sm text-muted-foreground/70">{t("gitTab.loading")}</p>
            )}
          </>
        )}

        {effectiveTab === "details" && (
          <div className="space-y-4">
            {/* `DetailsTabView.Build`'s own field order, and its `RemoveEmpty()`: a row the plan
              has no value for is dropped rather than rendered blank. */}
            <dl>
              <DetailRow label={t("details.planId")}>
                <button
                  type="button"
                  onClick={() => void runAction("copyPlanId", () => copyToClipboard(plan.id))}
                  title={t("details.copyPlanIdTooltip")}
                  className="font-mono hover:underline"
                >
                  {plan.id}
                </button>
              </DetailRow>
              <DetailRow label={t("details.folder")} empty={!plan.folderPath}>
                <button
                  type="button"
                  onClick={() =>
                    void runAction("copyFolderPath", () => copyToClipboard(plan.folderPath ?? ""))
                  }
                  title={t("details.copyFolderTooltip")}
                  className="break-all font-mono hover:underline"
                >
                  {plan.folderPath}
                </button>
              </DetailRow>
              <DetailRow label={t("details.initialPrompt")} empty={!plan.initialPrompt}>
                <span className="whitespace-pre-wrap">{plan.initialPrompt}</span>
              </DetailRow>
              <DetailRow label={t("details.revision")} empty={!plan.revisionCount}>
                {plan.revisionCount}
              </DetailRow>
              <DetailRow label={t("details.profile")} empty={!plan.executionProfile}>
                {plan.executionProfile}
              </DetailRow>
              <DetailRow
                label={t("details.relatedPlans")}
                empty={!plan.relatedPlans || plan.relatedPlans.length === 0}
              >
                {planLinkList(plan.relatedPlans ?? [])}
              </DetailRow>
              <DetailRow
                label={t("details.dependsOn")}
                empty={!plan.dependsOn || plan.dependsOn.length === 0}
              >
                {planLinkList(plan.dependsOn ?? [])}
              </DetailRow>
              <DetailRow label={t("details.issue")} empty={!plan.sourceUrl}>
                <a
                  href={plan.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-primary hover:underline"
                >
                  {plan.sourceUrl}
                </a>
              </DetailRow>
              <DetailRow label={t("details.created")} empty={!plan.created}>
                {(plan.created ?? "").slice(0, 10)}
              </DetailRow>
              <DetailRow label={t("details.level")} empty={!plan.level}>
                {plan.level}
              </DetailRow>
              <DetailRow label={t("details.project")} empty={!plan.project}>
                {plan.project}
              </DetailRow>
              <DetailRow label={t("details.state")}>
                {labels.planState(effectivePlan.state)}
              </DetailRow>
            </dl>

            {/* Repos and commits have no row of their own in V1's Details tab; they are kept here
              because V2's Git tab is the only other place they appear, and that tab now exists only
              for a plan under review. For every Draft — which is most of them — this is the only
              place they are readable at all, so these two panels are load-bearing rather than a
              duplicate of the Git tab. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  {t("details.repositories")}
                </h4>
                <ul className="mt-2 space-y-1 font-mono text-sm text-muted-foreground">
                  {plan.repos && plan.repos.length > 0 ? (
                    plan.repos.map((r, i) => <li key={i}>{r}</li>)
                  ) : (
                    <li className="font-sans text-muted-foreground/70">
                      {t("details.noRepositories")}
                    </li>
                  )}
                </ul>
              </div>

              <div>
                <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  {t("details.commits")}
                </h4>
                <ul className="mt-2 space-y-1 font-mono text-sm text-muted-foreground">
                  {plan.commits && plan.commits.length > 0 ? (
                    plan.commits.map((c, i) => <li key={i}>{c}</li>)
                  ) : (
                    <li className="font-sans text-muted-foreground/70">{t("details.noCommits")}</li>
                  )}
                </ul>
              </div>

              {/* `GitTabView`: the PR section exists only when the plan records one. */}
              {plan.prs && plan.prs.length > 0 && (
                <PlanPullRequests planId={plan.id} prs={plan.prs} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
