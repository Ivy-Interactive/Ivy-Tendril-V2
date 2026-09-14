/**
 * Field styling shared by the lifecycle dialogs.
 *
 * Semantic design tokens only — the surrounding views still use `slate-*`
 * palette classes, and copying them into new files would spread a theme the
 * tokens exist to replace.
 */
export const FIELD_CLASS =
  "w-full rounded-field border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

/** An error the backend reported, rendered where the operator pressed the button. */
export const ALERT_CLASS =
  "mt-4 rounded-box border border-destructive/50 bg-destructive/10 p-3 text-sm text-foreground";
