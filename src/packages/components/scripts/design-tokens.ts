/**
 * Single source of truth for the semantic colour palette.
 *
 * The C# app (Ivy-Tendril) renders through Ivy Framework, which takes its palette from
 * `@ivy-interactive/ivy-design-system`. V2 used to hand-roll the same tokens, and 19 of the 25 shared
 * names had drifted from the brand palette — most visibly `--primary`, a near-black `#18181b` where the
 * C# app uses Ivy green `#00cc92`, which put every primary button, active nav item and focus ring on a
 * different colour. These helpers read the package's compiled CSS and generate the managed region of
 * `src/styles/tokens.css`, so the drift cannot silently return: `sync-design-tokens.ts` writes the
 * region and `tests/design-tokens-sync.test.ts` fails when the file and the package disagree.
 *
 * The package's `tokens/index.json` is deliberately not used: its values are unresolved Design Tokens
 * references (`{ivy-framework.source.color.primary}`), whereas `dist/css/ivy-framework-*.css` carries the
 * resolved hex values that Ivy Framework and the generated C# token classes both come from. Reading the
 * CSS means V2 consumes exactly what V1 renders, with no reference resolver of our own to keep correct.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

export type ThemeMode = "light" | "dark";

/** Delimiters of the generated region. Brace-free on purpose: the `:root`/`.dark` extraction regexes in
 *  `design-tokens.test.ts` and `button.test.tsx` are `[^}]+`, so any `}` inside a block truncates it. */
export const MARKER_START = "/* ivy-design-system:start — generated, run pnpm sync:tokens */";
export const MARKER_END = "/* ivy-design-system:end */";

/**
 * Deviations from the design system, kept deliberately small and justified.
 *
 * `design-tokens.test.ts` and `button.test.tsx` enforce WCAG 2.1 AA (4.5:1) on token/`-foreground` pairs,
 * and dark `--destructive` (`#dd5860`) on the design system's `#f8f8f8` is only 3.51:1. The brand colour
 * wins and the accessibility invariant stays, so only the foreground moves: on `#000000` the same red
 * reaches 5.64:1.
 */
export const ACCESSIBILITY_OVERRIDES: Record<ThemeMode, Record<string, string>> = {
  light: {},
  dark: { "destructive-foreground": "#000000" },
};

const require_ = createRequire(import.meta.url);

/** Root of the installed package. Resolved through the `.` export, since `exports` exposes neither
 *  `package.json` nor the per-mode CSS files this reads. */
function packageRoot(): string {
  return resolve(dirname(require_.resolve("@ivy-interactive/ivy-design-system")), "..", "..");
}

export function designSystemCssPath(mode: ThemeMode): string {
  return resolve(packageRoot(), "dist/css", `ivy-framework-${mode}.css`);
}

/** The mode's semantic tokens, keyed by unprefixed name: the package declares `--color-primary`, while
 *  V2's tokens and tests use `--primary` and `tokens.css` maps `--color-primary: var(--primary)` for
 *  Tailwind. Overrides are applied here so every consumer sees the same values. */
export function readDesignSystemTokens(mode: ThemeMode): Map<string, string> {
  const css = readFileSync(designSystemCssPath(mode), "utf8");
  const tokens = new Map<string, string>();

  for (const match of css.matchAll(/--color-([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens.set(match[1], match[2].toLowerCase());
  }

  if (tokens.size === 0) {
    throw new Error(`No colour tokens found in ${designSystemCssPath(mode)}`);
  }

  for (const [name, value] of Object.entries(ACCESSIBILITY_OVERRIDES[mode])) {
    if (!tokens.has(name)) {
      throw new Error(
        `Override for --${name} (${mode}) does not correspond to a design system token`,
      );
    }
    tokens.set(name, value);
  }

  return tokens;
}

/** Names the design system owns. Taken from the light theme, which carries the full set. */
export function managedTokenNames(): string[] {
  return [...readDesignSystemTokens("light").keys()];
}

export function renderManagedRegion(mode: ThemeMode, indent = "  "): string {
  const lines = [`${indent}${MARKER_START}`];

  for (const [name, value] of readDesignSystemTokens(mode)) {
    const override = ACCESSIBILITY_OVERRIDES[mode][name];
    lines.push(
      `${indent}--${name}: ${value};${override ? " /* see ACCESSIBILITY_OVERRIDES */" : ""}`,
    );
  }

  lines.push(`${indent}${MARKER_END}`);
  return lines.join("\n");
}

/**
 * Rewrites both generated regions of `tokens.css`. The first region is `:root` (light) and the second is
 * `.dark`, matching the order the blocks appear in the file.
 */
export function syncManagedRegions(css: string): string {
  const modes: ThemeMode[] = ["light", "dark"];
  let result = css;
  let searchFrom = 0;

  for (const mode of modes) {
    const start = result.indexOf(MARKER_START, searchFrom);
    const end = result.indexOf(MARKER_END, start);

    if (start === -1 || end === -1) {
      throw new Error(
        `tokens.css is missing the ${mode} generated region. Expected ${modes.length} marker pairs.`,
      );
    }

    const lineStart = result.lastIndexOf("\n", start) + 1;
    const indent = result.slice(lineStart, start);
    const replacement = renderManagedRegion(mode, indent);

    result = result.slice(0, lineStart) + replacement + result.slice(end + MARKER_END.length);
    searchFrom = lineStart + replacement.length;
  }

  return result;
}

export function tokensCssPath(): string {
  return resolve(dirname(new URL(import.meta.url).pathname), "..", "src/styles/tokens.css");
}

export function readTokensCss(): string {
  return readFileSync(tokensCssPath(), "utf8");
}
