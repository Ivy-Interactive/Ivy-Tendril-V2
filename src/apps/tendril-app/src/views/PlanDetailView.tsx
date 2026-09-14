import React, { useEffect, useState } from "react";
import { PlanMarkdown } from "@ivy-interactive/components/tendril";
import {
  describeBridgeError,
  type PlanDetail,
  type PlanSummary,
  type RecommendationItem,
  type RecommendationState,
} from "../types/api";
import { bridge } from "../api/bridge";
import { PlanActionsController } from "../controllers/plan_actions";
import { PlanRevisionDiff } from "./PlanRevisionDiff";
import { PlanVerifications } from "./PlanVerifications";
import { RecommendationCard } from "../components/RecommendationCard";
import { RecommendationNoteDialog } from "../components/RecommendationNoteDialog";

interface PlanDetailViewProps {
  plan: PlanDetail;
  allPlans?: PlanSummary[];
  /** Lifecycle handlers reject when the service refuses the job; the rejection
   *  is surfaced in the action error banner rather than swallowed. */
  onExecute?: (planId: string) => void | Promise<void>;
  onRetry?: (planId: string) => void | Promise<void>;
  onCreatePr?: (planId: string) => void | Promise<void>;
  onBack?: () => void;
}

export const PlanDetailView: React.FC<PlanDetailViewProps> = ({
  plan,
  allPlans = [],
  onExecute,
  onRetry,
  onCreatePr,
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

  const handleExecute = () => runAction("Execute Plan", onExecute);
  const handleRetry = () => runAction("Retry Plan", onRetry);
  const handleCreatePr = () => runAction("Create PR", onCreatePr);

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
          <div className="flex items-center space-x-3">
            <span className="font-mono text-sm font-bold text-muted-foreground">{plan.id}</span>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-foreground">
              {plan.state}
            </span>
            <span className="rounded bg-muted/80 px-2 py-0.5 text-xs text-muted-foreground">
              {plan.project}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-foreground">{plan.title}</h1>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {plan.state === "Review" && (
            <>
              <button
                type="button"
                disabled={!canPr.allowed || pendingAction !== null}
                title={canPr.reason}
                onClick={handleCreatePr}
                className={`rounded-lg px-4 py-2 text-xs font-medium transition ${
                  canPr.allowed
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "cursor-not-allowed bg-muted text-muted-foreground/70"
                }`}
              >
                {pendingAction === "Create PR" ? "Starting..." : "Create PR"}
              </button>
              <button
                type="button"
                disabled={!canRetryPlan.allowed || pendingAction !== null}
                title={canRetryPlan.reason}
                onClick={handleRetry}
                className={`rounded-lg px-4 py-2 text-xs font-medium transition ${
                  canRetryPlan.allowed
                    ? "bg-warning text-warning-foreground hover:bg-warning/90"
                    : "cursor-not-allowed bg-muted text-muted-foreground/70"
                }`}
              >
                {pendingAction === "Retry Plan" ? "Starting..." : "Retry Plan"}
              </button>
            </>
          )}

          {plan.state !== "Review" && plan.state !== "Completed" && (
            <button
              type="button"
              disabled={!canExec.allowed || pendingAction !== null}
              title={canExec.reason}
              onClick={handleExecute}
              className={`rounded-lg px-4 py-2 text-xs font-medium transition ${
                canExec.allowed
                  ? "bg-info text-info-foreground hover:bg-info/90"
                  : "cursor-not-allowed bg-muted text-muted-foreground/70"
              }`}
            >
              {pendingAction === "Execute Plan" ? "Starting..." : "Execute Plan"}
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

      {/* Detail Tabs Header */}
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setActiveSubTab("spec")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
            activeSubTab === "spec"
              ? "border-ring text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Plan Specification
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("diff")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
            activeSubTab === "diff"
              ? "border-ring text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Diff View
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("verifications")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
            activeSubTab === "verifications"
              ? "border-ring text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Verifications ({plan.verifications?.length || 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("recommendations")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
            activeSubTab === "recommendations"
              ? "border-ring text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Recommendations ({recommendations.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("metadata")}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
            activeSubTab === "metadata"
              ? "border-ring text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Metadata & History
        </button>
      </div>

      {/* Tab Content */}
      <div className="mt-4">
        {activeSubTab === "spec" && (
          <div className="rounded-xl border border-border bg-card/40 p-6">
            <PlanMarkdown
              id="plan-markdown"
              content={plan.latestRevisionContent || "# No revision content available"}
              eventHandler={noop}
            />
          </div>
        )}

        {activeSubTab === "diff" && (
          <div className="rounded-xl border border-border bg-card/40 p-6">
            <PlanRevisionDiff planId={plan.id} revisionCount={plan.revisionCount ?? 0} />
          </div>
        )}

        {activeSubTab === "verifications" && (
          <div className="rounded-xl border border-border bg-card/40 p-6">
            <h3 className="text-sm font-semibold text-foreground mb-3">Plan Verifications</h3>
            <PlanVerifications planId={plan.id} verifications={plan.verifications || []} />
          </div>
        )}

        {activeSubTab === "recommendations" && (
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

        {activeSubTab === "metadata" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card/40 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Repositories
              </h4>
              <ul className="mt-2 space-y-1 text-sm font-mono text-muted-foreground">
                {plan.repos && plan.repos.length > 0 ? (
                  plan.repos.map((r, i) => <li key={i}>{r}</li>)
                ) : (
                  <li className="text-muted-foreground/70 font-sans">No repositories specified</li>
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-card/40 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Dependencies
              </h4>
              <ul className="mt-2 space-y-1 text-sm font-mono text-muted-foreground">
                {plan.dependsOn && plan.dependsOn.length > 0 ? (
                  plan.dependsOn.map((d, i) => <li key={i}>{d}</li>)
                ) : (
                  <li className="text-muted-foreground/70 font-sans">No dependencies</li>
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

            <div className="rounded-xl border border-border bg-card/40 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pull Requests
              </h4>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {plan.prs && plan.prs.length > 0 ? (
                  plan.prs.map((p, i) => (
                    <li key={i}>
                      <a
                        href={p}
                        target="_blank"
                        rel="noreferrer"
                        className="text-success hover:underline font-mono text-xs"
                      >
                        {p}
                      </a>
                    </li>
                  ))
                ) : (
                  <li className="text-muted-foreground/70">No PRs created</li>
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
    </div>
  );
};
