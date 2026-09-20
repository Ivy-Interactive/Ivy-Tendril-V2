import React from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";

export interface AssetChecklistProps {
  /** Human label of the category, e.g. `Skills`. */
  label: string;
  /** Slug used for test ids and control names, e.g. `skills`. */
  category: string;
  items: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** What to say when the project has none of this kind of asset. */
  emptyText: string;
  /** Disambiguates controls when several checklists of one category are on screen (push dialog). */
  scope?: string;
  /** The per-row kind badge (`Skill`, `MCP`, …) the original puts after every asset name. */
  itemBadge?: string;
}

/**
 * One category of assets as an expander over a checkbox list, with bulk toggles.
 *
 * The category is an expander open only when it has something in it, so five categories per project
 * stay scannable — `new Expandable(header, list).Small().Open(count > 0)` in
 * `ImportFromVaultDialog.cs` / `PushToVaultDialog.cs`. Select-All / Deselect-All live inside the
 * expander, right-aligned, and only appear once there is more than one item: with a single item the
 * checkbox already is the bulk control (`CategorySelectionToolbar`, `allItems.Count <= 1`).
 */
export const AssetChecklist: React.FC<AssetChecklistProps> = ({
  label,
  category,
  items,
  selected,
  onChange,
  emptyText,
  scope,
  itemBadge,
}) => {
  const suffix = scope ? ` for ${scope}` : "";
  const slug = scope ? `${scope}-${category}` : category;
  const selectedSet = new Set(selected);

  const toggle = (name: string, checked: boolean) => {
    onChange(
      checked
        ? items.filter((item) => item === name || selectedSet.has(item))
        : selected.filter((item) => item !== name),
    );
  };

  return (
    <Collapsible defaultOpen={items.length > 0} data-testid={`asset-group-${slug}`}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-box px-2 py-1 text-left text-xs text-foreground transition-colors hover:bg-secondary/60">
        {label}
        <Badge variant="secondary">{items.length}</Badge>
        <ChevronDown
          className="ml-auto size-3 shrink-0 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-1.5 pb-1.5 pl-3 pr-2 pt-1.5">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyText}</p>
        ) : (
          <>
            {items.length > 1 && (
              <div className="flex items-center justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Select all ${label}${suffix}`}
                  onClick={() => onChange([...items])}
                >
                  Select All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Deselect all ${label}${suffix}`}
                  onClick={() => onChange([])}
                >
                  Deselect All
                </Button>
              </div>
            )}
            <ul className="space-y-1">
              {items.map((name) => {
                const id = `asset-${slug}-${name}`;
                return (
                  <li key={name} className="flex items-center gap-2">
                    <label
                      className="flex items-center gap-2 text-xs text-foreground"
                      htmlFor={id}
                      data-testid={id}
                    >
                      <Checkbox
                        id={id}
                        checked={selectedSet.has(name)}
                        onCheckedChange={(checked) => toggle(name, checked === true)}
                      />
                      {name}
                    </label>
                    {itemBadge && <Badge variant="outline">{itemBadge}</Badge>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};
