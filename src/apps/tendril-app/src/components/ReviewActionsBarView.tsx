import React, { useState } from "react";
import { Play } from "lucide-react";
import type { ReviewActionConfig } from "../types/api";
import { bridge } from "../api/bridge";

export interface ConditionContext {
  worktreePaths?: string[];
  existingPaths?: string[];
  planFolder?: string;
}

/**
 * What this evaluator was able to conclude about a condition.
 *
 * `"unknown"` is the case V1 does not have and cannot have: `PlatformHelper.EvaluatePowerShellCondition`
 * runs the condition against the real filesystem with the plan folder as its working directory, natively
 * for a plain `Test-Path` and through `pwsh -NoProfile -Command "if (...)"` for anything else, so every
 * condition reaches a verdict. Here there is no filesystem and no shell, so `Test-Path` with nothing to
 * match against, and any grammar outside the subset below, genuinely have no answer.
 *
 * Keeping that separate from `false` is the whole point. Folding it into `false` disabled every
 * conditioned review action in the app permanently, tooltip and all, which reads as "the condition was
 * checked and does not hold" when nothing was checked at all.
 */
export type ConditionState = boolean | "unknown";

/** Kleene `-or`: one `true` decides it, otherwise an undecided part leaves the whole undecided. */
function orState(parts: ConditionState[]): ConditionState {
  if (parts.some((part) => part === true)) return true;
  return parts.some((part) => part === "unknown") ? "unknown" : false;
}

/** Kleene `-and`: one `false` decides it, otherwise an undecided part leaves the whole undecided. */
function andState(parts: ConditionState[]): ConditionState {
  if (parts.some((part) => part === false)) return false;
  return parts.some((part) => part === "unknown") ? "unknown" : true;
}

/**
 * The PowerShell subset this evaluator understands, as a three-valued result.
 *
 * The grammar is deliberately the same one `tendril-core`'s `jobs::hook_condition` parses
 * (`expr := and-expr (" -or " and-expr)*`, `and := term (" -and " term)*`,
 * `term := "(" expr ")" | bool-literal | Test-Path <path>`), and its module doc names this function as
 * the reference — so do not widen it here without widening that.
 *
 * `Test-Path` is a substring match against a supplied path list rather than a filesystem check, which
 * is also deliberate and is documented as such in that module.
 */
export function evaluateConditionState(
  condition: string | undefined,
  context?: ConditionContext,
): ConditionState {
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
    return orState(
      parts.map((part) => evaluateConditionState(part.trim().replace(/^\(|\)$/g, ""), context)),
    );
  }

  // Support PowerShell -and expressions
  if (trimmed.includes(" -and ")) {
    const parts = trimmed.split(" -and ");
    return andState(
      parts.map((part) => evaluateConditionState(part.trim().replace(/^\(|\)$/g, ""), context)),
    );
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

    // No paths to test against, so this is not a `Test-Path` that failed - it is one that was never
    // run. See `ConditionState`.
    return "unknown";
  }

  return "unknown";
}

/**
 * Whether the condition is known to hold. Anything this evaluator cannot decide reads as `false` here,
 * which is what `tendril-core`'s `jobs::hook_condition` mirrors for a hook: a hook whose condition
 * cannot be evaluated does not run. A *button*, unlike a hook, has a reviewer behind it who can be told
 * instead - see [`evaluateConditionState`].
 */
export function evaluateCondition(
  condition: string | undefined,
  context?: ConditionContext,
): boolean {
  return evaluateConditionState(condition, context) === true;
}

export function getReviewActionTooltip(
  action: ReviewActionConfig,
  conditionMet: ConditionState,
  allocatedPorts?: Record<string, number> | null,
): string {
  if (conditionMet === false) {
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
  const run = cmd ? `Run: ${action.command}${portsStr}` : `Run ${action.name}${portsStr}`;
  // The reviewer is told the gate was skipped rather than silently given a button V1 might have
  // disabled. The command itself is the check of last resort: it fails visibly in the terminal.
  return conditionMet === "unknown"
    ? `${run}. Condition not evaluated here: ${action.condition?.trim()}`
    : run;
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
  /**
   * Which actions are mid-handover, by name rather than one at a time. V1's bar navigates to a
   * `[App(..., allowDuplicateTabs: true)] ReviewActionApp`, so a second action running beside the
   * first is exactly what it allows: only the button that was pressed goes quiet.
   */
  const [executing, setExecuting] = useState<ReadonlySet<string>>(() => new Set());

  if (!actions || actions.length === 0) {
    return null;
  }

  const handleActionClick = async (action: ReviewActionConfig) => {
    if (disabled || executing.has(action.name)) return;
    setExecuting((prev) => new Set(prev).add(action.name));
    try {
      if (onExecuteAction) {
        await onExecuteAction(action.name);
      } else if (project) {
        await bridge.executeReviewAction(project, action.name, planId);
      }
    } finally {
      setExecuting((prev) => {
        const next = new Set(prev);
        next.delete(action.name);
        return next;
      });
    }
  };

  return (
    /* V1 `ReviewActionsBarView`: `Layout.Horizontal().Gap(2).Padding(3, 2, 1, 0)`, whose
       argument order is (left, top, right, bottom). The gap was ported and the padding was not,
       which left the bar flush against the frame's top-left corner. */
    <div
      data-testid="review-actions-bar"
      className="flex flex-wrap items-center gap-2 pt-2 pr-1 pl-3"
    >
      {actions.map((action) => {
        // A host that evaluated the condition properly (which needs a filesystem, so a host that
        // asked the service) wins outright; otherwise this decides what it can and says so when it
        // cannot. `ReviewActionsBarView.BuildActionButton` disables on a condition that *does not
        // hold*, which is `false` and not `"unknown"`.
        const conditionMet: ConditionState =
          actionStates?.[action.name] ??
          evaluateConditionState(action.condition, { existingPaths, worktreePaths });

        const isBtnDisabled = disabled || conditionMet === false || executing.has(action.name);
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
            className={`inline-flex items-center gap-1.5 rounded-field border px-3 py-1.5 text-xs font-medium transition ${
              conditionMet !== false && !disabled
                ? "border-border bg-card/80 text-foreground hover:border-ring hover:bg-accent"
                : "cursor-not-allowed border-border bg-background text-muted-foreground/70 opacity-60"
            }`}
          >
            <Play className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{action.name}</span>
          </button>
        );
      })}
    </div>
  );
};
