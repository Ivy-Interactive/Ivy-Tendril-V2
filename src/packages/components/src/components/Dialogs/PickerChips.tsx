/**
 * A multi-pick list as a row of toggle chips - the dialogs' stand-in for V1's searchable multi-select
 * (`ToSelectInput(options)` over a `string[]` state): Create PR's reviewers, Create Issue's labels.
 *
 * Each chip is a toggle button (`aria-pressed`) inside a labelled group, so it reads as "reviewers,
 * octocat, toggle button, pressed" rather than as a list of unrelated buttons.
 */
export function PickerChips({
  options,
  selected,
  onToggle,
  ariaLabel,
  testId,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  ariaLabel: string;
  testId?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
      className="flex max-h-32 flex-wrap gap-1 overflow-y-auto rounded-field border border-border p-1"
    >
      {options.map((option) => {
        const on = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(option)}
            className={`rounded-selector px-2 py-1 text-xs font-medium transition ${
              on
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
