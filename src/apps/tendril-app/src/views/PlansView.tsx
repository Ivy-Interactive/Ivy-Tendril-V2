import React, { useEffect, useMemo, useRef, useState } from "react";
import { useShortcut, type ShellBadgeDto } from "@ivy-interactive/components/tendril";
import type { Job, PlanSummary } from "../types/api";
import { NoContentView } from "../components/NoContentView";
import { TendrilProcessWallpaper } from "../components/TendrilProcessWallpaper";
import { usePublishSidebarList, type ShellSidebarList } from "../state/sidebarListStore";

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
 * The V1 state names that were renamed, mapped to what they were renamed to.
 *
 * `Building` became `Creating` and `ReadyForReview` became `Review`. A `plan.yaml` written before the
 * rename still carries the old spelling, and nothing rewrites one on read, so every read point has to
 * accept both or a legacy plan arrives as a state this UI knows nothing about: no badge colour, absent
 * from the list it belongs in, and — worse — not `"Review"`, so the Review-only actions never appear
 * on a plan that is sitting in review.
 */
const LEGACY_LIFECYCLE_STATES: Record<string, string> = {
  Building: "Creating",
  ReadyForReview: "Review",
};

/**
 * A plan's state under its current name. Anything already current, or unrecognised, passes through
 * unchanged so an unknown state still renders as itself rather than disappearing.
 */
export const normalizePlanState = (state: string | undefined): string =>
  state ? (LEGACY_LIFECYCLE_STATES[state] ?? state) : "";

/**
 * Plan state to badge classes, mirroring `Constants.PlanStatusBadgeVariants` in V1
 * (`src/Ivy.Tendril/Constants.cs`): the three in-flight states are Info, Review and
 * Completed are Success, Failed is Destructive, Blocked is Warning, and the three
 * resting states (Draft, Skipped, Icebox) are the neutral Outline.
 *
 * Semantic tokens only. `--primary` is Ivy green, so a state badge must never reach
 * for it: green here would read as "succeeded" on a plan that has not run.
 */
export const PLAN_STATE_BADGE_CLASS: Record<string, string> = {
  Creating: "border-info/40 bg-info/10 text-info",
  Updating: "border-info/40 bg-info/10 text-info",
  Executing: "border-info/40 bg-info/10 text-info",
  Review: "border-success/40 bg-success/10 text-success",
  Completed: "border-success/40 bg-success/10 text-success",
  Failed: "border-destructive/40 bg-destructive/10 text-destructive",
  Blocked: "border-warning/40 bg-warning/10 text-warning",
  Draft: "border-border bg-transparent text-muted-foreground",
  Skipped: "border-border bg-transparent text-muted-foreground",
  Icebox: "border-border bg-transparent text-muted-foreground",
};

export const planStateBadgeClass = (state: string): string =>
  PLAN_STATE_BADGE_CLASS[normalizePlanState(state)] ??
  "border-border bg-transparent text-muted-foreground";

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

/** The plan id as a number, for ordering. Non-numeric ids sort last. */
const planIdOrder = (id: string): number => {
  const parsed = Number.parseInt(id, 10);
  return Number.isNaN(parsed) ? -1 : parsed;
};

/**
 * The states this page's list holds, from `PlansApp.Build`:
 * `.Where(p => p.Status is PlanStatus.Draft or PlanStatus.Blocked)`. A blocked plan is a draft
 * waiting on a dependency, which is why V1 triages it here and not on the Review page.
 */
const PLANS_LIST_STATES = ["Draft", "Blocked"];

/**
 * The states V1's **Review** app owns, from `ReviewApp.Build`:
 * `.Where(p => p.Status is PlanStatus.Review or PlanStatus.Failed)`. A failed execution needs the
 * same decision a passing one does, so V1 triages both on that page.
 *
 * `AppShell/Dialogs/PlanSearchDialog.ResolveTarget` states the same partition from the other side,
 * and it is the authority for which surfaces a plan gets:
 *
 * ```csharp
 * PlanStatus.Draft or PlanStatus.Blocked => (typeof(PlansApp),  new PlansAppArgs(plan.FolderName)),
 * PlanStatus.Review or PlanStatus.Failed => (typeof(ReviewApp), new ReviewAppArgs(plan.FolderName)),
 * PlanStatus.Icebox                      => (typeof(IceboxApp), null),
 * _                                      => null
 * ```
 *
 * Lives here rather than in `ReviewView` because the plan page reads it too, and importing it from
 * there would pull that whole view (and its dialogs) into the plan page's chunk.
 */
export const REVIEW_QUEUE_STATES = ["Review", "Failed"] as const;

/** Whether a plan belongs to V1's Review app, under {@link normalizePlanState}'s current name. */
export const isReviewState = (state: string | undefined): boolean =>
  (REVIEW_QUEUE_STATES as readonly string[]).includes(normalizePlanState(state));

/**
 * `PlansApp.Build`'s `activePlanFolders`/`activeCreatePlanIds`: a job in one of these still holds
 * the plan, so V1 drops it from the list rather than offering a second write on top of the agent's.
 */
const JOB_HOLDS_PLAN: ReadonlyArray<Job["status"]> = ["Running", "Queued", "Pending", "Blocked"];

/**
 * The list this page publishes, exactly as `PlansApp.Build` assembles it: Draft or Blocked, minus
 * the plans a job is still working on, newest first (`.OrderByDescending(p => p.Id)`).
 *
 * `jobs` absent means the caller has no job list to consult, in which case the state filter is all
 * there is - the same tolerance `ReviewView.queueFor` documents.
 */
export const draftQueueFor = (plans: PlanSummary[], jobs?: Job[]): PlanSummary[] => {
  const held = new Set(
    (jobs ?? [])
      .filter((job) => JOB_HOLDS_PLAN.includes(job.status))
      .map((job) => job.planId)
      .filter((id): id is string => !!id),
  );

  return plans
    .filter((p) => PLANS_LIST_STATES.includes(normalizePlanState(p.state)) && !held.has(p.id))
    .sort((a, b) => planIdOrder(b.id) - planIdOrder(a.id));
};

/**
 * Whether `plan` is the plan `id` names.
 *
 * `PlanSelectionHelper.ResolveSelection` accepts three spellings of the same plan, because the id
 * reaches it from three places: `p.FolderName.Equals(saved)`, `p.Id.ToString() == saved` and
 * `p.FolderName.StartsWith(saved + "-")` — an app's args carry `00021-SomePlan`, a row carries the
 * folder and a link carries the bare number. The numeric comparison here covers all three, since
 * `parseInt` reads the leading id off a folder name.
 */
const isPlanId = (plan: PlanSummary, id: string): boolean => {
  if (plan.id.toLowerCase() === id.toLowerCase()) return true;
  const left = Number.parseInt(plan.id, 10);
  const right = Number.parseInt(id, 10);
  return !Number.isNaN(left) && !Number.isNaN(right) && left === right;
};

/**
 * Which plan an app opens on, ported from V1's `Helpers/PlanSelectionHelper.cs`.
 *
 * V1 calls this on **every** `Build()` of both `PlansApp` and `ReviewApp` — it is not a mount-time
 * seed — and its three branches are, in order:
 *
 * 1. the saved plan, if it is still in the list
 *    (`currentPlans.FirstOrDefault(p => p.FolderName.Equals(selected.FolderName) || p.Id == selected.Id)`);
 * 2. failing that, whatever now sits at the **same index** it used to
 *    (`var newIndex = oldIndex >= 0 ? Math.Min(oldIndex, currentPlans.Count - 1) : 0`), so clearing a
 *    queue works down it instead of bouncing back to the top after every decision;
 * 3. and with nothing saved at all, the first plan:
 *    `if (currentSelected == null && currentPlans.Count > 0 && ...) return (currentPlans[0], ...)`.
 *
 * Both callers order the list `.OrderByDescending(p => p.Id)`, so "the first plan" is the **highest
 * id**: the latest plan, not the most recently touched one. An empty list selects nothing, which is
 * what puts V1 on its `NoContentView`.
 *
 * @param plans the app's own filtered, newest-first list.
 * @param savedId the plan the app already had selected, or the one its args named.
 * @param previousPlans the list as it was on the previous build, for branch 2.
 */
export const resolvePlanSelection = (
  plans: PlanSummary[],
  savedId: string | null | undefined,
  previousPlans: readonly PlanSummary[] = [],
): PlanSummary | null => {
  if (plans.length === 0) return null;
  if (!savedId) return plans[0];

  const match = plans.find((plan) => isPlanId(plan, savedId));
  if (match) return match;

  const oldIndex = previousPlans.findIndex((plan) => isPlanId(plan, savedId));
  return plans[oldIndex >= 0 ? Math.min(oldIndex, plans.length - 1) : 0];
};

/**
 * The badges a row carries, in `PlansApp.BuildRowBadges` order: the state unless it is Draft (where
 * every plan starts, so saying so is not news), then one badge per project, then the level.
 */
export const planRowBadges = (plan: PlanSummary): ShellBadgeDto[] => {
  const badges: ShellBadgeDto[] = [];
  const state = normalizePlanState(plan.state);
  if (state !== "Draft") badges.push({ label: state, kind: "warning" });
  for (const project of parseProjects(plan.project)) {
    badges.push({ label: project, kind: "project" });
  }
  if (plan.level) badges.push({ label: plan.level, kind: "neutral" });
  return badges;
};

/**
 * `PlansApp.BuildSidebarList`, field for field: `new ShellSidebarListState("plans", "Plans", items,
 * selected?.FolderName, planId => new PlansAppArgs(planId))`.
 *
 * Nothing else is set, which is a decision rather than an omission: the list keeps the default
 * `Searchable` with no `OnSearch` (so the shell's search icon opens the plan search dialog) and no
 * `OnNew` (New Plan is the shell's own button, above the nav).
 */
export const buildPlansSidebarList = (
  plans: PlanSummary[],
  selectedId: string | null,
  select: (planId: string) => void,
): ShellSidebarList => ({
  appId: "plans",
  title: "Plans",
  items: plans.map((plan) => ({
    id: plan.id,
    title: plan.title,
    tag: formatPlanId(plan.id),
    badges: planRowBadges(plan),
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
  const selectedId = selectedPlanId ?? openedPlanId;

  useShortcut("plans:new-plan", NEW_PLAN_SHORTCUT, () => onNewPlan?.(), {
    description: "New Plan",
    disabled: !onNewPlan,
  });

  const listPlans = useMemo(() => draftQueueFor(plans, jobs), [plans, jobs]);

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
  const defaultSelection = resolvePlanSelection(listPlans, selectedId);
  const autoOpenedId = useRef<string | null>(null);

  useEffect(() => {
    const target = defaultSelection?.id;
    if (!target || autoOpenedId.current === target) return;
    autoOpenedId.current = target;
    setOpenedPlanId(target);
    onSelectPlan(target);
  }, [defaultSelection?.id, onSelectPlan]);

  const sidebarList = useMemo(
    () =>
      buildPlansSidebarList(listPlans, selectedId, (planId) => {
        setOpenedPlanId(planId);
        onSelectPlan(planId);
      }),
    [listPlans, selectedId, onSelectPlan],
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
            title="No plans"
            description="Plans you create will appear here"
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
          Select a plan from the sidebar
        </div>
      )}
    </div>
  );
};
