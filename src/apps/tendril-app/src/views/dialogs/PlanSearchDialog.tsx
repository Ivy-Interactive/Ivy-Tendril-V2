import * as React from "react";
import { type ShellBadgeDto, type ShellSectionItemDto } from "@ivy-interactive/components/tendril";
import {
  PlanSearchDialog as PlanSearchDialogView,
  MAX_PLAN_SEARCH_RESULTS,
  PLAN_SEARCH_DEBOUNCE_MS,
} from "@ivy-interactive/components/dialogs";
import { bridge } from "../../api/bridge";
import { describeBridgeError, type PlanSummary } from "../../types/api";
import { formatPlanId, normalizePlanState, parseProjects, planRowBadges } from "../PlansView";
import { useLevelColors } from "../../components/LevelBadge";
import type { LevelColors } from "../../utils/levelColor";
import { i18n, useTranslation } from "../../i18n";
import { planStateLabel } from "../../i18n/enumLabels";

/**
 * `ReviewApp.BuildRowBadges`' verification rule, which the Review arm below shares with
 * `ReviewView`: Verified only once every gate has run and none of them failed
 * (`Verifications.Count > 0 && All(Pass or Skipped)`); a plan with no gates at all is Unverified.
 */
const isVerified = (plan: PlanSummary): boolean =>
  plan.verifications.length > 0 &&
  plan.verifications.every((v) => v.status === "Pass" || v.status === "Skipped");

/**
 * V1 `PlanSearchDialog.BuildRowBadges`: a result carries the badges its owning sidebar list would
 * give it, so a plan looks the same here and there, and a status no list owns falls back to a plain
 * status badge. The four arms are V1's, with V1's badge kinds:
 *
 * - Draft/Blocked delegate to `PlansApp.BuildRowBadges`, which is {@link planRowBadges}.
 * - Review/Failed delegate to `ReviewApp.BuildRowBadges`: projects, then Verified/Unverified. It is
 *   spelled out here rather than imported because `ReviewView` keeps its copy private; the two are
 *   the same rule and the shared half (`isVerified`) is documented as such above. V1's `Partial`
 *   badge has no arm because `PlanSummary` carries no `partialDelivery` - the review page reads it
 *   from the plan detail, which a search result is not.
 * - Completed is a success badge, which is how V1 marks the one terminal state that went well.
 * - Everything else - `Creating`, `Updating`, `Executing`, `Skipped`, `Icebox` - is the neutral
 *   status badge. **These, with Completed, are the whole reason this dialog exists**: no sidebar
 *   list holds them, so the result row is the only place they are ever drawn.
 *
 * V1 passes the raw `plan.Project` to one `ShellBadgeDto.Project` in three of the four arms; V2
 * parses the comma-separated field in all of them (`ProjectHelper.ParseProjects`, which V1 itself
 * applies in the Draft arm), so a two-project plan reads the same in every arm.
 *
 * Labels are translated when the badges are built; the arms still switch on the raw state.
 */
export const planSearchRowBadges = (
  plan: PlanSummary,
  levelColors?: LevelColors,
): ShellBadgeDto[] => {
  const state = normalizePlanState(plan.state);
  if (state === "Draft" || state === "Blocked") return planRowBadges(plan, levelColors);

  const badges: ShellBadgeDto[] = parseProjects(plan.project).map((project) => ({
    label: project,
    kind: "project",
  }));

  if (state === "Review" || state === "Failed") {
    badges.push(
      isVerified(plan)
        ? { label: i18n.t("plans:searchBadges.verified"), kind: "success" }
        : { label: i18n.t("plans:searchBadges.unverified"), kind: "warning" },
    );
    // V1's Review arm shows the state through the row glyph; V2's review list adds it as a badge so
    // a failed execution and a clean one do not read identically. Same here.
    if (state !== "Review") badges.push({ label: planStateLabel(state), kind: "warning" });
    return badges;
  }

  badges.push({
    label: planStateLabel(state),
    kind: state === "Completed" ? "success" : "neutral",
  });
  return badges;
};

/** V1 builds a result row exactly as the sidebar lists build theirs: title, `#{Id}` tag, badges. */
export const planSearchRow = (
  plan: PlanSummary,
  levelColors?: LevelColors,
): ShellSectionItemDto => ({
  id: plan.id,
  title: plan.title,
  tag: formatPlanId(plan.id),
  badges: planSearchRowBadges(plan, levelColors),
});

export { MAX_PLAN_SEARCH_RESULTS, PLAN_SEARCH_DEBOUNCE_MS };

export interface PlanSearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPlan: (planId: string) => void;
  /** The search. Defaults to `bridge.listPlans({ q })` over the daemon's `PlanSearch` FTS5 index. */
  search?: (query: string) => Promise<PlanSummary[]>;
}

/**
 * The connected half of `PlanSearchDialog`.
 *
 * The dialog renders rows; turning plans into rows is this side's job, because it needs the Plans
 * list's badge builders and the configured level colours, neither of which the library can reach.
 * Draft and Blocked results carry the Plans list's level badge, so the dialog needs the same
 * colours the sidebar row it is imitating uses.
 *
 * No `status` filter is sent, deliberately: inheriting one would leave exactly the plans this
 * dialog exists for unreachable.
 */
export function PlanSearchDialog({ isOpen, onClose, onSelectPlan, search }: PlanSearchDialogProps) {
  const levelColors = useLevelColors();
  // The rows' badge labels are translated as they are built, so the search re-runs its rows when the
  // language - and with it `t` - changes.
  const { t } = useTranslation("plans");

  const fetchPlans = React.useMemo(
    () => search ?? ((text: string) => bridge.listPlans({ q: text })),
    [search],
  );

  const searchRows = React.useCallback(
    async (query: string): Promise<ShellSectionItemDto[]> => {
      const plans = await fetchPlans(query);
      return plans.map((plan) => planSearchRow(plan, levelColors));
    },
    [fetchPlans, levelColors, t],
  );

  return (
    <PlanSearchDialogView
      isOpen={isOpen}
      onClose={onClose}
      onSelectPlan={onSelectPlan}
      search={searchRows}
      describeError={describeBridgeError}
    />
  );
}
