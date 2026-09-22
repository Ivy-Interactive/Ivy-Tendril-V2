import { PlanActionsController } from "./planActions";
import { i18n } from "../i18n";
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

/** Translates into the language current at each call, so it is safe at module level. */
const t = i18n.getFixedT(null, "plans");

/**
 * The labels are translated when the set is built, which is on every render of the page that shows
 * them, so they follow a language change. `id` is what the page switches on, never `label`.
 */
export function draftActions(): DraftAction[] {
  return [
    {
      id: "execute",
      label: t("draftActions.execute"),
      variant: "primary",
      isAvailable: (plan) => PlanActionsController.canExecute(plan).allowed,
    },
    {
      id: "update",
      label: t("draftActions.update"),
      variant: "default",
      isAvailable: (plan) => PlanActionsController.canRefine(plan).allowed,
    },
    {
      id: "expand",
      label: t("draftActions.expand"),
      variant: "default",
      isAvailable: (plan) => PlanActionsController.canRefine(plan).allowed,
    },
    {
      id: "split",
      label: t("draftActions.split"),
      variant: "default",
      isAvailable: (plan) => PlanActionsController.canRefine(plan).allowed,
    },
    {
      id: "createIssue",
      label: t("draftActions.createIssue"),
      variant: "default",
      // Needs somewhere to run `gh`: the plan's repos, or the project's.
      isAvailable: () => true,
    },
    { id: "copyId", label: t("draftActions.copyId"), variant: "default", isAvailable: () => true },
    {
      id: "copyPath",
      label: t("draftActions.copyPath"),
      variant: "default",
      isAvailable: (plan) => Boolean(plan.folderPath),
    },
    {
      id: "openFolder",
      label: t("draftActions.openFolder"),
      variant: "default",
      isAvailable: (plan) => Boolean(plan.folderPath),
    },
    {
      id: "delete",
      label: t("draftActions.delete"),
      variant: "destructive",
      isAvailable: (plan) => PlanActionsController.canDelete(plan).allowed,
    },
  ];
}
