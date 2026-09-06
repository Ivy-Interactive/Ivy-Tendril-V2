import React, { useState } from "react";
import {
  PlanMarkdown,
  PlanDiffView,
  SortableVerificationList,
} from "components-storybook/tendril";
import type { PlanDetail, PlanSummary } from "../types/api";
import { PlanActionsController } from "../controllers/plan_actions";

interface PlanDetailViewProps {
  plan: PlanDetail;
  allPlans?: PlanSummary[];
  onExecute?: (planId: string) => void;
  onRetry?: (planId: string) => void;
  onCreatePr?: (planId: string) => void;
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
  const [activeSubTab, setActiveSubTab] = useState<"spec" | "diff" | "verifications" | "metadata">("spec");
  const [actionError, setActionError] = useState<string | null>(null);

  // Gating checks
  const canExec = PlanActionsController.canExecute(plan, allPlans);
  const canPr = PlanActionsController.canCreatePr(plan);
  const canRetryPlan = PlanActionsController.canRetry(plan);

  const verificationItems = (plan.verifications || []).map((v) => ({
    name: v.name,
    enabled: v.status !== "Skipped",
    required: true,
  }));

  const noop = () => {};

  const handleExecute = () => {
    try {
      setActionError(null);
      if (onExecute) onExecute(plan.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
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
                disabled={!canPr.allowed}
                title={canPr.reason}
                onClick={() => onCreatePr && onCreatePr(plan.id)}
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
                disabled={!canRetryPlan.allowed}
                title={canRetryPlan.reason}
                onClick={() => onRetry && onRetry(plan.id)}
                className={`rounded-lg px-4 py-2 text-xs font-medium transition ${
                  canRetryPlan.allowed
                    ? "bg-amber-600 text-white hover:bg-amber-500"
                    : "cursor-not-allowed bg-slate-800 text-slate-500"
                }`}
              >
                Retry Plan
              </button>
            </>
          )}

          {plan.state !== "Review" && plan.state !== "Completed" && (
            <button
              type="button"
              disabled={!canExec.allowed}
              title={canExec.reason}
              onClick={handleExecute}
              className={`rounded-lg px-4 py-2 text-xs font-medium transition ${
                canExec.allowed
                  ? "bg-blue-600 text-white hover:bg-blue-500"
                  : "cursor-not-allowed bg-slate-800 text-slate-500"
              }`}
            >
              Execute Plan
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-300">
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
            <PlanDiffView
              id="plan-diff"
              diff={`--- a/plan.md\n+++ b/plan.md\n@@ -1,3 +1,3 @@\n-# ${plan.title}\n+# ${plan.title} (Updated)\n`}
              viewType="Unified"
            />
          </div>
        )}

        {activeSubTab === "verifications" && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">Plan Verifications</h3>
            <SortableVerificationList
              id="verification-list"
              itemsJson={JSON.stringify(verificationItems)}
              eventHandler={noop}
            />
          </div>
        )}

        {activeSubTab === "metadata" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Repositories</h4>
              <ul className="mt-2 space-y-1 text-sm font-mono text-slate-300">
                {plan.repos && plan.repos.length > 0 ? (
                  plan.repos.map((r, i) => <li key={i}>{r}</li>)
                ) : (
                  <li className="text-slate-500 font-sans">No repositories specified</li>
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Dependencies</h4>
              <ul className="mt-2 space-y-1 text-sm font-mono text-slate-300">
                {plan.dependsOn && plan.dependsOn.length > 0 ? (
                  plan.dependsOn.map((d, i) => <li key={i}>{d}</li>)
                ) : (
                  <li className="text-slate-500 font-sans">No dependencies</li>
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Commits</h4>
              <ul className="mt-2 space-y-1 text-sm font-mono text-slate-300">
                {plan.commits && plan.commits.length > 0 ? (
                  plan.commits.map((c, i) => <li key={i}>{c}</li>)
                ) : (
                  <li className="text-slate-500 font-sans">No commits yet</li>
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Pull Requests</h4>
              <ul className="mt-2 space-y-1 text-sm text-slate-300">
                {plan.prs && plan.prs.length > 0 ? (
                  plan.prs.map((p, i) => (
                    <li key={i}>
                      <a href={p} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline font-mono text-xs">
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
    </div>
  );
};
