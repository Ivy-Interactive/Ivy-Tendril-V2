import { type PlanActionDto } from "@ivy-interactive/components/tendril";
import type { Annotation, PlanDetail, PlanSummary } from "../../types/api";
import { PlanActionsController } from "../../controllers/planActions";
import { draftActions, type DraftAction } from "../../controllers/draftActions";

/** What the action row is assembled from: the plan as the page believes it, and what is in flight. */
export interface PlanActionsOptions {
  effectivePlan: PlanDetail;
  allPlans: PlanSummary[];
  isPlanInFlight: boolean;
  pendingAction: string | null;
  isCheckingPreflight: boolean;
  annotations: Annotation[];
  answeredQuestionCount: number;
  hasActiveJob: (type: string) => boolean;
}

/**
 * The four action collections, plus the two things the page itself still needs from the assembly:
 * `draftSet` is what `handleWorkspaceAction` resolves a tag against, and `canOpenUpdateDialog` is
 * the predicate the empty-body callout shares with the topbar's wand - see its note below.
 */
export interface PlanActionSet {
  iconActions: PlanActionDto[];
  workspaceMenu: PlanActionDto[];
  secondaryActions: PlanActionDto[];
  primaryAction: PlanActionDto | null;
  draftSet: DraftAction[];
  canOpenUpdateDialog: boolean;
}

/**
 * The workspace's action row, assembled the way `DraftActions.Build` assembles it: "Update and
 * Share as icons, everything else in the overflow menu", the primary CTA on its own, and the
 * annotations/answers roll-up as a badged secondary button.
 *
 * Every entry is a `PlanActionDto` and reports back through one `OnAction` event, exactly as
 * `PlanWorkspaceActions.ApplyTo` wires it: "Tags are unique across icon actions, menu items and the
 * labeled buttons, so one event serves them all."
 */
export function buildPlanActions({
  effectivePlan,
  allPlans,
  isPlanInFlight,
  pendingAction,
  isCheckingPreflight,
  annotations,
  answeredQuestionCount,
  hasActiveJob,
}: PlanActionsOptions): PlanActionSet {
  // Gating checks
  const canExec = PlanActionsController.canExecute(effectivePlan, allPlans);
  const canPr = PlanActionsController.canCreatePr(effectivePlan);
  const canRetryPlan = PlanActionsController.canRetry(effectivePlan);
  const canDeletePlan = PlanActionsController.canDelete(effectivePlan);
  const canResetPlan = PlanActionsController.canReset(effectivePlan);
  const canPartial = PlanActionsController.canCompletePartial(effectivePlan);

  const iconActions: PlanActionDto[] = [];
  const workspaceMenu: PlanActionDto[] = [];
  const secondaryActions: PlanActionDto[] = [];
  let primaryAction: PlanActionDto | null = null;

  const draftSet = draftActions().filter((action) => action.isAvailable(effectivePlan));
  const availableDraft = new Set(draftSet.map((action) => action.id));
  const draftLabel = (id: DraftAction["id"]) =>
    draftSet.find((action) => action.id === id)?.label ?? id;

  /**
   * Whether *Update Plan* is reachable at all right now.
   *
   * Hoisted out of the branch below because two surfaces depend on it and they must never disagree:
   * the topbar's wand icon, and the empty-body callout that offers the same dialog. The callout used
   * to tell the reader to "Run Update Plan" in prose, which was a dead end in the one case it fired
   * most -- a husk plan has no annotations and no answered questions, so the badged *Update Plan*
   * secondary never appears, and the only other control is an unlabeled wand glyph. One predicate,
   * used at both sites, is what keeps the instruction and the control from drifting apart again.
   */
  const canOpenUpdateDialog =
    !isPlanInFlight &&
    effectivePlan.state !== "Review" &&
    effectivePlan.state !== "Completed" &&
    availableDraft.has("update");

  if (!isPlanInFlight && effectivePlan.state !== "Review" && effectivePlan.state !== "Completed") {
    // `actions.Action("Update", "Update", Icons.WandSparkles, ctx.ShowUpdateDialog, "U")`.
    if (canOpenUpdateDialog) {
      iconActions.push({
        tag: "update",
        label: draftLabel("update"),
        icon: "WandSparkles",
        shortcut: "U",
        disabled: pendingAction !== null || hasActiveJob("UpdatePlan"),
      });
    }

    // The overflow menu, in `DraftActions`' own order.
    if (availableDraft.has("expand"))
      workspaceMenu.push({
        tag: "expand",
        label: draftLabel("expand"),
        icon: "Expand",
        shortcut: "P",
        disabled: pendingAction !== null || hasActiveJob("ExpandPlan"),
      });
    if (availableDraft.has("split"))
      workspaceMenu.push({
        tag: "split",
        label: draftLabel("split"),
        icon: "Scissors",
        disabled: pendingAction !== null || hasActiveJob("SplitPlan"),
      });
    if (availableDraft.has("delete"))
      workspaceMenu.push({
        tag: "delete",
        label: draftLabel("delete"),
        icon: "Trash",
        shortcut: "Backspace",
        danger: true,
        disabled: pendingAction !== null,
      });
    if (availableDraft.has("createIssue"))
      workspaceMenu.push({ tag: "createIssue", label: draftLabel("createIssue"), icon: "Github" });

    // `actions.Menu("DiscussWithAgent", $"Discuss with {agentLabel}", agentIcon, ..., focusChat: true)`.
    workspaceMenu.push({
      tag: "DiscussWithAgent",
      label: "Discuss with agent",
      icon: "MessageSquare",
      focusChat: true,
    });

    if (availableDraft.has("openFolder"))
      workspaceMenu.push({
        tag: "openFolder",
        label: draftLabel("openFolder"),
        icon: "FolderOpen",
      });
    if (availableDraft.has("copyPath"))
      workspaceMenu.push({
        tag: "copyPath",
        label: draftLabel("copyPath"),
        icon: "ClipboardCopy",
      });
    if (availableDraft.has("copyId"))
      workspaceMenu.push({ tag: "copyId", label: draftLabel("copyId"), icon: "ClipboardCopy" });

    /**
     * `AddSecondary("UpdatePlan", "Update Plan", Icons.WandSparkles, ..., badge: (activeAnnotationCount
     * + answeredQuestions))`, with V1's reason: "Both kinds of pending work go through one button,
     * because one job answers both: an UpdatePlan that folds them into the plan. The badge counts them
     * together."
     */
    const pendingWork = annotations.filter((a) => !a.isResolved).length + answeredQuestionCount;
    if (pendingWork > 0) {
      secondaryActions.push({
        tag: "UpdatePlan",
        label: "Update Plan",
        icon: "WandSparkles",
        badge: String(pendingWork),
        disabled: pendingAction !== null || hasActiveJob("UpdatePlan"),
      });
    }

    // `actions.SetPrimary("Execute", "Execute", Icons.Rocket, ..., "x", disabled: isCheckingPreflight,
    // loading: isCheckingPreflight)`.
    if (availableDraft.has("execute")) {
      primaryAction = {
        tag: "execute",
        label: isCheckingPreflight
          ? "Checking..."
          : pendingAction === "Execute Plan"
            ? "Starting..."
            : draftLabel("execute"),
        icon: "Rocket",
        shortcut: "x",
        disabled: pendingAction !== null || isCheckingPreflight || !canExec.allowed,
        loading: isCheckingPreflight,
      };
    }
  }

  // The Review page's own set. V1 keeps these in `ReviewActions`, on the same workspace.
  if (!isPlanInFlight && (effectivePlan.state === "Review" || effectivePlan.state === "Failed")) {
    primaryAction = {
      tag: "CreatePr",
      label: "Create PR",
      icon: "GitPullRequest",
      disabled: !canPr.allowed || pendingAction !== null,
    };
    secondaryActions.push({
      tag: "CompletePlan",
      label: "Complete Plan",
      icon: "CircleCheck",
      disabled: pendingAction !== null,
    });
    secondaryActions.push({
      tag: "RetryPlan",
      label: "Retry Plan",
      icon: "RotateCcw",
      disabled: !canRetryPlan.allowed || pendingAction !== null,
    });
    if (canPartial.allowed)
      secondaryActions.push({
        tag: "AcceptPartialDelivery",
        label: "Accept Partial Delivery",
        icon: "TriangleAlert",
      });
  }

  // `ReviewActions.Build`: `.Menu("ResetToDraft", "Reset to Draft", Icons.RotateCcw, ..., "r")`,
  // followed by the danger item. V1's Review puts Discard in that second slot; the app offers Delete
  // there instead — see `handleWorkspaceAction`.
  if (!isPlanInFlight && canResetPlan.allowed)
    workspaceMenu.push({
      tag: "ResetToDraft",
      label: "Reset to Draft…",
      icon: "RotateCcw",
      shortcut: "r",
    });
  // The draft block above already carries Delete for every state it covers. Review and Completed are
  // the two it does not, and both need it: a plan that will never ship is removed from here, and
  // Discard — which only ever moved it to Skipped — is gone.
  if (
    !isPlanInFlight &&
    canDeletePlan.allowed &&
    !workspaceMenu.some((item) => item.tag === "delete")
  )
    workspaceMenu.push({
      tag: "delete",
      label: draftLabel("delete"),
      icon: "Trash",
      shortcut: "Backspace",
      danger: true,
      disabled: pendingAction !== null,
    });

  return {
    iconActions,
    workspaceMenu,
    secondaryActions,
    primaryAction,
    draftSet,
    canOpenUpdateDialog,
  };
}
