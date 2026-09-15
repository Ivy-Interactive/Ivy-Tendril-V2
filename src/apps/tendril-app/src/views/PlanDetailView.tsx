import React, { useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { PlanGitView, PlanMarkdown } from "@ivy-interactive/components/tendril";
import {
  describeBridgeError,
  type PlanDetail,
  type PlanGitData,
  type PlanSummary,
  type RecommendationItem,
  type RecommendationState,
  type RepoStatus,
  type StartJobResponse,
} from "../types/api";
import { bridge } from "../api/bridge";
import { PlanActionsController } from "../controllers/plan_actions";
import { PlanPullRequests } from "./PlanPullRequests";
import { draftActions, type DraftAction } from "../controllers/draft_actions";
import { collectExecuteGuards, type ExecuteGuard } from "../controllers/execute_guards";
import { PlanRevisionDiff } from "./PlanRevisionDiff";
import { PlanVerifications } from "./PlanVerifications";
import { formatPlanId, parseProjects, planStateBadgeClass } from "./PlansView";
import { RecommendationCard } from "../components/RecommendationCard";
import { RecommendationNoteDialog } from "../components/RecommendationNoteDialog";
import { CreateIssueDialog } from "./dialogs/CreateIssueDialog";
import { CreatePrDialog } from "./dialogs/CreatePrDialog";
import { DeletePlanDialog } from "./dialogs/DeletePlanDialog";
import { DirtyRepoDialog } from "./dialogs/DirtyRepoDialog";
import { DiscardPlanDialog } from "./dialogs/DiscardPlanDialog";
import { PartialDeliveryDialog } from "./dialogs/PartialDeliveryDialog";
import { PendingAnnotationsDialog } from "./dialogs/PendingAnnotationsDialog";
import { ResetToDraftDialog } from "./dialogs/ResetToDraftDialog";
import { SuggestChangesDialog } from "./dialogs/SuggestChangesDialog";
import { UnansweredQuestionsDialog } from "./dialogs/UnansweredQuestionsDialog";
import { UpdatePlanDialog } from "./dialogs/UpdatePlanDialog";

type PlanDetailTab = "plan" | "details" | "diff" | "verifications" | "recommendations" | "git";

/**
 * `PlanModels.cs`: `IsPullRequestSource => SourceUrl?.Contains("/pull/") == true`. The workspace
 * labels the source link "PR" or "Issue" from exactly this test
 * (`ContentView.Build`: `.Source(..., selectedPlan.IsPullRequestSource ? "PR" : "Issue")`).
 */
const sourceLabel = (sourceUrl: string | undefined): string =>
  sourceUrl?.includes("/pull/") ? "PR" : "Issue";

/** `#21` from a `00021-SomeFolderName` plan folder, as `DetailsTabView.ParsePlanLinks` does. */
const planLinkLabel = (folder: string): string => {
  const name = folder.split(/[/\\]/).pop() ?? folder;
  const dashIdx = name.indexOf("-");
  const idPart = dashIdx > 0 ? name.slice(0, dashIdx) : name;
  return formatPlanId(idPart);
};

/**
 * The workspace's meta line, from `ContentView.BuildMeta`: the plan's position in the list, and
 * the plans it waits on. Position is computed over the same newest-first ordering the list uses.
 */
const buildMeta = (plan: PlanDetail, allPlans: PlanSummary[]): string | null => {
  const ordered = [...allPlans].sort(
    (a, b) => (Number.parseInt(b.id, 10) || 0) - (Number.parseInt(a.id, 10) || 0),
  );
  const index = ordered.findIndex((p) => p.id === plan.id);
  const parts: string[] = [];
  if (index >= 0 && ordered.length > 0) parts.push(`${index + 1}/${ordered.length} plans`);
  if (plan.dependsOn && plan.dependsOn.length > 0)
    parts.push(`Depends on ${plan.dependsOn.map(planLinkLabel).join(", ")}`);
  return parts.length > 0 ? parts.join(" \u00b7 ") : null;
};

/**
 * `ContentView.BuildFailureCallout`: a failed plan says why at the top of its Plan tab, and a
 * failed verification is the better answer than the job log. The report bodies V1 quotes live in
 * `<planFolder>/Verification/<name>.md`, which this page reads only inside the Verifications tab,
 * so the callout names the verifications and points at their reports rather than inventing a
 * summary. With no failed verification at all it falls back to V1's log wording.
 */
const ExecutionFailedCallout: React.FC<{ plan: PlanDetail }> = ({ plan }) => {
  const failed = (plan.verifications ?? []).filter(
    (v) => v.status === "Fail" || v.status === "Pending",
  );
  return (
    <div
      role="alert"
      data-testid="plan-failure-callout"
      className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
    >
      <p className="font-semibold">Execution Failed</p>
      {failed.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {failed.map((v) => (
            <li key={v.name}>
              <span className="font-semibold">{v.name}</span> {v.status}, see verification report
              for details
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1">No details available. Check the job logs.</p>
      )}
    </div>
  );
};

/** One label/value row of the Details tab, dropped entirely when the value is empty. */
const DetailRow: React.FC<{ label: string; children?: React.ReactNode; empty?: boolean }> = ({
  label,
  children,
  empty,
}) =>
  empty ? null : (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );

/** The lifecycle dialogs this view owns, at most one open at a time. */
type LifecycleDialog =
  | "update"
  | "createIssue"
  | "delete"
  | "discard"
  | "reset"
  | "partialDelivery"
  | "suggestChanges"
  | "createPr";

interface PlanDetailViewProps {
  plan: PlanDetail;
  allPlans?: PlanSummary[];
  /** Repos to offer the Create Issue dialog when the plan records none. */
  projectRepos?: string[];
  /** Dispatches ExecutePlan — called only once every guard has been passed.
   *  A rejection is surfaced in the action error banner rather than swallowed. */
  onExecute?: (planId: string) => void | Promise<void>;
  /** A job one of the dialogs started, so the shell can open its session tab. */
  onJobStarted?: (response: StartJobResponse) => void;
  /** The plan's state changed on the service; the caller should re-fetch it. */
  onPlanChanged?: (planId: string) => void;
  onPlanDeleted?: (planId: string) => void;
  onBack?: () => void;
}

export const PlanDetailView: React.FC<PlanDetailViewProps> = ({
  plan,
  allPlans = [],
  projectRepos = [],
  onExecute,
  onJobStarted,
  onPlanChanged,
  onPlanDeleted,
  onBack,
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

  // Fetched on mount rather than when the Git tab is opened: the at-risk badge on
  // the tab button is the whole point of the feature, and a warning you only see
  // once you have clicked into the tab is not a warning. A rejection is confined to
  // the Git tab's own body — it must not disturb the other tabs or the action banner.
  const [gitData, setGitData] = useState<PlanGitData | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);

  useEffect(() => {
    setGitData(null);
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
   * The tab strip, in V1's order. `ContentView.Build` adds Git only when it has something to
   * show (`if (gitItemCount > 0) tabs.Add(...)`); a null count means the fetch has not answered
   * yet, so the tab stays rather than appearing and disappearing under the pointer.
   *
   * Deviation: the counts stay inside the label rather than becoming `PlanTabDto.Badge`
   * elements, so a tab's accessible name still carries its count.
   */
  const tabs: { id: PlanDetailTab; label: string }[] = [
    { id: "plan", label: "Plan" },
    { id: "details", label: "Details" },
    { id: "diff", label: "Diff View" },
    { id: "verifications", label: `Verifications (${plan.verifications?.length || 0})` },
    { id: "recommendations", label: `Recommendations (${recommendations.length})` },
  ];
  if (gitItemCount === null || gitItemCount > 0)
    tabs.push({ id: "git", label: gitItemCount === null ? "Git" : `Git (${gitItemCount})` });

  // `var activeTab = tabs.Any(t => t.Id == selectedTab.Value) ? selectedTab.Value : PlanTab;`
  const effectiveTab: PlanDetailTab = tabs.some((t) => t.id === activeSubTab)
    ? activeSubTab
    : "plan";

  const meta = buildMeta(plan, allPlans);

  // Gating checks
  const canExec = PlanActionsController.canExecute(plan, allPlans);
  const canPr = PlanActionsController.canCreatePr(plan);
  const canRetryPlan = PlanActionsController.canRetry(plan);
  const canDiscardPlan = PlanActionsController.canDiscard(plan);
  const canResetPlan = PlanActionsController.canReset(plan);
  const canPartial = PlanActionsController.canCompletePartial(plan);

  const noop = () => {};

  /**
   * Run a lifecycle action, reporting any rejection in the banner. Every one of
   * these ends up starting a promptware job on the service, which can refuse
   * (dependency not met, plan in the wrong state, daemon down): so the
   * rejection is the operator's only signal that nothing happened.
   */
  const runAction = async (
    label: string,
    action: ((planId: string) => void | Promise<void>) | undefined,
  ) => {
    if (!action) return;
    setActionError(null);
    setPendingAction(label);
    try {
      await action(plan.id);
    } catch (err) {
      setActionError(`${label} failed: ${describeBridgeError(err)}`);
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
    setActionError(null);

    let repoStatus: RepoStatus[] | undefined;
    try {
      repoStatus = await bridge.getRepoStatus(plan.id);
    } catch {
      repoStatus = undefined;
    }

    // Only unresolved annotations block: a resolved one needs no UpdatePlan run.
    let annotationCount: number | undefined;
    try {
      annotationCount = (await bridge.listAnnotations(plan.id)).filter((a) => !a.isResolved).length;
    } catch {
      annotationCount = undefined;
    }

    let collected: ExecuteGuard[] = [];
    try {
      collected = collectExecuteGuards({ plan, repoStatus, annotationCount });
    } catch {
      // A guard that cannot be collected must not swallow the click.
      collected = [];
    }

    if (collected.length === 0) {
      await runAction("Execute Plan", onExecute);
      return;
    }

    setGuards(collected);
    setGuardIndex(0);
  };

  const clearGuards = () => {
    setGuards([]);
    setGuardIndex(0);
  };

  const handleGuardProceed = async () => {
    if (guardIndex + 1 < guards.length) {
      setGuardIndex(guardIndex + 1);
      return;
    }
    clearGuards();
    await runAction("Execute Plan", onExecute);
  };

  const handleGuardUpdatePlan = () => {
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
      case "expand":
        await runAction("Expand Plan", async () => {
          handleJobStarted(await PlanActionsController.expandPlan(plan));
        });
        return;
      case "split":
        await runAction("Split Plan", async () => {
          handleJobStarted(await PlanActionsController.splitPlan(plan));
        });
        return;
      case "createIssue":
        setActiveDialog("createIssue");
        return;
      case "delete":
        setActiveDialog("delete");
        return;
      case "copyId":
        await runAction("Copy Plan ID", () => navigator.clipboard.writeText(plan.id));
        return;
      case "copyPath":
        await runAction("Copy Folder Path", () =>
          navigator.clipboard.writeText(plan.folderPath ?? ""),
        );
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

  return (
    <div className="space-y-6" data-testid="plan-detail-view">
      {/* Header bar */}
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mb-2 text-xs text-muted-foreground hover:text-foreground"
            >
              ← Back to plans
            </button>
          )}
          {/* The workspace title bar's own order (`ContentView.Build`): plan id, then the state,
              then the project badges, then the level. `#21`, not `#00021`. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-muted-foreground">
              {formatPlanId(plan.id)}
            </span>
            <span
              data-testid="plan-state-badge"
              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${planStateBadgeClass(
                plan.state,
              )}`}
            >
              {plan.state}
            </span>
            {parseProjects(plan.project).map((project) => (
              <span
                key={project}
                className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                {project}
              </span>
            ))}
            {plan.level && (
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                {plan.level}
              </span>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-bold text-foreground">{plan.title}</h1>
          {/* `.Meta(BuildMeta(...))` and `.Source(...)` on the workspace: where this plan sits in
              the list, what it waits on, and a link to the issue or PR it came from. */}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {meta && <span>{meta}</span>}
            {plan.sourceUrl && (
              <a
                href={plan.sourceUrl}
                target="_blank"
                rel="noreferrer"
                title={plan.sourceUrl}
                className="text-primary hover:underline"
              >
                {sourceLabel(plan.sourceUrl)}
              </a>
            )}
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {plan.state === "Review" && (
            <>
              <button
                type="button"
                disabled={!canPr.allowed || pendingAction !== null}
                title={canPr.reason}
                onClick={() => setActiveDialog("createPr")}
                className={`rounded-lg px-4 py-2 text-xs font-medium transition ${
                  canPr.allowed
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "cursor-not-allowed bg-muted text-muted-foreground/70"
                }`}
              >
                Create PR
              </button>
              <button
                type="button"
                disabled={!canRetryPlan.allowed || pendingAction !== null}
                title={canRetryPlan.reason}
                onClick={() => setActiveDialog("suggestChanges")}
                className={`rounded-lg px-4 py-2 text-xs font-medium transition ${
                  canRetryPlan.allowed
                    ? "bg-warning text-warning-foreground hover:bg-warning/90"
                    : "cursor-not-allowed bg-muted text-muted-foreground/70"
                }`}
              >
                Retry Plan
              </button>
              {canPartial.allowed && (
                <button
                  type="button"
                  onClick={() => setActiveDialog("partialDelivery")}
                  className="rounded-lg bg-warning/20 px-4 py-2 text-xs font-medium text-warning transition hover:bg-warning/30"
                >
                  Accept Partial Delivery
                </button>
              )}
            </>
          )}

          {plan.state !== "Review" &&
            plan.state !== "Completed" &&
            draftActions()
              .filter((action) => action.isAvailable(plan))
              .map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={pendingAction !== null || (action.id === "execute" && !canExec.allowed)}
                  title={action.id === "execute" ? canExec.reason : undefined}
                  onClick={() => void handleDraftAction(action)}
                  className={`rounded-lg px-4 py-2 text-xs font-medium transition ${
                    action.variant === "primary"
                      ? "bg-info text-info-foreground hover:bg-info/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground/70"
                      : action.variant === "destructive"
                        ? "bg-destructive/20 text-destructive hover:bg-destructive/30"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {action.id === "execute" && pendingAction === "Execute Plan"
                    ? "Starting..."
                    : action.label}
                </button>
              ))}

          {canResetPlan.allowed && (
            <button
              type="button"
              onClick={() => setActiveDialog("reset")}
              className="rounded-lg bg-muted px-4 py-2 text-xs font-medium text-muted-foreground transition hover:bg-accent"
            >
              Reset to Draft…
            </button>
          )}
          {canDiscardPlan.allowed && (
            <button
              type="button"
              onClick={() => setActiveDialog("discard")}
              className="rounded-lg bg-destructive/20 px-4 py-2 text-xs font-medium text-destructive transition hover:bg-destructive/30"
            >
              Discard Plan…
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          data-testid="plan-action-error"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          {actionError}
        </div>
      )}

      {/* Detail tab strip. V1's own order and labels (`ContentView.Build`): Plan, Details, then
          Git last and only when it has something to show, with the three tabs V2 adds in between. */}
      <div className="flex flex-wrap border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveSubTab(tab.id)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
              effectiveTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.id === "git" && commitsAtRisk > 0 && (
              <span
                data-testid="git-tab-at-risk"
                aria-label={`${commitsAtRisk} ${
                  commitsAtRisk === 1 ? "commit is" : "commits are"
                } at risk of being lost`}
                className="ml-2 inline-block h-2 w-2 rounded-full bg-destructive align-middle"
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="mt-4">
        {effectiveTab === "plan" && (
          <div className="rounded-xl border border-border bg-card/40 p-6">
            {/* `PlanTabView.Build`: a failed plan leads with why, above the plan itself. */}
            {plan.state === "Failed" && <ExecutionFailedCallout plan={plan} />}
            <PlanMarkdown
              id="plan-markdown"
              content={plan.latestRevisionContent || "# No revision content available"}
              eventHandler={noop}
            />
          </div>
        )}

        {effectiveTab === "diff" && (
          <div className="rounded-xl border border-border bg-card/40 p-6">
            <PlanRevisionDiff planId={plan.id} revisionCount={plan.revisionCount ?? 0} />
          </div>
        )}

        {effectiveTab === "verifications" && (
          <div className="rounded-xl border border-border bg-card/40 p-6">
            <h3 className="text-sm font-semibold text-foreground mb-3">Plan Verifications</h3>
            <PlanVerifications
              planId={plan.id}
              verifications={plan.verifications || []}
              planState={plan.state}
            />
          </div>
        )}

        {effectiveTab === "recommendations" && (
          <div className="rounded-xl border border-border bg-card/40 p-6 space-y-4">
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
          <div className="rounded-xl border border-border bg-card/40 p-6">
            {gitError ? (
              <p data-testid="git-tab-error" className="text-xs text-destructive">
                {gitError}
              </p>
            ) : gitData ? (
              <PlanGitView
                data={gitData}
                prs={plan.prs ?? []}
                planState={plan.state}
                onOpenUrl={(url) => void openPath(url)}
              />
            ) : (
              <p className="text-sm text-muted-foreground/70">Loading git state…</p>
            )}
          </div>
        )}

        {effectiveTab === "details" && (
          <div className="space-y-4">
            {/* `DetailsTabView.Build`'s own field order, and its `RemoveEmpty()`: a row the plan
                has no value for is dropped rather than rendered blank. */}
            <dl className="rounded-xl border border-border bg-card/40 p-4">
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
              <DetailRow label="State">{plan.state}</DetailRow>
            </dl>

            {/* Repos and commits have no row of their own in V1's Details tab; they are kept here
                because V2's Git tab is the only other place they appear and it is hidden while a
                plan has nothing in git yet. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-card/40 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Repositories
                </h4>
                <ul className="mt-2 space-y-1 text-sm font-mono text-muted-foreground">
                  {plan.repos && plan.repos.length > 0 ? (
                    plan.repos.map((r, i) => <li key={i}>{r}</li>)
                  ) : (
                    <li className="text-muted-foreground/70 font-sans">
                      No repositories specified
                    </li>
                  )}
                </ul>
              </div>

              <div className="rounded-xl border border-border bg-card/40 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Commits
                </h4>
                <ul className="mt-2 space-y-1 text-sm font-mono text-muted-foreground">
                  {plan.commits && plan.commits.length > 0 ? (
                    plan.commits.map((c, i) => <li key={i}>{c}</li>)
                  ) : (
                    <li className="text-muted-foreground/70 font-sans">No commits yet</li>
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
        annotationCount={activeGuard?.annotationCount ?? 0}
        onUpdatePlan={handleGuardUpdatePlan}
        onProceed={() => void handleGuardProceed()}
      />
      <UnansweredQuestionsDialog
        isOpen={activeGuard?.kind === "UnansweredQuestions"}
        onClose={clearGuards}
        questions={activeGuard?.questions ?? []}
        onUpdatePlan={handleGuardUpdatePlan}
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
      />
      <DiscardPlanDialog
        isOpen={activeDialog === "discard"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        onDiscarded={(planId) => onPlanChanged?.(planId)}
      />
      <ResetToDraftDialog
        isOpen={activeDialog === "reset"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        onReset={(planId) => onPlanChanged?.(planId)}
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
    </div>
  );
};
