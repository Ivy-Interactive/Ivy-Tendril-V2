import React, { useEffect, useMemo, useRef, useState } from "react";
import { useShortcut, type ShellBadgeDto } from "@ivy-interactive/components/tendril";
import type { Job, PlanSummary } from "../types/api";
import { NoContentView } from "../components/NoContentView";
import { TendrilProcessWallpaper } from "../components/TendrilProcessWallpaper";
import { usePublishSidebarList, type ShellSidebarList } from "../state/sidebarListStore";
import { isPlanId, resolvePlanSelection } from "../state/plansStore";
import { draftQueueFor, normalizePlanState } from "../utils/planQueues";
import { resolveLevelColor, type LevelColors } from "../utils/levelColor";
import { useLevelColors } from "../components/LevelBadge";
import { i18n, useTranslation } from "../i18n";
import { planStateLabel } from "../i18n/enumLabels";

/**
 * Which plans this page lists, and the state-name normalisation every read point needs, both from
 * `utils/planQueues` — the shell's nav badges count the same queues and cannot import them from a view.
 * Re-exported because this module was where they lived, and much of the app still imports them here.
 */
export {
  draftQueueFor,
  isReviewState,
  normalizePlanState,
  reviewQueueFor,
  REVIEW_QUEUE_STATES,
} from "../utils/planQueues";

/**
 * `PlanSelectionHelper.ResolveSelection` and the next-item rule built on it, which moved to
 * `plansStore` for the same reason the queue helpers live in `utils/planQueues`: the shell needs both
 * and cannot import them from a `React.lazy` view without pulling it into the initial chunk. Still
 * re-exported here, because this module is where they lived and where the app imports them from.
 */
export { nextAfterRemoval, resolvePlanSelection } from "../state/plansStore";

/**
 * The New Plan shortcut, bound and labelled as V1 binds and labels it
 * (`NewPlanButton.ShortcutKey("CTRL+ALT+N")` / `NewPlanButton.GetTooltip`). `Ctrl` maps to
 * Command on macOS in both frameworks, so the one string covers both platforms.
 *
 * The button itself belongs to the shell (`ShellNewPlanButton`, above the nav, as in V1's
 * `sidebarBody`), so this page binds the key without drawing a second button for it.
 */
const NEW_PLAN_SHORTCUT = "Ctrl+Alt+N";

interface PlansViewProps {
  plans: PlanSummary[];
  /**
   * The live job list. `PlansApp.Build` reads it to keep a plan out of the list while a job still
   * holds its worktree; see [`draftQueueFor`]. Optional so a caller with no job list still gets the
   * state-filtered list rather than an empty sidebar.
   */
  jobs?: Job[];
  /**
   * The plan the shell's sidebar row should read as selected. Absent means "whatever this page last
   * opened", which is how the highlight survives until the host threads its own selection through.
   */
  selectedPlanId?: string | null;
  onSelectPlan: (planId: string) => void;
  onNewPlan?: () => void;
  /**
   * Where the empty page's process wallpaper navigates: V1's `UseTendrilProcess` wires its boxes to
   * `Navigate<PlansApp>()`, `Navigate<ReviewApp>()` and `Navigate<JobsApp>()`, so without this the
   * wallpaper's arrows are drawn and do nothing.
   */
  onNavigate?: (navId: string) => void;
}

/**
 * Plan state to the library `Badge` variant, value for value from `Constants.PlanStatusBadgeVariants`
 * (V1 `src/Ivy.Tendril/Constants.cs:32-44`): the three in-flight states are Info, Review and Completed
 * are Success, Failed is Destructive, Blocked is Warning, and the three resting states (Draft,
 * Skipped, Icebox) are the neutral Outline.
 *
 * V1's map is over `BadgeVariant` and so is this: the library `Badge` has the same variants, so the
 * port is the enum rather than a translation of it into classes. A state outside the map falls to
 * Outline, which is what V1's `GetValueOrDefault` does.
 */
export const PLAN_STATE_BADGE_VARIANT: Record<string, PlanStateBadgeVariant> = {
  Creating: "info",
  Updating: "info",
  Executing: "info",
  Review: "success",
  Completed: "success",
  Failed: "destructive",
  Blocked: "warning",
  Draft: "outline",
  Skipped: "outline",
  Icebox: "outline",
};

export type PlanStateBadgeVariant = "info" | "success" | "destructive" | "warning" | "outline";

export const planStateBadgeVariant = (state: string): PlanStateBadgeVariant =>
  PLAN_STATE_BADGE_VARIANT[normalizePlanState(state)] ?? "outline";

/**
 * `#21`, not `#00021`: V1 tags a row with `$"#{plan.Id}"` (`PlansApp.BuildSidebarList`)
 * where `Id` is the integer, so the zero padding of the folder name never reaches the UI.
 */
export const formatPlanId = (id: string): string => {
  const trimmed = id.replace(/^0+(?=\d)/, "");
  return `#${trimmed || id}`;
};

/** `ProjectHelper.ParseProjects`: a plan's project field can name several, comma separated. */
export const parseProjects = (project: string | undefined): string[] =>
  (project ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

/**
 * The badges a row carries, in `PlansApp.BuildRowBadges` order: the state unless it is Draft (where
 * every plan starts, so saying so is not news), then one badge per project, then the level.
 *
 * `levelColors` is the configured level palette (`useLevelColors`). V1's *Icebox* row is the one that
 * colours the level — `new Badge(plan.Level).Color(config.GetLevelColor(plan.Level) ?? Colors.Gray)`
 * (`Apps/Icebox/SidebarView.cs:25`) — while `PlansApp.BuildRowBadges` builds a bare
 * `new ShellBadgeDto(plan.Level)` and leaves it neutral. That split is V1 being inconsistent with
 * itself about one badge rather than two deliberate designs, so the colour is applied here too and
 * the mapping is V1's own, read from the same `levels` config rather than invented.
 *
 * Omitting `levelColors` keeps the neutral badge, which is what a caller that has not read
 * configuration (or could not) should render: a grey fallback asserted before the colours are known
 * would flash the wrong colour on every row.
 */
export const planRowBadges = (plan: PlanSummary, levelColors?: LevelColors): ShellBadgeDto[] => {
  const badges: ShellBadgeDto[] = [];
  const state = normalizePlanState(plan.state);
  // The label is the state's, translated at the call; the comparison stays on the raw value.
  if (state !== "Draft") badges.push({ label: planStateLabel(state), kind: "warning" });
  for (const project of parseProjects(plan.project)) {
    badges.push({ label: project, kind: "project" });
  }
  if (plan.level) {
    const color = resolveLevelColor(plan.level, levelColors);
    badges.push(
      color ? { label: plan.level, kind: "color", color } : { label: plan.level, kind: "neutral" },
    );
  }
  return badges;
};

/**
 * `PlansApp.BuildSidebarList`, field for field: `new ShellSidebarListState("plans", "Plans", items,
 * selected?.FolderName, planId => new PlansAppArgs(planId))`.
 *
 * The title and the state badges are translated when the list is built, so a caller that memoizes
 * the list keys it on the language too.
 *
 * Nothing else is set, which is a decision rather than an omission: the list keeps the default
 * `Searchable` with no `OnSearch` (so the shell's search icon opens the plan search dialog) and no
 * `OnNew` (New Plan is the shell's own button, above the nav).
 */
export const buildPlansSidebarList = (
  plans: PlanSummary[],
  selectedId: string | null,
  select: (planId: string) => void,
  levelColors?: LevelColors,
): ShellSidebarList => ({
  appId: "plans",
  title: i18n.t("plans:sidebar.title"),
  items: plans.map((plan) => ({
    id: plan.id,
    title: plan.title,
    tag: formatPlanId(plan.id),
    badges: planRowBadges(plan, levelColors),
  })),
  selectedId,
  buildSelectArgs: (planId) => {
    /* V1's shell turns a row click into `OpenApp(new NavigateArgs("plans", BuildSelectArgs(id)))`
       and the plans app reads `PlansAppArgs.PlanId` back out of its args. V2 has no arg-carrying
       navigation yet, so the selection is applied here as well; the returned object is still V1's
       `PlansAppArgs(planId)` so this drops out once the shell can hand args to a view. */
    select(planId);
    return { planId };
  },
});

/**
 * The Plans page.
 *
 * `PlansApp.Build` renders **no list of its own**: it publishes one into the shell sidebar on every
 * build (`sidebarListSignal.Send(BuildSidebarList(plans, selected))`) and returns a `ContentView`
 * that shows the selected plan. So does this: the content area is the selection, and the list the
 * page used to draw as a card grid now lives where V1 puts it.
 *
 * Selecting a row opens the plan, which in V2 is the host's `plan-<id>` page (`PlanDetailView`) -
 * V1's `PlansAppArgs(planId)` reaching `ContentView` by another route.
 */
export const PlansView: React.FC<PlansViewProps> = ({
  plans,
  jobs,
  selectedPlanId = null,
  onSelectPlan,
  onNewPlan,
  onNavigate,
}) => {
  /**
   * The row the sidebar reads as selected. Seeded from the host and then whatever this page last
   * opened, because `selectedId` drives both the highlighted row and the page tab's title
   * (`TendrilAppShell.PageTabTitle`).
   */
  const [openedPlanId, setOpenedPlanId] = useState<string | null>(selectedPlanId);
  const { t } = useTranslation("plans");

  useShortcut("plans:new-plan", NEW_PLAN_SHORTCUT, () => onNewPlan?.(), {
    description: t("plansView.newPlanShortcut"),
    disabled: !onNewPlan,
  });

  const listPlans = useMemo(() => draftQueueFor(plans, jobs), [plans, jobs]);

  /**
   * Which of the two ids `ResolveSelection` is handed as its "saved" plan: the address while it names
   * a plan still in the queue, and otherwise the plan this page last opened.
   *
   * The two disagree in exactly one case — the address still naming a plan that has just left the
   * queue — and there the order is the whole difference. V1 has no such case: its `selected` is the
   * app's own state, re-recorded from each resolution, and `PlansAppArgs.PlanId` only ever seeds it.
   * Letting the prop outrank that state instead re-asks "where does the departed plan send us?" on
   * every later render, and the answer does not keep: branch 2 needs the queue that plan was still
   * in, which one render later is no longer what `previousQueue` holds. The selection falls through
   * to `plans[0]`, so an operator who cleared a plan is advanced one step down the queue and then, a
   * render later, thrown back to the top of it.
   */
  const addressIsLive =
    selectedPlanId !== null && listPlans.some((plan) => isPlanId(plan, selectedPlanId));
  const selectedId = addressIsLive ? selectedPlanId : (openedPlanId ?? selectedPlanId);

  /**
   * The queue as it was on the previous render, which is the argument `resolvePlanSelection`'s
   * keep-the-index branch cannot work without — and which this page used to omit, leaving the branch
   * unreachable and every plan that left the queue bouncing the selection back to the newest one.
   *
   * V1 needs no such ref because `PlansApp.Build` holds the previous list in the app's own state and
   * passes it straight in; a function component has to carry it across renders itself. The ref is
   * updated in an effect rather than during render so that the render which first sees a shortened
   * list still reads the longer one, which is the whole point of the comparison.
   */
  const previousQueue = useRef<PlanSummary[]>(listPlans);

  /**
   * The plan this page opens on, which V1 opens **without being asked**: `PlansApp.Build` runs
   * `PlanSelectionHelper.ResolveSelection` on every build and hands the result to its `ContentView`,
   * so arriving on the page with nothing saved lands on `plans[0]` — the newest Draft/Blocked plan —
   * rather than on an empty pane.
   *
   * V2 renders the plan under its own `plan-<id>` page instead of inside this one, so "select it" is
   * the same navigation a sidebar row performs. The ref keeps that to once per resolved plan:
   * `onSelectPlan` is a fresh closure on every host render, and re-running it would push a duplicate
   * history entry each time.
   */
  const defaultSelection = resolvePlanSelection(listPlans, selectedId, previousQueue.current);
  const autoOpenedId = useRef<string | null>(null);

  /*
   * The previous queue is only advanced once the *host* has accepted the resolution, not on every
   * render that produced one.
   *
   * `onSelectPlan` is a navigation, so the host applies it a render later: until it does, this page
   * re-renders with the shortened list and the departed plan still named as `selectedId`. Advancing
   * the ref on the first of those renders threw away the only list the departed plan's index could
   * be read from, so the second render found it in neither list and took `ResolveSelection`'s third
   * branch — back to `plans[0]`, the newest plan, which is exactly the bounce keep-the-index exists
   * to prevent. Holding the ref until `selectedId` names a plan that is actually in the list keeps
   * V1's own invariant: `PlansApp.Build` re-resolves against the list it last *built* from, and it
   * only ever builds from a list its selection belongs to.
   */
  useEffect(() => {
    if (selectedId && !listPlans.some((plan) => isPlanId(plan, selectedId))) return;
    previousQueue.current = listPlans;
  }, [listPlans, selectedId]);

  useEffect(() => {
    const target = defaultSelection?.id;
    if (!target || autoOpenedId.current === target) return;
    autoOpenedId.current = target;
    setOpenedPlanId(target);
    onSelectPlan(target);
  }, [defaultSelection?.id, onSelectPlan]);

  /* The level badges' colours, read from `config.yaml`'s `levels` the way V1's rows read them off
     `IConfigService`. Undefined until the read lands, which renders the neutral badge rather than a
     grey one — see `planRowBadges`. */
  const levelColors = useLevelColors();

  // `t` is a dependency only for its identity: it changes with the language, and the list's title and
  // badges are translated inside the builder.
  const sidebarList = useMemo(
    () =>
      buildPlansSidebarList(
        listPlans,
        selectedId,
        (planId) => {
          setOpenedPlanId(planId);
          onSelectPlan(planId);
        },
        levelColors,
      ),
    [listPlans, selectedId, onSelectPlan, levelColors, t],
  );

  /* Published on every render, which `ShellSidebarListSignal`'s own doc comment says the shell
     tolerates by design ("The active app publishes this on every build"). */
  usePublishSidebarList(sidebarList);

  return (
    <div className="h-full" data-testid="plans-view">
      {/* `ContentView.BuildNoSelectionView`, which V1 keeps as two separate cases: an empty list is
          `NoContentView("No plans", "Plans you create will appear here")`, and a list with nothing
          selected is the one muted line pointing at the sidebar. The second is unreachable in a
          running app now that a non-empty list always resolves a selection — it is unreachable in V1
          for the same reason, and kept here for the same reason: it is what a list with a selection
          the host has not applied yet shows. */}
      {listPlans.length === 0 ? (
        /* Plans is a full-bleed app (V1's `.RemoveParentPadding()` on the workspace), so the shell
           gives this page no padding and the empty state has to inset itself. V1 reaches
           `NoContentView` *before* the workspace branch, so the empty case keeps the host's 16px and
           `Height(Size.Full())` centres it. */
        <div className="flex h-full min-h-0 items-center justify-center p-4">
          {/* The `cta` is V1's `processView`, i.e. `Context.UseTendrilProcess()`: the pipeline
              wallpaper, with New Plan opening the Create Plan dialog straight from it. */}
          <NoContentView
            data-testid="plans-empty"
            title={t("plansView.empty.title")}
            description={t("plansView.empty.description")}
            cta={
              <TendrilProcessWallpaper
                plans={plans}
                jobs={jobs}
                onNewPlan={onNewPlan}
                onNavigate={onNavigate}
              />
            }
          />
        </div>
      ) : (
        <div
          data-testid="plans-no-selection"
          className="flex h-full items-center justify-center text-sm text-muted-foreground"
        >
          {t("plansView.noSelection")}
        </div>
      )}
    </div>
  );
};
