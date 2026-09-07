import React, { useEffect, useState } from "react";
import {
  describeBridgeError,
  type PlanSummary,
  type RecommendationItem,
  type RecommendationState,
} from "../types/api";
import { bridge } from "../api/bridge";
import { PlanActionsController } from "../controllers/plan_actions";
import { EmptyState } from "../components/EmptyState";
import { RecommendationCard } from "../components/RecommendationCard";
import { RecommendationNoteDialog } from "../components/RecommendationNoteDialog";

interface ReviewViewProps {
  plans: PlanSummary[];
  onSelectPlan: (planId: string) => void;
  onCreatePr: (planId: string) => void | Promise<void>;
  onRetry: (planId: string, feedback: string) => void | Promise<void>;
}

export const ReviewView: React.FC<ReviewViewProps> = ({
  plans,
  onSelectPlan,
  onCreatePr,
  onRetry,
}) => {
  const reviewPlans = plans.filter((p) => p.state === "Review");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    reviewPlans[0]?.id || null
  );
  const [retryFeedback, setRetryFeedback] = useState("");
  const [isRetrying, setIsRetrying] = useState(false);

  const selectedPlan = reviewPlans.find((p) => p.id === selectedPlanId);

  // Recommendations come from the selected plan's plan.yaml via the bridge.
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeNoteDialog, setActiveNoteDialog] = useState<{
    title: string;
    action: "Accept" | "Decline";
  } | null>(null);

  useEffect(() => {
    if (!selectedPlanId) {
      setRecommendations([]);
      return;
    }

    let cancelled = false;
    setRecsError(null);

    bridge
      .listRecommendations(selectedPlanId)
      .then((recs) => {
        if (!cancelled) setRecommendations(recs);
      })
      .catch((err) => {
        if (cancelled) return;
        setRecommendations([]);
        setRecsError(describeBridgeError(err));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPlanId]);

  /**
   * Apply a triage decision optimistically, then persist it. On failure the
   * previous list is restored — the operator must not be left believing a
   * decision was recorded in plan.yaml when it was not.
   */
  const setRecState = async (
    title: string,
    state: RecommendationState,
    declineReason?: string
  ) => {
    if (!selectedPlanId) return;

    const previous = recommendations;
    setRecommendations((prev) =>
      prev.map((r) => (r.title === title ? { ...r, state, declineReason } : r))
    );
    setActionError(null);

    try {
      await bridge.setRecommendationState(
        selectedPlanId,
        title,
        state,
        declineReason
      );
    } catch (err) {
      setRecommendations(previous);
      setActionError(
        `Could not mark "${title}" as ${state}: ${describeBridgeError(err)}`
      );
    }
  };

  const handleDialogSubmit = async (note?: string) => {
    if (!activeNoteDialog) return;
    const { title, action } = activeNoteDialog;
    const trimmedNote = note?.trim();
    const targetState: RecommendationState =
      action === "Accept"
        ? (trimmedNote ? "AcceptedWithNotes" : "Accepted")
        : "Declined";
    const notePayload = trimmedNote || undefined;

    setActiveNoteDialog(null);
    await setRecState(title, targetState, notePayload);
  };

  const handleRetrySubmit = async () => {
    if (!selectedPlan || !retryFeedback.trim()) return;
    setActionError(null);
    try {
      await onRetry(selectedPlan.id, retryFeedback.trim());
      setIsRetrying(false);
      setRetryFeedback("");
    } catch (err) {
      setActionError(`Retry Plan failed: ${describeBridgeError(err)}`);
    }
  };

  const handleCreatePr = async () => {
    if (!selectedPlan) return;
    setActionError(null);
    try {
      await onCreatePr(selectedPlan.id);
    } catch (err) {
      setActionError(`Create PR failed: ${describeBridgeError(err)}`);
    }
  };

  if (reviewPlans.length === 0) {
    return (
      <div data-testid="review-view" className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Review & Recommendations</h1>
        <EmptyState
          title="No plans in Review"
          description="There are currently no completed executions waiting for human review. Run or execute plans to review them here."
        />
      </div>
    );
  }

  const canPr = selectedPlan ? PlanActionsController.canCreatePr(selectedPlan) : { allowed: false };

  return (
    <div className="space-y-6" data-testid="review-view">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Review & Recommendations</h1>
          <p className="text-xs text-slate-400">
            Inspect completed implementations, triage recommendations, and approve or retry.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Plans list */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Plans Awaiting Review ({reviewPlans.length})
          </h3>
          {reviewPlans.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedPlanId(p.id)}
              className={`cursor-pointer rounded-xl border p-4 transition ${
                selectedPlanId === p.id
                  ? "border-amber-500 bg-slate-900 ring-1 ring-amber-500"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-slate-400">{p.id}</span>
                <span className="rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-300 border border-amber-800">
                  Review
                </span>
              </div>
              <h4 className="mt-2 text-sm font-semibold text-slate-100 line-clamp-1">{p.title}</h4>
              <p className="mt-1 text-xs text-slate-400">{p.project}</p>
            </div>
          ))}
        </div>

        {/* Plan Review Details & Recommendations */}
        {selectedPlan && (
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono text-xs font-bold text-slate-400">{selectedPlan.id}</span>
                  <h2 className="mt-1 text-xl font-bold text-slate-100">{selectedPlan.title}</h2>
                  <p className="text-xs text-slate-400">Project: {selectedPlan.project}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectPlan(selectedPlan.id)}
                  className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
                >
                  View Full Spec & Diff →
                </button>
              </div>

              {/* Review Actions */}
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  disabled={!canPr.allowed}
                  title={canPr.reason}
                  onClick={handleCreatePr}
                  className={`rounded-lg px-4 py-2 text-xs font-medium transition ${
                    canPr.allowed
                      ? "bg-emerald-600 text-white hover:bg-emerald-500"
                      : "cursor-not-allowed bg-slate-800 text-slate-500"
                  }`}
                >
                  Approve & Create PR
                </button>
                <button
                  type="button"
                  onClick={() => setIsRetrying(true)}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-amber-500"
                >
                  Request Changes (Retry)
                </button>
              </div>

              {actionError && (
                <div
                  role="alert"
                  data-testid="review-action-error"
                  className="mt-4 rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-300"
                >
                  {actionError}
                </div>
              )}

              {/* Retry feedback form */}
              {isRetrying && (
                <div className="mt-4 rounded-xl border border-amber-600/40 bg-amber-950/20 p-4">
                  <label className="block text-xs font-medium text-amber-200 mb-1">
                    Feedback / Change Request for RetryPlan Job:
                  </label>
                  <textarea
                    rows={3}
                    value={retryFeedback}
                    onChange={(e) => setRetryFeedback(e.target.value)}
                    placeholder="Describe what needs to be changed, fixed, or rewritten in the worktree..."
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                  />
                  <div className="mt-3 flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setIsRetrying(false)}
                      className="rounded px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!retryFeedback.trim()}
                      onClick={handleRetrySubmit}
                      className="rounded bg-amber-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
                    >
                      Submit Change Request
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Recommendations List */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
              <h3 className="text-sm font-semibold text-slate-100">Plan Recommendations</h3>
              <p className="text-xs text-slate-400">
                Out-of-scope follow-ups and improvements discovered during execution.
              </p>

              {recsError && (
                <div
                  role="alert"
                  data-testid="recommendations-error"
                  className="mt-4 rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-300"
                >
                  {recsError}
                </div>
              )}

              {!recsError && recommendations.length === 0 && (
                <p
                  data-testid="no-recommendations"
                  className="mt-4 text-xs text-slate-500"
                >
                  ExecutePlan registered no recommendations for this plan.
                </p>
              )}

              <div className="mt-4 space-y-3">
                {recommendations.map((rec) => (
                  <RecommendationCard
                    key={rec.title}
                    recommendation={rec}
                    onAccept={(title) => setActiveNoteDialog({ title, action: "Accept" })}
                    onDecline={(title) => setActiveNoteDialog({ title, action: "Decline" })}
                  />
                ))}
              </div>
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
    </div>
  );
};
