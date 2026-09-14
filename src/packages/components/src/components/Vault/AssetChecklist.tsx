import React from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button/button";
import { Checkbox } from "../ui/checkbox";

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
}

/**
 * One category of assets as a checkbox list, with bulk toggles.
 *
 * Select-All / Deselect-All only appear once there is more than one item — with a single item the
 * checkbox already is the bulk control.
 */
export const AssetChecklist: React.FC<AssetChecklistProps> = ({
  label,
  category,
  items,
  selected,
  onChange,
  emptyText,
  scope,
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
    <section className="space-y-1.5" data-testid={`asset-group-${slug}`}>
      <header className="flex items-center gap-2">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <Badge variant="secondary">{items.length}</Badge>
        {items.length > 1 && (
          <span className="ml-auto flex items-center gap-1">
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
          </span>
        )}
      </header>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((name) => {
            const id = `asset-${slug}-${name}`;
            return (
              <li key={name}>
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
