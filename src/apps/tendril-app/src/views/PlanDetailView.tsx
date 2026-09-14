import React, { useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { PlanMarkdown } from "@ivy-interactive/components/tendril";
import {
  describeBridgeError,
  type PlanDetail,
  type PlanSummary,
  type RecommendationItem,
  type RecommendationState,
  type RepoStatus,
  type StartJobResponse,
} from "../types/api";
import { bridge } from "../api/bridge";
import { PlanActionsController } from "../controllers/plan_actions";
import { draftActions, type DraftAction } from "../controllers/draft_actions";
import { collectExecuteGuards, type ExecuteGuard } from "../controllers/execute_guards";
import { PlanRevisionDiff } from "./PlanRevisionDiff";
import { PlanVerifications } from "./PlanVerifications";
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
  const [activeSubTab, setActiveSubTab] = useState<
    "spec" | "diff" | "verifications" | "recommendations" | "metadata"
  >("spec");
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
   * them. Repo status is best-effort — a status the service cannot report
   * degrades to "no dirty repos known" rather than blocking execution forever.
   */
  const handleExecute = async () => {
    setActionError(null);

    let repoStatus: RepoStatus[] | undefined;
    try {
      repoStatus = await bridge.getRepoStatus(plan.id);
    } catch {
      repoStatus = undefined;
    }

    let collected: ExecuteGuard[] = [];
    try {
      collected = collectExecuteGuards({ plan, repoStatus });
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
    const targetState: RecommendationState =
      action === "Accept" ? (trimmedNote ? "AcceptedWithNotes" : "Accepted") : "Declined";
    const notePayload = trimmedNote || undefined;

    handleCloseDialog();
    setActionError(null);

    // Snapshot for rollback
    const previous = recommendations;
    setRecommendations((prev) =>
      prev.map((r) =>
        r.title === title ? { ...r, state: targetState, declineReason: notePayload } : r,
      ),
    );

    try {
      await bridge.setRecommendationState(plan.id, title, targetState, notePayload);
    } catch (err) {
      setRecommendations(previous);
      setActionError(`Failed to update recommendation "${title}": ${describeBridgeError(err)}`);
    }
  };

  return (
    <div className="space-y-6" data-testid="plan-detail-view">
      {/* Header bar */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mb-2 text-xs text-slate-400 hover:text-slate-200"
            >
              ← Back to plans
            </button>
          )}
          <div className="flex items-center space-x-3">
            <span className="font-mono text-sm font-bold text-slate-400">{plan.id}</span>
            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-200">
              {plan.state}
            </span>
            <span className="rounded bg-slate-800/80 px-2 py-0.5 text-xs text-slate-400">
              {plan.project}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-slate-100">{plan.title}</h1>
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
                    ? "bg-emerald-600 text-white hover:bg-emerald-500"
                    : "cursor-not-allowed bg-slate-800 text-slate-500"
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
                    ? "bg-amber-600 text-white hover:bg-amber-500"
                    : "cursor-not-allowed bg-slate-800 text-slate-500"
                }`}
              >
                Retry Plan
              </button>
              {canPartial.allowed && (
                <button
                  type="button"
                  onClick={() => setActiveDialog("partialDelivery")}
                  className="rounded-lg bg-amber-900/60 px-4 py-2 text-xs font-medium text-amber-200 transition hover:bg-amber-900"
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
                      ? "bg-blue-600 text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                      : action.variant === "destructive"
                        ? "bg-red-900/60 text-red-200 hover:bg-red-900"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
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
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
            >
              Reset to Draft…
            </button>
          )}
          {canDiscardPlan.allowed && (
            <button
              type="button"
              onClick={() => setActiveDialog("discard")}
              className="rounded-lg bg-red-900/60 px-4 py-2 text-xs font-medium text-red-200 transition hover:bg-red-900"
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
          className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-300"
        >
          {actionError}
        </div>
      )}

      {/* Detail Tabs Header */}
      <div className="flex border-b border-slate-800">
        <button
          type="button"
          onClick={() => setActiveSubTab("spec")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
            activeSubTab === "spec"
              ? "border-emerald-500 text-slate-100"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Plan Specification
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("diff")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
            activeSubTab === "diff"
              ? "border-emerald-500 text-slate-100"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Diff View
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("verifications")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
            activeSubTab === "verifications"
              ? "border-emerald-500 text-slate-100"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Verifications ({plan.verifications?.length || 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("recommendations")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
            activeSubTab === "recommendations"
              ? "border-emerald-500 text-slate-100"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Recommendations ({recommendations.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("metadata")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
            activeSubTab === "metadata"
              ? "border-emerald-500 text-slate-100"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Metadata & History
        </button>
      </div>

      {/* Tab Content */}
      <div className="mt-4">
        {activeSubTab === "spec" && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <PlanMarkdown
              id="plan-markdown"
              content={plan.latestRevisionContent || "# No revision content available"}
              eventHandler={noop}
            />
          </div>
        )}

        {activeSubTab === "diff" && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <PlanRevisionDiff planId={plan.id} revisionCount={plan.revisionCount ?? 0} />
          </div>
        )}

        {activeSubTab === "verifications" && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">Plan Verifications</h3>
            <PlanVerifications planId={plan.id} verifications={plan.verifications || []} />
          </div>
        )}

        {activeSubTab === "recommendations" && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Plan Recommendations</h3>
              <p className="text-xs text-slate-400">
                Out-of-scope follow-ups and improvements discovered during execution.
              </p>
            </div>

            {recommendations.length === 0 ? (
              <p data-testid="no-recommendations" className="text-xs text-slate-500">
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

        {activeSubTab === "metadata" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Repositories
              </h4>
              <ul className="mt-2 space-y-1 text-sm font-mono text-slate-300">
                {plan.repos && plan.repos.length > 0 ? (
                  plan.repos.map((r, i) => <li key={i}>{r}</li>)
                ) : (
                  <li className="text-slate-500 font-sans">No repositories specified</li>
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Dependencies
              </h4>
              <ul className="mt-2 space-y-1 text-sm font-mono text-slate-300">
                {plan.dependsOn && plan.dependsOn.length > 0 ? (
                  plan.dependsOn.map((d, i) => <li key={i}>{d}</li>)
                ) : (
                  <li className="text-slate-500 font-sans">No dependencies</li>
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Commits
              </h4>
              <ul className="mt-2 space-y-1 text-sm font-mono text-slate-300">
                {plan.commits && plan.commits.length > 0 ? (
                  plan.commits.map((c, i) => <li key={i}>{c}</li>)
                ) : (
                  <li className="text-slate-500 font-sans">No commits yet</li>
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Pull Requests
              </h4>
              <ul className="mt-2 space-y-1 text-sm text-slate-300">
                {plan.prs && plan.prs.length > 0 ? (
                  plan.prs.map((p, i) => (
                    <li key={i}>
                      <a
                        href={p}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-400 hover:underline font-mono text-xs"
                      >
                        {p}
                      </a>
                    </li>
                  ))
                ) : (
                  <li className="text-slate-500">No PRs created</li>
                )}
              </ul>
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
