import * as React from "react";
import { CircleHelp, Filter, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { densityToIconButtonSize } from "@/components/ui/density-scale";
import { Densities } from "@/types/density";

import {
  filterExpressionColumns,
  filterExpressionExamples,
  filterExpressionPlaceholder,
  parseFilterExpression,
} from "./filter-expression";
import type { RemoteTableFilter } from "./remote-query";
import type { DataTableColumn } from "./types";

export interface DataTableFilterExpressionProps<TRow> {
  columns: readonly DataTableColumn<TRow>[];
  /** The committed expression. Local edits live in the input until Enter. */
  value: string;
  /** Called with the committed text and the filter it parsed to. Never called for invalid text. */
  onCommit: (text: string, filter: RemoteTableFilter | null) => void;
  density?: Densities;
  className?: string;
}

/**
 * The table's one filter control, at the top-left of the toolbar.
 *
 * This is the framework's affordance and its placement: `DataTableWidget.tsx` renders the filter
 * `DataTableOption` as the **first child of the header's left group**, as an icon button that expands
 * *inline to the right* into an expression editor with a `Clear` button on its right edge
 * (`options/DataTableFilterOption.tsx`). Commit is on **Enter** and nowhere else — not per keystroke,
 * not on blur — because with a server-side filter the difference is one request per intent instead of
 * one per character.
 *
 * Three deliberate differences from the framework's editor, all of them about the editor and none about
 * the filter:
 *
 * - **A plain input, not CodeMirror.** Theirs is a CodeMirror language mode over a generated ANTLR
 *   parser; the parity contract's rule is to reuse what exists rather than import a grammar, so the
 *   grammar is hand-written (`filter-expression.ts`) and the input is the design system's own.
 * - **The vocabulary is discoverable rather than autocompleted.** A help popover lists the filterable
 *   columns and, for a column whose values are a closed set, those values — which is what their
 *   autocomplete offers, minus the inline completion.
 * - **A parse failure keeps the text and says why.** Theirs falls back to an LLM when
 *   `allowLlmFiltering` is set; here an unreadable expression is not committed and the reason appears
 *   beside the box, so the typo can be fixed in place.
 *
 * Expanded whenever a filter is applied, which is not cosmetic: a collapsed control that is silently
 * narrowing the table is how a user comes to believe rows are missing.
 */
function DataTableFilterExpressionInner<TRow>(
  { columns, value, onCommit, density, className }: DataTableFilterExpressionProps<TRow>,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const [draft, setDraft] = React.useState(value);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(value.length > 0);

  /* An expression cleared or restored from outside has to reach the box. Keyed on the committed value
     rather than done in an effect, so a keystroke racing a re-render is not overwritten by the value it
     has not committed yet. */
  const lastValue = React.useRef(value);
  if (lastValue.current !== value) {
    lastValue.current = value;
    if (draft !== value) setDraft(value);
    if (value.length > 0 && !expanded) setExpanded(true);
    if (error) setError(null);
  }

  const filterable = filterExpressionColumns(columns);
  const iconButtonSize = densityToIconButtonSize(density ?? Densities.Medium);
  const active = value.length > 0;

  const commit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setError(null);
      if (value.length > 0) onCommit("", null);
      return;
    }
    const parsed = parseFilterExpression(columns, trimmed);
    if (parsed.error) {
      // Not committed: a table narrowed by an expression nobody could read is worse than an unapplied
      // one, and the text has to survive so the mistake can be corrected rather than retyped.
      setError(parsed.error);
      return;
    }
    setError(null);
    if (trimmed !== value) onCommit(trimmed, parsed.filter);
  };

  const clear = () => {
    setDraft("");
    setError(null);
    if (value.length > 0) onCommit("", null);
  };

  return (
    <div
      ref={ref}
      data-slot="data-table-filter"
      className={cn("flex min-w-0 flex-1 items-start gap-1", className)}
    >
      <Button
        type="button"
        variant="ghost"
        size={iconButtonSize}
        aria-label="Filter"
        title="Filter table data"
        aria-expanded={expanded}
        // The framework's own active styling for an expanded option (`DataTableOption.tsx`: `expanded ?
        // "bg-accent hover:bg-accent"`), extended to "a filter is applied" so a narrowed table says so
        // even before the box is looked at. The token is `secondary`, not the framework's `accent`:
        // `--accent` is `#f8f8f8` on a `#ffffff` toolbar and `#1a1a1a` on `#0a0a0a`, i.e. 1.062:1, so
        // the signal this comment promises did not visibly exist. `--secondary` measures 1.259:1 and
        // is the token every other selected state in this repo already uses.
        className={cn(active && "bg-secondary text-secondary-foreground hover:bg-secondary")}
        onClick={() => setExpanded((open) => !open)}
      >
        <Filter aria-hidden="true" />
      </Button>

      {expanded ? (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="relative flex min-w-0 items-center">
            <Input
              type="text"
              density={density}
              aria-label="Filter expression"
              aria-invalid={error ? true : undefined}
              placeholder={filterExpressionPlaceholder(columns)}
              value={draft}
              disabled={filterable.length === 0}
              className={cn(
                "min-w-0 flex-1 font-mono text-xs",
                draft.length > 0 && "pr-14",
                error && "border-destructive",
              )}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit(draft);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDraft(value);
                  setError(null);
                }
              }}
            />
            {draft.length > 0 && (
              // The framework's `Clear`, in the framework's place: the right edge of the editor, with a
              // dividing border rather than floating over the text.
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Clear filter"
                className="absolute right-0 top-0 h-full rounded-l-none border-l border-input px-2 text-xs"
                onClick={clear}
              >
                Clear
              </Button>
            )}
          </div>
          {error && (
            <span
              role="alert"
              data-testid="data-table-filter-error"
              className="text-xs text-destructive"
            >
              {error}
            </span>
          )}
        </div>
      ) : null}

      {expanded && filterable.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size={iconButtonSize}
              aria-label="Filter syntax"
              title="What can be filtered, and how"
            >
              <CircleHelp aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-80 w-80 overflow-y-auto text-xs">
            <p className="mb-2 text-muted-foreground">
              One expression, committed with Enter. Conditions join with <code>AND</code> /{" "}
              <code>OR</code> and group with parentheses.
            </p>
            <ul className="mb-3 flex flex-col gap-1 font-mono">
              {filterExpressionExamples(columns).map((example) => (
                <li key={example}>{example}</li>
              ))}
            </ul>
            <p className="mb-1 font-medium">Filterable columns</p>
            <ul className="flex flex-col gap-1">
              {columns
                .filter((column) => Boolean(column.filter))
                .map((column) => {
                  const options = column.filter?.options ?? [];
                  return (
                    <li key={column.name}>
                      <span className="font-mono">[{column.header ?? column.name}]</span>
                      {options.length > 0 && (
                        <span className="text-muted-foreground">
                          {" — "}
                          {options
                            .slice(0, 8)
                            .map((option) => option.label ?? option.value)
                            .join(", ")}
                          {options.length > 8 ? ", …" : ""}
                        </span>
                      )}
                    </li>
                  );
                })}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}

      {!expanded && active ? (
        // Collapsed with a filter applied: the expression itself is the indicator, truncated, plus a
        // clear. Without this a narrowed table looks like a short one.
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-xs text-muted-foreground" title={value}>
            {value}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Clear filter"
            className="h-auto px-1 py-0.5 text-muted-foreground"
            onClick={clear}
          >
            <X aria-hidden="true" className="size-3" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** `forwardRef` erases the generic, so the row type is restored by the callable cast below. */
export interface DataTableFilterExpressionComponent {
  <TRow>(
    props: DataTableFilterExpressionProps<TRow> & { ref?: React.Ref<HTMLDivElement> },
  ): React.ReactElement | null;
  displayName?: string;
}

const DataTableFilterExpression = React.forwardRef(
  DataTableFilterExpressionInner,
) as DataTableFilterExpressionComponent;
DataTableFilterExpression.displayName = "DataTableFilterExpression";

export { DataTableFilterExpression };
