import React, { useEffect, useMemo, useState } from "react";
import {
  PlanWorkspace,
  useShortcut,
  type PlanActionDto,
  type PlanTabDto,
  type ShellBadgeDto,
} from "@ivy-interactive/components/tendril";
import { Callout } from "@ivy-interactive/components/ui";
import {
  describeBridgeError,
  type DraftComment,
  type Job,
  type PlanDetail,
  type PlanSummary,
  type PlanVerification,
  type RecommendationItem,
  type RecommendationState,
  type ReviewActionConfig,
  type StartJobResponse,
} from "../types/api";
import { bridge } from "../api/bridge";
import { PlanActionsController } from "../controllers/plan_actions";
import { NoContentView } from "../components/NoContentView";
import { VERIFICATION_BADGE_CLASS } from "../utils/verificationStatus";
import { PlanChatPanel } from "../components/chat/PlanChatPanel";
import { ProjectBadges } from "../components/ProjectBadges";
import { TendrilProcessWallpaper } from "../components/TendrilProcessWallpaper";
import { RecommendationCard } from "../components/RecommendationCard";
import { RecommendationNoteDialog } from "../components/RecommendationNoteDialog";
import { ReviewActionsBarView } from "../components/ReviewActionsBarView";
import { formatPlanId, isReviewState, parseProjects, resolvePlanSelection } from "./PlansView";
import { usePublishSidebarList, type ShellSidebarList } from "../state/sidebarListStore";
import type { ReviewActionTarget } from "./ReviewActionView";
import { CreatePrDialog } from "./dialogs/CreatePrDialog";
import { DeletePlanDialog } from "./dialogs/DeletePlanDialog";
import { PartialDeliveryDialog } from "./dialogs/PartialDeliveryDialog";
import { ResetToDraftDialog } from "./dialogs/ResetToDraftDialog";
import { SuggestChangesDialog } from "./dialogs/SuggestChangesDialog";

/** The triage dialogs this view owns, at most one open at a time. */
type TriageDialog = "createPr" | "suggestChanges" | "delete" | "reset" | "partialDelivery";

/**
 * `ReviewApp.Build`'s `activePlanFolders`: a job in one of these still holds the plan's worktree, so
 * every triage decision on that plan is one an agent is about to overwrite. `Blocked` counts - it is a
 * job queued behind another, not a job that finished.
 */
const JOB_HOLDS_PLAN: ReadonlyArray<Job["status"]> = ["Running", "Queued", "Pending", "Blocked"];

/**
 * The queue, exactly as `ReviewApp.Build` assembles it: Review or Failed, **minus the plans a job is
 * still running on** (`.Where(p => !activePlanFolders.Contains(p.FolderPath))`), newest first.
 *
 * The exclusion is the part that is easy to drop and matters most. A plan under a RetryPlan is in
 * Executing and so filtered by state anyway, but one whose retry is only Queued or Blocked is still
 * sitting in Review, and offering Complete Plan or Create PR on it means approving work that has not
 * been done yet. `jobs` absent means the caller has no job list to consult, in which case the state
 * filter is all there is.
 */
const queueFor = (plans: PlanSummary[], jobs?: Job[]): PlanSummary[] => {
  const held = new Set(
    (jobs ?? [])
      .filter((job) => JOB_HOLDS_PLAN.includes(job.status))
      .map((job) => job.planId)
      .filter((id): id is string => !!id),
  );

  return (
    plans
      // `isReviewState` normalises, so a plan still recorded as `ReadyForReview` is in the queue it
      // belongs to. Comparing the raw state dropped exactly those plans out of the page that triages
      // them - the same trap `LEGACY_LIFECYCLE_STATES` documents.
      .filter((p) => isReviewState(p.state) && !held.has(p.id))
      .sort((a, b) => {
        const left = Number.parseInt(a.id, 10);
        const right = Number.parseInt(b.id, 10);
        if (Number.isNaN(left) || Number.isNaN(right)) return b.id.localeCompare(a.id);
        return right - left;
      })
  );
};

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
 * `ReviewApp.BuildRowBadges`: the project, then Verified or Unverified.
 *
 * The state badge is V2's own and deliberate. V1's queue also holds Failed plans and tells them
 * apart by the row's state glyph, which `ShellItemState` only spells for a chat that is working or
 * finished - so without this a failed execution and a clean one read identically in the list.
 */
const reviewRowBadges = (plan: PlanSummary): ShellBadgeDto[] => {
  const badges: ShellBadgeDto[] = parseProjects(plan.project).map((project) => ({
    label: project,
    kind: "project",
  }));
  badges.push(
    isVerified(plan.verifications)
      ? { label: "Verified", kind: "success" }
      : { label: "Unverified", kind: "warning" },
  );
  if (plan.state !== "Review") badges.push({ label: plan.state, kind: "warning" });
  return badges;
};

/**
 * `ReviewApp.BuildSidebarList`, field for field: `new ShellSidebarListState("review", "Review",
 * items, selected?.FolderName, planId => new ReviewAppArgs(planId))`, where a row is the plan's
 * title with `#{Id}` as its tag.
 *
 * Nothing else is set: the default `Searchable` with no `OnSearch` is what makes the shell's search
 * icon open the plan search dialog, which is right for a plan list.
 */
export const buildReviewSidebarList = (
  plans: PlanSummary[],
  selectedId: string | null,
  select: (planId: string) => void,
): ShellSidebarList => ({
  appId: "review",
  title: "Review",
  items: plans.map((plan) => ({
    id: plan.id,
    title: plan.title,
    tag: formatPlanId(plan.id),
    badges: reviewRowBadges(plan),
  })),
  selectedId,
  buildSelectArgs: (planId) => {
    /* The shell routes a click as `OpenApp(new NavigateArgs("review", BuildSelectArgs(id)))` and V1's
       `ReviewApp` reads `ReviewAppArgs.PlanId` back out. V2 has no arg-carrying navigation yet, so
       the selection is applied here too; the returned object is still V1's args, so this drops out
       once the shell can hand args to a view. */
    select(planId);
    return { planId };
  },
});

/** `ContentView`'s `RecommendationsTab`. */
const RECOMMENDATIONS_TAB = "recommendations";

/**
 * `ContentView.BuildRecommendationChangeRequest`, verbatim in shape: a numbered heading per
 * recommendation with its description under it, which becomes one RetryPlan's change request.
 */
export const buildRecommendationChangeRequest = (
  selected: { title: string; description: string }[],
): string => {
  const lines = [
    `Implement the following ${selected.length} recommendation(s) from the review:`,
    "",
  ];
  selected.forEach((rec, index) => {
    lines.push(`## ${index + 1}. ${rec.title}`, "", rec.description, "");
  });
  return lines.join("\n").trimEnd();
};

/**
 * The shortcuts `ReviewActions.Build` and `ContentView.AddPrimaryAction` bind, letter for letter:
 * the primary CTA on `m`, Request Changes on `c`, Reset to Draft on `r`, and the danger menu item on
 * `Backspace` — which is Discard in V1 and Delete here — and `PlanNeighborShortcuts` walking the
 * queue with the arrow keys.
 */
const PRIMARY_SHORTCUT = "m";
const REQUEST_CHANGES_SHORTCUT = "c";
const RESET_SHORTCUT = "r";
const DELETE_SHORTCUT = "Backspace";

interface ReviewViewProps {
  plans: PlanSummary[];
  /**
   * The live job list. `ReviewApp.Build` reads it to keep a plan out of the queue while a job still
   * holds its worktree; see [`queueFor`]. Optional so a caller with no job list still gets the
   * state-filtered queue rather than an empty page.
   */
  jobs?: Job[];
  /**
   * The plan the address names, which is V1's `ReviewAppArgs.PlanId`: `ReviewApp.Build` seeds its
   * selection from `args?.PlanId` and re-resolves it on every build. Absent means "whatever this page
   * last selected", which is what leaves the default selection to {@link resolvePlanSelection}.
   */
  selectedPlanId?: string | null;
  onSelectPlan: (planId: string) => void;
  /**
   * V1's `ContentView` wires `onCreatePlan` into its embedded chat unconditionally, so "create plan
   * from this message" works there as well as on the Chat page. Threaded through to
   * {@link PlanChatPanel}; without it that message action is inert.
   */
  onCreatePlan?: (initialDescription: string) => void;
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
  /**
   * Opens the Create Plan dialog from the empty page's process wallpaper, which is what V1's
   * `CreatePlanDialogLauncher` does with `OnCreate` (`Hooks/UseTendrilProcess.cs`).
   */
  onNewPlan?: () => void;
  /** Where that wallpaper's other boxes navigate: `Navigate<PlansApp>`/`<ReviewApp>`/`<JobsApp>`. */
  onNavigate?: (navId: string) => void;
}

export const ReviewView: React.FC<ReviewViewProps> = ({
  plans,
  jobs,
  selectedPlanId: addressedPlanId = null,
  onSelectPlan,
  onCreatePlan,
  onJobStarted,
  onPlanChanged,
  onOpenReviewAction,
  onNewPlan,
  onNavigate,
}) => {
  const reviewPlans = useMemo(() => queueFor(plans, jobs), [plans, jobs]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [activeDialog, setActiveDialog] = useState<TriageDialog | null>(null);

  /**
   * `PlanSelectionHelper.ResolveSelection`, re-resolved on every render as V1 re-resolves it on every
   * build: the plan this page already had wins while it is still in the queue, the plan the address
   * names (V1's `ReviewAppArgs.PlanId`) is what seeds that on arrival, and with neither the queue's
   * **first** plan is selected — which, on a list ordered `.OrderByDescending(p => p.Id)`, is the
   * latest plan waiting for review. Deriving it rather than only seeding state at mount is what makes
   * a queue that arrives after the first render land on a plan instead of on nothing.
   */
  const selectedPlan =
    resolvePlanSelection(reviewPlans, selectedPlanId ?? addressedPlanId) ?? undefined;
  const selectedIndex = selectedPlan ? reviewPlans.indexOf(selectedPlan) : -1;
  const selectedId = selectedPlan?.id;

  /**
   * The queue itself goes to the shell sidebar, not into this page: `ReviewApp.Build` renders no
   * list of its own, it sends one (`sidebarListSignal.Send(BuildSidebarList(plans, selected))`) and
   * returns a `ContentView` that shows the selected plan.
   *
   * Published on every render, as `ShellSidebarListSignal`'s doc comment says the shell expects
   * ("The active app publishes this on every build"), which also keeps the closure over the current
   * selection fresh. `selectedId` is what highlights the row and titles the page tab
   * (`TendrilAppShell.PageTabTitle`).
   */
  const sidebarList = useMemo(
    () => buildReviewSidebarList(reviewPlans, selectedId ?? null, setSelectedPlanId),
    [reviewPlans, selectedId],
  );

  usePublishSidebarList(sidebarList);

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
  /**
   * `ContentView`'s `selectedRecTitles`: which pending recommendations Implement will act on. Held by
   * title, which is `RecommendationsTabView`'s own key, and cleared whenever the plan changes.
   */
  const [selectedRecTitles, setSelectedRecTitles] = useState<ReadonlySet<string>>(new Set());
  const [activeNoteDialog, setActiveNoteDialog] = useState<{
    title: string;
    action: "Accept" | "Decline";
  } | null>(null);

  useEffect(() => {
    // Cleared up front: the outgoing plan's recommendations must not sit under the incoming plan's
    // heading while its own fetch is out.
    setRecommendations([]);
    setSelectedRecTitles(new Set());
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
   * Whether the plan's pre-execution validation rejected its premise, which is the first half of
   * `PlanReaderService.GetCompletionBlockReasonForFolder`.
   *
   * `PreExecution` is deliberately not a plan.yaml verification row (it is a property of one execution
   * attempt, not of the plan) so it does not arrive with `plan.verifications` and has to be read as a
   * report. A missing report is `NOT_FOUND`, which is the common case and means nothing is blocked - a
   * plan is never blocked on a guess.
   */
  const [preExecutionFailed, setPreExecutionFailed] = useState(false);

  useEffect(() => {
    setPreExecutionFailed(false);
    if (!selectedId) return;

    let cancelled = false;
    bridge
      .getVerificationReport(selectedId, "PreExecution")
      .then((report) => {
        if (!cancelled) setPreExecutionFailed(report?.result === "Fail");
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  /**
   * `PlanReaderService.GetCompletionBlockReason`, whose text V1 shows in two places: the "No Changes
   * Needed" callout above the content, and the primary action, which becomes Delete Plan rather than
   * Complete Plan (V1 offers Skip Plan there, which was Discard under another label).
   *
   * Pre-execution said Fail **and** nothing was delivered. The no-commits-and-no-PRs conjunct is what
   * keeps config-only plans (which legitimately have neither) and any plan that did real work out of
   * the block. `null` until the detail has answered: the commit and PR counts are unknown then, not
   * zero, and blocking completion on an unloaded plan would be the same mistake in the other
   * direction.
   */
  const completionBlocked =
    preExecutionFailed &&
    planDetail !== null &&
    (planDetail.commits?.length ?? 0) === 0 &&
    (planDetail.prs?.length ?? 0) === 0;

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

  const toggleRecSelection = (title: string) => {
    setSelectedRecTitles((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  /**
   * `ContentView.ImplementSelectedRecommendations` (`Apps/Review/ContentView.cs`): accept the ticked
   * recommendations and retry the plan once with all of them as the change request.
   *
   * Both of V1's refusals are here, and both are decided against a **re-read** of the plan's
   * recommendations rather than the list in hand - the selection may have been made minutes ago and
   * another operator may have acted on the same rows since:
   *
   * - nothing ticked: "Select at least one recommendation to implement." ("Nothing Selected")
   * - the ticked rows are no longer pending: "Selected recommendations are no longer pending. Refresh
   *   and try again." ("Nothing to Implement")
   *
   * V1 marks them accepted in one service call (`AcceptRecommendationsAndRetry`) and V2 has no such
   * route, so they are written one at a time before the job starts - the same order V1 uses, and the
   * same reason: a recommendation marked accepted whose job never started is recoverable, one left
   * Pending after a job ran gets implemented twice.
   */
  const implementSelectedRecommendations = async () => {
    if (!selectedPlan || pendingAction !== null) return;
    setActionError(null);

    if (selectedRecTitles.size === 0) {
      setActionError("Select at least one recommendation to implement.");
      return;
    }

    setPendingAction("implementRecs");
    try {
      const current = await bridge
        .listRecommendations(selectedPlan.id)
        .catch(() => recommendations);
      const selected = (current ?? []).filter(
        (rec) => selectedRecTitles.has(rec.title) && (!rec.state || rec.state === "Pending"),
      );

      if (selected.length === 0) {
        setActionError("Selected recommendations are no longer pending. Refresh and try again.");
        return;
      }

      for (const rec of selected) {
        await bridge.setRecommendationState(selectedPlan.id, rec.title, "Accepted");
      }

      const response = await PlanActionsController.retryPlan(
        selectedPlan,
        buildRecommendationChangeRequest(selected),
      );
      setSelectedRecTitles(new Set());
      onJobStarted?.(response);
      onPlanChanged?.(selectedPlan.id);
    } catch (err) {
      setActionError(
        `Could not implement the selected recommendations: ${describeBridgeError(err)}`,
      );
    } finally {
      setPendingAction(null);
    }
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
  const canDeletePlan = selectedPlan
    ? PlanActionsController.canDelete(selectedPlan)
    : { allowed: false, reason: undefined };
  const canReset = selectedPlan
    ? PlanActionsController.canReset(selectedPlan)
    : { allowed: false, reason: undefined };
  const canPartial = selectedPlan
    ? PlanActionsController.canCompletePartial(selectedPlan)
    : { allowed: false, reason: undefined };

  /**
   * `ContentView.AddPrimaryAction`, in its order: a plan with commits opens a PR; failing that, a plan
   * whose completion is blocked offers Delete Plan — V1's Skip Plan, which opened the discard dialog
   * and so only ever wrote `Skipped`; failing that, Complete Plan.
   *
   * `isPrUpdate` is `PlanFile.IsPullRequestSource` (`SourceUrl?.Contains("/pull/")`). It changes both
   * the label and *how* the action fires - see [`updatePr`].
   *
   * `commitCount` is `null` while the detail has not answered: the count is unknown, not zero, and the
   * CTA holds at Create PR rather than offering to complete a plan whose commits simply have not
   * loaded.
   */
  const commitCount = planDetail ? (planDetail.commits?.length ?? 0) : null;
  const isPrUpdate = (planDetail?.sourceUrl ?? "").includes("/pull/");
  const prIsPrimary = commitCount !== 0;
  const deleteIsPrimary = !prIsPrimary && completionBlocked;

  /**
   * `ContentView.AddPrimaryAction`'s PR-update branch, which deliberately skips the Create PR dialog:
   * "There's nothing to configure for an update (no new branch, no merge/delete choices), so we skip
   * the Create PR dialog and push directly." ExecutePlan already based the worktree on the PR's head
   * branch, so this push updates the open PR instead of opening a second one, and the four options are
   * V1's literal `CreatePrArgs(SolveMergeConflicts: true, Merge: false, DeleteBranch: false,
   * IncludeArtifacts: true)`.
   *
   * The plan stays in the queue afterwards, as it does in V1: the PR is updated and left open for
   * review, so only a refresh is asked for.
   */
  const updatePr = async () => {
    if (!selectedPlan) return;
    setActionError(null);
    setPendingAction("updatePr");
    try {
      const response = await PlanActionsController.createPr(selectedPlan, {
        solveMergeConflicts: true,
        merge: false,
        deleteBranch: false,
        includeArtifacts: true,
      });
      onJobStarted?.(response);
      onPlanChanged?.(selectedPlan.id);
    } catch (err) {
      setActionError(
        `Could not update the PR for plan ${formatPlanId(selectedPlan.id)}: ${describeBridgeError(err)}`,
      );
    } finally {
      setPendingAction(null);
    }
  };

  const primaryLabel = prIsPrimary
    ? isPrUpdate
      ? "Update PR"
      : "Create PR"
    : deleteIsPrimary
      ? "Delete Plan"
      : "Complete Plan";
  const primaryDisabled = prIsPrimary
    ? !canPr.allowed || pendingAction !== null
    : deleteIsPrimary
      ? !canDeletePlan.allowed || pendingAction !== null
      : pendingAction !== null;
  const firePrimary = () => {
    if (primaryDisabled) return;
    if (prIsPrimary) {
      if (isPrUpdate) void updatePr();
      else setActiveDialog("createPr");
    } else if (deleteIsPrimary) {
      // V1's Skip Plan opened the discard dialog, which only ever wrote `PlanStatus.Skipped`. With
      // Discard gone, the delete confirm answers the same question and still offers "Move to
      // Skipped" as its first alternative, so the reversible answer is not lost.
      setActiveDialog("delete");
    } else {
      void completePlan();
    }
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

  /*
   * Only the queue walk is bound here. Every other key on this page belongs to a workspace action and
   * is registered by the widget itself from that action's `shortcut` (`useActionShortcuts`), gated on
   * its own `hostModalOpen()` - so binding them here too would fire each action twice.
   */
  const modalOpen = activeDialog !== null || activeNoteDialog !== null;

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

  /**
   * The topbar's action row, assembled as `ReviewActions.Build` assembles it: Request Changes as an
   * icon action (badged with the unresolved comment count), Reset to Draft and the danger item in the
   * overflow menu — Discard in V1, Delete here — and the CTA on its own.
   *
   * Every entry is a `PlanActionDto` reporting back through one `OnAction` event, and each carries
   * its own `shortcut` so the widget binds the keys V1 binds.
   */
  const iconActions: PlanActionDto[] = selectedPlan
    ? [
        {
          tag: "RequestChanges",
          label: "Request Changes",
          icon: "MessageSquare",
          shortcut: REQUEST_CHANGES_SHORTCUT,
          badge: draftComments.length > 0 ? String(draftComments.length) : undefined,
        },
      ]
    : [];

  const workspaceMenu: PlanActionDto[] = [];
  if (canReset.allowed)
    workspaceMenu.push({
      tag: "ResetToDraft",
      label: "Reset to Draft",
      icon: "RotateCcw",
      shortcut: RESET_SHORTCUT,
    });
  if (canDeletePlan.allowed)
    workspaceMenu.push({
      tag: "Delete",
      label: "Delete Plan",
      icon: "Trash",
      shortcut: DELETE_SHORTCUT,
      danger: true,
    });
  /*
   * V2's own, in the place V1 keeps its file-manager / terminal / copy-path / plan.yaml items: this
   * page carries the review decision, and everything else about the plan - its spec, diff, commits
   * and artifacts, which V1 has as tabs here - is on the plan's own page. See the report.
   */
  workspaceMenu.push({ tag: "OpenPlanPage", label: "Open Full Spec & Diff", icon: "ExternalLink" });

  const secondaryActions: PlanActionDto[] = [];
  if (canPartial.allowed)
    secondaryActions.push({
      tag: "PartialDelivery",
      label: "Accept Partial Delivery",
      icon: "TriangleAlert",
    });

  const primaryAction: PlanActionDto | null = selectedPlan
    ? {
        tag: "Primary",
        label:
          pendingAction === "complete"
            ? "Completing…"
            : pendingAction === "updatePr"
              ? "Pushing…"
              : primaryLabel,
        // `Icons.GitPullRequest`, `Icons.Ban`, `Icons.CircleCheck`, in `AddPrimaryAction`'s order.
        // `Ban` was Skip Plan's; the branch now deletes, so it takes Delete's `Trash` instead.
        icon: prIsPrimary ? "GitPullRequest" : deleteIsPrimary ? "Trash" : "CircleCheck",
        shortcut: PRIMARY_SHORTCUT,
        disabled: primaryDisabled,
        loading: pendingAction !== null,
      }
    : null;

  /**
   * Why the CTA is refused, when it is. V1 states this in a toast on the click
   * (`PlanTransitionBlockedException`); a `PlanActionDto` has nowhere to put it and a disabled button
   * cannot be clicked, so it is said once in the toolbar instead of being lost.
   */
  const primaryRefusal =
    primaryDisabled && pendingAction === null
      ? prIsPrimary
        ? canPr.reason
        : deleteIsPrimary
          ? canDeletePlan.reason
          : undefined
      : undefined;

  /** One `OnAction` event serves the icon actions, the menu and the buttons: tags are unique. */
  const handleWorkspaceAction = (tag: string) => {
    switch (tag) {
      case "RequestChanges":
        setActiveDialog("suggestChanges");
        return;
      case "ResetToDraft":
        setActiveDialog("reset");
        return;
      case "Delete":
        setActiveDialog("delete");
        return;
      case "PartialDelivery":
        setActiveDialog("partialDelivery");
        return;
      case "OpenPlanPage":
        if (selectedPlan) onSelectPlan(selectedPlan.id);
        return;
      case "Primary":
        firePrimary();
        return;
    }
  };

  if (reviewPlans.length === 0) {
    return (
      <div
        data-testid="review-view"
        /* Review is a full-bleed app, so the shell pads this page not at all and the empty state
           insets itself - V1 returns `NoContentView` before the `.RemoveParentPadding()` workspace
           branch, so it keeps the host's 16px and `Height(Size.Full())` centres it. */
        className="flex h-full min-h-0 items-center justify-center p-4"
      >
        {/* `NoContentView("No plans to review", "Completed plans will appear here for review",
            processView)`, where `processView` is `Context.UseTendrilProcess()`: the same pipeline
            wallpaper the empty Plans page carries. */}
        <NoContentView
          data-testid="review-empty"
          title="No plans to review"
          description="Completed plans will appear here for review"
          cta={
            <TendrilProcessWallpaper
              plans={plans}
              jobs={jobs}
              onNewPlan={onNewPlan}
              onNavigate={onNavigate}
            />
          }
        />
      </div>
    );
  }

  const verifications = selectedPlan?.verifications ?? [];
  const pendingRecs = recommendations.filter((r) => !r.state || r.state === "Pending");

  const recommendationTabs: PlanTabDto[] = [
    {
      id: RECOMMENDATIONS_TAB,
      label: "Recommendations",
      // `ContentView`: the tab is badged with how many are still pending.
      badge: pendingRecs.length > 0 ? String(pendingRecs.length) : undefined,
    },
  ];

  return (
    <div className="h-full min-h-0" data-testid="review-view">
      {/*
        The plan page's frame, as `Review/ContentView.BuildPage` composes it: the topbar
        (`PlanWorkspace`'s `.pws-topbar`) with the plan id, title, meta and project badges on the left
        and the action row on the right, the toolbar slot above the tab strip, the verifications panel
        in the strip's corner (`ReviewVerificationsPanelView`), and the tab content below.

        The queue is gone from this page entirely: it is the shell's sidebar list now.
      */}
      {selectedPlan && (
        <PlanWorkspace
          id="review-workspace"
          // `.PlanId($"#{plan.Id}")` — `#21`, not `#00021`.
          planId={formatPlanId(selectedPlan.id)}
          title={selectedPlan.title}
          // `.Meta($"{currentIndex + 1}/{allPlans.Count} plans")`.
          meta={`${selectedIndex + 1}/${reviewPlans.length} plans`}
          // `.Source(SourceUrl, IsPullRequestSource ? "PR" : "Issue")`.
          sourceUrl={planDetail?.sourceUrl || undefined}
          sourceLabel={isPrUpdate ? "PR" : "Issue"}
          actions={iconActions}
          menuItems={workspaceMenu}
          secondary={secondaryActions}
          primary={primaryAction}
          tabs={recommendationTabs}
          selectedTab={RECOMMENDATIONS_TAB}
          events={["OnAction", "OnTabSelect"]}
          eventHandler={(evt: string, _id: string, args?: unknown[]) => {
            if (evt !== "OnAction") return;
            const tag = args?.[0];
            if (typeof tag === "string") handleWorkspaceAction(tag);
          }}
          slots={{
            /* `.ProjectBadges(ProjectHelper.BuildBadges(plan.Project, config))`. The state is not one
               of them: this page only ever shows a plan in Review or Failed, and the row's badges in
               the sidebar already say which. */
            ProjectBadges: [<ProjectBadges key="projects" project={selectedPlan.project} />],
            Toolbar: [
              /* `ContentView.BuildPage`'s toolbar slot opens with this when the plan's completion is
                 blocked: `Callout.Info(..., "No Changes Needed")` above the review actions, with the
                 primary CTA already switched to Delete Plan. The two are one decision shown twice, so
                 they are computed once (`completionBlocked`). */
              completionBlocked ? (
                <Callout.Info
                  key="completion-blocked"
                  title="No Changes Needed"
                  data-testid="review-completion-blocked"
                >
                  Pre-execution validation found no changes needed because the issue or task is
                  already resolved. You can delete this plan, or move it to Skipped or Icebox.
                </Callout.Info>
              ) : null,
              primaryRefusal ? (
                <p
                  key="primary-refusal"
                  data-testid="review-primary-refusal"
                  className="text-xs text-muted-foreground"
                >
                  {primaryLabel} is unavailable: {primaryRefusal}
                </p>
              ) : null,
              /* The project's review actions sit above the content as a bare button row
                 (`ReviewActionsBarView`, `Padding(3, 2, 1, 0)`), with no heading over them - the
                 buttons are named after what they run. */
              reviewActions.length > 0 ? (
                <div key="review-actions" data-testid="review-actions-bar-container">
                  <ReviewActionsBarView
                    project={selectedPlan.project}
                    planId={selectedPlan.id}
                    actions={reviewActions}
                    allocatedPorts={allocatedPorts}
                    onExecuteAction={handleExecuteReviewAction}
                  />
                </div>
              ) : null,
              actionError ? (
                <div
                  key="action-error"
                  role="alert"
                  data-testid="review-action-error"
                  className="rounded-box border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                >
                  {actionError}
                </div>
              ) : null,
            ].filter((node): node is React.ReactElement => node !== null),
            /* `ReviewVerificationsPanelView`, in the tab strip's corner where V1 puts it: the outcome
               badge in an auto-width column, the verification's name in the rest of the row, and "No
               verifications" when the plan has none. V1 opens the report in a sheet; this page has
               none, so the report stays on the plan page's Verifications tab. */
            Verifications: [
              verifications.length === 0 ? (
                <p
                  key="none"
                  data-testid="no-verifications"
                  className="text-sm text-muted-foreground"
                >
                  No verifications
                </p>
              ) : (
                <div key="rows" className="grid grid-cols-[auto_1fr] items-center gap-2">
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
              ),
            ],
            /**
             * `Review/ContentView.cs:328`: `isShareMode ? null : new PlanChatView(selectedPlan)` —
             * the same slot, the same panel and the same conversation as the plan page's, because it
             * is the same plan. V2 had no chat here at all, which is also why triaging a plan meant
             * leaving the page to ask about it.
             *
             * Fed the detail record once it lands, because the queue row is a summary and carries no
             * `folderPath` — and the folder is what a new session records as its owner. The summary is
             * enough to *find* an existing conversation on its own, through the `<id>-` prefix arm of
             * `sessionBelongsToPlan`, and `PlanChatPanel` takes the folder on in place rather than
             * rebuilding its store around it, so the panel is never torn down mid-conversation.
             *
             * The window in which the folder is unknown is one local round trip against a keystroke
             * and a click, so a first message cannot realistically land inside it; if one did, the
             * session it creates records no plan and reads as a free-standing chat.
             */
            Chat: [
              <PlanChatPanel
                key="chat"
                plan={planDetail?.id === selectedPlan.id ? planDetail : selectedPlan}
                onOpenPlan={onSelectPlan}
                onCreatePlan={onCreatePlan}
              />,
            ],
            Content: [
              /* `RecommendationsTabView`: the pending rows are selectable and Implement acts on the
                 selection; V1 lists only the pending ones, and this page keeps the decided rows
                 visible because the accept/decline triage happens here, and a decision that vanishes
                 the row it was made on gives the operator nothing to check it by. */
              <div key="recommendations" className="space-y-3 p-4">
                {recsError && (
                  <div
                    role="alert"
                    data-testid="recommendations-error"
                    className="rounded-box border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                  >
                    {recsError}
                  </div>
                )}

                {/* `Text.Muted("Loading...")` while the plan's content query is in flight. */}
                {loadedRecsFor !== selectedId && !recsError && (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                )}

                {loadedRecsFor === selectedId && !recsError && recommendations.length === 0 && (
                  <p data-testid="no-recommendations" className="text-sm text-muted-foreground">
                    No recommendations.
                  </p>
                )}

                {pendingRecs.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="implement-recommendations"
                      disabled={pendingAction !== null}
                      onClick={() => void implementSelectedRecommendations()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-field border border-border px-3 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pendingAction === "implementRecs" ? "Starting…" : "Implement"}
                      {selectedRecTitles.size > 0 && (
                        <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
                          {selectedRecTitles.size}
                        </span>
                      )}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      Accepts the ticked recommendations and retries the plan with them as the
                      change request.
                    </span>
                  </div>
                )}

                {recommendations.length > 0 && (
                  <div className="space-y-2">
                    {recommendations.map((rec) => {
                      const isPending = !rec.state || rec.state === "Pending";
                      return (
                        <div key={rec.title} className="flex items-start gap-2">
                          {/* `RecommendationRowView`'s checkbox, which only a pending row carries. */}
                          {isPending && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${rec.title}`}
                              checked={selectedRecTitles.has(rec.title)}
                              onChange={() => toggleRecSelection(rec.title)}
                              className="mt-4 size-4 shrink-0 accent-primary"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <RecommendationCard
                              recommendation={rec}
                              onAccept={(title) => setActiveNoteDialog({ title, action: "Accept" })}
                              onDecline={(title) =>
                                setActiveNoteDialog({ title, action: "Decline" })
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>,
            ],
          }}
        />
      )}

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
            onJobStarted={(response) => {
              /*
               * `SuggestChangesDialog.HandleSubmit`'s `_draftCommentsState.Set(new List<DraftComment>())`,
               * which runs beside `ClearDraftCommentsAsync` and not instead of it: the dialog clears the
               * plan's drafts on the service, and V1 also drops the count it is holding in the same
               * breath so the Request Changes badge stops counting feedback that has already been sent.
               *
               * V1 could have waited for the service instead - `ContentView` subscribes to
               * `IPlanDiffCommentService.CommentsChanged` and re-reads on every notification - but V2 has
               * no such subscription, so without this the badge stays wrong until the plan is
               * reselected.
               */
              setDraftComments([]);
              onJobStarted?.(response);
            }}
            initialChangeRequest={inlineFeedback}
            /* The comments themselves are already in the field via `inlineFeedback`; V1's dialog
               states the count in a callout and in the submit label rather than listing them again. */
            inlineCommentCount={commentSummary.length}
          />
          {/* Every one of its four answers takes the plan out of the review queue — deleted, Skipped
              or Icebox — so all three callbacks resolve the selection the same way. */}
          <DeletePlanDialog
            isOpen={activeDialog === "delete"}
            onClose={() => setActiveDialog(null)}
            plan={selectedPlan}
            onDeleted={handlePlanLeftReview}
            onSkipped={handlePlanLeftReview}
            onArchived={handlePlanLeftReview}
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
