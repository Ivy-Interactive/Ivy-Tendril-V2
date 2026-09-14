import { useTheme } from "@ivy-interactive/components/theme";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "../lib/cn";

const ORDER = ["light", "dark", "system"] as const;

const LABELS: Record<(typeof ORDER)[number], string> = {
  light: "Light theme",
  dark: "Dark theme",
  system: "System theme",
};

/**
 * Cycles light -> dark -> system.
 *
 * All this does is call `setTheme`; `ThemeProvider` puts `light`/`dark` on `documentElement`, and the
 * `:root` / `.dark` variable blocks in `globals.css` do the rest. There is no docs-specific theme
 * state, which is the whole point of importing the real token file.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const current = ORDER.includes(theme) ? theme : "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Glyph = current === "light" ? Sun : current === "dark" ? Moon : Monitor;

  return (
    <button
      type="button"
      aria-label={`${LABELS[current]}. Switch to ${LABELS[next].toLowerCase()}`}
      title={LABELS[current]}
      onClick={() => setTheme(next)}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-field text-muted-foreground",
        "transition-colors hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Glyph className="size-4" aria-hidden="true" />
    </button>
  );
}
