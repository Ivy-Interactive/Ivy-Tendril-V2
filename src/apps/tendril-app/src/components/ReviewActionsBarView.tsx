import React, { useId, useState } from "react";
import { Play } from "lucide-react";
import { TuiTooltip, withTooltipScope } from "@ivy-interactive/components/ui";
import type { ReviewActionConditionResult, ReviewActionConfig } from "../types/api";
import { bridge } from "../api/bridge";
import { i18n, useTranslation, type TFunction } from "../i18n";

/** For the pure helpers below when no component hands them its `t`; follows the current language. */
const reviewT = i18n.getFixedT(null, "review");

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
 * match against, and any grammar outside the subset below, genuinely have no answer. That is why the
 * real verdict comes from the daemon (`bridge.getReviewActionConditions`), which does what V1 did; this
 * evaluator only decides what it can while that answer is out, or if it never arrives. The daemon has
 * an `"unknown"` of its own, for a condition it could not evaluate either (unsupported syntax, a
 * timeout).
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

/**
 * One action's condition as a host decided it. `reason` is why it could not be decided, and is only
 * read for `"unknown"`: a condition that does not hold is explained by the condition itself, which is
 * all V1's `Disabled: Condition not met (<condition>)` ever said.
 */
export interface ReviewActionConditionVerdict {
  state: ConditionState;
  reason?: string;
}

/**
 * The daemon's answer as the verdicts this bar reads, keyed by action name. A state this build does
 * not recognise is read as undecided rather than guessed at in either direction.
 */
export function conditionVerdictsFrom(
  results: readonly ReviewActionConditionResult[],
): Record<string, ReviewActionConditionVerdict> {
  const verdicts: Record<string, ReviewActionConditionVerdict> = {};
  for (const result of results) {
    const state: ConditionState =
      result.state === "met" ? true : result.state === "notMet" ? false : "unknown";
    verdicts[result.name] = { state, reason: result.reason ?? undefined };
  }
  return verdicts;
}

/**
 * `ReviewActionsBarView.GetTooltip`, plus the undecided case V1 never had: `reason` is the daemon's
 * account of why it could not evaluate the condition, when it is the daemon that could not.
 *
 * Translated when it is called: a component passes its own `t`, so the text follows a language
 * change on the next render; anything else gets the current language's. The action's name, command
 * and condition are the project's own config and the daemon's `reason` its own text - only the
 * sentence around them is.
 */
export function getReviewActionTooltip(
  action: ReviewActionConfig,
  conditionMet: ConditionState,
  allocatedPorts?: Record<string, number> | null,
  reason?: string,
  t: TFunction<"review"> = reviewT,
): string {
  const cond = action.condition?.trim();

  if (conditionMet === false) {
    return cond
      ? t("actionsBar.tooltip.conditionNotMetWithCondition", { condition: cond })
      : t("actionsBar.tooltip.conditionNotMet");
  }

  if (conditionMet === "unknown") {
    if (reason) {
      return cond
        ? t("actionsBar.tooltip.conditionErrorWithCondition", { condition: cond, reason })
        : t("actionsBar.tooltip.conditionError", { reason });
    }
    return cond
      ? t("actionsBar.tooltip.conditionNotMetWithCondition", { condition: cond })
      : t("actionsBar.tooltip.conditionNotMet");
  }

  const portKeys = allocatedPorts ? Object.keys(allocatedPorts).sort() : [];
  const ports = portKeys
    .map((k) => t("actionsBar.tooltip.port", { name: k, port: allocatedPorts![k] }))
    .join(", ");
  const withPorts = portKeys.length > 0;

  const cmd = action.command?.trim();
  return cmd
    ? withPorts
      ? t("actionsBar.tooltip.runCommandWithPorts", { command: action.command, ports })
      : t("actionsBar.tooltip.runCommand", { command: action.command })
    : withPorts
      ? t("actionsBar.tooltip.runActionWithPorts", { name: action.name, ports })
      : t("actionsBar.tooltip.runAction", { name: action.name });
}

export interface ReviewActionsBarViewProps {
  project?: string;
  planId?: string;
  actions: ReviewActionConfig[];
  allocatedPorts?: Record<string, number> | null;
  onExecuteAction?: (actionName: string) => void | Promise<void>;
  /**
   * Conditions a host evaluated properly, keyed by action name — in the app, the daemon's answer for
   * the selected plan (`conditionVerdictsFrom(await bridge.getReviewActionConditions(...))`). A bare
   * `ConditionState` is accepted for a host with no reason to give.
   */
  actionStates?: Record<string, ConditionState | ReviewActionConditionVerdict>;
  /**
   * The host is still asking for `actionStates`. An action whose condition this bar cannot decide on
   * its own waits, disabled and saying so, rather than being offered and then taken away under the
   * reviewer's cursor. V1's bar did the same: its states start empty, which disables every action
   * until the query answers.
   */
  conditionsPending?: boolean;
  existingPaths?: string[];
  worktreePaths?: string[];
  disabled?: boolean;
  /** Why the whole bar is disabled, shown on every button in place of what it would run. */
  disabledReason?: string;
}

/** A disabled button with the one sentence that says why, or an enabled one with what it runs. */
interface ActionPresentation {
  disabled: boolean;
  tooltip: string;
  /**
   * Drawn as unusable. Every disabled state is, except the button that was just pressed: that one is
   * answering the click, and dimming it under the reviewer's cursor would read as the click failing.
   */
  dimmed: boolean;
  /** Disabled only until something finishes (the daemon's answer, the handover), not for good. */
  busy: boolean;
}

function presentAction(
  action: ReviewActionConfig,
  verdict: ReviewActionConditionVerdict,
  options: {
    allocatedPorts?: Record<string, number> | null;
    barDisabled: boolean;
    disabledReason?: string;
    checking: boolean;
    executing: boolean;
    t: TFunction<"review">;
  },
): ActionPresentation {
  const { t } = options;
  if (options.barDisabled) {
    return {
      disabled: true,
      tooltip:
        options.disabledReason == null
          ? t("actionsBar.tooltip.barDisabledDefault")
          : t("actionsBar.tooltip.barDisabled", { reason: options.disabledReason }),
      dimmed: true,
      busy: false,
    };
  }
  if (options.executing) {
    return {
      disabled: true,
      tooltip: t("actionsBar.tooltip.starting", { name: action.name }),
      dimmed: false,
      busy: true,
    };
  }
  if (options.checking) {
    // Dimmed like V1's `btn.Disabled()` while its query was out: a button drawn as pressable that
    // swallows the click, for as long as a shell condition takes, is the silent failure this
    // exists to avoid.
    return {
      disabled: true,
      tooltip: t("actionsBar.tooltip.checking", {
        condition: String(action.condition?.trim()),
      }),
      dimmed: true,
      busy: true,
    };
  }
  if (verdict.state === false || verdict.state === "unknown") {
    return {
      disabled: true,
      tooltip: getReviewActionTooltip(
        action,
        verdict.state,
        options.allocatedPorts,
        verdict.reason,
        t,
      ),
      dimmed: true,
      busy: false,
    };
  }
  return {
    disabled: false,
    tooltip: getReviewActionTooltip(action, true, options.allocatedPorts, undefined, t),
    dimmed: false,
    busy: false,
  };
}

const ReviewActionsBar: React.FC<ReviewActionsBarViewProps> = ({
  project,
  planId,
  actions,
  allocatedPorts,
  onExecuteAction,
  actionStates,
  conditionsPending = false,
  existingPaths,
  worktreePaths,
  disabled = false,
  disabledReason,
}) => {
  const { t } = useTranslation("review");
  /**
   * Which actions are mid-handover, by name rather than one at a time. V1's bar navigates to a
   * `[App(..., allowDuplicateTabs: true)] ReviewActionApp`, so a second action running beside the
   * first is exactly what it allows: only the button that was pressed goes quiet.
   */
  const [executing, setExecuting] = useState<ReadonlySet<string>>(() => new Set());
  const descriptionIdBase = useId();

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
      {actions.map((action, index) => {
        // A host that evaluated the condition properly (which needs a filesystem, so a host that
        // asked the daemon) wins outright; otherwise this decides what it can and says so when it
        // cannot. `ReviewActionsBarView.BuildActionButton` disables on a condition that *does not
        // hold*, which is `false` and not `"unknown"`.
        const hostVerdict = actionStates?.[action.name];
        const verdict: ReviewActionConditionVerdict =
          hostVerdict === undefined
            ? { state: evaluateConditionState(action.condition, { existingPaths, worktreePaths }) }
            : typeof hostVerdict === "object"
              ? hostVerdict
              : { state: hostVerdict };
        const presentation = presentAction(action, verdict, {
          allocatedPorts,
          barDisabled: disabled,
          disabledReason,
          checking: hostVerdict === undefined && conditionsPending && verdict.state === "unknown",
          executing: executing.has(action.name),
          t,
        });
        const descriptionId = `${descriptionIdBase}-${index}`;

        return (
          /* The shared tooltip rather than a native `title`, which is what this was: a disabled
             button emits no pointer events, so whether its `title` ever shows is up to the engine,
             and the one tooltip that says why it is disabled is exactly the one that matters.
             `wrapTrigger` anchors it on a wrapper that still receives the hover, and
             `disabled:pointer-events-none` lets the hover through the button to reach it, as the
             shared `Button` does; the wrapper then carries the `not-allowed` cursor itself. */
          <TuiTooltip
            key={action.name}
            content={
              <span className="block break-words whitespace-normal">{presentation.tooltip}</span>
            }
            wrapTrigger
            triggerDisabled={presentation.disabled}
          >
            <button
              type="button"
              data-testid={`review-action-btn-${action.name.toLowerCase().replace(/\s+/g, "-")}`}
              disabled={presentation.disabled}
              aria-label={action.name}
              aria-describedby={descriptionId}
              aria-busy={presentation.busy || undefined}
              onClick={() => handleActionClick(action)}
              className={`inline-flex items-center gap-1.5 rounded-field border px-3 py-1.5 text-xs font-medium transition disabled:pointer-events-none ${
                presentation.dimmed
                  ? "border-border bg-background text-muted-foreground/70 opacity-60"
                  : "border-border bg-card/80 text-foreground hover:border-ring hover:bg-secondary/60"
              }`}
            >
              <Play className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{action.name}</span>
            </button>
            {/* The same sentence for assistive tech, which reads a description without a hover.
                `hidden` rather than `sr-only`: `aria-describedby` still resolves a hidden element,
                and a merely visually hidden one would be read a second time as loose text after
                the button. */}
            <span id={descriptionId} hidden>
              {presentation.tooltip}
            </span>
          </TuiTooltip>
        );
      })}
    </div>
  );
};

/**
 * One tooltip scope for the row, so moving from one button to the next hands the tooltip over at
 * once instead of waiting out the open delay again.
 */
export const ReviewActionsBarView = withTooltipScope(ReviewActionsBar);
