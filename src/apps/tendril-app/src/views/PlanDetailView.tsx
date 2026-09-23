import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { copyToClipboard } from "@ivy-interactive/components";
import { Badge } from "@ivy-interactive/components/ui";
import {
  PlanWorkspace,
  type PlanQuestion,
  type PlanTabDto,
} from "@ivy-interactive/components/tendril";
import {
  describeBridgeError,
  type Job,
  type PlanDetail,
  type PlanGitData,
  type PlanSummary,
  type RecommendationItem,
  type RecommendationState,
  type RepoStatus,
  type StartJobResponse,
} from "../types/api";
import { bridge } from "../api/bridge";
import { plansStore } from "../state/plansStore";
import { PlanChatPanel } from "../components/chat/PlanChatPanel";
import { extractPlanQuestions, patchQuestionsMarkdown } from "../utils/questionMarkdown";
import { PlanActionsController } from "../controllers/planActions";
import { type DraftAction } from "../controllers/draftActions";
import { buildUpdatePrompt } from "../controllers/updatePrompt";
import {
  collectExecuteGuards,
  unfoldedAnswerCount,
  type ExecuteGuard,
} from "../controllers/executeGuards";
import { PlanVerifications } from "./PlanVerifications";
import {
  formatPlanId,
  isReviewState,
  normalizePlanState,
  planStateBadgeVariant,
} from "./PlansView";
import { ErrorBanner } from "../components/ErrorBanner";
import { VerificationReportSheet } from "./sheets/VerificationReportSheet";
import { ProjectBadges } from "../components/ProjectBadges";
import { LevelBadge } from "../components/LevelBadge";
import { RecommendationNoteDialog } from "../components/RecommendationNoteDialog";
import { CreateIssueDialog } from "./dialogs/CreateIssueDialog";
import { CreatePrDialog } from "./dialogs/CreatePrDialog";
import { DeletePlanDialog } from "./dialogs/DeletePlanDialog";
import { DirtyRepoDialog } from "@ivy-interactive/components/dialogs";
import { PartialDeliveryDialog } from "./dialogs/PartialDeliveryDialog";
import { PendingAnnotationsDialog } from "@ivy-interactive/components/dialogs";
import { ResetToDraftDialog } from "./dialogs/ResetToDraftDialog";
import { SuggestChangesDialog } from "./dialogs/SuggestChangesDialog";
import { UnansweredQuestionsDialog } from "@ivy-interactive/components/dialogs";
import { UpdatePlanDialog } from "./dialogs/UpdatePlanDialog";
import { useWireframeBaseUrl } from "../api/proxyOrigin";
import {
  buildMeta,
  findPlanChatSession,
  IN_FLIGHT_JOB_STATUSES,
  IN_FLIGHT_PLAN_STATES,
  PlanQuestionsPanel,
  sourceLabel,
  type LifecycleDialog,
  type PlanDetailTab,
} from "./planDetail/helpers";
import { usePlanAnnotations } from "./planDetail/usePlanAnnotations";
import { buildPlanActions } from "./planDetail/actions";
import { OtherTabsPane, PlanPane } from "./planDetail/tabPanes";

export { findPlanChatSession };

interface PlanDetailViewProps {
  plan: PlanDetail;
  allPlans?: PlanSummary[];
  /** Repos to offer the Create Issue dialog when the plan records none. */
  projectRepos?: string[];
  /**
   * The live job list. `UpdatePlanDialog` reads it to refuse a second UpdatePlan while one is still
   * in flight, as V1 does — two agents rewriting one plan file at once is how a plan ends up with
   * half of each.
   */
  jobs?: Job[];
  /** Dispatches ExecutePlan — called only once every guard has been passed.
   *  A rejection is surfaced in the action error banner rather than swallowed. */
  onExecute?: (planId: string) => void | Promise<void>;
  /** A job one of the dialogs started, so the shell can open its session tab. */
  onJobStarted?: (response: StartJobResponse) => void;
  /** The plan left the queue this page was opened from — Skipped, Icebox or a partial delivery. */
  onPlanChanged?: (planId: string) => void;
  /**
   * The plan went back to Draft, which is an arrival rather than a departure: it stays on screen and
   * only its detail needs re-reading. Separate from {@link onPlanChanged} because that one advances
   * past the plan, and Reset is the CTA that keeps the operator on it.
   */
  onPlanReset?: (planId: string) => void;
  onPlanDeleted?: (planId: string) => void;
}

export const PlanDetailView: React.FC<PlanDetailViewProps> = ({
  plan,
  allPlans = [],
  projectRepos = [],
  jobs = [],
  onExecute,
  onJobStarted,
  onPlanChanged,
  onPlanReset,
  onPlanDeleted,
}) => {
  // V1's tab ids (`ContentView.PlanTab` / `DetailsTab` / `GitTab`), plus the three tabs V2
  // adds. Order matters: see the tab strip below.
  const [activeSubTab, setActiveSubTab] = useState<PlanDetailTab>("plan");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>(
    plan.recommendations || [],
  );
  const [activeNoteDialog, setActiveNoteDialog] = useState<{
    title: string;
    action: "Accept" | "Decline";
  } | null>(null);
  const [activeDialog, setActiveDialog] = useState<LifecycleDialog | null>(null);
  // The pre-execution guard chain. `guards` is empty unless one is open, and
  // `onExecute` fires only after the last one has been passed.
  const [guards, setGuards] = useState<ExecuteGuard[]>([]);
  const [guardIndex, setGuardIndex] = useState(0);
  /**
   * How the PendingAnnotations guard's count divides between unresolved annotations and answers no
   * UpdatePlan run has folded in — V1's two arguments to `PendingAnnotationsDialog`, which the guard
   * itself reports only as a sum. Collected on the same click, so the dialog's wording describes the
   * state the guard actually fired on.
   */
  const [pendingSplit, setPendingSplit] = useState<{
    annotations: number;
    answers: number;
  } | null>(null);
  /**
   * Jobs the ExecutePlan at the end of the chain must wait for — V1's `pendingWaitJobIds`, which it
   * carries into `DirtyRepoDialog` for the same reason: *Update Plan & Execute* on a dirty repo still
   * has to ask about the repo, and the update's job id must survive that question.
   */
  const [chainedWaitJobIds, setChainedWaitJobIds] = useState<string[]>([]);
  /**
   * True while the pre-execution checks are running.
   *
   * V1 has this as `isCheckingPreflight` from `Context.UsePreflightCheck()` and spends it on the
   * Execute button: `disabled: isCheckingPreflight, loading: isCheckingPreflight`
   * (`ContentView.Build`). The checks shell out to git in every repo of the plan's project, so
   * without it a second click during the first check runs the whole chain twice and can dispatch
   * two ExecutePlan jobs.
   */
  const [isCheckingPreflight, setIsCheckingPreflight] = useState(false);
  /**
   * V1's `TransitionPlanOptimistically`: the state the plan is *about* to be in, shown until the
   * service confirms it. `JobService.StartJob` owns the authoritative transition, so this exists
   * purely so the badge and the action set stop offering Execute the instant it was pressed.
   *
   * Cleared whenever the plan prop's own state moves, which is the confirmation arriving.
   */
  const [optimisticState, setOptimisticState] = useState<string | null>(null);
  /**
   * Verification statuses this page has written but not yet seen come back on the plan.
   *
   * V1 does not need this: `VerificationsPanelView` writes through `planService` and the whole view
   * rebuilds off the refreshed `PlanFile`. Here the plan arrives as a prop, so without carrying the
   * write forward the header's Create PR / Accept Partial Delivery gates would keep reading the
   * statuses from before the toggle.
   */
  const [verificationOverrides, setVerificationOverrides] = useState<
    Record<string, PlanDetail["verifications"][number]["status"]>
  >({});

  /**
   * The revision as the reader is answering it.
   *
   * V1's own comment: "The revision as the user is editing it. Answers are merged in here and written
   * straight back to the same revision file — answering a question is not a new revision of the plan,
   * it is filling in a blank the plan left." Reset when the plan's content moves underneath, which is
   * the same trigger V1 uses to reseed it.
   */
  const [revisionContent, setRevisionContent] = useState(plan.latestRevisionContent ?? "");
  /**
   * The live revision, readable synchronously.
   *
   * Two answers clicked back to back would otherwise both merge into the value captured by the render
   * that was on screen when the first was clicked, and the second write would erase the first.
   */
  const revisionRef = useRef(revisionContent);
  /** Questions whose in-place write has been sent and not yet answered. */
  const [savingAnswers, setSavingAnswers] = useState<ReadonlySet<string>>(new Set());
  /**
   * Brings a question into view when its index entry is clicked. V1: "The token is what makes a
   * repeat click work — an unchanged id compares equal and nothing would move."
   */
  const [scrollTo, setScrollTo] = useState<{ questionId: string; token: number } | null>(null);

  useEffect(() => {
    const next = plan.latestRevisionContent ?? "";
    revisionRef.current = next;
    setRevisionContent(next);
    setScrollTo(null);
  }, [plan.latestRevisionContent]);

  /** The plan's questions as the page currently holds them, for the index and its answered count. */
  const questions = useMemo<PlanQuestion[]>(() => {
    try {
      return extractPlanQuestions(revisionContent);
    } catch {
      // A malformed fence renders as prose rather than a picker, so it indexes as nothing.
      return [];
    }
  }, [revisionContent]);

  /**
   * The unanswered count the workspace badges and its dot follow.
   *
   * `ContentView.CountUnansweredQuestions` counts every question without an answer, optional ones
   * included — the badge says how much of the plan is still blank, which is not the same question as
   * what blocks execution.
   *
   * Read off `revisionContent`, as V1 reads it off its own `revisionContent` state: an answer is
   * written back into the same revision the moment it is picked, and a refused write is rolled back,
   * so the live document is also what is on disk.
   */
  const unansweredQuestions = useMemo(
    () => questions.filter((q) => !q.answerPresent).length,
    [questions],
  );

  /**
   * Answers written into the revision. The second term of V1's Update Plan badge
   * (`activeAnnotationCount + answeredQuestions`), which V1 likewise counts off the revision the page
   * is holding rather than waiting for a refetch — the answer is already on disk for the UpdatePlan
   * job to read.
   */
  const answeredQuestionCount = useMemo(
    () => questions.filter((q) => q.answerPresent).length,
    [questions],
  );

  /**
   * A line the page wants the chat composer pre-filled with, and a token so asking twice works — the
   * same shape, and the same reason, as `scrollTo`. "Discuss with agent" is the one thing that sets it.
   */
  const [openVerification, setOpenVerification] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState<{ text: string; token: number }>({
    text: "",
    token: 0,
  });

  /**
   * V1's `ContentView.ApplyAnswer`.
   *
   * The merge is the local half of what `QuestionAnswers.TryApply` does: only the addressed question's
   * `answer` key changes, every other byte of the document is left alone. The write is V1's next line,
   * `planService.UpdateLatestRevision(...)` — `bridge.updateLatestRevision`, which overwrites the
   * newest revision **in place**. Not `writeRevision`: that appends, which would claim the agent
   * produced a new plan and would inflate `revisionCount`, the term
   * `executeGuards.unfoldedAnswerCount` reads as `revisionCount === 1`.
   *
   * A refused write is rolled back rather than left on screen. V1 can leave the question of what a
   * failure looks like alone because its write is synchronous and in-process; here the daemon can say
   * no, and an answer that stayed on the page after that would be counted by the Update Plan badge and
   * by the execute guard as though it were on disk.
   */
  const applyAnswer = useCallback(
    async (questionId: string, answer: string[]) => {
      // Merged off the ref rather than inside a state updater: an updater must stay pure, and this one
      // would otherwise fire the write twice under StrictMode's double invocation.
      const previous = revisionRef.current;
      const merged = patchQuestionsMarkdown(previous, { [questionId]: answer });
      // `TryApply` "reports a miss instead of throwing … a stale answer is worth ignoring".
      if (merged === previous) return;

      revisionRef.current = merged;
      setRevisionContent(merged);
      setSavingAnswers((prev) => new Set(prev).add(questionId));
      setActionError(null);

      try {
        await bridge.updateLatestRevision(plan.id, merged);
      } catch (err) {
        // Compare-and-swap: a later answer merged on top of this one owns the document now, and its
        // own write is what will settle the file, so reverting here would discard it.
        if (revisionRef.current === merged) {
          revisionRef.current = previous;
          setRevisionContent(previous);
        }
        setActionError(`Failed to save answer: ${describeBridgeError(err)}`);
      } finally {
        setSavingAnswers((prev) => {
          const next = new Set(prev);
          next.delete(questionId);
          return next;
        });
      }
    },
    [plan.id],
  );

  /**
   * Everything a plan switch has to forget, mirroring `ContentView.Build`'s plan-change block.
   *
   * Keyed on the plan's id and not on the prop's identity, exactly as V1 keys it: "every refresh
   * hands the state a fresh PlanFile instance of the same plan, and that must not throw the reader
   * back to the first tab". The open dialogs matter most — V1 spells out why it closes the questions
   * dialog here: "Left open across a switch, 'Execute Anyway' would run the new plan on a
   * confirmation the user gave for the old one."
   */
  useEffect(() => {
    setActiveSubTab("plan");
    setActiveDialog(null);
    setActiveNoteDialog(null);
    setGuards([]);
    setGuardIndex(0);
    setPendingSplit(null);
    setChainedWaitJobIds([]);
    setSavingAnswers(new Set());
    setIsCheckingPreflight(false);
    setActionError(null);
    setPendingAction(null);
    setOptimisticState(null);
    setVerificationOverrides({});
  }, [plan.id]);

  // The service has spoken, so the guess is spent. Comparing against the raw prop rather than the
  // normalised value keeps a legacy-named state from looking like a change on every render.
  useEffect(() => {
    setOptimisticState(null);
    setVerificationOverrides({});
  }, [plan.state, plan.updated]);

  useEffect(() => {
    setRecommendations(plan.recommendations || []);
    let cancelled = false;
    bridge
      .listRecommendations(plan.id)
      .then((recs) => {
        if (!cancelled && recs) {
          setRecommendations(recs);
        }
      })
      .catch(() => {
        // Fall back to initial plan.recommendations
      });
    return () => {
      cancelled = true;
    };
  }, [plan.id, plan.recommendations]);

  // Names the daemon origin, not the app origin: under Tauri a relative path resolves to the
  // webview, which serves the bundle and nothing else.
  const wireframeBaseUrl = useWireframeBaseUrl(plan.id);

  const { annotations, setAnnotations, handleAnnotationsChange } = usePlanAnnotations(
    plan,
    setActionError,
  );

  /**
   * Whether this plan gets the surfaces V1 keeps on its **Review** page.
   *
   * V1 has two plan pages, not one, and the diff and the recommendations belong to only one of them.
   * `Apps/Plans/ContentView.Build` — the page a Draft or Blocked plan opens on — builds exactly
   * `var tabs = new List<PlanTabDto> { new(PlanTab, "Plan"), new(DetailsTab, "Details") };`.
   * `Apps/Review/ContentView.BuildPage` is where Changes and Recommendations exist at all, and
   * `ReviewApp.Build` only ever hands it plans that are `Review` or `Failed`.
   *
   * So the gate is the plan's state, not a preference: a draft has no execution to diff and nothing
   * has recommended anything about it yet.
   *
   * Read off the optimistic state for the same reason every other gate below reads `effectivePlan`
   * (which is assembled further down, after the tab strip): a plan that has just been sent to execute
   * must stop offering the review surfaces at once.
   *
   * Declared up here, above the git hooks, because Git is now one of these surfaces and its fetch
   * keys off it — see the note on that effect.
   */
  const showsReviewSurfaces = isReviewState(optimisticState ?? plan.state);

  // Fetched on mount rather than when the Git tab is opened: the at-risk badge on
  // the tab button is the whole point of the feature, and a warning you only see
  // once you have clicked into the tab is not a warning. A rejection is confined to
  // the Git tab's own body — it must not disturb the other tabs or the action banner.
  const [gitData, setGitData] = useState<PlanGitData | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);

  /**
   * What the git read is keyed on.
   *
   * `plan.id` alone is not enough. V1 makes this point explicitly where it revalidates the plan
   * content query on a watcher event (`ContentView.Build`): "Without this the query key (the folder
   * path) never changes while a plan is open, so the cached content - commits, git changes,
   * artifacts - is served for the life of the view even while a job is executing the plan." A refetch
   * of the plan hands us a new object with the same id, so the worktrees, the commit reachability
   * verdicts and the at-risk badge would all be frozen at whatever they were when the tab opened.
   *
   * `updated` is bumped by every `plan.yaml` write, so it is the change signal; the commit and PR
   * counts are included because they are what the Git tab actually renders.
   */
  const gitQueryKey = `${plan.id}|${plan.updated ?? ""}|${plan.state}|${
    plan.commits?.length ?? 0
  }|${plan.prs?.length ?? 0}`;

  useEffect(() => {
    // Only a plan under review has a Git tab to feed, so a draft does not pay for this read. The
    // fetch shells out to git in every repo of the plan's project; running it for a plan that can
    // never show the result is work whose only visible effect was the tab flicker below.
    if (!showsReviewSurfaces) return;
    // The last-known-good data stays on screen across a revalidation. V1 makes the same call for the
    // same reason (`ContentView.ShouldShowLoadingPlaceholder`: "a revalidation keeps the
    // last-known-good content"), and only a plan switch is allowed to blank it.
    setGitError(null);
    let cancelled = false;
    bridge
      .getPlanGit(plan.id)
      .then((data) => {
        if (!cancelled && data) {
          setGitData(data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setGitError(describeBridgeError(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [plan.id, gitQueryKey, showsReviewSurfaces]);

  // A plan switch, on the other hand, must not show the previous plan's git state while the new
  // one loads.
  useEffect(() => {
    setGitData(null);
  }, [plan.id]);

  // Legacy's CountGitItems: worktrees + recorded commits + pull requests.
  const gitItemCount = gitData
    ? gitData.worktrees.length + (plan.commits?.length ?? 0) + (plan.prs?.length ?? 0)
    : null;

  const commitsAtRisk = gitData
    ? Object.values(gitData.unassociatedCommitRefStatus).filter(
        (status) => status === "unreachable" || status === "missing",
      ).length
    : 0;

  /**
   * The workspace's own tab strip (`PlanTabDto[]`), in V1's order. `ContentView.Build` adds Git only
   * when it has something to show (`if (gitItemCount > 0) tabs.Add(...)`); a null count means the
   * fetch has not answered yet, so the tab stays rather than appearing and disappearing under the
   * pointer.
   *
   * This is the strip *inside* the plan page, not the shell's bottom strip — nothing here opens or
   * closes a shell tab.
   *
   * Counts stay inside the label rather than becoming `PlanTabDto.badge` elements, so a tab's
   * accessible name still carries its count. Verifications is deliberately **not** a tab: V1 puts it
   * in the tab strip's corner dropdown (`VerificationsPanelView` in the workspace's `Verifications`
   * slot), which is where it now lives here too.
   */
  const tabs: { id: PlanDetailTab; label: string; badge?: string }[] = [
    { id: "plan", label: "Plan" },
    { id: "details", label: "Details" },
  ];

  /**
   * `BuildPage`'s own gate on the diff, with V1's reason quoted: "Only surface the Changes tab once
   * there are actual file changes — no point showing an empty 'No commits yet.' tab before any work
   * has landed" (`var changesCount = planData.AllChanges?.Files.Count ?? 0; if (changesCount > 0)`).
   *
   * V2's diff is between two **revisions of the plan**, so its equivalent of "nothing to show" is a
   * plan with a single revision — which is exactly the case `PlanRevisionDiff` answers with its
   * `diff-single-revision` empty state. An absent count is V1's `?? 0`: unknown is not something to
   * show a tab for.
   */
  const comparableRevisions = (plan.revisionCount ?? 0) > 1;

  if (showsReviewSurfaces && comparableRevisions) tabs.push({ id: "diff", label: "Diff View" });

  /**
   * `if (pendingRecs.Count > 0) tabs.Add(new PlanTabDto(RecommendationsTab, "Recommendations", ...))`.
   *
   * Deliberately counting **every** recommendation rather than only the pending ones, which is the one
   * place this diverges from `BuildPage`. V1's tab is a selectable list plus Implement; the triage
   * itself (Accept / Decline, with a note) happens in the Recommendations app. Here the triage is on
   * this tab, so gating on the pending count would make the tab disappear the moment its last
   * decision was taken, leaving the operator nothing to check the decision by. Same reasoning, and the
   * same wording, as `ReviewView`'s decided rows.
   */
  if (showsReviewSurfaces)
    tabs.push({ id: "recommendations", label: `Recommendations (${recommendations.length})` });

  /**
   * Git is a review surface, and it appears only once its count is known.
   *
   * Two changes here, both asked for after the tab was seen flickering on every plan that opened.
   *
   * **It is gated on `showsReviewSurfaces`.** Worktrees, commit reachability and PRs are all things
   * an *execution* produced; a Draft has none of them, so the tab could only ever say so. V1 agrees
   * in shape if not in placement — its Draft page (`Apps/Plans/ContentView.Build`) is where Git lived,
   * but everything that tab renders in V2 is post-execution state, and the operator's instruction is
   * that Git belongs to a review. The Details tab already carries this plan's repos and commits
   * (see its own note), so a draft loses no information by not having the tab.
   *
   * **`gitItemCount === null` no longer shows it.** That clause was the flicker: it put an unlabelled
   * "Git" on screen the moment the page mounted and relabelled it to "Git (4)" when the fetch landed,
   * a tab appearing then changing under the pointer. Unknown is now treated as V1 treats it
   * (`if (gitItemCount > 0)`) — nothing to show a tab for yet — so the tab appears once, already
   * carrying its count.
   *
   * A *failed* read is not "unknown" and still gets the tab, without a count: the tab body is the
   * only place that failure is reported, and dropping the tab would turn an unreachable daemon into
   * a silently missing feature.
   */
  if (showsReviewSurfaces && ((gitItemCount ?? 0) > 0 || gitError)) {
    // The at-risk warning used to be a bare dot with an `aria-label`; a `PlanTabDto` carries only a
    // label and a badge, so the count becomes the badge (`new PlanTabDto(GitTab, "Git", count)` is how
    // V1 badges this tab) and the label says what it counts, which no dot could.
    const label = gitItemCount === null ? "Git" : `Git (${gitItemCount})`;
    tabs.push({
      id: "git",
      label: commitsAtRisk > 0 ? `${label} · ${commitsAtRisk} at risk` : label,
      badge: commitsAtRisk > 0 ? String(commitsAtRisk) : undefined,
    });
  }

  // `var activeTab = tabs.Any(t => t.Id == selectedTab.Value) ? selectedTab.Value : PlanTab;`
  const effectiveTab: PlanDetailTab = tabs.some((t) => t.id === activeSubTab)
    ? activeSubTab
    : "plan";

  const meta = buildMeta(plan, allPlans);

  /**
   * The plan as this page currently believes it to be: the prop, plus the state it has optimistically
   * moved and the verification statuses it has written.
   *
   * Every gate below reads this rather than the prop, which is what makes an action stop offering
   * itself the moment it has been taken — V1 gets the same effect by writing the optimistic plan
   * straight into `selectedPlanState` (`ContentView.TransitionPlanOptimistically`).
   *
   * `state` is also normalised here, so a plan still recorded under a legacy name is gated as the
   * state it actually is: without this a `ReadyForReview` plan is not `"Review"`, so Create PR,
   * Retry Plan and Accept Partial Delivery all silently vanish from a plan sitting in review.
   */
  const effectivePlan: PlanDetail = React.useMemo(() => {
    const state = (optimisticState ?? normalizePlanState(plan.state)) as PlanDetail["state"];
    const overrides = Object.keys(verificationOverrides);
    const verifications =
      overrides.length === 0
        ? plan.verifications
        : (plan.verifications ?? []).map((v) =>
            v.name in verificationOverrides ? { ...v, status: verificationOverrides[v.name] } : v,
          );
    if (state === plan.state && verifications === plan.verifications) return plan;
    return { ...plan, state, verifications };
  }, [plan, optimisticState, verificationOverrides]);

  /**
   * Whether a job of this type already holds the plan, mirroring `ContentView.HasActiveJob<TArgs>`.
   *
   * V1 spends this on `DraftActions`: `Expand` and `Split` are handed
   * `disabled: ctx.HasActiveExpandJob` / `HasActiveSplitJob`, and their handlers open with
   * `if (ctx.HasActiveSplitJob) return;` — the guard is stated twice because a disabled button that
   * still fires is how a plan gets two agents rewriting it at once.
   */
  const hasActiveJob = (type: string): boolean =>
    jobs.some(
      (job) =>
        job.type === type && job.planId === plan.id && IN_FLIGHT_JOB_STATUSES.includes(job.status),
    );

  /**
   * True while a job owns the plan folder.
   *
   * V1 never shows the draft action bar in this situation at all: `PlansApp.Build` filters the list
   * to `Draft`/`Blocked` plans that have no active job, so a plan mid-flight is simply not on the
   * page. V2's detail view is reachable for any plan, so the same rule has to be applied here.
   */
  const isPlanInFlight =
    IN_FLIGHT_PLAN_STATES.includes(effectivePlan.state) ||
    hasActiveJob("ExecutePlan") ||
    hasActiveJob("RetryPlan");

  /**
   * Run a lifecycle action, reporting any rejection in the banner. Every one of
   * these ends up starting a promptware job on the service, which can refuse
   * (dependency not met, plan in the wrong state, daemon down): so the
   * rejection is the operator's only signal that nothing happened.
   *
   * Returns whether the action went through, so a caller that made an optimistic guess can take it
   * back. No action supplied counts as not going through: nothing happened.
   */
  const runAction = async (
    label: string,
    action: ((planId: string) => void | Promise<void>) | undefined,
  ): Promise<boolean> => {
    if (!action) return false;
    setActionError(null);
    setPendingAction(label);
    try {
      await action(plan.id);
      return true;
    } catch (err) {
      setActionError(`${label} failed: ${describeBridgeError(err)}`);
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  /**
   * Execute, gated.
   *
   * Nothing is dispatched while a guard is open: `onExecute` is called either
   * because no guard fired, or because the operator proceeded through all of
   * them. Repo status and the annotation count are both best-effort — what the
   * service cannot report degrades to "nothing known" rather than blocking
   * execution forever.
   */
  const handleExecute = async () => {
    // V1's Execute button is `disabled: isCheckingPreflight` while the check runs. Re-entering here
    // would run the whole git sweep twice and, worse, could open a second guard chain over the
    // first, so the click is dropped rather than queued.
    if (isCheckingPreflight || isPlanInFlight) return;
    setActionError(null);
    setIsCheckingPreflight(true);

    try {
      let repoStatus: RepoStatus[] | undefined;
      try {
        repoStatus = await bridge.getRepoStatus(plan.id);
      } catch {
        repoStatus = undefined;
      }

      // Only unresolved annotations block: a resolved one needs no UpdatePlan run. Re-read on the
      // click rather than trusting what was loaded on render, as V1 re-reads its own state here.
      let annotationCount: number | undefined;
      try {
        annotationCount = (await bridge.listAnnotations(plan.id)).filter(
          (a) => !a.isResolved,
        ).length;
      } catch {
        annotationCount = undefined;
      }

      let collected: ExecuteGuard[] = [];
      try {
        // The revision the page is holding, not the one the prop was fetched with: an answer picked a
        // moment ago is already written back into the same revision, and V1 reads its own
        // `revisionContent` here for the same reason. Without it, answering and then executing would
        // skip the "unincorporated answers" warning until something happened to refetch the plan.
        const livePlan: PlanDetail =
          revisionContent === (effectivePlan.latestRevisionContent ?? "")
            ? effectivePlan
            : { ...effectivePlan, latestRevisionContent: revisionContent };
        collected = collectExecuteGuards({ plan: livePlan, repoStatus, annotationCount });
      } catch {
        // A guard that cannot be collected must not swallow the click.
        collected = [];
      }

      if (collected.length === 0) {
        await dispatchExecute();
        return;
      }

      // V1's `PendingAnnotationsDialog` is handed the two counts separately, because the two are not
      // discarded alike: annotations live only in the UI, answers are already in the revision file and
      // survive an execute-without-updating. `collectExecuteGuards` reports only their sum, so the
      // split is carried alongside it.
      setPendingSplit({
        annotations: annotationCount ?? 0,
        answers: unfoldedAnswerCount({
          ...effectivePlan,
          latestRevisionContent: revisionContent,
        }),
      });
      setGuards(collected);
      setGuardIndex(0);
    } finally {
      setIsCheckingPreflight(false);
    }
  };

  /**
   * The dispatch itself, once every guard has been passed.
   *
   * V1's `ContentView.LaunchExecute` moves the plan to `Creating` before starting the job and
   * comments that `JobService.StartJob` owns the real transition — the optimistic move exists so the
   * page stops offering Execute the instant it was pressed. The guess is rolled back if the dispatch
   * is refused, because a refused job leaves the plan exactly where it was.
   */
  const dispatchExecute = async (waitJobIds?: string[]) => {
    const chained = (waitJobIds ?? []).length > 0;

    if (chained) {
      // `LaunchExecute`'s own comment: "When chained behind an UpdatePlan job the plan is already
      // Updating; JobLauncher sets Executing once the blocked ExecutePlan launches." So the optimistic
      // move is skipped here — guessing `Creating` would undo the `Updating` the update just set.
      //
      // Dispatched here rather than through `onExecute`, which takes only a plan id and so cannot carry
      // `waitForJobs`. `SuggestChangesDialog` bypasses its controller for the same reason and says so.
      // The parked ExecutePlan is exactly V1's `new ExecutePlanArgs(...) { WaitForJobs = waitJobIds }`.
      await runAction("Execute Plan", async () => {
        handleJobStarted(
          await bridge.startJob({
            type: "ExecutePlan",
            folderPath: plan.id,
            waitForJobs: waitJobIds,
          }),
        );
      });
      return;
    }

    setOptimisticState("Creating");
    if (!(await runAction("Execute Plan", onExecute))) {
      setOptimisticState(null);
    }
  };

  const clearGuards = () => {
    setGuards([]);
    setGuardIndex(0);
    setPendingSplit(null);
    setChainedWaitJobIds([]);
  };

  const handleGuardProceed = async () => {
    if (guardIndex + 1 < guards.length) {
      setGuardIndex(guardIndex + 1);
      return;
    }
    const waitJobIds = chainedWaitJobIds;
    clearGuards();
    await dispatchExecute(waitJobIds);
  };

  /**
   * V1's `SubmitAnnotationsUpdate`: start the UpdatePlan job that folds the pending work into the plan,
   * and retire the annotations it just quoted.
   *
   * Returns the job id, because "update *and* execute" needs something to wait on. A refusal returns
   * `null` and keeps the annotations: they were never sent, so throwing them away would lose them for
   * nothing.
   */
  const submitAnnotationsUpdate = async (): Promise<string | null> => {
    const unresolved = annotations.filter((a) => !a.isResolved);
    const prompt = buildUpdatePrompt(unresolved, answeredQuestionCount);

    setOptimisticState("Updating");
    let jobId: string | null = null;
    const started = await runAction("Update Plan", async () => {
      const response = await PlanActionsController.updatePlan(effectivePlan, prompt);
      jobId = response.jobId;
      handleJobStarted(response);
    });
    if (!started) {
      setOptimisticState(null);
      return null;
    }

    // The annotations are in the prompt now, so they go — V1 clears them here too. Not awaited into the
    // failure path: the job has already started, and an annotation that outlived its dispatch is a
    // smaller problem than reporting failure for a job that ran.
    setAnnotations([]);
    for (const annotation of unresolved) {
      void bridge.deleteAnnotation(plan.id, annotation.id).catch(() => undefined);
    }
    return jobId;
  };

  /** The guard's *Update Plan* button: fold the pending work in, and stop there. */
  const handleGuardUpdatePlan = async () => {
    clearGuards();
    await submitAnnotationsUpdate();
  };

  /**
   * The guard's primary, *Update Plan & Execute* — V1's `onUpdateAndExecute`, which is
   * `ContinueExecute([SubmitAnnotationsUpdate(...)], ...)`: one UpdatePlan job, then an ExecutePlan
   * parked behind it.
   *
   * The unanswered-questions guard is skipped on this path, and V1 says why: "Updating retires the
   * questions it folds in, so there is nothing left to warn about on this path — the warning would be
   * about a state the job is on its way to fixing." A dirty repo is still asked about, because the
   * update does nothing about that.
   */
  const handleGuardUpdateAndExecute = async () => {
    const remainingDirty = guards.slice(guardIndex + 1).find((g) => g.kind === "DirtyRepo");
    clearGuards();

    const jobId = await submitAnnotationsUpdate();
    if (!jobId) return;

    if (remainingDirty) {
      setChainedWaitJobIds([jobId]);
      setGuards([remainingDirty]);
      setGuardIndex(0);
      return;
    }
    await dispatchExecute([jobId]);
  };

  /** Opens the free-text update dialog, which is what the questions guard offers instead. */
  const handleGuardUpdateDialog = () => {
    clearGuards();
    setActiveDialog("update");
  };

  const activeGuard = guards[guardIndex];

  const handleJobStarted = (response: StartJobResponse) => {
    onJobStarted?.(response);
  };

  const handleDraftAction = async (action: DraftAction) => {
    switch (action.id) {
      case "execute":
        await handleExecute();
        return;
      case "update":
        setActiveDialog("update");
        return;
      // `DraftActions.StartExpand` / `StartSplit` both open with an early return on their own active
      // job, and both move the plan optimistically before starting: Expand to `Creating`, Split to
      // `Updating`. The early return is not belt-and-braces — a keyboard shortcut reaches the handler
      // without going through the disabled button.
      case "expand":
        if (hasActiveJob("ExpandPlan")) return;
        setOptimisticState("Creating");
        if (
          !(await runAction("Expand Plan", async () => {
            handleJobStarted(await PlanActionsController.expandPlan(effectivePlan));
          }))
        ) {
          setOptimisticState(null);
        }
        return;
      case "split":
        if (hasActiveJob("SplitPlan")) return;
        setOptimisticState("Updating");
        if (
          !(await runAction("Split Plan", async () => {
            handleJobStarted(await PlanActionsController.splitPlan(effectivePlan));
          }))
        ) {
          setOptimisticState(null);
        }
        return;
      case "createIssue":
        setActiveDialog("createIssue");
        return;
      case "delete":
        setActiveDialog("delete");
        return;
      case "copyId":
        await runAction("Copy Plan ID", () => copyToClipboard(plan.id));
        return;
      case "copyPath":
        await runAction("Copy Folder Path", () => copyToClipboard(plan.folderPath ?? ""));
        return;
      case "openFolder":
        await runAction("Open Folder", () => openPath(plan.folderPath ?? ""));
        return;
    }
  };

  const handleOpenDialog = (title: string, action: "Accept" | "Decline") => {
    setActiveNoteDialog({ title, action });
  };

  const handleCloseDialog = () => {
    setActiveNoteDialog(null);
  };

  const handleSubmitDialog = async (note?: string) => {
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
    // The same dialog text is a note on an accept and a reason on a decline, so
    // it goes to a different field either way round.
    const declineReason = accepting ? undefined : notePayload;
    const notes = accepting ? notePayload : undefined;

    handleCloseDialog();
    setActionError(null);

    // Snapshot for rollback
    const previous = recommendations;
    setRecommendations((prev) =>
      prev.map((r) => (r.title === title ? { ...r, state: targetState, declineReason, notes } : r)),
    );

    try {
      await bridge.setRecommendationState(plan.id, title, targetState, declineReason, notes);
    } catch (err) {
      setRecommendations(previous);
      setActionError(`Failed to update recommendation "${title}": ${describeBridgeError(err)}`);
    }
  };

  const {
    iconActions,
    workspaceMenu,
    secondaryActions,
    primaryAction,
    draftSet,
    canOpenUpdateDialog,
  } = buildPlanActions({
    effectivePlan,
    allPlans,
    isPlanInFlight,
    pendingAction,
    isCheckingPreflight,
    annotations,
    answeredQuestionCount,
    hasActiveJob,
  });

  const handleWorkspaceAction = async (tag: string) => {
    const draft = draftSet.find((action) => action.id === tag);
    if (draft) {
      await handleDraftAction(draft);
      return;
    }
    switch (tag) {
      case "CompletePlan":
        void (async () => {
          setActionError(null);
          setPendingAction("complete");
          try {
            const resp = await PlanActionsController.completePlan(effectivePlan);
            if (resp) {
              onJobStarted?.(resp);
              onPlanChanged?.(effectivePlan.id);
            } else {
              await plansStore.transitionPlanOptimistic(effectivePlan.id, "Completed", true);
              onPlanChanged?.(effectivePlan.id);
            }
          } catch (err) {
            setActionError(
              `Could not complete plan ${formatPlanId(effectivePlan.id)}: ${describeBridgeError(err)}`,
            );
          } finally {
            setPendingAction(null);
          }
        })();
        return;
      case "UpdatePlan":
        setActiveDialog("update");
        return;
      case "CreatePr":
        setActiveDialog("createPr");
        return;
      case "RetryPlan":
        setActiveDialog("suggestChanges");
        return;
      case "AcceptPartialDelivery":
        setActiveDialog("partialDelivery");
        return;
      case "ResetToDraft":
        setActiveDialog("reset");
        return;
      case "delete":
        // Reached only for Review and Completed plans: for every other state `delete` is in
        // `draftSet`, so `handleDraftAction` above has already claimed the tag.
        setActiveDialog("delete");
        return;
      case "DiscussWithAgent":
        // The workspace has already put the caret in the composer (`focusChat`); this drafts V1's
        // opening line for it, `PlanChatSessions.DiscussPrompt`, "phrased for where the plan is".
        setChatDraft({
          text:
            effectivePlan.state === "Review" ||
            effectivePlan.state === "Completed" ||
            effectivePlan.state === "Failed"
              ? "I want to discuss the outcome of this plan before completing it. Summarize what was done and point out anything worth a closer look."
              : "I want to discuss this plan before executing it. Summarize it and point out anything you would change.",
          token: chatDraft.token + 1,
        });
        return;
    }
  };

  /**
   * Why the plan body is blank, when it is.
   *
   * This used to be one string — `revisionContent || "# No revision content available"` — fed
   * straight into `PlanMarkdown`, which is wrong twice over. It rendered a *fake `# ` heading*, so a
   * plan whose body genuinely was that sentence looked identical to a plan that had none; and it
   * gave one answer to three different questions, which is how plans 00003 and 00004 came to sit
   * there looking merely empty.
   *
   * Those two are the concrete evidence. Their folders have a `Revisions/` directory with nothing in
   * it, `revisionCount: 0`, and a `plan.yaml` whose `updated` still equals its `created` — their
   * CreatePlan jobs (00010 and 00013) were killed by stop-all between `tendril plan create`, which
   * makes the folder, and `tendril plan write-revision`, which writes `001.md`. Nothing was ever
   * written, nothing failed to load, and the page said neither.
   *
   * So the three cases are named apart:
   *  - `writing`  — a job holds the plan right now, so the body is expected to be absent.
   *  - `never`    — no revision file exists (`revisionCount === 0`). The creating job did not finish.
   *  - `unreadable` — the count says a revision is on disk but its text came back empty, which is a
   *    read fault rather than a plan that was never drafted, and must not be reported as the latter.
   */
  const emptyBodyReason: "writing" | "never" | "unreadable" | null = revisionContent
    ? null
    : IN_FLIGHT_PLAN_STATES.includes(effectivePlan.state) ||
        hasActiveJob("CreatePlan") ||
        hasActiveJob("UpdatePlan")
      ? "writing"
      : (plan.revisionCount ?? 0) === 0
        ? "never"
        : "unreadable";

  return (
    <div className="h-full min-h-0" data-testid="plan-detail-view">
      {/*
        The plan page's frame, `ContentView.Build`'s
        `actions.ApplyTo(new PlanWorkspace(tabContent, new PlanChatView(...),
        new VerificationsPanelView(...), questionsPanel).PlanId(...).Title(...)...)`.

        The four positional arguments are the Content, Chat, Verifications and Questions slots, in
        that order, and everything else is a named setter on the widget.
      */}
      <PlanWorkspace
        id="plan-workspace"
        // `.PlanId($"#{selectedPlan.Id}")` — `#21`, not `#00021`.
        planId={formatPlanId(plan.id)}
        title={plan.title}
        meta={meta ?? undefined}
        // `.Source(SourceUrl, IsPullRequestSource ? "PR" : "Issue")`.
        sourceUrl={plan.sourceUrl || undefined}
        sourceLabel={sourceLabel(plan.sourceUrl)}
        actions={iconActions}
        menuItems={workspaceMenu}
        primary={primaryAction}
        secondary={secondaryActions}
        tabs={tabs as PlanTabDto[]}
        selectedTab={effectiveTab}
        // `.QuestionsLabel(unanswered > 0 ? $"Questions ({unanswered} unanswered)" : "Questions")`.
        questionsLabel={
          unansweredQuestions > 0 ? `Questions (${unansweredQuestions} unanswered)` : "Questions"
        }
        unansweredQuestions={unansweredQuestions}
        events={["OnAction", "OnTabSelect"]}
        eventHandler={(evt: string, _id: string, args?: unknown[]) => {
          if (evt === "OnTabSelect") {
            const id = args?.[0];
            if (typeof id === "string") setActiveSubTab(id as PlanDetailTab);
            return;
          }
          if (evt !== "OnAction") return;
          const tag = args?.[0];
          if (typeof tag === "string") void handleWorkspaceAction(tag);
        }}
        slots={{
          /**
           * `.ProjectBadges(ProjectHelper.BuildBadges(selectedPlan.Project, config))`.
           *
           * The lifecycle badge rides along, which V1's plan page has no need for: `PlansApp.Build`
           * only ever lists Draft/Blocked plans, so the state was never in question. V2's detail page
           * is reachable for every plan, so it has to say which one it is looking at.
           */
          ProjectBadges: [
            <Badge
              key="state"
              data-testid="plan-state-badge"
              variant={planStateBadgeVariant(effectivePlan.state)}
            >
              {effectivePlan.state}
            </Badge>,
            <ProjectBadges key="projects" project={plan.project} />,
            /* The level, coloured from `config.yaml`'s `levels` the way V1's Icebox row colours it
               (`SidebarView.cs:25`). `LevelBadge` renders nothing without a level, so the guard the
               outline badge needed is inside it now. */
            <LevelBadge key="level" level={plan.level} />,
          ],
          /**
           * V1 leaves the `Toolbar` slot empty and reports refusals through toasts, which V2's shell
           * does not have. So the banner the page already had lives here, above the tab strip, which
           * is where the slot renders.
           */
          Toolbar: actionError
            ? [
                <ErrorBanner key="error" data-testid="plan-action-error" className="flex-1">
                  {actionError}
                </ErrorBanner>,
              ]
            : [],
          /**
           * `new VerificationsPanelView(selectedPlan, planService, config, chatExecution)` — the
           * corner dropdown, not a tab. This is also the first consumer the shared
           * `SortableVerificationList` could have had; it is not used here because V1's panel is a
           * checkbox list whose order comes from the project config, not a hand-orderable one.
           */
          Verifications: [
            <PlanVerifications
              key="verifications"
              planId={plan.id}
              project={plan.project}
              verifications={effectivePlan.verifications || []}
              planState={effectivePlan.state}
              onVerificationChange={(name, status) =>
                setVerificationOverrides((prev) => ({ ...prev, [name]: status }))
              }
              onOpenReport={(name) => setOpenVerification(name)}
            />,
          ],
          /**
           * `questions.Count > 0 ? new QuestionsPanelView(questions, id => { selectedTab.Set(PlanTab);
           * scrollTo.Set(new QuestionScrollTarget(id, token + 1)); }) : null` — clicking an entry
           * returns to the Plan tab and scrolls the question into view.
           */
          Questions:
            questions.length > 0
              ? [
                  <PlanQuestionsPanel
                    key="questions"
                    questions={questions}
                    savingIds={savingAnswers}
                    onSelect={(questionId) => {
                      setActiveSubTab("plan");
                      setScrollTo({ questionId, token: (scrollTo?.token ?? 0) + 1 });
                    }}
                  />,
                ]
              : undefined,
          /* `isShareMode ? null : new PlanChatView(selectedPlan)` — the plan's own conversation,
             hosted by the same view the Chat app is. V2 has no share mode, so there is no null arm
             yet. */
          Chat: [<PlanChatPanel key="chat" plan={plan} draft={chatDraft} />],
          Content: [
            effectiveTab === "plan" ? (
              <PlanPane
                key="plan-pane"
                plan={plan}
                effectivePlan={effectivePlan}
                jobs={jobs}
                emptyBodyReason={emptyBodyReason}
                canOpenUpdateDialog={canOpenUpdateDialog}
                setActiveDialog={setActiveDialog}
                revisionContent={revisionContent}
                wireframeBaseUrl={wireframeBaseUrl}
                annotations={annotations}
                scrollTo={scrollTo}
                handleAnnotationsChange={handleAnnotationsChange}
                applyAnswer={applyAnswer}
              />
            ) : (
              <OtherTabsPane
                key="tab-pane"
                plan={plan}
                effectivePlan={effectivePlan}
                effectiveTab={effectiveTab}
                recommendations={recommendations}
                handleOpenDialog={handleOpenDialog}
                gitData={gitData}
                gitError={gitError}
                runAction={runAction}
              />
            ),
          ],
        }}
      />

      {/* Optional Note Dialog */}
      <RecommendationNoteDialog
        isOpen={activeNoteDialog !== null}
        title={activeNoteDialog?.title ?? ""}
        action={activeNoteDialog?.action ?? "Accept"}
        onClose={handleCloseDialog}
        onSubmit={handleSubmitDialog}
      />

      {/* Pre-execution guards, shown one at a time in collection order. */}
      <PendingAnnotationsDialog
        isOpen={activeGuard?.kind === "PendingAnnotations"}
        onClose={clearGuards}
        annotationCount={pendingSplit?.annotations ?? activeGuard?.annotationCount ?? 0}
        answeredQuestionCount={pendingSplit?.answers}
        onUpdatePlan={() => void handleGuardUpdatePlan()}
        onUpdateAndExecute={() => void handleGuardUpdateAndExecute()}
        onProceed={() => void handleGuardProceed()}
      />
      <UnansweredQuestionsDialog
        isOpen={activeGuard?.kind === "UnansweredQuestions"}
        onClose={clearGuards}
        questions={activeGuard?.questions ?? []}
        onUpdatePlan={handleGuardUpdateDialog}
        onProceed={() => void handleGuardProceed()}
      />
      <DirtyRepoDialog
        isOpen={activeGuard?.kind === "DirtyRepo"}
        onClose={clearGuards}
        dirtyRepos={activeGuard?.dirtyRepos ?? []}
        onProceed={() => void handleGuardProceed()}
      />

      {/* Lifecycle dialogs */}
      <UpdatePlanDialog
        isOpen={activeDialog === "update"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        planJobs={jobs}
        onJobStarted={handleJobStarted}
      />
      <CreateIssueDialog
        isOpen={activeDialog === "createIssue"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        projectRepos={projectRepos}
        onJobStarted={handleJobStarted}
      />
      <DeletePlanDialog
        isOpen={activeDialog === "delete"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        onDeleted={(planId) => onPlanDeleted?.(planId)}
        onArchived={(planId) => onPlanChanged?.(planId)}
        onSkipped={(planId) => onPlanChanged?.(planId)}
      />
      {/* Reset is the one dialog here that is not a queue departure: it puts the plan back at Draft,
          which is where the operator works on it next, so the page stays on it and reloads it rather
          than advancing past it. `onPlanChanged` moves on to the next plan in the queue, which for a
          reset would close the plan the operator just asked to start over. */}
      <ResetToDraftDialog
        isOpen={activeDialog === "reset"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        onReset={(planId) => onPlanReset?.(planId)}
      />
      <PartialDeliveryDialog
        isOpen={activeDialog === "partialDelivery"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        onCompleted={(planId) => onPlanChanged?.(planId)}
      />
      <SuggestChangesDialog
        isOpen={activeDialog === "suggestChanges"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        onJobStarted={handleJobStarted}
      />
      <CreatePrDialog
        isOpen={activeDialog === "createPr"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        onJobStarted={handleJobStarted}
      />
      <VerificationReportSheet
        planId={plan.id}
        verificationName={openVerification}
        initialStatus={effectivePlan.verifications?.find((v) => v.name === openVerification)?.status}
        onClose={() => setOpenVerification(null)}
        wireframeBaseUrl={wireframeBaseUrl}
      />
    </div>
  );
};
