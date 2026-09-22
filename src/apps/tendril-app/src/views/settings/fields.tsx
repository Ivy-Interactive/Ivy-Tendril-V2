import React from "react";
import { Check } from "lucide-react";
import {
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ivyColorVar,
} from "@ivy-interactive/components/ui";
import { IVY_COLOR_NAMES, levelBadgeColor, type IvyColorName } from "../../utils/levelColor";

/**
 * The labelled controls every V1 setup view is built out of. They were local to `SettingsView` and
 * moved here when the flat card stack became a nested sidebar, because the per-project screens and
 * the editor blades compose the same ones.
 */

/**
 * The one width every settings screen is laid out against - V1's `Size.Auto().Max(Size.Units(120))`,
 * the cap `AppearanceSetupView`, `CodingAgentSetupView` and the account and tunnel views all open
 * with. `170` rather than `120` because V2's controls are wider, but the point is the same: one
 * column, applied in one place.
 *
 * `min-w-0` travels with it. Without it the cap still holds but the element cannot shrink below its
 * content as a flex item, which is how a wide table pushes rows past the pane edge with no way to
 * scroll to them.
 */
export const SETTINGS_CONTAINER = "min-w-0 max-w-170";

/**
 * Section heading and hint, the `Text.Block(...).Bold()` / `Text.Muted(...).Small()` pair V1 opens
 * every setup view with.
 *
 * It applies {@link SETTINGS_CONTAINER} itself, so a section is bounded by being a section rather
 * than by each call site remembering to repeat the cap. Three of them had not - Team Vault, Daemon
 * Diagnostics and Newsletter ran the full width of the pane while everything around them stopped at
 * the same column.
 *
 * It draws no box, because V1 draws none: every one of its setup views returns a bare
 * `Layout.Vertical()` whose first two children are that heading pair, and the only `new Card(...)`
 * anywhere in `Apps/Settings` is the agent tile in `CodingAgentSetupView` - a card because it is a
 * selectable thing, not because it is a section. This used to render
 * `rounded-box border border-border bg-card/60 p-6` plus a rule under the header, which boxed every
 * section inside the pane that already frames them and made the screen read as a stack of widgets
 * rather than one settings page.
 */
export const SettingsSection: React.FC<{
  title: string;
  hint?: string;
  testId?: string;
  action?: React.ReactNode;
  /** Opt out of the shared cap for a section that owns its own width. */
  unbounded?: boolean;
  children: React.ReactNode;
}> = ({ title, hint, testId, action, unbounded, children }) => (
  <section className={unbounded ? undefined : SETTINGS_CONTAINER} data-testid={testId}>
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

/**
 * `Text.H4(...).Bold()`, the heading V1's `ProjectDetailView` separates its ten blocks with.
 *
 * It draws no rule. It used to carry a `border-t` above it, on the reasoning that blocks inside one
 * project are parts of a single screen rather than separate pages - but V1 draws no rule between
 * them either, and `first:border-t-0` never fired because in all three consumers something precedes
 * the first block, so every one of the 17 instances drew one. Blocks are separated by spacing alone.
 */
export const SubSection: React.FC<{
  title: string;
  hint?: string;
  count?: number;
  action?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}> = ({ title, hint, count, action, testId, children }) => (
  <section className="space-y-2" data-testid={testId}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">
          {title}
          {count !== undefined && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">{count}</span>
          )}
        </h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

/** V1 reports a failed save as destructive body text under the fields, not as a toast. */
export const SaveError: React.FC<{ message: string | null }> = ({ message }) =>
  message ? <p className="text-xs text-destructive">{message}</p> : null;

/** A number field with V1's `Min`/`Max` bounds and its `Suffix` unit. */
export const NumberField: React.FC<{
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  hint?: string;
  onChange: (value: number) => void;
}> = ({ id, label, value, min, max, suffix, hint, onChange }) => (
  <div className="space-y-1">
    <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
      {label}
    </Label>
    <div className="relative">
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        // Clearing the field parses as NaN, which would make the input uncontrolled; V1's
        // NumberInput has no empty state either, so it falls back to the lower bound.
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10) || min)}
        className={suffix ? "pr-12" : undefined}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

/** A labelled text field, the `WithField().Label(...)` wrapper round every `ToTextInput`. */
export const TextField: React.FC<{
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  disabled?: boolean;
  onChange: (value: string) => void;
}> = ({ id, label, value, placeholder, hint, error, disabled, onChange }) => (
  <div className="space-y-1">
    <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
      {label}
    </Label>
    <Input
      id={id}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={error ? true : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
    {error ? (
      <p className="text-xs text-destructive">{error}</p>
    ) : (
      hint && <p className="text-xs text-muted-foreground">{hint}</p>
    )}
  </div>
);

/** A labelled select, the `WithField().Label(...)` wrapper V1 puts round every `ToSelectInput`. */
export const SelectField: React.FC<{
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  hint?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}> = ({ id, label, value, options, hint, disabled, onChange }) => (
  <div className="space-y-1">
    <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
      {label}
    </Label>
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

/**
 * A labelled **native** select, for the lists whose contents come from a catalog: the theme presets,
 * and each profile's model and effort.
 *
 * Native rather than the layered `SelectField` for the reasons `AgentPicker`'s own `PickerSelect`
 * gives - the option list floats over its container instead of growing it, and its keyboard handling
 * and labelling come from the platform. It also keeps V1's `extraOptions` behaviour honest: a value
 * the catalog does not offer (a model id typed by hand into `config.yaml`, a preset from a vault this
 * build cannot see) is listed as its own option rather than silently reading as the first entry.
 */
export const NativeSelectField: React.FC<{
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  hint?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}> = ({ id, label, value, options, hint, disabled, onChange }) => (
  <div className="space-y-1">
    <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
      {label}
    </Label>
    <select
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-field border border-input bg-background px-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {!options.some((option) => option.value === value) && (
        <option value={value}>{value || "Default"}</option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

/** A labelled multiline field, for the newline-separated lists V1 edits with `ToCodeInput`. */
export const LinesField: React.FC<{
  id: string;
  label: string;
  value: string;
  hint?: string;
  placeholder?: string;
  rows?: "short" | "tall";
  onChange: (value: string) => void;
}> = ({ id, label, value, hint, placeholder, rows = "short", onChange }) => (
  <div className="space-y-1">
    <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
      {label}
    </Label>
    <Textarea
      id={id}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${rows === "tall" ? "h-60" : "h-24"} font-mono text-xs`}
    />
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

/**
 * Names whose swatch is light enough that a white tick vanishes on it.
 *
 * V1's own list, copied rather than computed (`ColorInputWidget.tsx:96`). Computing it from the
 * token hexes would be the better rule and a different one: V2's `--yellow` is `#a16207`, dark
 * enough that a white tick reads fine, so a luminance test would tick it white and V1 ticks it
 * black. The point of this port is to look like V1, so the list is V1's.
 */
const DARK_TICK_COLORS: ReadonlySet<string> = new Set(["white", "yellow", "lime", "amber", "cyan"]);

/**
 * V1's `ColorSwatchGrid` (`Ivy-Framework/src/frontend/src/widgets/inputs/ColorInputWidget.tsx:63`),
 * class for class: a six-column grid of round `size-6` swatches, the selected one ringed and
 * ticked, each button named by its colour so the grid is usable without sight of it.
 *
 * The colours are {@link IVY_COLOR_NAMES} - the Ivy `Colors` enum in declaration order, which is the
 * order `Object.keys(enumColorsToCssVar)` yields in V1 - resolved through `ivyColorVar` rather than
 * a second table of hexes. That is the whole reason this is a fixed palette and not a hex picker:
 * `config.yaml` stores a *name*, the daemon never validates it, and V1's `ConfigService` rewrites
 * anything that is not an enum member to `Slate`. A free text field let an operator type a value
 * that would be silently replaced; a grid of the 32 legal names cannot produce one.
 */
export const ColorSwatchGrid: React.FC<{
  value: string;
  disabled?: boolean;
  onSelect: (name: IvyColorName) => void;
}> = ({ value, disabled, onSelect }) => {
  const selected = levelBadgeColor(value);

  return (
    <div className="grid grid-cols-6 gap-1 p-1" role="group" aria-label="Colors">
      {IVY_COLOR_NAMES.map((name) => {
        const isSelected = selected === name;
        return (
          <button
            key={name}
            type="button"
            disabled={disabled}
            aria-label={name}
            aria-pressed={isSelected}
            title={name}
            data-color={name}
            onClick={() => onSelect(name)}
            className={`flex size-6 items-center justify-center rounded-full border-2 transition-all hover:z-10 hover:scale-110 ${
              isSelected ? "border-foreground ring-2 ring-foreground/30" : "border-transparent"
            } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            style={{ backgroundColor: ivyColorVar(name) }}
          >
            {isSelected && (
              <Check
                className={`size-4 ${
                  DARK_TICK_COLORS.has(name.toLowerCase()) ? "text-black" : "text-white"
                }`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
};

/**
 * A labelled colour, edited as V1 edits one:
 * `projectColor.ToColorInput().Variant(ColorInputVariant.SwatchPicker)`
 * (`Ivy.Tendril/Apps/Settings/ProjectDetailView.cs:222`, and the same call in
 * `Blades/EditProjectBladeView.cs:145` under a `.Label("Color")`).
 *
 * So: a square trigger filled with the current colour, and a popover holding
 * {@link ColorSwatchGrid}, which closes on pick - V1's `handleSwatchSelect` sets the value and then
 * `setSwatchPickerOpen(false)`.
 *
 * The trigger is a `size-9 rounded-field` square rather than V1's `rounded-md`, because `size-9` is
 * the height of every other control on these screens (`NativeSelectField`, `Input`) and
 * `rounded-field` is the token those use; V1's `colorInputPickerVariant` resolves to the same 36px
 * at its default density. A colour the palette does not contain - a hex somebody hand-wrote into
 * `config.yaml`, which V1 would rewrite to `Slate` on its next save - renders as an empty trigger
 * and is named as unset rather than drawn as a colour, the same distinction {@link levelBadgeColor}
 * draws for a badge.
 */
export const ColorSwatchField: React.FC<{
  id: string;
  label: string;
  value: string;
  hint?: string;
  disabled?: boolean;
  onChange: (value: IvyColorName) => void;
}> = ({ id, label, value, hint, disabled, onChange }) => {
  const [open, setOpen] = React.useState(false);
  const selected = levelBadgeColor(value);

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              id={id}
              type="button"
              disabled={disabled}
              aria-label={label}
              title={selected ?? "Choose color"}
              data-testid={`${id}-trigger`}
              data-color={selected ?? ""}
              className={`size-9 shrink-0 rounded-field border border-input shadow-sm ${
                disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
              }`}
              style={selected ? { backgroundColor: ivyColorVar(selected) } : undefined}
            />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <ColorSwatchGrid
              value={value}
              disabled={disabled}
              onSelect={(name) => {
                onChange(name);
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <span className="text-sm text-foreground">{selected ?? "None"}</span>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
};

export const asOptions = (values: string[]): { value: string; label: string }[] =>
  values.map((value) => ({ value, label: value }));
