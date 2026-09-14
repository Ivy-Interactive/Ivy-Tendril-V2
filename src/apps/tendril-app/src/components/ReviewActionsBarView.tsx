import React, { useState } from "react";
import { Play } from "lucide-react";
import type { ReviewActionConfig } from "../types/api";
import { bridge } from "../api/bridge";

export interface ConditionContext {
  worktreePaths?: string[];
  existingPaths?: string[];
  planFolder?: string;
}

export function evaluateCondition(
  condition: string | undefined,
  context?: ConditionContext,
): boolean {
  if (!condition || condition.trim() === "") {
    return true;
  }
  const trimmed = condition.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "$true" || lower === "true") {
    return true;
  }
  if (lower === "$false" || lower === "false") {
    return false;
  }

  // Support PowerShell -or expressions
  if (trimmed.includes(" -or ")) {
    const parts = trimmed.split(" -or ");
    return parts.some((part) => evaluateCondition(part.trim().replace(/^\(|\)$/g, ""), context));
  }

  // Support PowerShell -and expressions
  if (trimmed.includes(" -and ")) {
    const parts = trimmed.split(" -and ");
    return parts.every((part) => evaluateCondition(part.trim().replace(/^\(|\)$/g, ""), context));
  }

  // Test-Path expression: Test-Path "path" or Test-Path path
  const testPathMatch = trimmed.match(/Test-Path\s+["']?([^"')]+)["']?/i);
  if (testPathMatch) {
    const targetPath = testPathMatch[1].trim();

    // Check against existingPaths if explicitly provided
    if (context?.existingPaths && context.existingPaths.length > 0) {
      return context.existingPaths.some((p) => p.includes(targetPath) || targetPath.includes(p));
    }

    // Check against worktreePaths if provided
    if (context?.worktreePaths && context.worktreePaths.length > 0) {
      return context.worktreePaths.some((wp) => wp.includes(targetPath) || targetPath.includes(wp));
    }

    return false;
  }

  return false;
}

export function getReviewActionTooltip(
  action: ReviewActionConfig,
  conditionMet: boolean,
  allocatedPorts?: Record<string, number> | null,
): string {
  if (!conditionMet) {
    const cond = action.condition?.trim();
    return cond
      ? `Disabled: Condition not met (${action.condition})`
      : "Disabled: Condition not met";
  }

  const portKeys = allocatedPorts ? Object.keys(allocatedPorts).sort() : [];
  const portsStr =
    portKeys.length > 0
      ? ` (ports: ${portKeys.map((k) => `${k}: ${allocatedPorts![k]}`).join(", ")})`
      : "";

  const cmd = action.command?.trim();
  return cmd ? `Run: ${action.command}${portsStr}` : `Run ${action.name}${portsStr}`;
}

export interface ReviewActionsBarViewProps {
  project?: string;
  planId?: string;
  actions: ReviewActionConfig[];
  allocatedPorts?: Record<string, number> | null;
  onExecuteAction?: (actionName: string) => void | Promise<void>;
  actionStates?: Record<string, boolean>;
  existingPaths?: string[];
  worktreePaths?: string[];
  disabled?: boolean;
}

export const ReviewActionsBarView: React.FC<ReviewActionsBarViewProps> = ({
  project,
  planId,
  actions,
  allocatedPorts,
  onExecuteAction,
  actionStates,
  existingPaths,
  worktreePaths,
  disabled = false,
}) => {
  const [executingAction, setExecutingAction] = useState<string | null>(null);

  if (!actions || actions.length === 0) {
    return null;
  }

  const handleActionClick = async (action: ReviewActionConfig) => {
    if (disabled || executingAction) return;
    setExecutingAction(action.name);
    try {
      if (onExecuteAction) {
        await onExecuteAction(action.name);
      } else if (project) {
        await bridge.executeReviewAction(project, action.name, planId);
      }
    } finally {
      setExecutingAction(null);
    }
  };

  return (
    <div data-testid="review-actions-bar" className="flex flex-wrap items-center gap-2">
      {actions.map((action) => {
        const conditionMet =
          actionStates?.[action.name] ??
          evaluateCondition(action.condition, { existingPaths, worktreePaths });

        const isBtnDisabled = disabled || !conditionMet || executingAction === action.name;
        const tooltip = getReviewActionTooltip(action, conditionMet, allocatedPorts);

        return (
          <button
            key={action.name}
            type="button"
            data-testid={`review-action-btn-${action.name.toLowerCase().replace(/\s+/g, "-")}`}
            disabled={isBtnDisabled}
            title={tooltip}
            aria-label={action.name}
            onClick={() => handleActionClick(action)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              conditionMet && !disabled
                ? "border-slate-700 bg-slate-900/80 text-slate-200 hover:border-slate-600 hover:bg-slate-800 hover:text-white"
                : "cursor-not-allowed border-slate-800 bg-slate-950 text-slate-500 opacity-60"
            }`}
          >
            <Play className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{action.name}</span>
          </button>
        );
      })}
    </div>
  );
};
