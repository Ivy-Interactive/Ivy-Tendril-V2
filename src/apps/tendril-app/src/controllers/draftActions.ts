import { PlanActionsController } from "./planActions";
import type { PlanDetail } from "../types/api";

/**
 * The action set offered for a Draft plan, ported from legacy `DraftActions.cs`.
 *
 * A descriptor list rather than JSX so a view and (later) a context menu can
 * render the same set from one source, and so availability stays testable
 * without a DOM.
 *
 * **Not ported:** legacy's Share/tunnel action. V2 has no tunnel service, so
 * there is nothing to point it at — the omission is deliberate, not an oversight.
 */
export interface DraftAction {
  id:
    | "execute"
    | "update"
    | "expand"
    | "split"
    | "createIssue"
    | "delete"
    | "copyPath"
    | "copyId"
    | "openFolder";
  label: string;
  variant: "primary" | "default" | "destructive";
  isAvailable: (plan: PlanDetail) => boolean;
}

export function draftActions(): DraftAction[] {
  return [
    {
      id: "execute",
      label: "Execute Plan",
      variant: "primary",
      isAvailable: (plan) => PlanActionsController.canExecute(plan).allowed,
    },
    {
      id: "update",
      label: "Update Plan…",
      variant: "default",
      isAvailable: (plan) => PlanActionsController.canRefine(plan).allowed,
    },
    {
      id: "expand",
      label: "Expand Plan",
      variant: "default",
      isAvailable: (plan) => PlanActionsController.canRefine(plan).allowed,
    },
    {
      id: "split",
      label: "Split Plan",
      variant: "default",
      isAvailable: (plan) => PlanActionsController.canRefine(plan).allowed,
    },
    {
      id: "createIssue",
      label: "Create Issue…",
      variant: "default",
      // Needs somewhere to run `gh`: the plan's repos, or the project's.
      isAvailable: () => true,
    },
    { id: "copyId", label: "Copy Plan ID", variant: "default", isAvailable: () => true },
    {
      id: "copyPath",
      label: "Copy Folder Path",
      variant: "default",
      isAvailable: (plan) => Boolean(plan.folderPath),
    },
    {
      id: "openFolder",
      label: "Open Folder",
      variant: "default",
      isAvailable: (plan) => Boolean(plan.folderPath),
    },
    {
      id: "delete",
      label: "Delete Plan…",
      variant: "destructive",
      isAvailable: (plan) => PlanActionsController.canDelete(plan).allowed,
    },
  ];
}
