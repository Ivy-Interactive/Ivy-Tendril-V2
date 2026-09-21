import * as React from "react";
import { Button } from "@ivy-interactive/components/ui";
import { ChevronDown, ChevronRight, Eye } from "lucide-react";
import { SURFACES } from "./scenarios/registry";

/**
 * V1's `Apps/Debug/DialogsApp.cs`: a hidden harness for looking at how each dialog renders across
 * its input permutations.
 *
 * V1 registers one `Expandable` per dialog and opens the real component with a hand-built model.
 * This does the same, over the shared catalogs in `scenarios/` - the difference being that those
 * catalogs also drive `tests/dialog-scenarios.test.tsx`, so what is looked at here is what CI
 * checks. V1's harness was visual only, which is part of why it stopped at one dialog out of
 * forty-eight.
 *
 * Copy is V1's, verbatim: "Dialog Test Harness", and "Expand a dialog to preview how it renders
 * across input permutations."
 *
 * **One scenario is open at a time**, deliberately. Several dialogs seed their fields once per
 * opening rather than on prop identity - `CreateIssueDialog` most visibly - so showing two at once
 * and swapping props between them would display the first scenario's values under the second
 * scenario's title. Closing and remounting is the only way to see a scenario as its caller would.
 */
export function DebugView() {
  const [expanded, setExpanded] = React.useState<string | null>(SURFACES[0]?.id ?? null);
  const [open, setOpen] = React.useState<{ surface: string; index: number } | null>(null);

  const close = React.useCallback(() => setOpen(null), []);
  const active = open ? SURFACES.find((s) => s.id === open.surface) : undefined;
  const totalScenarios = SURFACES.reduce((n, s) => n + s.scenarios.length, 0);

  return (
    // No outer padding and no scroll container of its own: the shell owns both
    // (`CONTENT_PADDED_CLASS` is `flex-1 overflow-y-auto p-4`), and a view that adds them nests a
    // second scroller inside the first and pays the inset twice.
    <div data-testid="debug-view" className="space-y-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Dialog Test Harness</h2>
        <p className="text-sm text-muted-foreground">
          Expand a dialog to preview how it renders across input permutations.
        </p>
        <p className="text-xs text-muted-foreground">
          {SURFACES.length} dialogs · {totalScenarios} scenarios · the same catalogs
          <code className="mx-1 font-mono">tests/dialog-scenarios.test.tsx</code>
          asserts.
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {SURFACES.map((surface) => {
          const isExpanded = expanded === surface.id;
          return (
            <li key={surface.id} className="rounded-box border border-border">
              <button
                type="button"
                className="flex w-full items-center gap-2 p-3 text-left"
                aria-expanded={isExpanded}
                onClick={() => setExpanded(isExpanded ? null : surface.id)}
                data-testid={`harness-surface-${surface.id}`}
              >
                {isExpanded ? (
                  <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
                ) : (
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                )}
                <span className="font-mono text-sm font-medium text-foreground">{surface.id}</span>
                <span className="text-xs text-muted-foreground">
                  {surface.scenarios.length} scenarios
                </span>
              </button>

              {isExpanded && (
                <ul className="flex flex-col gap-3 border-t border-border p-3">
                  {surface.scenarios.map((scenario, index) => (
                    <li key={scenario.title} className="flex flex-col gap-1">
                      <div>
                        <Button
                          variant="outline"
                          onClick={() => setOpen({ surface: surface.id, index })}
                          data-testid={`harness-scenario-${surface.id}-${index}`}
                        >
                          <Eye className="size-4" aria-hidden />
                          {scenario.title}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{scenario.hint}</p>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {active && open ? active.render(open.index, { onClose: close }) : null}
    </div>
  );
}
