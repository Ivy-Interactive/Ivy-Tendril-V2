import React from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { WandSparkles } from "lucide-react";
import { Button, Callout, Densities } from "@ivy-interactive/components/ui";
import { PlanGitView, PlanMarkdown } from "@ivy-interactive/components/tendril";
import type { Annotation, Job, PlanDetail, PlanGitData, RecommendationItem } from "../../types/api";
import { ErrorBanner } from "../../components/ErrorBanner";
import { RecommendationCard } from "../../components/RecommendationCard";
import { PlanPullRequests } from "../PlanPullRequests";
import { PlanRevisionDiff } from "../PlanRevisionDiff";
import {
  DetailRow,
  ExecutionFailedCallout,
  planLinkLabel,
  type LifecycleDialog,
  type PlanDetailTab,
} from "./helpers";

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
}) => (
  <div className="flex min-h-0 flex-1 flex-col">
    {/* `PlanTabView.Build`: a failed plan leads with why, above the plan itself. */}
    {effectivePlan.state === "Failed" && (
      <div className="px-8 pt-6">
        <ExecutionFailedCallout plan={effectivePlan} jobs={jobs} />
      </div>
    )}
    {/* An absent body is prose, not a document: rendering it through `PlanMarkdown` is what made it
          indistinguishable from a real plan.

          All three reasons go through `Callout`, the library primitive `ErrorBanner` already wraps,
          rather than the three different treatments this used to have (two bare `<p>`s and one
          banner). One shape, three variants: the severity is the only thing that differs, which is
          what `Callout`'s variants are for. `Small` density and the icon are `ErrorBanner`'s
          choices, kept so the `unreadable` case renders exactly as it did. */}
    {emptyBodyReason ? (
      <div className="px-8 py-6">
        {emptyBodyReason === "writing" ? (
          <Callout.Info
            data-testid="revision-writing"
            density={Densities.Small}
            icon={false}
            className="text-sm"
          >
            The agent is still drafting this plan. Its body appears here once the job writes the
            first revision.
          </Callout.Info>
        ) : emptyBodyReason === "never" ? (
          <Callout.Warning
            data-testid="revision-never-written"
            density={Densities.Small}
            icon={false}
            className="text-sm"
          >
            <p>
              This plan has no revisions. Its folder was created but the job that was drafting it
              never wrote one, so there is no plan body to show.
            </p>
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
                Update Plan
              </Button>
            )}
          </Callout.Warning>
        ) : (
          <ErrorBanner data-testid="revision-unreadable">
            This plan records {plan.revisionCount} revision
            {plan.revisionCount === 1 ? "" : "s"} on disk, but its latest revision came back empty.
            The file may be unreadable.
          </ErrorBanner>
        )}
      </div>
    ) : null}
    {/* `PlanTabView.Build` composes this as
          `new PlanMarkdown(annotatedContent).Article().DangerouslyAllowLocalFiles()
           .Annotations(...).OnAnnotationsChange(...).OnAnswersChange(onAnswerChanged)
           .ScrollTo(scrollTo)`. `OnAnswersChange` is what makes the questions in the document
          answerable at all; without it `PlanMarkdown` passes `undefined` as its answer callback and
          "undefined puts every callout in read-only mode".

          Hidden entirely while the body is absent: `PlanMarkdown` with an empty string is what used
          to require the fake-heading placeholder. */}
    {!emptyBodyReason && (
      <PlanMarkdown
        id="plan-markdown"
        content={revisionContent}
        wireframeBaseUrl={wireframeBaseUrl}
        article
        dangerouslyAllowLocalFiles
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
    )}
  </div>
);

interface OtherTabsPaneProps {
  plan: PlanDetail;
  effectivePlan: PlanDetail;
  effectiveTab: PlanDetailTab;
  recommendations: RecommendationItem[];
  handleOpenDialog: (title: string, action: "Accept" | "Decline") => void;
  gitData: PlanGitData | null;
  gitError: string | null;
  runAction: (
    label: string,
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
}) => (
  <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
    {effectiveTab === "diff" && (
      <PlanRevisionDiff planId={plan.id} revisionCount={plan.revisionCount ?? 0} />
    )}

    {effectiveTab === "recommendations" && (
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Plan Recommendations</h3>
          <p className="text-xs text-muted-foreground">
            Out-of-scope follow-ups and improvements discovered during execution.
          </p>
        </div>

        {recommendations.length === 0 ? (
          <p data-testid="no-recommendations" className="text-xs text-muted-foreground/70">
            ExecutePlan registered no recommendations for this plan.
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
          <p className="text-sm text-muted-foreground/70">Loading git state…</p>
        )}
      </>
    )}

    {effectiveTab === "details" && (
      <div className="space-y-4">
        {/* `DetailsTabView.Build`'s own field order, and its `RemoveEmpty()`: a row the plan
              has no value for is dropped rather than rendered blank. */}
        <dl>
          <DetailRow label="Plan ID">
            <button
              type="button"
              onClick={() =>
                void runAction("Copy Plan ID", () => navigator.clipboard.writeText(plan.id))
              }
              title="Copy to clipboard"
              className="font-mono hover:underline"
            >
              {plan.id}
            </button>
          </DetailRow>
          <DetailRow label="Folder" empty={!plan.folderPath}>
            <button
              type="button"
              onClick={() =>
                void runAction("Copy Folder Path", () =>
                  navigator.clipboard.writeText(plan.folderPath ?? ""),
                )
              }
              title="Copy to clipboard"
              className="break-all font-mono hover:underline"
            >
              {plan.folderPath}
            </button>
          </DetailRow>
          <DetailRow label="Initial Prompt" empty={!plan.initialPrompt}>
            <span className="whitespace-pre-wrap">{plan.initialPrompt}</span>
          </DetailRow>
          <DetailRow label="Revision" empty={!plan.revisionCount}>
            {plan.revisionCount}
          </DetailRow>
          <DetailRow label="Profile" empty={!plan.executionProfile}>
            {plan.executionProfile}
          </DetailRow>
          <DetailRow
            label="Related Plans"
            empty={!plan.relatedPlans || plan.relatedPlans.length === 0}
          >
            {(plan.relatedPlans ?? []).map(planLinkLabel).join(", ")}
          </DetailRow>
          <DetailRow label="Depends On" empty={!plan.dependsOn || plan.dependsOn.length === 0}>
            {(plan.dependsOn ?? []).map(planLinkLabel).join(", ")}
          </DetailRow>
          <DetailRow label="Issue" empty={!plan.sourceUrl}>
            <a
              href={plan.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all text-primary hover:underline"
            >
              {plan.sourceUrl}
            </a>
          </DetailRow>
          <DetailRow label="Created" empty={!plan.created}>
            {(plan.created ?? "").slice(0, 10)}
          </DetailRow>
          <DetailRow label="Level" empty={!plan.level}>
            {plan.level}
          </DetailRow>
          <DetailRow label="Project" empty={!plan.project}>
            {plan.project}
          </DetailRow>
          <DetailRow label="State">{effectivePlan.state}</DetailRow>
        </dl>

        {/* Repos and commits have no row of their own in V1's Details tab; they are kept here
              because V2's Git tab is the only other place they appear, and that tab now exists only
              for a plan under review. For every Draft — which is most of them — this is the only
              place they are readable at all, so these two panels are load-bearing rather than a
              duplicate of the Git tab. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Repositories
            </h4>
            <ul className="mt-2 space-y-1 font-mono text-sm text-muted-foreground">
              {plan.repos && plan.repos.length > 0 ? (
                plan.repos.map((r, i) => <li key={i}>{r}</li>)
              ) : (
                <li className="font-sans text-muted-foreground/70">No repositories specified</li>
              )}
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Commits
            </h4>
            <ul className="mt-2 space-y-1 font-mono text-sm text-muted-foreground">
              {plan.commits && plan.commits.length > 0 ? (
                plan.commits.map((c, i) => <li key={i}>{c}</li>)
              ) : (
                <li className="font-sans text-muted-foreground/70">No commits yet</li>
              )}
            </ul>
          </div>

          {/* `GitTabView`: the PR section exists only when the plan records one. */}
          {plan.prs && plan.prs.length > 0 && <PlanPullRequests planId={plan.id} prs={plan.prs} />}
        </div>
      </div>
    )}
  </div>
);
