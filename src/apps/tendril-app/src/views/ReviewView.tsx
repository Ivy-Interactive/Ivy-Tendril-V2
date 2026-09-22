import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { copyToClipboard } from "@ivy-interactive/components";
import {
  PlanChangesView,
  PlanGitView,
  PlanMarkdown,
  PlanWorkspace,
  useShortcut,
  type PlanActionDto,
  type PlanTabDto,
  type ShellBadgeDto,
} from "@ivy-interactive/components/tendril";
import { Badge, Button, Callout } from "@ivy-interactive/components/ui";
import {
  describeBridgeError,
  type DraftComment,
  type Job,
  type PlanArtifacts,
  type PlanChangesData,
  type PlanDetail,
  type PlanGitData,
  type PlanSummary,
  type PlanVerification,
  type RecommendationItem,
  type RecommendationState,
  type ReviewActionConfig,
  type StartJobResponse,
} from "../types/api";
import { bridge } from "../api/bridge";
import { useWireframeBaseUrl } from "../api/proxyOrigin";
import { PlanActionsController } from "../controllers/planActions";
import { ErrorBanner } from "../components/ErrorBanner";
import { VerificationReportSheet } from "../components/VerificationReportSheet";
import { NoContentView } from "../components/NoContentView";
import { VERIFICATION_BADGE_VARIANT } from "../utils/verificationStatus";
import { PlanChatPanel } from "../components/chat/PlanChatPanel";
import { ProjectBadges } from "../components/ProjectBadges";
import { TendrilProcessWallpaper } from "../components/TendrilProcessWallpaper";
import { RecommendationCard } from "../components/RecommendationCard";
import { RecommendationNoteDialog } from "../components/RecommendationNoteDialog";
import { ReviewActionsBarView } from "../components/ReviewActionsBarView";
import { formatPlanId, parseProjects } from "./PlansView";
import { isPlanId, nextAfterRemoval, plansStore, resolvePlanSelection } from "../state/plansStore";
import { reviewQueueFor } from "../utils/planQueues";
import { usePublishSidebarList, type ShellSidebarList } from "../state/sidebarListStore";
import type { ReviewActionTarget } from "./ReviewActionView";
import { CreatePrDialog } from "./dialogs/CreatePrDialog";
import { DeletePlanDialog } from "./dialogs/DeletePlanDialog";
import { PartialDeliveryDialog } from "./dialogs/PartialDeliveryDialog";
import { ResetToDraftDialog } from "./dialogs/ResetToDraftDialog";
import { SuggestChangesDialog } from "./dialogs/SuggestChangesDialog";
import { DetailRow, ExecutionFailedCallout, planLinkLabel } from "./planDetail/helpers";
import { PlanPullRequests } from "./PlanPullRequests";

/** The triage dialogs this view owns, at most one open at a time. */
type TriageDialog = "createPr" | "suggestChanges" | "delete" | "reset" | "partialDelivery";

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

/** The 7 review tabs matching Tendril v1 ReviewApp. */
const SUMMARY_TAB = "summary";
const PLAN_TAB = "plan";
const DETAILS_TAB = "details";
const GIT_TAB = "git";
const CHANGES_TAB = "changes";
const ARTIFACTS_TAB = "artifacts";
const RECOMMENDATIONS_TAB = "recommendations";

const FALLBACK_SUMMARY_MARKDOWN = `# Summary

> [!NOTE]
> No summary is found for this plan. Please check the verifications for more information.
>
> \`Reset to Draft\` or \`Request Changes\` to retry the plan.`;

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
   * holds its worktree; see [`reviewQueueFor`]. Optional so a caller with no job list still gets the
   * state-filtered queue rather than an empty page.
   */
  jobs?: Job[];
  /**
   * The plan the address names, which is V1's `ReviewAppArgs.PlanId`: `ReviewApp.Build` seeds its
   * selection from `args?.PlanId` and re-resolves it on every build. Absent means "whatever this page
   * last selected", which is what leaves the default selection to {@link resolvePlanSelection}.
   */
  selectedPlanId?: string | null;
  /** The tab to select initially or on deep-link. Defaults to "summary". */
  initialTab?: string;
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
  initialTab,
  onSelectPlan,
  onJobStarted,
  onPlanChanged,
  onOpenReviewAction,
  onNewPlan,
  onNavigate,
}) => {
  const reviewPlans = useMemo(() => reviewQueueFor(plans, jobs), [plans, jobs]);

  /**
   * The queue as it was on the previous render, which is the argument `resolvePlanSelection`'s
   * keep-the-index branch cannot work without — and which this page used to omit, so the branch was
   * unreachable and a plan the host's refetch removed sent the selection back to the top of the
   * queue. `handlePlanLeftReview` hid that by re-pointing the selection itself, but only for the
   * decisions it is wired to: a plan that left because a job took it, or because another surface
   * moved it, fell straight through to the fallback.
   *
   * V1 needs no such ref because `ReviewApp.Build` holds the previous list in the app's own state;
   * a function component has to carry it across renders itself. Updated in an effect so the render
   * that first sees a shortened queue still reads the longer one.
   */
  const previousQueue = useRef<PlanSummary[]>(reviewPlans);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [activeDialog, setActiveDialog] = useState<TriageDialog | null>(null);
  const [openVerification, setOpenVerification] = useState<string | null>(null);

  /**
   * `PlanSelectionHelper.ResolveSelection`, re-resolved on every render as V1 re-resolves it on every
   * build: the plan this page already had wins while it is still in the queue, the plan the address
   * names (V1's `ReviewAppArgs.PlanId`) is what seeds that on arrival, and with neither the queue's
   * **first** plan is selected — which, on a list ordered `.OrderByDescending(p => p.Id)`, is the
   * latest plan waiting for review. Deriving it rather than only seeding state at mount is what makes
   * a queue that arrives after the first render land on a plan instead of on nothing.
   */
  const selectedPlan =
    resolvePlanSelection(reviewPlans, selectedPlanId ?? addressedPlanId, previousQueue.current) ??
    undefined;
  const selectedIndex = selectedPlan ? reviewPlans.indexOf(selectedPlan) : -1;
  const selectedId = selectedPlan?.id;

  /*
   * Held until the selection is one the queue actually holds, for the reason `PlansView` holds it:
   * the id this page resolves against can name a plan that has already left, and advancing the ref
   * while it does throws away the only list that plan's index can be read from — the next render
   * then finds it in neither list and falls back to the top of the queue.
   *
   * This page re-points its own selection through `handlePlanLeftReview`, so the window is one
   * render rather than a navigation; the guard costs nothing and closes it either way.
   */
  useEffect(() => {
    const resolvedId = selectedPlanId ?? addressedPlanId;
    if (resolvedId && !reviewPlans.some((plan) => isPlanId(plan, resolvedId))) return;
    previousQueue.current = reviewPlans;
  }, [reviewPlans, selectedPlanId, addressedPlanId]);

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

  const [selectedTab, setSelectedTab] = useState<string>(initialTab ?? SUMMARY_TAB);
  const [summaryContent, setSummaryContent] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false);
  const [gitData, setGitData] = useState<PlanGitData | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [changesData, setChangesData] = useState<PlanChangesData | null>(null);
  const [changesLoading, setChangesLoading] = useState<boolean>(false);
  const [artifacts, setArtifacts] = useState<PlanArtifacts | null>(null);

  const wireframeBaseUrl = useWireframeBaseUrl(selectedPlan?.id);

  useEffect(() => {
    setSelectedTab(initialTab ?? SUMMARY_TAB);
    setSummaryContent(null);
    setGitData(null);
    setGitError(null);
    setChangesData(null);
    setArtifacts(null);
    if (!selectedId) return;

    let cancelled = false;

    setSummaryLoading(true);
    bridge
      .getPlanSummary(selectedId)
      .then((res) => {
        if (!cancelled) setSummaryContent(res);
      })
      .catch(() => {
        if (!cancelled) setSummaryContent(null);
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });

    bridge
      .getPlanGit(selectedId)
      .then((res) => {
        if (!cancelled) setGitData(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setGitData(null);
          setGitError(describeBridgeError(err));
        }
      });

    setChangesLoading(true);
    bridge
      .getPlanChanges(selectedId)
      .then((res) => {
        if (!cancelled) setChangesData(res);
      })
      .catch(() => {
        if (!cancelled) setChangesData(null);
      })
      .finally(() => {
        if (!cancelled) setChangesLoading(false);
      });

    bridge
      .getPlanArtifacts(selectedId)
      .then((res) => {
        if (!cancelled) setArtifacts(res);
      })
      .catch(() => {
        if (!cancelled) setArtifacts(null);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, initialTab]);

  const handleChangesEvent = useCallback(
    async (evt: string, _widgetId: string, args: unknown[]) => {
      if (!selectedId) return;
      if (evt === "OnAddComment" || evt === "OnUpdateComment") {
        const comment = args?.[0] as DraftComment | undefined;
        if (comment) {
          try {
            const updated = await bridge.upsertDiffComment(selectedId, comment);
            setDraftComments(updated.filter((c) => !c.isResolved));
          } catch {
            // Best effort
          }
        }
      } else if (evt === "OnDeleteComment") {
        const comment = args?.[0] as DraftComment | undefined;
        if (comment?.filePath && comment?.changeKey) {
          try {
            const updated = await bridge.deleteDiffComment(
              selectedId,
              comment.filePath,
              comment.changeKey,
            );
            setDraftComments(updated.filter((c) => !c.isResolved));
          } catch {
            // Best effort
          }
        }
      }
    },
    [selectedId],
  );

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
   * A triage decision the service accepted: the plan leaves the queue, so this page opens the next
   * thing to review — whatever now sits at the same place in the queue, which is
   * {@link nextAfterRemoval}, the one shared spelling of `PlanSelectionHelper.ResolveSelection`'s
   * keep-the-index rule. The arithmetic that used to be inlined here was that rule's only correct
   * implementation in the app; every other CTA reached for the top of the queue instead.
   *
   * The queue is read from `reviewPlans` rather than the store, because it is the *filtered* list
   * that has indices worth keeping: the store's `plans` holds every plan in every state, so an index
   * into it names a different plan entirely.
   */
  const handlePlanLeftReview = (planId: string) => {
    setSelectedPlanId(nextAfterRemoval(reviewPlans, planId)?.id ?? null);
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
      const planToComplete = planDetail ?? selectedPlan;
      const resp = await PlanActionsController.completePlan(planToComplete);
      if (resp) {
        onJobStarted?.(resp);
        onPlanChanged?.(selectedPlan.id);
      } else {
        await plansStore.transitionPlanOptimistic(selectedPlan.id, "Completed", true);
        handlePlanLeftReview(selectedPlan.id);
      }
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
      case "CompletePlan":
        void completePlan();
        return;
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

  const pendingRecs = recommendations.filter((r) => !r.state || r.state === "Pending");

  const gitItemCount = useMemo(() => {
    if (!gitData) return 0;
    const worktreesCount = gitData.worktrees?.length ?? 0;
    const commitsCount = planDetail?.commits?.length ?? 0;
    const prsCount = planDetail?.prs?.length ?? 0;
    return worktreesCount + commitsCount + prsCount;
  }, [gitData, planDetail?.commits, planDetail?.prs]);

  const changesCount = changesData?.files?.length ?? 0;
  const totalArtifacts =
    (artifacts?.screenshots?.length ?? 0) + (artifacts?.other?.length ?? 0);

  const tabs = useMemo<PlanTabDto[]>(() => {
    const list: PlanTabDto[] = [
      { id: SUMMARY_TAB, label: "Summary" },
      { id: PLAN_TAB, label: "Plan" },
      { id: DETAILS_TAB, label: "Details" },
      {
        id: GIT_TAB,
        label: "Git",
        badge: gitItemCount > 0 ? String(gitItemCount) : undefined,
      },
    ];

    if (changesCount > 0 || selectedTab === CHANGES_TAB) {
      list.push({
        id: CHANGES_TAB,
        label: "Changes",
        badge: changesCount > 0 ? String(changesCount) : undefined,
      });
    }

    if (totalArtifacts > 0 || selectedTab === ARTIFACTS_TAB) {
      list.push({
        id: ARTIFACTS_TAB,
        label: "Artifacts",
        badge: totalArtifacts > 0 ? String(totalArtifacts) : undefined,
      });
    }

    list.push({
      id: RECOMMENDATIONS_TAB,
      label: "Recommendations",
      badge: pendingRecs.length > 0 ? String(pendingRecs.length) : undefined,
    });

    return list;
  }, [gitItemCount, changesCount, totalArtifacts, pendingRecs.length, selectedTab]);

  const activeTab = tabs.some((t) => t.id === selectedTab)
    ? selectedTab
    : (tabs[0]?.id ?? SUMMARY_TAB);

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
          tabs={tabs}
          selectedTab={activeTab}
          events={["OnAction", "OnTabSelect"]}
          eventHandler={(evt: string, _id: string, args?: unknown[]) => {
            if (evt === "OnTabSelect") {
              const tabId = args?.[0];
              if (typeof tabId === "string") setSelectedTab(tabId);
              return;
            }
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
                <ErrorBanner key="action-error" data-testid="review-action-error">
                  {actionError}
                </ErrorBanner>
              ) : null,
            ].filter((node): node is React.ReactElement => node !== null),
            /* `ReviewVerificationsPanelView`, in the tab strip's corner where V1 puts it: the outcome
               badge in an auto-width column, the verification's name in the rest of the row, and "No
               verifications" when the plan has none. Clicking an outcome badge or verification name
               opens its detailed markdown report in a right-hand sheet (`VerificationReportSheet`). */
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
                      <Badge
                        data-testid={`review-verification-${v.name}`}
                        variant={VERIFICATION_BADGE_VARIANT[v.status]}
                        className="cursor-pointer justify-self-start hover:opacity-80"
                        onClick={() => setOpenVerification(v.name)}
                        title={`View ${v.name} report`}
                      >
                        {v.status}
                      </Badge>
                      <button
                        type="button"
                        data-testid={`review-verification-button-${v.name}`}
                        onClick={() => setOpenVerification(v.name)}
                        className="truncate text-left text-sm font-medium text-foreground transition-colors hover:text-primary hover:underline focus:outline-none"
                        title={`View ${v.name} report`}
                      >
                        {v.name}
                      </button>
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
              />,
            ],
            Content: [
              activeTab === SUMMARY_TAB && (
                <div
                  key="summary"
                  data-testid="review-tab-summary"
                  className="flex min-h-0 flex-1 flex-col overflow-y-auto"
                >
                  <div className="w-full max-w-[var(--content-measure)] px-8 py-6">
                    {summaryLoading && !summaryContent ? (
                      <p className="text-sm text-muted-foreground">Loading summary…</p>
                    ) : (
                      <PlanMarkdown
                        id="review-summary-markdown"
                        content={typeof summaryContent === "string" && summaryContent ? summaryContent : FALLBACK_SUMMARY_MARKDOWN}
                        article
                        dangerouslyAllowLocalFiles
                      />
                    )}
                  </div>
                </div>
              ),

              activeTab === PLAN_TAB && (
                <div
                  key="plan"
                  data-testid="review-tab-plan"
                  className="flex min-h-0 flex-1 flex-col overflow-y-auto"
                >
                  <div className="w-full max-w-[var(--content-measure)] px-8 py-6">
                    {selectedPlan.state === "Failed" && planDetail && (
                      <ExecutionFailedCallout plan={planDetail} jobs={jobs ?? []} />
                    )}
                    <PlanMarkdown
                      id="review-plan-markdown"
                      content={planDetail?.latestRevisionContent || "# No plan specification available."}
                      wireframeBaseUrl={wireframeBaseUrl}
                      article
                      dangerouslyAllowLocalFiles
                    />
                  </div>
                </div>
              ),

              activeTab === DETAILS_TAB && (
                <div
                  key="details"
                  data-testid="review-tab-details"
                  className="min-h-0 flex-1 overflow-y-auto"
                >
                  <div className="w-full max-w-[var(--content-measure)] space-y-4 px-8 py-6">
                    <dl>
                      <DetailRow label="Plan ID">
                        <button
                          type="button"
                          onClick={() => void copyToClipboard(selectedPlan.id)}
                          title="Copy to clipboard"
                          className="font-mono hover:underline"
                        >
                          {selectedPlan.id}
                        </button>
                      </DetailRow>
                      <DetailRow label="Folder" empty={!planDetail?.folderPath}>
                        <button
                          type="button"
                          onClick={() => void copyToClipboard(planDetail?.folderPath ?? "")}
                          title="Copy to clipboard"
                          className="break-all font-mono hover:underline"
                        >
                          {planDetail?.folderPath}
                        </button>
                      </DetailRow>
                      <DetailRow label="Initial Prompt" empty={!planDetail?.initialPrompt}>
                        <span className="whitespace-pre-wrap">{planDetail?.initialPrompt}</span>
                      </DetailRow>
                      <DetailRow label="Revision" empty={!planDetail?.revisionCount}>
                        {planDetail?.revisionCount}
                      </DetailRow>
                      <DetailRow label="Profile" empty={!planDetail?.executionProfile}>
                        {planDetail?.executionProfile}
                      </DetailRow>
                      <DetailRow
                        label="Related Plans"
                        empty={!planDetail?.relatedPlans || planDetail.relatedPlans.length === 0}
                      >
                        {(planDetail?.relatedPlans ?? []).map(planLinkLabel).join(", ")}
                      </DetailRow>
                      <DetailRow
                        label="Depends On"
                        empty={!planDetail?.dependsOn || planDetail.dependsOn.length === 0}
                      >
                        {(planDetail?.dependsOn ?? []).map(planLinkLabel).join(", ")}
                      </DetailRow>
                      <DetailRow label="Issue" empty={!planDetail?.sourceUrl}>
                        <a
                          href={planDetail?.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all text-primary hover:underline"
                        >
                          {planDetail?.sourceUrl}
                        </a>
                      </DetailRow>
                      <DetailRow label="Created" empty={!planDetail?.created}>
                        {(planDetail?.created ?? "").slice(0, 10)}
                      </DetailRow>
                      <DetailRow label="Level" empty={!planDetail?.level}>
                        {planDetail?.level}
                      </DetailRow>
                      <DetailRow label="Project" empty={!selectedPlan.project}>
                        {selectedPlan.project}
                      </DetailRow>
                      <DetailRow label="State">{selectedPlan.state}</DetailRow>
                    </dl>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                          Repositories
                        </h4>
                        <ul className="mt-2 space-y-1 font-mono text-sm text-muted-foreground">
                          {planDetail?.repos && planDetail.repos.length > 0 ? (
                            planDetail.repos.map((r, i) => <li key={i}>{r}</li>)
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
                          {planDetail?.commits && planDetail.commits.length > 0 ? (
                            planDetail.commits.map((c, i) => <li key={i}>{c}</li>)
                          ) : (
                            <li className="font-sans text-muted-foreground/70">No commits yet</li>
                          )}
                        </ul>
                      </div>

                      {planDetail?.prs && planDetail.prs.length > 0 && (
                        <PlanPullRequests planId={selectedPlan.id} prs={planDetail.prs} />
                      )}

                      <div className="sm:col-span-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Verifications ({verifications.length})
                        </h4>
                        {verifications.length > 0 ? (
                          <div className="mt-2 grid max-w-xl grid-cols-[auto_1fr] items-center gap-2">
                            {verifications.map((v) => (
                              <React.Fragment key={v.name}>
                                <Badge
                                  variant={VERIFICATION_BADGE_VARIANT[v.status]}
                                  className="cursor-pointer justify-self-start hover:opacity-80"
                                  onClick={() => setOpenVerification(v.name)}
                                  title={`View ${v.name} report`}
                                >
                                  {v.status}
                                </Badge>
                                <button
                                  type="button"
                                  data-testid={`details-verification-button-${v.name}`}
                                  onClick={() => setOpenVerification(v.name)}
                                  className="truncate text-left text-sm font-medium text-foreground transition-colors hover:text-primary hover:underline focus:outline-none"
                                  title={`View ${v.name} report`}
                                >
                                  {v.name}
                                </button>
                              </React.Fragment>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground/70">No verifications</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ),

              activeTab === GIT_TAB && (
                <div
                  key="git"
                  data-testid="review-tab-git"
                  className="min-h-0 flex-1 overflow-y-auto"
                >
                  <div className="w-full max-w-[var(--content-measure)] px-8 py-6">
                    {gitError ? (
                      <p data-testid="git-tab-error" className="text-xs text-destructive">
                        {gitError}
                      </p>
                    ) : gitData ? (
                      <PlanGitView
                        data={gitData}
                        prs={planDetail?.prs ?? []}
                        planState={selectedPlan.state}
                        onOpenUrl={(url) => void openPath(url)}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground/70">Loading git state…</p>
                    )}
                  </div>
                </div>
              ),

              activeTab === CHANGES_TAB && (
                <div
                  key="changes"
                  data-testid="review-tab-changes"
                  className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4"
                >
                  {changesLoading && !changesData ? (
                    <p className="text-sm text-muted-foreground">Loading changes…</p>
                  ) : changesData && changesData.files.length > 0 ? (
                    <PlanChangesView
                      id={`review-changes-${selectedPlan.id}`}
                      files={changesData.files}
                      comments={draftComments}
                      eventHandler={handleChangesEvent}
                      showTree
                    />
                  ) : (
                    <p data-testid="no-changes" className="text-sm text-muted-foreground">
                      No file changes recorded for this plan.
                    </p>
                  )}
                </div>
              ),

              activeTab === ARTIFACTS_TAB && (
                <div
                  key="artifacts"
                  data-testid="review-tab-artifacts"
                  className="min-h-0 flex-1 overflow-y-auto"
                >
                  <div className="w-full max-w-[var(--content-measure)] space-y-6 px-8 py-6">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Plan Artifacts</h3>
                      <p className="text-xs text-muted-foreground">
                        Outputs, sample files, and screenshots captured during execution.
                      </p>
                    </div>

                    {artifacts === null ? (
                      <p className="text-sm text-muted-foreground">Loading artifacts…</p>
                    ) : totalArtifacts === 0 ? (
                      <p data-testid="no-artifacts" className="text-sm text-muted-foreground">
                        No artifacts found for this plan.
                      </p>
                    ) : (
                      <>
                        {artifacts.screenshots && artifacts.screenshots.length > 0 && (
                          <div className="space-y-3">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Screenshots ({artifacts.screenshots.length})
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                              {artifacts.screenshots.map((file, idx) => {
                                const filename = file.split(/[/\\]/).pop() ?? file;
                                const src = isTauri() ? convertFileSrc(file) : file;
                                return (
                                  <div
                                    key={idx}
                                    className="group relative flex flex-col rounded-md border border-border bg-card p-2 overflow-hidden shadow-sm"
                                  >
                                    <div className="relative aspect-video w-full overflow-hidden rounded bg-muted">
                                      <img
                                        src={src}
                                        alt={filename}
                                        className="h-full w-full object-contain cursor-pointer transition-transform duration-200 group-hover:scale-105"
                                        onClick={() => void openPath(file)}
                                      />
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-1">
                                      <span
                                        className="truncate text-xs font-mono text-foreground"
                                        title={filename}
                                      >
                                        {filename}
                                      </span>
                                      <div className="flex items-center gap-1 shrink-0">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 px-1.5 text-xs"
                                          onClick={() => void copyToClipboard(file)}
                                          title="Copy path"
                                        >
                                          Copy
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-6 px-1.5 text-xs"
                                          onClick={() => void openPath(file)}
                                          title="Open in system viewer"
                                        >
                                          Open
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {artifacts.other && artifacts.other.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Other Artifact Files ({artifacts.other.length})
                            </h4>
                            <ul className="divide-y divide-border rounded border border-border bg-card">
                              {artifacts.other.map((file, idx) => {
                                const filename = file.split(/[/\\]/).pop() ?? file;
                                return (
                                  <li
                                    key={idx}
                                    className="flex items-center justify-between p-2 text-xs"
                                  >
                                    <span
                                      className="font-mono text-muted-foreground truncate mr-2"
                                      title={file}
                                    >
                                      {filename}
                                    </span>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-1.5 text-xs"
                                        onClick={() => void copyToClipboard(file)}
                                      >
                                        Copy
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-6 px-1.5 text-xs"
                                        onClick={() => void openPath(file)}
                                      >
                                        Open
                                      </Button>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ),

              activeTab === RECOMMENDATIONS_TAB && (
                <div
                  key="recommendations"
                  data-testid="review-tab-recommendations"
                  className="w-full max-w-[var(--content-measure)] space-y-3 p-4"
                >
                  {recsError && (
                    <ErrorBanner data-testid="recommendations-error">{recsError}</ErrorBanner>
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
                      <Button
                        type="button"
                        variant="outline"
                        data-testid="implement-recommendations"
                        disabled={pendingAction !== null}
                        onClick={() => void implementSelectedRecommendations()}
                        className="h-8"
                      >
                        {pendingAction === "implementRecs" ? "Starting…" : "Implement"}
                        {selectedRecTitles.size > 0 && (
                          <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
                            {selectedRecTitles.size}
                          </span>
                        )}
                      </Button>
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
                </div>
              ),
            ].filter((node): node is React.ReactElement => Boolean(node)),
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
          {/* Reset advances here where it does not on a plan's own page: Draft is off this queue, so
              a reset plan leaves Review exactly as a skip does, and the reviewer's next decision is
              the next plan. On `plan-<id>` there is no queue to leave and the page stays put. */}
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
          <VerificationReportSheet
            planId={selectedPlan.id}
            verificationName={openVerification}
            initialStatus={verifications.find((v) => v.name === openVerification)?.status}
            onClose={() => setOpenVerification(null)}
            wireframeBaseUrl={wireframeBaseUrl}
          />
        </>
      )}
    </div>
  );
};
