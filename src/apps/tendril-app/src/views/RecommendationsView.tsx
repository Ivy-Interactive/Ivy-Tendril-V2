import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleCheck, ExternalLink, RefreshCw, X } from "lucide-react";
import type { ShellBadgeDto } from "@ivy-interactive/components/tendril";
import { bridge } from "../api/bridge";
import {
  describeBridgeError,
  type CrossPlanRecommendation,
  type RecommendationState,
} from "../types/api";
import { NoContentView } from "../components/NoContentView";
import { REC_IMPACT_CLASS } from "../components/RecommendationCard";
import { RecommendationNoteDialog } from "../components/RecommendationNoteDialog";
import { usePublishSidebarList, type ShellSidebarList } from "../state/sidebarListStore";
import { formatPlanId } from "./PlansView";

/**
 * Which recommendation the inbox will show at all, from
 * `RecommendationsApp.Build`: `r.SourcePlanStatus == PlanStatus.Completed`, and the same predicate
 * the daemon's own pending count uses (`PlanDatabaseService.ComputePlanCounts`, whose subquery reads
 * `State = 'Pending' AND SourcePlanStatus = 'Completed'`).
 *
 * The reason is not cosmetic: accepting a recommendation starts a CreatePlan job, and a source plan
 * that has not finished may still do the work itself. A recommendation from a Failed or Executing
 * plan is a note, not an action.
 *
 * A row with no `sourcePlanStatus` at all is shown rather than hidden. The field is optional on the
 * DTO and the projection route is currently unreachable from the desktop app (see the report), so
 * "absent" means the transport lost it, and blanking the page on a transport gap is the worse
 * failure of the two.
 */
const isActionableSource = (rec: CrossPlanRecommendation): boolean =>
  rec.sourcePlanStatus == null ||
  rec.sourcePlanStatus === "" ||
  rec.sourcePlanStatus === "Completed";

/**
 * The identity `RecommendationsApp.RecommendationId` uses: plan plus title, since a title is only
 * unique within its plan.
 */
export const recommendationId = (rec: CrossPlanRecommendation): string =>
  `${rec.planId}::${rec.title}`;

/**
 * `RecommendationsApp.BuildRowBadges`, which deliberately mirrors the detail header's badge row
 * (Project + Impact) so each row is self-describing: High is Success, Medium is Warning, anything
 * else neutral.
 */
const recommendationRowBadges = (rec: CrossPlanRecommendation): ShellBadgeDto[] => {
  const badges: ShellBadgeDto[] = [];
  if (rec.project) badges.push({ label: rec.project, kind: "project" });
  if (rec.impact) {
    badges.push({
      label: rec.impact,
      kind: rec.impact === "High" ? "success" : rec.impact === "Medium" ? "warning" : "neutral",
    });
  }
  return badges;
};

/**
 * `RecommendationsApp.BuildSidebarList`, field for field: `new ShellSidebarListState(
 * "recommendations", "Recommendations", items, selected != null ? RecommendationId(selected) : null,
 * id => new RecommendationsAppArgs(id))`, where a row's tag is `#{ShortPlanId}` - the source plan,
 * which is the only context a recommendation's title needs.
 */
export const buildRecommendationsSidebarList = (
  recommendations: CrossPlanRecommendation[],
  selectedId: string | null,
  select: (id: string) => void,
): ShellSidebarList => ({
  appId: "recommendations",
  title: "Recommendations",
  items: recommendations.map((rec) => ({
    id: recommendationId(rec),
    title: rec.title,
    tag: formatPlanId(rec.planId),
    badges: recommendationRowBadges(rec),
  })),
  selectedId,
  buildSelectArgs: (id) => {
    /* The shell routes a click as `OpenApp(new NavigateArgs("recommendations", BuildSelectArgs(id)))`
       and V1's app reads `RecommendationsAppArgs.RecommendationId` back out. V2 has no arg-carrying
       navigation yet, so the selection is applied here too; the returned object is still V1's args,
       so this drops out once the shell can hand args to a view. */
    select(id);
    return { recommendationId: id };
  },
});

export interface RecommendationsViewProps {
  onSelectPlan: (planId: string) => void;
  onJobStarted?: (res: { jobId: string }) => void;
}

/**
 * The Recommendations page.
 *
 * `RecommendationsApp.Build` renders no list: it publishes one into the shell sidebar on every build
 * and returns a `ContentView` showing the selected recommendation, with Accept, Decline and Accept
 * with Notes acting on that one. So does this.
 *
 * Only pending recommendations from a Completed plan are ever listed (V1's `allPending`), which is
 * also why this page has no status filter: a decided recommendation is not something the page can
 * act on, and V1 never shows one here.
 */
export const RecommendationsView: React.FC<RecommendationsViewProps> = ({
  onSelectPlan,
  onJobStarted,
}) => {
  const [recommendations, setRecommendations] = useState<CrossPlanRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** The row the operator picked, as `"planId::title"`; null means "whatever is first". */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Dialog state for Accept With Notes or Decline
  const [activeDialog, setActiveDialog] = useState<{
    rec: CrossPlanRecommendation;
    action: "Accept" | "Decline";
  } | null>(null);

  /**
   * The recommendation an action is mid-flight on, as `"planId::title"`.
   *
   * V1 gets this guard for free: `ContentView`'s Accept and Decline both call `refresh()` and
   * `GoToNext()`, so the row the operator just acted on is no longer the selected one and its
   * buttons are gone before a second click can land. The selection moves here too, but only once
   * the service has answered — and Accept writes a state *and* starts a CreatePlan job, which means
   * a double click costs two plans and two agent runs.
   */
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await bridge.listCrossPlanRecommendations();
      setRecommendations(list);
      setError(null);
    } catch (err) {
      setError(`Failed to load recommendations: ${describeBridgeError(err)}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** `RecommendationsApp.Build`'s `allPending`: Pending, and from a plan that finished. */
  const pending = useMemo(
    () =>
      recommendations.filter(
        (rec) => isActionableSource(rec) && (rec.state ?? "Pending") === "Pending",
      ),
    [recommendations],
  );

  /**
   * The selection, re-resolved on every render as V1 does: an explicit pick wins while it is still
   * pending, and otherwise the first row is selected (`if (selectedState.Value == null &&
   * allPending.Count > 0) selectedState.Set(allPending[0])`, plus the block below it that drops a
   * selection which has left the list).
   */
  const explicitIndex = selectedId
    ? pending.findIndex((r) => recommendationId(r) === selectedId)
    : -1;
  const selectedIndex = explicitIndex >= 0 ? explicitIndex : pending.length > 0 ? 0 : -1;
  const selected = selectedIndex >= 0 ? pending[selectedIndex] : undefined;

  const sidebarList = useMemo(
    () =>
      buildRecommendationsSidebarList(
        pending,
        selected ? recommendationId(selected) : null,
        setSelectedId,
      ),
    [pending, selected],
  );

  /* Published on every render, which is what `ShellSidebarListSignal` documents the shell as
     expecting ("The active app publishes this on every build"). `selectedId` drives both the
     highlighted row and the page tab's title (`TendrilAppShell.PageTabTitle`). */
  usePublishSidebarList(sidebarList);

  /**
   * `ContentView.GoToNext`, which every decision ends with: the operator works down the list
   * instead of being thrown back to the top, and the row just acted on is the one that leaves.
   */
  const goToNext = () => {
    if (pending.length === 0) return;
    const next = pending[(Math.max(selectedIndex, 0) + 1) % pending.length];
    setSelectedId(next ? recommendationId(next) : null);
  };

  /**
   * The whole state machine, mirroring `Recommendations/ContentView`'s two handlers and its
   * `AcceptWithNotesDialog` callback:
   *
   * - Decline writes `Declined` and nothing else.
   * - Accept writes `Accepted`, then starts a CreatePlan job from the description.
   * - Accept with notes writes `AcceptedWithNotes` and starts the job from the `[ORIGINAL
   *   RECOMMENDATION]` / `[NOTES]` envelope, so the agent sees both.
   *
   * The write comes first in all three, exactly as V1 orders them: a recommendation marked accepted
   * whose job failed to start is recoverable (start it again from the plan), whereas a job started
   * against a recommendation still marked Pending gets accepted a second time by the next operator.
   *
   * The reload at the end is V1's `refresh()`. It matters more here than the optimistic patch it
   * replaces: when `startJob` fails after the state write landed, the patch would leave the row
   * reading Pending while the daemon has it as Accepted, and the operator's next click would be
   * refused for reasons nothing on screen explains.
   */
  const handleSetState = async (
    rec: CrossPlanRecommendation,
    state: RecommendationState,
    noteOrReason?: string,
  ) => {
    const id = recommendationId(rec);
    if (pendingId != null) return;
    setActionError(null);
    setPendingId(id);

    const declineReason = state === "Declined" ? noteOrReason : undefined;
    const notes = state === "AcceptedWithNotes" ? noteOrReason : undefined;

    try {
      await bridge.setRecommendationState(rec.planId, rec.title, state, declineReason, notes);
    } catch (err) {
      setActionError(`Failed to update recommendation "${rec.title}": ${describeBridgeError(err)}`);
      setPendingId(null);
      return;
    }

    // Reflected immediately so the row leaves the list it is no longer pending in; the reload below
    // is what makes it true rather than merely hopeful.
    setRecommendations((prev) =>
      prev.map((item) =>
        item.planId === rec.planId && item.title === rec.title
          ? { ...item, state, declineReason, notes }
          : item,
      ),
    );
    goToNext();

    if (state === "Accepted" || state === "AcceptedWithNotes") {
      const description = notes
        ? `[ORIGINAL RECOMMENDATION]\n${rec.description}\n\n[NOTES]\n${notes}`
        : rec.description;
      try {
        const res = await bridge.startJob({
          type: "CreatePlan",
          prompt: description,
          project: rec.project,
        });
        if (res && onJobStarted) onJobStarted(res);
      } catch (err) {
        // Named apart from a failed write, because the two need different things from the operator:
        // this one is accepted-but-not-started, which only a retry from the plan can fix.
        setActionError(
          `Marked "${rec.title}" accepted, but the CreatePlan job did not start: ` +
            `${describeBridgeError(err)}`,
        );
      }
    }

    setPendingId(null);
    await load();
  };

  const isBusy = pendingId != null;
  const impactClass = selected?.impact
    ? (REC_IMPACT_CLASS[selected.impact] ?? "border border-border text-muted-foreground")
    : "border border-border text-muted-foreground";

  return (
    <div data-testid="recommendations-view" className="space-y-4">
      {actionError && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-box border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
            className="ml-2 font-bold"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-box border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {!selected ? (
        <NoContentView
          data-testid="recommendations-empty"
          // `NoContentView("No recommendations", "Recommendations from completed plans will appear
          // here")`, with no `cta`: V1 hangs the process wallpaper off Plans and Review only. There
          // is no second "nothing matches your filter" case any more either - the page has no
          // filters, because V1's list is always exactly the pending recommendations.
          title="No recommendations"
          description="Recommendations from completed plans will appear here"
        />
      ) : (
        <>
          {/* `ResponsiveHeader.Build(BuildTitleArea, BuildControls)`: the title is `#{ShortPlanId}
              {Title}` and carries no badges (they are on the sidebar row), and the controls are the
              project badge, where the operator is in the list, then Decline and Accept. */}
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
            <h1
              data-testid="recommendation-title"
              className="min-w-0 truncate text-base font-semibold text-foreground"
              title={selected.title}
            >
              {formatPlanId(selected.planId)} {selected.title}
            </h1>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {selected.project && (
                <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {selected.project}
                </span>
              )}
              {selected.impact && (
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${impactClass}`}>
                  {selected.impact}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {selectedIndex + 1}/{pending.length}
                </span>{" "}
                recommendations
              </span>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setActiveDialog({ rec: selected, action: "Decline" })}
                className="inline-flex items-center gap-1.5 rounded-field border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                Decline
              </button>
              <button
                type="button"
                data-testid="recommendation-accept"
                disabled={isBusy}
                onClick={() => void handleSetState(selected, "Accepted")}
                className="inline-flex items-center gap-1.5 rounded-field bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-xs transition hover:bg-primary/90 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {pendingId === recommendationId(selected) ? "Accepting..." : "Accept"}
              </button>
            </div>
          </div>

          {/* `FooterLayout`'s action bar: Accept with Notes, then View Plan. Refresh is V2's own -
              V1 re-reads on the inbox auto-refresh hook instead of a button. */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setActiveDialog({ rec: selected, action: "Accept" })}
              className="inline-flex items-center gap-1.5 rounded-field border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              <CircleCheck className="h-3.5 w-3.5" />
              Accept with Notes
            </button>
            <button
              type="button"
              onClick={() => onSelectPlan(selected.planId)}
              className="inline-flex items-center gap-1.5 rounded-field border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View Plan
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-field border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {/* The recommendation itself, which is the whole scrollable content in V1. */}
          <div
            data-testid={`recommendation-detail-${selected.title}`}
            className="whitespace-pre-wrap text-sm text-muted-foreground"
          >
            {selected.description}
          </div>
        </>
      )}

      {/* Note dialog */}
      {activeDialog && (
        <RecommendationNoteDialog
          isOpen
          title={activeDialog.rec.title}
          // `AcceptWithNotesDialog` renders the recommendation in its body, so the notes are written
          // against the text rather than from memory.
          recommendationDescription={activeDialog.rec.description}
          action={activeDialog.action}
          onClose={() => setActiveDialog(null)}
          onSubmit={async (note) => {
            const rec = activeDialog.rec;
            const action = activeDialog.action;
            setActiveDialog(null);
            if (action === "Accept") {
              await handleSetState(rec, note ? "AcceptedWithNotes" : "Accepted", note);
            } else {
              await handleSetState(rec, "Declined", note);
            }
          }}
        />
      )}
    </div>
  );
};
