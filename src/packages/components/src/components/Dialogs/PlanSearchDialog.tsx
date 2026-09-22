import * as React from "react";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Input } from "../ui/input";
import { ShellSidebarSection } from "../Shell";
import { useTranslation } from "@/i18n/uiDialogs";
import type { ShellSectionItemDto } from "../Shell";
import { DialogShell } from "./DialogShell";

/**
 * Fallback error text.
 *
 * Module scope, not a default parameter: a default arrow is a new function on every render, and
 * this one sits in the debounce effect's dep array - so a consumer that omits `describeError`
 * would tear the effect down and re-arm the timer on every render, and a parent re-rendering
 * faster than the debounce would never issue a search at all.
 */
const describeErrorFallback = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** V1 `PlanSearchDialog.MaxResults`. */
export const MAX_PLAN_SEARCH_RESULTS = 15;

/**
 * How long the box sits still before the query goes out. V2 only: V1 searches the SQLite handle it
 * already holds, synchronously inside `Build()`, so it needs no debounce at all.
 */
export const PLAN_SEARCH_DEBOUNCE_MS = 150;

export interface PlanSearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * A picked result. The caller routes it as a navigation - the same one a sidebar row click takes -
   * rather than the dialog reaching into a view's state.
   */
  onSelectPlan: (planId: string) => void;
  /**
   * The search, returning rows ready to render.
   *
   * Rows rather than plan records, because building one needs the Plans list's badge builders and
   * the configured level colours, both of which read app state this component cannot see. The app's
   * wrapper does that mapping and hands back what the sidebar widget renders - which is also what
   * keeps a plan looking identical here and in the sidebar.
   */
  search: (query: string) => Promise<ShellSectionItemDto[]>;
  /** Turns a rejection into the message shown in place of results. */
  describeError?: (err: unknown) => string;
}

/**
 * Full-text plan search, opened from the sidebar section's search icon (and its `Cmd/Ctrl+K`).
 * Port of V1 `AppShell/Dialogs/PlanSearchDialog.cs`.
 *
 * **Why it has to exist.** The sidebar lists follow V1 and hold only a slice of the plans: Plans
 * lists Draft and Blocked, Review lists Review and Failed, Icebox lists Icebox. A `Completed`,
 * `Skipped`, `Creating`, `Updating` or `Executing` plan is in none of them, so without this dialog
 * it is reachable from nowhere in the UI. The search therefore **never sends a `status` filter**:
 * inheriting one would leave exactly the plans it exists for unreachable.
 *
 * V1's decisions kept: at most {@link MAX_PLAN_SEARCH_RESULTS} rows (V1's `.Take(15)`); rows render
 * through the very `ShellSidebarSection` the sidebar uses; an empty box shows the box alone, with
 * no rows, no message and no request; a query with nothing behind it reads "No plans found.";
 * Escape closes, the box has focus on open, and rows are buttons reached by Tab, because V1 has no
 * arrow-key palette behaviour and the section's rows are already the sidebar's keyboard contract.
 *
 * Changed, and why: debounced and asynchronous, because the query is IPC here and a synchronous DB
 * read in V1. In-flight requests are sequenced so a slow early keystroke cannot overwrite a later
 * result, and "No plans found." is withheld until a request has actually answered. A failed query
 * is reported, because V1 cannot fail (in-process SQLite) and a rejection rendered as "No plans
 * found." would read as "this plan does not exist".
 */
export function PlanSearchDialog({
  isOpen,
  onClose,
  onSelectPlan,
  search,
  describeError = describeErrorFallback,
}: PlanSearchDialogProps) {
  const { t } = useTranslation("uiDialogs");
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<ShellSectionItemDto[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  /** Whether the results on screen belong to the query in the box. Gates "No plans found.". */
  const [hasAnswer, setHasAnswer] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const requestSeq = React.useRef(0);

  // V1 rebuilds its results from a fresh `UseState("")` every time the dialog is constructed, so a
  // reopen starts empty.
  React.useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setItems([]);
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
      setItems([]);
      setIsSearching(false);
      setHasAnswer(false);
      setError(null);
      return;
    }

    setIsSearching(true);
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      search(trimmed)
        .then((rows) => {
          if (seq !== requestSeq.current) return;
          setItems(rows.slice(0, MAX_PLAN_SEARCH_RESULTS));
          setError(null);
          setHasAnswer(true);
          setIsSearching(false);
        })
        .catch((err: unknown) => {
          if (seq !== requestSeq.current) return;
          setItems([]);
          setError(describeError(err));
          setHasAnswer(true);
          setIsSearching(false);
        });
    }, PLAN_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [isOpen, trimmed, search, describeError]);

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
      title={t("planSearch.title")}
      width="px560"
      testId="plan-search-dialog"
      initialFocusRef={inputRef}
      footer={
        <Button variant="outline" onClick={onClose} data-testid="dialog-close">
          {t("actions.close")}
        </Button>
      }
    >
      {/* V1's `query.ToSearchInput().Placeholder("Search plans").Width(Size.Full())`. */}
      <Input
        ref={inputRef}
        type="search"
        aria-label={t("planSearch.inputLabel")}
        data-testid="plan-search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("planSearch.placeholder")}
      />

      {trimmed !== "" && (
        <div className="mt-2">
          {error !== null ? (
            <Callout.Error data-testid="plan-search-error">{error}</Callout.Error>
          ) : items.length > 0 ? (
            /* The sidebar's own list widget, as V1 renders results. `collapsible={false}` keeps the
               rail's narrow-chip form out of a dialog, and no title/searchable means no header and
               no second `Cmd+K` listener over the shell's. */
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
              {t("planSearch.searching")}
            </p>
          ) : (
            /* V1: `body |= Text.Muted("No plans found.")`. */
            <p className="text-sm text-muted-foreground" data-testid="plan-search-empty">
              {t("planSearch.empty")}
            </p>
          )}
        </div>
      )}
    </DialogShell>
  );
}
