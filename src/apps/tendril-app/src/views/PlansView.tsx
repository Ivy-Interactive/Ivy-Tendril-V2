import React, { useState, useMemo, useRef, useEffect } from "react";
import { Plus, SearchX } from "lucide-react";
import {
  BadgeSelect,
  getPlatformShortcut,
  useFocusManagement,
  useFocusable,
  useShortcut,
  type BadgeSelectOption,
} from "@ivy-interactive/components/tendril";
import type { PlanSummary, PlanVerification, VerificationStatus } from "../types/api";
import { EmptyState } from "../components/EmptyState";

const PLANS_FOCUS_GROUP = "plans-list";

/**
 * The New Plan shortcut, bound and labelled as V1 binds and labels it
 * (`NewPlanButton.ShortcutKey("CTRL+ALT+N")` / `NewPlanButton.GetTooltip`). `Ctrl` maps to
 * Command on macOS in both frameworks, so the one string covers both platforms.
 */
const NEW_PLAN_SHORTCUT = "Ctrl+Alt+N";

interface PlansViewProps {
  plans: PlanSummary[];
  onSelectPlan: (planId: string) => void;
  onNewPlan?: () => void;
}

/**
 * The lifecycle states, in `PlanStatus` declaration order (V1
 * `src/Ivy.Tendril/Models/PlanModels.cs`). The filter reads as the lifecycle it
 * describes rather than as an arbitrary list.
 */
const LIFECYCLE_OPTIONS: BadgeSelectOption[] = [
  { value: "Draft", label: "Draft" },
  { value: "Creating", label: "Creating" },
  { value: "Updating", label: "Updating" },
  { value: "Executing", label: "Executing" },
  { value: "Completed", label: "Completed" },
  { value: "Failed", label: "Failed" },
  { value: "Review", label: "Review" },
  { value: "Skipped", label: "Skipped" },
  { value: "Icebox", label: "Icebox" },
  { value: "Blocked", label: "Blocked" },
];

/**
 * The V1 state names that were renamed, mapped to what they were renamed to.
 *
 * `Building` became `Creating` and `ReadyForReview` became `Review`. A `plan.yaml` written before the
 * rename still carries the old spelling, and nothing rewrites one on read, so every read point has to
 * accept both or a legacy plan arrives as a state this UI knows nothing about: no badge colour, absent
 * from the state filter, and — worse — not `"Review"`, so the Review-only actions never appear on a
 * plan that is sitting in review.
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
 * Whether a key event belongs to something being typed into rather than to the list.
 *
 * Checked on the event target and on the focused element both: a listener bound to `window` sees the
 * target only when the event was dispatched on the field itself.
 */
const isTextEntry = (target: EventTarget | null): boolean => {
  const candidates = [target, typeof document === "undefined" ? null : document.activeElement];
  for (const candidate of candidates) {
    if (!candidate || !(candidate instanceof HTMLElement)) continue;
    const tag = candidate.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || candidate.isContentEditable) {
      return true;
    }
  }
  return false;
};

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
 * Verification status to dot colour, from `Constants.VerificationStatusBadgeVariants`
 * (V1 `src/Ivy.Tendril/Constants.cs`): Pass is Success, Fail is Destructive, and both
 * Pending and Skipped are Outline. Pending is not a warning - a verification that has
 * not run yet is news about nothing.
 */
const VERIFICATION_DOT_CLASS: Record<VerificationStatus, string> = {
  Pass: "bg-success",
  Fail: "bg-destructive",
  Pending: "bg-muted-foreground/50",
  Skipped: "bg-muted-foreground/50",
};

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
 * One plan row. Registering with the focus group by index is what lets the arrow keys move real DOM
 * focus rather than only the highlight — the row is already `tabIndex={0}` with focus-visible styling.
 */
const PlanRow: React.FC<{
  index: number;
  highlighted: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}> = ({ index, highlighted, onSelect, children }) => {
  const { ref } = useFocusable(PLANS_FOCUS_GROUP, index);
  return (
    <div
      ref={ref}
      role="listitem"
      tabIndex={0}
      onClick={onSelect}
      className={`cursor-pointer rounded-xl border p-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        highlighted
          ? "border-primary bg-card shadow-md ring-1 ring-primary"
          : "border-border bg-card/60 hover:border-primary hover:bg-card"
      }`}
    >
      {children}
    </div>
  );
};

/** The badges a row carries, in `PlansApp.BuildRowBadges` order. */
const PlanRowBadges: React.FC<{ plan: PlanSummary }> = ({ plan }) => (
  <>
    {/* Draft carries no state badge: it is where every plan starts, so saying so is not news. */}
    {normalizePlanState(plan.state) !== "Draft" && (
      <span
        className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${planStateBadgeClass(
          plan.state,
        )}`}
      >
        {normalizePlanState(plan.state)}
      </span>
    )}
    {parseProjects(plan.project).map((project) => (
      <span
        key={project}
        className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground"
      >
        {project}
      </span>
    ))}
    {plan.level && (
      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
        {plan.level}
      </span>
    )}
  </>
);

const VerificationDots: React.FC<{ verifications: PlanVerification[] }> = ({ verifications }) => (
  <div className="flex shrink-0 space-x-1">
    {verifications.map((v) => (
      <span
        key={v.name}
        title={`${v.name}: ${v.status}`}
        className={`h-2 w-2 rounded-full ${
          VERIFICATION_DOT_CLASS[v.status] ?? VERIFICATION_DOT_CLASS.Pending
        }`}
      />
    ))}
  </div>
);

export const PlansView: React.FC<PlansViewProps> = ({ plans, onSelectPlan, onNewPlan }) => {
  const [search, setSearch] = useState("");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowFocus = useFocusManagement(PLANS_FOCUS_GROUP);

  // `skipInInputs` subsumes the activeElement guard this used to need: a "/" typed into the search
  // box is a slash, not a shortcut.
  useShortcut("plans:focus-search", "/", () => searchInputRef.current?.focus(), {
    description: "Focus search bar in plans explorer",
  });

  useShortcut("plans:new-plan", NEW_PLAN_SHORTCUT, () => onNewPlan?.(), {
    description: "New Plan",
    disabled: !onNewPlan,
  });

  const filteredPlans = useMemo(() => {
    const matching = plans.filter((p) => {
      // Matched on the current name, so filtering by "Review" also finds a plan still recorded as
      // `ReadyForReview`.
      if (selectedStates.length > 0 && !selectedStates.includes(normalizePlanState(p.state))) {
        return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          p.id.toLowerCase().includes(q) ||
          p.title.toLowerCase().includes(q) ||
          p.project.toLowerCase().includes(q)
        );
      }
      return true;
    });
    // `PlansApp.Build`: `.OrderByDescending(p => p.Id)`. Newest plan first, and stable
    // regardless of the order the service happened to hand them over in.
    return matching.sort((a, b) => planIdOrder(b.id) - planIdOrder(a.id));
  }, [plans, selectedStates, search]);

  /**
   * Keep the highlight on a row that still exists.
   *
   * V1 does this in `PlanSelectionHelper.ResolveSelection`: a selection whose plan has left the list
   * falls back to whatever now occupies the same position, `Math.Min(oldIndex, count - 1)`, and to
   * the first row when there is no position to keep. Without it, filtering or deleting the last plan
   * leaves the index past the end and Enter silently does nothing.
   */
  useEffect(() => {
    setSelectedIndex((prev) => {
      if (filteredPlans.length === 0) return 0;
      return Math.min(Math.max(prev, 0), filteredPlans.length - 1);
    });
  }, [filteredPlans.length]);

  // Arrow key navigation. This stays on its own listener — it drives a selection index, not a single
  // discoverable action — but the arrows now move DOM focus alongside the highlight, so a screen
  // reader and the focus ring follow the selection instead of staying on whatever was last clicked.
  useEffect(() => {
    const handleNavigation = (e: KeyboardEvent) => {
      if (filteredPlans.length === 0) return;
      // Arrows belong to whatever is being typed into. The registry's `skipInInputs` already does
      // this for "/" above; this listener predates it and has to say so itself, otherwise the search
      // box cannot move its own caret.
      if (isTextEntry(e.target)) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        // focusIndex, not focusNext: the highlight is the source of truth here, and stepping the
        // focus walk independently drifts a row behind it on the first press.
        const next = (selectedIndex + 1) % filteredPlans.length;
        setSelectedIndex(next);
        rowFocus.focusIndex(next);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const previous = selectedIndex <= 0 ? filteredPlans.length - 1 : selectedIndex - 1;
        setSelectedIndex(previous);
        rowFocus.focusIndex(previous);
      } else if (e.key === "Enter") {
        // The text-entry guard above already excludes the search box, so Enter typed there is a
        // newline in a search string rather than a request to open the highlighted plan.
        e.preventDefault();
        const selected = filteredPlans[selectedIndex];
        if (selected) {
          onSelectPlan(selected.id);
        }
      }
    };
    window.addEventListener("keydown", handleNavigation);
    return () => window.removeEventListener("keydown", handleNavigation);
  }, [filteredPlans, selectedIndex, onSelectPlan, rowFocus]);

  const isFiltered = search.length > 0 || selectedStates.length > 0;

  return (
    <div className="space-y-6" data-testid="plans-view">
      {/* Search and Filters bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <input
            ref={searchInputRef}
            type="text"
            role="searchbox"
            aria-label="Search plans"
            placeholder="Search plans by title, ID, or project... (Press / to focus)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground/70 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center space-x-3">
          <div className="min-w-[180px]">
            <BadgeSelect
              id="state-filter"
              options={LIFECYCLE_OPTIONS}
              value={selectedStates}
              placeholder="Filter by state..."
              multiple={true}
              // BadgeSelect only emits an event it was told to emit; without this the
              // filter is decorative.
              events={["OnChange"]}
              eventHandler={(_evt: string, _id: string, args?: unknown[]) => {
                if (args && Array.isArray(args[0])) {
                  setSelectedStates(args[0] as string[]);
                }
              }}
            />
          </div>
          {onNewPlan && (
            <button
              type="button"
              onClick={onNewPlan}
              aria-label="New Plan"
              title={`New Plan (${getPlatformShortcut(NEW_PLAN_SHORTCUT)})`}
              className="flex items-center space-x-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              <Plus size={16} aria-hidden="true" />
              <span>New Plan</span>
            </button>
          )}
        </div>
      </div>

      {/* Plans List or Empty State.
          V1 keeps these two cases apart: nothing to show at all is `NoContentView`
          ("No plans" / "Plans you create will appear here", `ContentView.BuildNoSelectionView`),
          while a filter that excludes everything is the much smaller inline `NoResultsView`. */}
      {filteredPlans.length === 0 ? (
        isFiltered ? (
          <div
            role="region"
            aria-label="No results"
            className="flex items-start gap-2 p-4 text-sm text-muted-foreground"
          >
            <SearchX size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>No results. Try adjusting your filters.</span>
          </div>
        ) : (
          <EmptyState title="No plans" description="Plans you create will appear here" />
        )
      ) : (
        <div
          role="list"
          aria-label="Plans list"
          className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
        >
          {filteredPlans.map((p, idx) => {
            const isHighlighted = idx === selectedIndex;
            return (
              <PlanRow
                key={p.id}
                index={idx}
                highlighted={isHighlighted}
                onSelect={() => onSelectPlan(p.id)}
              >
                <span className="font-mono text-xs font-semibold text-muted-foreground">
                  {formatPlanId(p.id)}
                </span>

                <h3 className="mt-2 text-sm font-semibold text-foreground line-clamp-2">
                  {p.title}
                </h3>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PlanRowBadges plan={p} />
                  </div>
                  {p.verifications && p.verifications.length > 0 && (
                    <VerificationDots verifications={p.verifications} />
                  )}
                </div>
              </PlanRow>
            );
          })}
        </div>
      )}
    </div>
  );
};
