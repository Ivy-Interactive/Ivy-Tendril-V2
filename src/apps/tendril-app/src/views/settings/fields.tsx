import React from "react";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@ivy-interactive/components/ui";

/**
 * The labelled controls every V1 setup view is built out of. They were local to `SettingsView` and
 * moved here when the flat card stack became a nested sidebar, because the per-project screens and
 * the editor blades compose the same ones.
 */

/**
 * Section heading and hint, the `Text.Block(...).Bold()` / `Text.Muted(...).Small()` pair V1 opens
 * every setup view with.
 */
export const SectionCard: React.FC<{
  title: string;
  hint?: string;
  testId?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, hint, testId, action, children }) => (
  <div className="rounded-xl border border-border bg-card/60 p-6" data-testid={testId}>
    <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
    <div className="mt-4">{children}</div>
  </div>
);

/**
 * `Text.H4(...).Bold()`, the heading V1's `ProjectDetailView` separates its ten blocks with. Unlike
 * `SectionCard` it draws no box, because inside one project every block is part of the same screen.
 */
export const SubSection: React.FC<{
  title: string;
  hint?: string;
  count?: number;
  action?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}> = ({ title, hint, count, action, testId, children }) => (
  <section
    className="space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0"
    data-testid={testId}
  >
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
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
      className="h-9 w-full rounded-field border border-input bg-background px-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

export const asOptions = (values: string[]): { value: string; label: string }[] =>
  values.map((value) => ({ value, label: value }));
