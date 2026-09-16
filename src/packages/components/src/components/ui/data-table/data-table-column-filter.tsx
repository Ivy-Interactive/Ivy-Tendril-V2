import * as React from "react";
import { Filter, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Densities } from "@/types/density";

import type { DataTableColumnFilter } from "./column-filters";

export interface DataTableColumnFilterProps {
  /** Header text, used in every accessible name so a screen reader hears which column. */
  label: string;
  filter: DataTableColumnFilter;
  /** Selected values. Empty means no constraint. */
  value: string[];
  onChange: (values: string[]) => void;
  density?: Densities;
  className?: string;
}

/**
 * One column's filter control, as it sits in the header's filter row.
 *
 * Two controls, matching [`DataTableColumnFilter.kind`]:
 *
 * - **text** — an `Input` whose *committed* value is the filter. Typing changes nothing; Enter and
 *   blur commit, Escape reverts to the committed value. That is the framework editor's discipline
 *   (`widgets/dataTables/options/DataTableFilterOption.tsx` commits on Enter and clears only when the
 *   box is emptied), and with a server-side filter it is the difference between one request and one
 *   per keystroke.
 * - **select** — a popover checklist. The trigger states the count, because a collapsed control that
 *   silently narrows a table is how a user comes to believe rows are missing.
 *
 * Deliberately not a `<form>`: a filter row inside `<thead>` that submitted would reload the page in
 * the desktop shell.
 */
const DataTableColumnFilterControl = React.forwardRef<HTMLDivElement, DataTableColumnFilterProps>(
  ({ label, filter, value, onChange, density, className }, ref) => {
    const idPrefix = React.useId();

    if (filter.kind === "select") {
      const options = filter.options ?? [];
      const multiple = filter.multiple !== false;
      const selected = new Set(value);

      const toggle = (optionValue: string, checked: boolean) => {
        if (!multiple) {
          onChange(checked ? [optionValue] : []);
          return;
        }
        if (checked) {
          onChange([...value.filter((v) => v !== optionValue), optionValue]);
          return;
        }
        onChange(value.filter((v) => v !== optionValue));
      };

      return (
        <div ref={ref} className={cn("flex items-center gap-1", className)}>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                // Enabled with nothing to pick is a control that does nothing when clicked; the
                // options for a facet are loaded, so "none yet" is a real state.
                disabled={options.length === 0}
                aria-label={`Filter by ${label}`}
                className="h-auto max-w-full justify-start gap-1 px-1 py-0.5 font-normal text-muted-foreground"
              >
                <Filter aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate text-xs">
                  {selected.size === 0
                    ? (filter.placeholder ?? "All")
                    : selected.size === 1
                      ? (options.find((option) => option.value === value[0])?.label ?? value[0])
                      : `${selected.size} selected`}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-64 w-56 overflow-y-auto">
              <div className="flex flex-col gap-2">
                {options.map((option) => {
                  const id = `${idPrefix}-${option.value}`;
                  return (
                    <div key={option.value} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={selected.has(option.value)}
                        onCheckedChange={(checked) => toggle(option.value, checked === true)}
                      />
                      <Label htmlFor={id} className="cursor-pointer font-normal">
                        {option.label ?? option.value}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
          {selected.size > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Clear ${label} filter`}
              className="h-auto px-1 py-0.5 text-muted-foreground"
              onClick={() => onChange([])}
            >
              <X aria-hidden="true" className="size-3" />
            </Button>
          )}
        </div>
      );
    }

    return (
      <DataTableTextFilter
        ref={ref}
        label={label}
        placeholder={filter.placeholder}
        value={value[0] ?? ""}
        onCommit={(next) => onChange(next.length > 0 ? [next] : [])}
        density={density}
        className={className}
      />
    );
  },
);
DataTableColumnFilterControl.displayName = "DataTableColumnFilterControl";

interface DataTableTextFilterProps {
  label: string;
  placeholder?: string;
  /** The committed value. Local edits live in the input until Enter or blur. */
  value: string;
  onCommit: (value: string) => void;
  density?: Densities;
  className?: string;
}

const DataTableTextFilter = React.forwardRef<HTMLDivElement, DataTableTextFilterProps>(
  ({ label, placeholder, value, onCommit, density, className }, ref) => {
    const [draft, setDraft] = React.useState(value);

    /* An external change to the committed value — a filter cleared from a toolbar, or restored state —
       must reach the box. Keyed on the committed value rather than done in an effect so a keystroke
       racing a re-render cannot be overwritten by the value it has not committed yet. */
    const lastValue = React.useRef(value);
    if (lastValue.current !== value) {
      lastValue.current = value;
      if (draft !== value) setDraft(value);
    }

    const commit = (next: string) => {
      const trimmed = next.trim();
      if (trimmed === value) return;
      onCommit(trimmed);
    };

    return (
      <div ref={ref} className={cn("flex items-center", className)}>
        <Input
          type="text"
          density={density}
          aria-label={`Filter by ${label}`}
          placeholder={placeholder ?? "Contains…"}
          value={draft}
          className="h-6 w-full min-w-0 px-1 text-xs"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(draft);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(value);
            }
          }}
        />
      </div>
    );
  },
);
DataTableTextFilter.displayName = "DataTableTextFilter";

export { DataTableColumnFilterControl };
