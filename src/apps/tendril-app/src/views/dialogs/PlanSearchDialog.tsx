import * as React from "react";
import { Button } from "@ivy-interactive/components/ui";
import {
  ShellSidebarSection,
  type ShellBadgeDto,
  type ShellSectionItemDto,
} from "@ivy-interactive/components/tendril";
import { bridge } from "../../api/bridge";
import { describeBridgeError, type PlanSummary } from "../../types/api";
import { formatPlanId, normalizePlanState, parseProjects, planRowBadges } from "../PlansView";
import { DialogShell } from "./DialogShell";
import { ALERT_CLASS, FIELD_CLASS } from "./fieldStyles";

/** V1 `PlanSearchDialog.MaxResults`. */
export const MAX_PLAN_SEARCH_RESULTS = 15;

/**
 * How long the box sits still before the query goes out. V2 only: V1 searches the SQLite handle it
 * already holds, synchronously inside `Build()`, so it needs no debounce at all. Here every
 * keystroke would otherwise be an IPC round trip to the daemon.
 */
export const PLAN_SEARCH_DEBOUNCE_MS = 150;

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
 */
export const planSearchRowBadges = (plan: PlanSummary): ShellBadgeDto[] => {
  const state = normalizePlanState(plan.state);
  if (state === "Draft" || state === "Blocked") return planRowBadges(plan);

  const badges: ShellBadgeDto[] = parseProjects(plan.project).map((project) => ({
    label: project,
    kind: "project",
  }));

  if (state === "Review" || state === "Failed") {
    badges.push(
      isVerified(plan)
        ? { label: "Verified", kind: "success" }
        : { label: "Unverified", kind: "warning" },
    );
    // V1's Review arm shows the state through the row glyph; V2's review list adds it as a badge so
    // a failed execution and a clean one do not read identically. Same here.
    if (state !== "Review") badges.push({ label: state, kind: "warning" });
    return badges;
  }

  badges.push({ label: state, kind: state === "Completed" ? "success" : "neutral" });
  return badges;
};

/** V1 builds a result row exactly as the sidebar lists build theirs: title, `#{Id}` tag, badges. */
export const planSearchRow = (plan: PlanSummary): ShellSectionItemDto => ({
  id: plan.id,
  title: plan.title,
  tag: formatPlanId(plan.id),
  badges: planSearchRowBadges(plan),
});

export interface PlanSearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * A picked result. The caller routes it as a navigation - the same one a sidebar row click takes -
   * rather than the dialog reaching into a view's state.
   */
  onSelectPlan: (planId: string) => void;
  /**
   * The search itself. Defaults to `bridge.listPlans({ q })`, which is the daemon's
   * `GET /api/plans?q=` over the `PlanSearch` FTS5 index. Injectable for tests.
   */
  search?: (query: string) => Promise<PlanSummary[]>;
}

/**
 * Full-text plan search, opened from the sidebar section's search icon (and its `Cmd/Ctrl+K`)
 * whenever the published list supplies no `onSearch` of its own - which is every plan list. Port of
 * V1 `AppShell/Dialogs/PlanSearchDialog.cs`.
 *
 * **Why it has to exist.** The sidebar lists follow V1 and hold only a slice of the plans: Plans
 * lists Draft and Blocked, Review lists Review and Failed, Icebox lists Icebox. A `Completed`,
 * `Skipped`, `Creating`, `Updating` or `Executing` plan is in none of them, so without this dialog
 * it is reachable from nowhere in the UI. The search therefore **never sends a `status` filter**:
 * inheriting one would leave exactly the plans it exists for unreachable.
 *
 * V1's decisions kept:
 *
 * - It searches the plan database's full text, not the plan list the shell happens to be holding:
 *   `?q=` is served by `get_plans_limited`, which is the `PlanSearch` FTS5 index ranked by bm25,
 *   with a bare plan number promoted to the top slot as an exact id lookup and a `LIKE` fallback
 *   over Title/content/Id/Project/SourceUrl/InitialPrompt for the fragments FTS5 cannot match. That
 *   is `PlanDatabaseService.SearchPlans` including its sanitiser and its fallback, so the ranking
 *   and the matched columns are the backend's and are not re-decided here.
 * - At most {@link MAX_PLAN_SEARCH_RESULTS} rows (V1's `.Take(15)`), applied client side because
 *   the bridge's `PlanQuery` carries no `limit`.
 * - Rows render through the very `ShellSidebarSection` the sidebar uses, with the per-list badge
 *   builders ({@link planSearchRowBadges}), so a plan looks identical here and there.
 * - An empty box shows the box alone - no rows, no message, no request.
 * - A query with nothing behind it reads "No plans found.".
 * - Escape closes, the box has focus on open, and rows are buttons reached by Tab. No arrow-key or
 *   Enter-to-pick palette behaviour: V1 has none, and the section's rows are already the sidebar's
 *   own keyboard contract.
 *
 * Changed, and why:
 *
 * - **A pick opens the plan whatever its status.** V1's `ResolveTarget` maps the status back to the
 *   app that owns it and returns null for `Completed`, `Skipped` and the three in-flight states, so
 *   in V1 picking one of those closes the dialog and goes nowhere - the states the dialog exists for
 *   are the ones it cannot open. V2 has one plan page per plan (`plan-<id>`), so every result is
 *   navigable and the resolve step is gone.
 * - Debounced ({@link PLAN_SEARCH_DEBOUNCE_MS}) and asynchronous, because the query is IPC here and
 *   a synchronous DB read in V1. In-flight requests are sequenced so a slow early keystroke cannot
 *   overwrite a later result, and "No plans found." is withheld until a request has actually
 *   answered.
 * - A failed query is reported. V1 cannot fail (in-process SQLite); a rejected bridge call that
 *   rendered as "No plans found." would read as "this plan does not exist".
 */
export function PlanSearchDialog({ isOpen, onClose, onSelectPlan, search }: PlanSearchDialogProps) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<PlanSummary[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  /** Whether the results on screen belong to the query in the box. Gates "No plans found.". */
  const [hasAnswer, setHasAnswer] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const requestSeq = React.useRef(0);

  const runSearch = React.useMemo(
    () =>
      search ??
      // No `status`, deliberately: see the class comment. `q` alone is what reaches every state.
      ((text: string) => bridge.listPlans({ q: text })),
    [search],
  );

  // V1 rebuilds its results from a fresh `UseState("")` every time the dialog is constructed, so a
  // reopen starts empty.
  React.useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setResults([]);
    setIsSearching(false);
    setHasAnswer(false);
    setError(null);
    requestSeq.current += 1;
  }, [isOpen]);

  const trimmed = query.trim();

  React.useEffect(() => {
    if (!isOpen) return;
    // V1: `string.IsNullOrWhiteSpace(query.Value) ? [] : database.SearchPlans(...)`. An empty box
    // never queries.
    if (trimmed === "") {
      requestSeq.current += 1;
      setResults([]);
      setIsSearching(false);
      setHasAnswer(false);
      setError(null);
      return;
    }

    setIsSearching(true);
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      runSearch(trimmed)
        .then((plans) => {
          if (seq !== requestSeq.current) return;
          setResults(plans.slice(0, MAX_PLAN_SEARCH_RESULTS));
          setError(null);
          setHasAnswer(true);
          setIsSearching(false);
        })
        .catch((err: unknown) => {
          if (seq !== requestSeq.current) return;
          setResults([]);
          setError(describeBridgeError(err));
          setHasAnswer(true);
          setIsSearching(false);
        });
    }, PLAN_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [isOpen, trimmed, runSearch]);

  const items = results.map(planSearchRow);

  const handlePick = (planId: string) => {
    // V1: `dialogOpen.Set(false)` first, then the navigation.
    onClose();
    onSelectPlan(planId);
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      // V1's `new DialogHeader("Search Plans")` and `.Width(Size.Px(560))`.
      title="Search Plans"
      width="px560"
      testId="plan-search-dialog"
      initialFocusRef={inputRef}
      footer={
        <Button variant="outline" onClick={onClose} data-testid="dialog-close">
          Close
        </Button>
      }
    >
      {/* V1's `query.ToSearchInput().Placeholder("Search plans").Width(Size.Full())`. */}
      <input
        ref={inputRef}
        type="search"
        aria-label="Search plans"
        data-testid="plan-search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search plans"
        className={FIELD_CLASS}
      />

      {trimmed !== "" && (
        <div className="mt-2">
          {error !== null ? (
            <div role="alert" className={ALERT_CLASS} data-testid="plan-search-error">
              {error}
            </div>
          ) : items.length > 0 ? (
            /* The sidebar's own list widget, as V1 renders results: `.Items(items)
               .Collapsible(false).OnSelectItem(...)`. `Collapsible(false)` keeps the rail's
               narrow-chip form out of a dialog, and no `title`/`searchable` means no header and no
               second `Cmd+K` listener over the shell's. */
            <ShellSidebarSection
              id="plan-search-results"
              items={items}
              collapsible={false}
              events={["OnSelectItem"]}
              eventHandler={(evt: string, _id: string, args?: unknown[]) => {
                if (evt !== "OnSelectItem") return;
                const planId = args?.[0];
                if (typeof planId === "string" && planId.length > 0) handlePick(planId);
              }}
            />
          ) : isSearching || !hasAnswer ? (
            /* V2 only: the query is still out, so V1's "No plans found." would be premature. */
            <p className="text-sm text-muted-foreground" data-testid="plan-search-pending">
              Searching…
            </p>
          ) : (
            /* V1: `body |= Text.Muted("No plans found.")`. */
            <p className="text-sm text-muted-foreground" data-testid="plan-search-empty">
              No plans found.
            </p>
          )}
        </div>
      )}
    </DialogShell>
  );
}
