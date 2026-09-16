import React, { useEffect, useMemo, useState } from "react";
import {
  CircleCheck,
  ExternalLink,
  GitPullRequest,
  MessageSquare,
  RotateCcw,
  Trash,
} from "lucide-react";
import { useShortcut } from "@ivy-interactive/components/tendril";
import {
  describeBridgeError,
  type DraftComment,
  type PlanDetail,
  type PlanSummary,
  type PlanVerification,
  type RecommendationItem,
  type RecommendationState,
  type ReviewActionConfig,
  type StartJobResponse,
  type VerificationStatus,
} from "../types/api";
import { bridge } from "../api/bridge";
import { PlanActionsController } from "../controllers/plan_actions";
import { EmptyState } from "../components/EmptyState";
import { RecommendationCard } from "../components/RecommendationCard";
import { RecommendationNoteDialog } from "../components/RecommendationNoteDialog";
import { ReviewActionsBarView } from "../components/ReviewActionsBarView";
import { formatPlanId, parseProjects, planStateBadgeClass } from "./PlansView";
import type { ReviewActionTarget } from "./ReviewActionView";
import { CreatePrDialog } from "./dialogs/CreatePrDialog";
import { DiscardPlanDialog } from "./dialogs/DiscardPlanDialog";
import { PartialDeliveryDialog } from "./dialogs/PartialDeliveryDialog";
import { ResetToDraftDialog } from "./dialogs/ResetToDraftDialog";
import { SuggestChangesDialog } from "./dialogs/SuggestChangesDialog";

/** The triage dialogs this view owns, at most one open at a time. */
type TriageDialog = "createPr" | "suggestChanges" | "discard" | "reset" | "partialDelivery";

/**
 * The queue, exactly as `ReviewApp.Build` selects it: a plan waiting on a human is one in Review
 * **or Failed**, newest first (`.Where(p => p.Status is PlanStatus.Review or PlanStatus.Failed)
 * .OrderByDescending(p => p.Id)`). A failed execution needs the same decision a passing one does -
 * retry, reset or discard - so V1 triages both on this page.
 */
const REVIEW_QUEUE_STATES: PlanSummary["state"][] = ["Review", "Failed"];

const queueFor = (plans: PlanSummary[]): PlanSummary[] =>
  plans
    .filter((p) => REVIEW_QUEUE_STATES.includes(p.state))
    .sort((a, b) => {
      const left = Number.parseInt(a.id, 10);
      const right = Number.parseInt(b.id, 10);
      if (Number.isNaN(left) || Number.isNaN(right)) return b.id.localeCompare(a.id);
      return right - left;
    });

/**
 * `ReviewApp.BuildRowBadges`: a plan reads as Verified only once every gate has run and none of
 * them failed (`plan.Verifications.Count > 0 && All(Pass or Skipped)`); anything else, including a
 * plan with no gates at all, is Unverified.
 */
const isVerified = (verifications: PlanVerification[] | undefined): boolean =>
  !!verifications &&
  verifications.length > 0 &&
  verifications.every((v) => v.status === "Pass" || v.status === "Skipped");

/**
 * `Constants.VerificationStatusBadgeVariants` (V1 `src/Ivy.Tendril/Constants.cs`): Pass is Success,
 * Fail is Destructive, Pending and Skipped are Outline. Same mapping as the plan page's
 * verification rows, so one outcome never has two looks.
 */
const VERIFICATION_BADGE_CLASS: Record<VerificationStatus, string> = {
  Pass: "border-success/40 bg-success/10 text-success",
  Fail: "border-destructive/40 bg-destructive/10 text-destructive",
  Pending: "border-border text-muted-foreground",
  Skipped: "border-border text-muted-foreground",
};

/**
 * The shortcuts `ReviewActions.Build` and `ContentView.AddPrimaryAction` bind, letter for letter:
 * the primary CTA on `m`, Request Changes on `c`, Reset to Draft on `r`, Discard on `Backspace`,
 * and `PlanNeighborShortcuts` walking the queue with the arrow keys.
 */
const PRIMARY_SHORTCUT = "m";
const REQUEST_CHANGES_SHORTCUT = "c";
const RESET_SHORTCUT = "r";
const DISCARD_SHORTCUT = "Backspace";

/** `.pws-btn`: 32px high, 8px radius, 14px medium label, 6px gap to its icon. */
const BTN_BASE =
  "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
/** `.pws-btn--primary`, whose `--pws-cta-bg` is `--primary`: the CTA is the one filled button. */
const BTN_PRIMARY = `${BTN_BASE} bg-primary text-primary-foreground hover:bg-primary/90`;
/** `.pws-btn--secondary`: transparent, bordered, foreground text, hover on the accent. */
const BTN_SECONDARY = `${BTN_BASE} border border-border text-foreground hover:bg-accent`;
/** `.pws-menu-item[data-danger="true"]`, whose `--pws-danger` is `--destructive`. */
const BTN_DANGER = `${BTN_BASE} border border-border text-destructive hover:bg-destructive/10`;

/**
 * The `TuiKbd` a `LabeledButton` trails its shortcut with (`.pws-btn-kbd`, 18px square, `bare`
 * variant). `border-current` so the cap reads on the filled CTA as well as on a bordered button,
 * and `aria-hidden` so the button's accessible name stays the action's label.
 */
const KbdHint: React.FC<{ keys: string }> = ({ keys }) => (
  <kbd
    aria-hidden="true"
    className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-current/30 px-1 text-[10px] font-medium opacity-70"
  >
    {keys}
  </kbd>
);

interface ReviewViewProps {
  plans: PlanSummary[];
  onSelectPlan: (planId: string) => void;
  /** A job a triage dialog started, so the shell can open its session tab. */
  onJobStarted?: (response: StartJobResponse) => void;
  /** The plan's state changed on the service; the caller should re-fetch. */
  onPlanChanged?: (planId: string) => void;
  /**
   * Hand a review action to the shell, which opens it in the full-height review-action view.
   *
   * This view cannot host the run itself: the action's output is a live stream and the app it starts
   * has to be framed at full height, neither of which fits inside a card on a scrolling triage page.
   */
  onOpenReviewAction?: (target: ReviewActionTarget) => void;
}

export const ReviewView: React.FC<ReviewViewProps> = ({
  plans,
  onSelectPlan,
  onJobStarted,
  onPlanChanged,
  onOpenReviewAction,
}) => {
  const reviewPlans = useMemo(() => queueFor(plans), [plans]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [activeDialog, setActiveDialog] = useState<TriageDialog | null>(null);

  /**
   * `PlanSelectionHelper.ResolveSelection`, which re-resolves on every build: an explicit
   * selection wins while it is still in the queue, and otherwise the queue's first plan is
   * selected. Deriving it rather than only seeding state at mount is what makes a queue that
   * arrives after the first render land on a plan instead of on nothing.
   */
  const explicitIndex = selectedPlanId ? reviewPlans.findIndex((p) => p.id === selectedPlanId) : -1;
  const selectedIndex = explicitIndex >= 0 ? explicitIndex : reviewPlans.length > 0 ? 0 : -1;
  const selectedPlan = selectedIndex >= 0 ? reviewPlans[selectedIndex] : undefined;
  const selectedId = selectedPlan?.id;

  // Recommendations come from the selected plan's plan.yaml via the bridge.
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  /**
   * Which plan the list in hand belongs to. `Text.Muted("No recommendations.")` is a fact about a
   * plan that has answered; before that the page is loading, and a "none" shown while the fetch is
   * still out would be a claim nothing has made yet.
   */
  const [loadedRecsFor, setLoadedRecsFor] = useState<string | null>(null);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [activeNoteDialog, setActiveNoteDialog] = useState<{
    title: string;
    action: "Accept" | "Decline";
  } | null>(null);

  useEffect(() => {
    // Cleared up front: the outgoing plan's recommendations must not sit under the incoming plan's
    // heading while its own fetch is out.
    setRecommendations([]);
    setLoadedRecsFor(null);
    setRecsError(null);
    if (!selectedId) return;

    let cancelled = false;

    bridge
      .listRecommendations(selectedId)
      .then((recs) => {
        if (cancelled) return;
        setRecommendations(recs ?? []);
        setLoadedRecsFor(selectedId);
      })
      .catch((err) => {
        if (cancelled) return;
        setRecommendations([]);
        setLoadedRecsFor(selectedId);
        setRecsError(describeBridgeError(err));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const [reviewActions, setReviewActions] = useState<ReviewActionConfig[]>([]);
  /**
   * The plan's detail record. The queue row only carries a summary, and three of V1's decisions
   * need more than that: which CTA to offer (`Commits.Count`), whether the source is a PR
   * (`IsPullRequestSource`), and the ports the review-action tooltips quote.
   */
  const [planDetail, setPlanDetail] = useState<PlanDetail | null>(null);

  useEffect(() => {
    setPlanDetail(null);
    if (!selectedId) return;

    let cancelled = false;
    bridge
      .getPlan(selectedId)
      .then((plan) => {
        if (!cancelled && plan) setPlanDetail(plan);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  /**
   * The unresolved diff comments, which `ReviewActions.Build` counts onto the Request Changes
   * action as its badge (`badge: ctx.CommentCount > 0 ? ... : null`) and
   * `SuggestChangesDialog` folds into the RetryPlan request. A rejection leaves the count at zero:
   * a missing badge understates the feedback, an error banner would block the triage page.
   */
  const [draftComments, setDraftComments] = useState<DraftComment[]>([]);

  useEffect(() => {
    setDraftComments([]);
    if (!selectedId) return;

    let cancelled = false;
    bridge
      .listDiffComments(selectedId)
      .then((comments) => {
        if (!cancelled && Array.isArray(comments)) {
          setDraftComments(comments.filter((c) => !c.isResolved));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedPlan?.project) {
      setReviewActions([]);
      return;
    }

    let cancelled = false;
    bridge
      .getProjectReviewActions(selectedPlan.project)
      .then((actions) => {
        if (!cancelled) setReviewActions(actions);
      })
      .catch(() => {
        if (!cancelled) setReviewActions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPlan?.project]);

  const allocatedPorts = planDetail?.allocatedPorts ?? selectedPlan?.allocatedPorts;

  /**
   * Apply a triage decision optimistically, then persist it. On failure the
   * previous list is restored: the operator must not be left believing a
   * decision was recorded in plan.yaml when it was not.
   */
  const setRecState = async (
    title: string,
    state: RecommendationState,
    declineReason?: string,
    notes?: string,
  ) => {
    if (!selectedId) return;

    const previous = recommendations;
    setRecommendations((prev) =>
      prev.map((r) => (r.title === title ? { ...r, state, declineReason, notes } : r)),
    );
    setActionError(null);

    try {
      await bridge.setRecommendationState(selectedId, title, state, declineReason, notes);
    } catch (err) {
      setRecommendations(previous);
      setActionError(`Could not mark "${title}" as ${state}: ${describeBridgeError(err)}`);
    }
  };

  const handleDialogSubmit = async (note?: string) => {
    if (!activeNoteDialog) return;
    const { title, action } = activeNoteDialog;
    const trimmedNote = note?.trim();
    const accepting = action === "Accept";
    const targetState: RecommendationState = accepting
      ? trimmedNote
        ? "AcceptedWithNotes"
        : "Accepted"
      : "Declined";
    const notePayload = trimmedNote || undefined;

    setActiveNoteDialog(null);
    // The same dialog text means different things either way round: a note on an
    // accept, a reason on a decline. They go to different fields.
    await setRecState(
      title,
      targetState,
      accepting ? undefined : notePayload,
      accepting ? notePayload : undefined,
    );
  };

  /**
   * A triage decision the service accepted: the plan leaves the queue, so the selection moves to
   * whatever now sits at the same place in it. `PlanSelectionHelper.ResolveSelection` keeps the
   * old index (`Math.Min(oldIndex, currentPlans.Count - 1)`) rather than jumping to the top, so
   * clearing a queue works down it instead of bouncing back to the newest plan every time.
   */
  const handlePlanLeftReview = (planId: string) => {
    const leavingIndex = reviewPlans.findIndex((p) => p.id === planId);
    const remaining = reviewPlans.filter((p) => p.id !== planId);
    if (remaining.length === 0) {
      setSelectedPlanId(null);
    } else {
      const next = Math.min(Math.max(leavingIndex, 0), remaining.length - 1);
      setSelectedPlanId(remaining[next].id);
    }
    onPlanChanged?.(planId);
  };

  const handleExecuteReviewAction = async (actionName: string) => {
    if (!selectedPlan) return;
    setActionError(null);
    if (onOpenReviewAction) {
      onOpenReviewAction({
        project: selectedPlan.project,
        actionName,
        planId: selectedPlan.id,
      });
      return;
    }
    // No host to open the view in — this view rendered on its own. Start the action anyway, which is
    // what pressing the button did before there was a view to watch it in.
    try {
      await bridge.executeReviewAction(selectedPlan.project, actionName, selectedPlan.id);
    } catch (err) {
      setActionError(`Review action "${actionName}" failed: ${describeBridgeError(err)}`);
    }
  };

  /**
   * `ContentView.AddPrimaryAction`'s CTA, optimistically applied and refreshed: `TransitionState`
   * to Completed, with the service's refusal surfaced instead of reading as a silent no-op (V1
   * toasts `PlanTransitionBlockedException`; this page has a banner where V1 has a toast).
   */
  const completePlan = async () => {
    if (!selectedPlan) return;
    setActionError(null);
    setPendingAction("complete");
    try {
      await bridge.updatePlanField(selectedPlan.id, "state", "Completed");
      handlePlanLeftReview(selectedPlan.id);
    } catch (err) {
      setActionError(
        `Could not complete plan ${formatPlanId(selectedPlan.id)}: ${describeBridgeError(err)}`,
      );
    } finally {
      setPendingAction(null);
    }
  };

  const canPr = selectedPlan
    ? PlanActionsController.canCreatePr(selectedPlan)
    : { allowed: false, reason: undefined };
  const canDiscard = selectedPlan
    ? PlanActionsController.canDiscard(selectedPlan)
    : { allowed: false, reason: undefined };
  const canReset = selectedPlan
    ? PlanActionsController.canReset(selectedPlan)
    : { allowed: false, reason: undefined };
  const canPartial = selectedPlan
    ? PlanActionsController.canCompletePartial(selectedPlan)
    : { allowed: false, reason: undefined };

  /**
   * Which CTA the plan gets, from `ContentView.AddPrimaryAction`: a plan with commits opens a PR -
   * "Update PR" when the plan came from one, since ExecutePlan based the worktree on that PR's head
   * branch and the push updates it rather than opening a second - and a plan with nothing committed
   * is completed instead, because there is nothing to open a PR from.
   *
   * `null` while the detail has not answered: the count is unknown, not zero, and the CTA holds at
   * Create PR rather than offering to complete a plan whose commits simply have not loaded.
   */
  const commitCount = planDetail ? (planDetail.commits?.length ?? 0) : null;
  const isPrUpdate = (planDetail?.sourceUrl ?? "").includes("/pull/");
  const completeIsPrimary = commitCount === 0;
  const primaryLabel = completeIsPrimary ? "Complete Plan" : isPrUpdate ? "Update PR" : "Create PR";
  const primaryDisabled = completeIsPrimary
    ? pendingAction !== null
    : !canPr.allowed || pendingAction !== null;
  const firePrimary = () => {
    if (primaryDisabled) return;
    if (completeIsPrimary) void completePlan();
    else setActiveDialog("createPr");
  };

  /**
   * V1's Request Changes folds the reviewer's unresolved inline comments into the RetryPlan
   * request (`SuggestChangesDialog.HandleSubmit`: a "Line-by-line feedback:" block of
   * `- **In [path](file:///…#L12) line 12** (by author):` rows). It lands in the editable field
   * here rather than being appended at submit, so the reviewer sees what is being sent.
   */
  const inlineFeedback = useMemo(() => {
    if (draftComments.length === 0) return undefined;
    const repoPath = planDetail?.repos?.[0] ?? "";
    const lines = ["Line-by-line feedback:"];
    for (const c of draftComments) {
      const absolute = `${repoPath}/${c.filePath}`.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
      const link = `file:///${absolute.replace(/^\/+/, "")}`;
      const by = c.author ? ` (by ${c.author})` : "";
      lines.push(`- **In [${c.filePath}](${link}#L${c.lineNumber}) line ${c.lineNumber}**${by}:`);
      lines.push(`  ${c.content}`);
    }
    return lines.join("\n");
  }, [draftComments, planDetail?.repos]);

  const commentSummary = useMemo(
    () => draftComments.map((c) => `${c.filePath}:${c.lineNumber} — ${c.content}`),
    [draftComments],
  );

  // A shortcut must not fire behind a dialog: the dialog owns the keyboard while it is open, as
  // `useActionShortcuts`' `hostModalOpen()` gate does for the workspace's own actions.
  const modalOpen = activeDialog !== null || activeNoteDialog !== null;

  useShortcut("review:primary-action", PRIMARY_SHORTCUT, firePrimary, {
    description: primaryLabel,
    disabled: modalOpen || primaryDisabled,
  });
  useShortcut(
    "review:request-changes",
    REQUEST_CHANGES_SHORTCUT,
    () => setActiveDialog("suggestChanges"),
    { description: "Request Changes", disabled: modalOpen || !selectedPlan },
  );
  useShortcut("review:reset-to-draft", RESET_SHORTCUT, () => setActiveDialog("reset"), {
    description: "Reset to Draft",
    disabled: modalOpen || !canReset.allowed,
  });
  useShortcut("review:discard", DISCARD_SHORTCUT, () => setActiveDialog("discard"), {
    description: "Discard",
    disabled: modalOpen || !canDiscard.allowed,
  });
  useShortcut(
    "review:previous-plan",
    "ArrowLeft",
    () => setSelectedPlanId(reviewPlans[selectedIndex - 1]?.id ?? null),
    { description: "Previous plan", disabled: modalOpen || selectedIndex <= 0 },
  );
  useShortcut(
    "review:next-plan",
    "ArrowRight",
    () => setSelectedPlanId(reviewPlans[selectedIndex + 1]?.id ?? null),
    {
      description: "Next plan",
      disabled: modalOpen || selectedIndex < 0 || selectedIndex >= reviewPlans.length - 1,
    },
  );

  if (reviewPlans.length === 0) {
    return (
      <div data-testid="review-view">
        {/* `NoContentView("No plans to review", "Completed plans will appear here for review")`. */}
        <EmptyState
          title="No plans to review"
          description="Completed plans will appear here for review"
        />
      </div>
    );
  }

  const verifications = selectedPlan?.verifications ?? [];
  const pendingRecs = recommendations.filter((r) => !r.state || r.state === "Pending");

  return (
    <div className="space-y-4" data-testid="review-view">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* The queue. `ReviewApp.BuildSidebarList` renders it as the shell's sidebar list, so a row
            is a title with its `#id` tag opposite, its badges underneath, and selection is a filled
            row (`.tsh-section-item[data-selected="true"]` on `--tsh-row-active`) rather than a
            coloured outline. */}
        <div className="rounded-xl border border-border bg-card/40 p-2">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-sm font-medium text-foreground">Review</span>
            <span className="text-xs text-muted-foreground">{reviewPlans.length}</span>
          </div>
          <div className="mt-1 space-y-0.5">
            {reviewPlans.map((p) => (
              <button
                key={p.id}
                type="button"
                data-selected={p.id === selectedId}
                aria-current={p.id === selectedId}
                onClick={() => setSelectedPlanId(p.id)}
                className={`flex w-full flex-col gap-1 rounded-md px-3 py-2.5 text-left transition ${
                  p.id === selectedId ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                }`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                  <span className="shrink-0 text-sm font-medium">{formatPlanId(p.id)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {/* `BuildRowBadges`: the project, then whether the gates passed. A Failed plan
                      also carries its state, which V1's shell row shows as the row's own state
                      rather than as a badge. */}
                  {parseProjects(p.project).map((project) => (
                    <span
                      key={project}
                      className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {project}
                    </span>
                  ))}
                  {isVerified(p.verifications) ? (
                    <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs text-success">
                      Verified
                    </span>
                  ) : (
                    <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning">
                      Unverified
                    </span>
                  )}
                  {p.state !== "Review" && (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${planStateBadgeClass(
                        p.state,
                      )}`}
                    >
                      {p.state}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* The plan under review. */}
        {selectedPlan && (
          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-xl border border-border bg-card/60">
              {/* `PlanWorkspace`'s title bar (`.pws-topbar`): the plan id unemphasised, the title
                  semibold beside it, then the source link and where the plan sits in the queue
                  (`.Meta($"{currentIndex + 1}/{allPlans.Count} plans")`). */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-2 pl-5 pr-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2 text-base text-foreground">
                    <span className="shrink-0 font-normal">{formatPlanId(selectedPlan.id)}</span>
                    <span className="truncate font-semibold" title={selectedPlan.title}>
                      {selectedPlan.title}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {planDetail?.sourceUrl && (
                      <a
                        href={planDetail.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={planDetail.sourceUrl}
                        className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                      >
                        <ExternalLink size={14} />
                        {isPrUpdate ? "PR" : "Issue"}
                      </a>
                    )}
                    <span className="text-foreground">
                      {selectedIndex + 1}/{reviewPlans.length} plans
                    </span>
                    {parseProjects(selectedPlan.project).map((project) => (
                      <span
                        key={project}
                        className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {project}
                      </span>
                    ))}
                  </div>
                </div>

                {/* The action cluster, in the order `.pws-topbar-right` renders it: the icon
                    actions and menu items first, the CTA last. V2 has no tabbed workspace on this
                    page, so the link to the plan's own page rides along as a secondary button. */}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveDialog("suggestChanges")}
                    className={BTN_SECONDARY}
                    title="Request Changes"
                  >
                    <MessageSquare size={16} />
                    Request Changes
                    {draftComments.length > 0 && (
                      <span
                        data-testid="request-changes-comment-count"
                        className="rounded-full bg-muted px-1.5 text-xs tabular-nums"
                      >
                        {draftComments.length}
                      </span>
                    )}
                    <KbdHint keys="C" />
                  </button>
                  {canPartial.allowed && (
                    <button
                      type="button"
                      onClick={() => setActiveDialog("partialDelivery")}
                      className={`${BTN_BASE} border border-warning/40 text-warning hover:bg-warning/10`}
                    >
                      Accept Partial Delivery
                    </button>
                  )}
                  {canReset.allowed && (
                    <button
                      type="button"
                      onClick={() => setActiveDialog("reset")}
                      className={BTN_SECONDARY}
                    >
                      <RotateCcw size={16} />
                      Reset to Draft
                      <KbdHint keys="R" />
                    </button>
                  )}
                  {canDiscard.allowed && (
                    <button
                      type="button"
                      onClick={() => setActiveDialog("discard")}
                      className={BTN_DANGER}
                    >
                      <Trash size={16} />
                      Discard
                      <KbdHint keys="⌫" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectPlan(selectedPlan.id)}
                    className={BTN_SECONDARY}
                  >
                    View Full Spec &amp; Diff →
                  </button>
                  <button
                    type="button"
                    disabled={primaryDisabled}
                    title={completeIsPrimary ? undefined : canPr.reason}
                    onClick={firePrimary}
                    className={BTN_PRIMARY}
                  >
                    {completeIsPrimary ? <CircleCheck size={16} /> : <GitPullRequest size={16} />}
                    {pendingAction === "complete" ? "Completing…" : primaryLabel}
                    <KbdHint keys="M" />
                  </button>
                </div>
              </div>

              {/* `ContentView.BuildPage`'s toolbar slot: the project's review actions sit above the
                  content as a bare button row (`ReviewActionsBarView`, `Padding(3, 2, 1, 0)`), with
                  no heading over them - the buttons are named after what they run. */}
              {reviewActions.length > 0 && (
                <div
                  className="border-b border-border px-5 pb-1 pt-2"
                  data-testid="review-actions-bar-container"
                >
                  <ReviewActionsBarView
                    project={selectedPlan.project}
                    planId={selectedPlan.id}
                    actions={reviewActions}
                    allocatedPorts={allocatedPorts}
                    onExecuteAction={handleExecuteReviewAction}
                  />
                </div>
              )}

              {/* `ReviewVerificationsPanelView`: the outcome badge in an auto-width column, the
                  verification's name in the rest of the row, and "No verifications" when the plan
                  has none. V1 opens the report in a sheet; this page has none, so the report stays
                  on the plan page's Verifications tab. */}
              <div className="border-b border-border px-5 py-3">
                <div className="mb-2 text-sm font-medium text-foreground">Verifications</div>
                {verifications.length === 0 ? (
                  <p data-testid="no-verifications" className="text-sm text-muted-foreground">
                    No verifications
                  </p>
                ) : (
                  <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                    {verifications.map((v) => (
                      <React.Fragment key={v.name}>
                        <span
                          data-testid={`review-verification-${v.name}`}
                          className={`justify-self-start rounded border px-2 py-0.5 text-xs font-medium ${
                            VERIFICATION_BADGE_CLASS[v.status]
                          }`}
                        >
                          {v.status}
                        </span>
                        <span className="truncate text-sm text-foreground">{v.name}</span>
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>

              {actionError && (
                <div
                  role="alert"
                  data-testid="review-action-error"
                  className="m-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                >
                  {actionError}
                </div>
              )}
            </div>

            {/* `RecommendationsTabView`: the tab is labelled "Recommendations" and badged with how
                many are still pending. V1 lists only the pending ones; this page keeps the decided
                rows visible because the accept/decline triage happens here, and a decision that
                vanishes the row it was made on gives the operator nothing to check it by. */}
            <div className="rounded-xl border border-border bg-card/60 p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-foreground">Recommendations</h3>
                {pendingRecs.length > 0 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {pendingRecs.length}
                  </span>
                )}
              </div>

              {recsError && (
                <div
                  role="alert"
                  data-testid="recommendations-error"
                  className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                >
                  {recsError}
                </div>
              )}

              {/* `Text.Muted("Loading...")` while the plan's content query is in flight. */}
              {loadedRecsFor !== selectedId && !recsError && (
                <p className="mt-3 text-sm text-muted-foreground">Loading...</p>
              )}

              {loadedRecsFor === selectedId && !recsError && recommendations.length === 0 && (
                <p data-testid="no-recommendations" className="mt-3 text-sm text-muted-foreground">
                  No recommendations.
                </p>
              )}

              {recommendations.length > 0 && (
                <div className="mt-3 space-y-2">
                  {recommendations.map((rec) => (
                    <RecommendationCard
                      key={rec.title}
                      recommendation={rec}
                      onAccept={(title) => setActiveNoteDialog({ title, action: "Accept" })}
                      onDecline={(title) => setActiveNoteDialog({ title, action: "Decline" })}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <RecommendationNoteDialog
        isOpen={activeNoteDialog !== null}
        title={activeNoteDialog?.title ?? ""}
        action={activeNoteDialog?.action ?? "Accept"}
        onClose={() => setActiveNoteDialog(null)}
        onSubmit={handleDialogSubmit}
      />

      {selectedPlan && (
        <>
          <CreatePrDialog
            isOpen={activeDialog === "createPr"}
            onClose={() => setActiveDialog(null)}
            plan={selectedPlan}
            onJobStarted={(response) => onJobStarted?.(response)}
          />
          <SuggestChangesDialog
            isOpen={activeDialog === "suggestChanges"}
            onClose={() => setActiveDialog(null)}
            plan={selectedPlan}
            onJobStarted={(response) => onJobStarted?.(response)}
            initialChangeRequest={inlineFeedback}
            /* The comments themselves are already in the field via `inlineFeedback`; V1's dialog
               states the count in a callout and in the submit label rather than listing them again. */
            inlineCommentCount={commentSummary.length}
          />
          <DiscardPlanDialog
            isOpen={activeDialog === "discard"}
            onClose={() => setActiveDialog(null)}
            plan={selectedPlan}
            onDiscarded={handlePlanLeftReview}
          />
          <ResetToDraftDialog
            isOpen={activeDialog === "reset"}
            onClose={() => setActiveDialog(null)}
            plan={selectedPlan}
            onReset={handlePlanLeftReview}
          />
          <PartialDeliveryDialog
            isOpen={activeDialog === "partialDelivery"}
            onClose={() => setActiveDialog(null)}
            plan={selectedPlan}
            onCompleted={handlePlanLeftReview}
          />
        </>
      )}
    </div>
  );
};
