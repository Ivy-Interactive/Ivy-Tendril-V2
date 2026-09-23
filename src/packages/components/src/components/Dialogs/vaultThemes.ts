/**
 * The data half of `VaultThemesDialog`: the theme shape a Team Vault stores, the colour tokens the
 * generator edits, and the JSON/CSS a theme is exported as or imported from.
 *
 * Ported from V1's `Apps/Settings/Dialogs/VaultThemesDialog.cs` and `Services/Vault` (the
 * `VaultThemeManifest` a vault keeps as `themes/<id>.json`) and `Themes/ThemeSerializationService.cs`.
 * V1's manifest wraps an Ivy `Theme` whose colours are PascalCase properties (`PrimaryForeground`);
 * V2's themes are CSS custom properties (`primary-foreground`), the same keys
 * `lib/theme-presets.ts` uses, so an imported V1 theme is mapped key by key.
 */
import type { ThemePreset, ThemePresetColors } from "../../lib/theme-presets";

/** One colour token per V1 `ThemeColors` property, grouped the way V1's generator lays them out. */
export const VAULT_THEME_COLOR_GROUPS = [
  {
    id: "main",
    tokens: [
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "background",
      "foreground",
    ],
  },
  {
    id: "semantic",
    tokens: [
      "success",
      "success-foreground",
      "destructive",
      "destructive-foreground",
      "warning",
      "warning-foreground",
      "info",
      "info-foreground",
    ],
  },
  {
    id: "ui",
    tokens: [
      "muted",
      "muted-foreground",
      "accent",
      "accent-foreground",
      "card",
      "card-foreground",
      "popover",
      "popover-foreground",
      "border",
      "input",
      "ring",
    ],
  },
] as const;

export type VaultThemeColorGroup = (typeof VAULT_THEME_COLOR_GROUPS)[number]["id"];

export const VAULT_THEME_TOKENS: string[] = VAULT_THEME_COLOR_GROUPS.flatMap((group) => [
  ...group.tokens,
]);

/** `BorderRadiusSelector`'s steps, as the `--radius-boxes` value each sets. */
export const VAULT_THEME_RADII = {
  none: "0rem",
  small: "0.25rem",
  medium: "0.5rem",
  large: "0.75rem",
  full: "1rem",
} as const;

export type VaultThemeRadius = keyof typeof VAULT_THEME_RADII;

/** A theme as a vault stores it — V1's `VaultThemeManifest`, with V2's token-keyed colours. */
export interface VaultTheme {
  /** The file name in the vault (`themes/<id>.json`) and what `config.yaml`'s `theme` holds. */
  id: string;
  name: string;
  description: string;
  /** Which half was authored; the list shows a Light/Dark badge and previews that half. */
  isDark: boolean;
  /** Primary, secondary, accent, background — the four swatches V1 draws. */
  previewColors: string[];
  colors: { light?: ThemePresetColors; dark?: ThemePresetColors };
  fontFamily?: string | null;
  fontSize?: string | null;
  radius?: VaultThemeRadius | null;
}

/** What the generator hands back on *Upload to Team Vault*. `id` is set when editing a theme. */
export type VaultThemeDraft = Omit<VaultTheme, "id"> & { id?: string };

/**
 * The palette a preset's missing tokens fall back to: V1's `TendrilThemes.CreateDefaultIvyTheme`
 * zinc set. Most shipped presets only override a few tokens on top of `tokens.css`, and a generator
 * needs a concrete value in every swatch.
 */
export const FALLBACK_THEME_COLORS: { light: ThemePresetColors; dark: ThemePresetColors } = {
  light: {
    primary: "#18181b",
    "primary-foreground": "#fafafa",
    secondary: "#f4f4f5",
    "secondary-foreground": "#18181b",
    background: "#ffffff",
    foreground: "#09090b",
    success: "#16a34a",
    "success-foreground": "#ffffff",
    destructive: "#dc2626",
    "destructive-foreground": "#ffffff",
    warning: "#d97706",
    "warning-foreground": "#ffffff",
    info: "#2563eb",
    "info-foreground": "#ffffff",
    muted: "#f4f4f5",
    "muted-foreground": "#71717a",
    accent: "#f4f4f5",
    "accent-foreground": "#18181b",
    card: "#ffffff",
    "card-foreground": "#09090b",
    popover: "#ffffff",
    "popover-foreground": "#09090b",
    border: "#e4e4e7",
    input: "#e4e4e7",
    ring: "#18181b",
  },
  dark: {
    primary: "#fafafa",
    "primary-foreground": "#18181b",
    secondary: "#27272a",
    "secondary-foreground": "#fafafa",
    background: "#09090b",
    foreground: "#fafafa",
    success: "#22c55e",
    "success-foreground": "#052e16",
    destructive: "#ef4444",
    "destructive-foreground": "#fafafa",
    warning: "#f59e0b",
    "warning-foreground": "#1c1917",
    info: "#3b82f6",
    "info-foreground": "#fafafa",
    muted: "#27272a",
    "muted-foreground": "#a1a1aa",
    accent: "#27272a",
    "accent-foreground": "#fafafa",
    card: "#09090b",
    "card-foreground": "#fafafa",
    popover: "#09090b",
    "popover-foreground": "#fafafa",
    border: "#27272a",
    input: "#27272a",
    ring: "#d4d4d8",
  },
};

/** Every token filled in: the theme's own value, else the fallback palette's. */
export function completeColors(colors: VaultTheme["colors"]): {
  light: ThemePresetColors;
  dark: ThemePresetColors;
} {
  return {
    light: { ...FALLBACK_THEME_COLORS.light, ...colors.light },
    dark: { ...FALLBACK_THEME_COLORS.dark, ...colors.dark },
  };
}

/** A shipped preset as a generator starting point. */
export function themeFromPreset(preset: ThemePreset): VaultTheme {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    isDark: preset.isDark,
    previewColors: preset.previewColors,
    colors: completeColors(preset.colors),
  };
}

/** `PreviewColors = [Primary, Secondary, Accent, Background]` of the authored half. */
export function previewColorsFor(colors: ThemePresetColors): string[] {
  return [
    colors.primary ?? "#18181b",
    colors.secondary ?? "#71717a",
    colors.accent ?? "#27272a",
    colors.background ?? "#ffffff",
  ];
}

/**
 * V1's id rule (`HandleSaveToVault`): lower-case, anything but `[a-z0-9_-]` becomes `-`, trimmed of
 * dashes. Empty falls back to a random `vault-theme-xxxxxx`.
 */
export function vaultThemeId(name: string, random: () => string = randomSuffix): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "");
  return id === "" ? `vault-theme-${random()}` : id;
}

function randomSuffix(): string {
  return Math.random().toString(16).slice(2, 8).padEnd(6, "0");
}

/** The inline custom properties a scoped preview needs: the colours of one half, and the radius. */
export function previewStyle(
  colors: ThemePresetColors,
  radius: VaultThemeRadius | null | undefined,
  fontFamily?: string | null,
  fontSize?: string | null,
): Record<string, string> {
  const style: Record<string, string> = {};
  for (const [token, value] of Object.entries(colors)) style[`--${token}`] = value;
  const r = VAULT_THEME_RADII[radius ?? "medium"];
  style["--radius"] = r;
  style["--radius-boxes"] = r;
  style["--radius-fields"] = `calc(${r} * 0.75)`;
  style["--radius-selectors"] = `calc(${r} * 0.5)`;
  if (fontFamily && fontFamily.trim() !== "") style.fontFamily = fontFamily;
  if (fontSize && fontSize.trim() !== "") style.fontSize = fontSize;
  return style;
}

/** The JSON a theme is shared as — `ThemeSerializationService.ExportToJson`. */
export function exportThemeJson(theme: VaultThemeDraft): string {
  const { id: _id, ...rest } = theme;
  return JSON.stringify(rest, null, 2);
}

/**
 * The stylesheet a theme installs, in `lib/theme-presets.ts`'s shape (`:root` for light, `.dark`
 * for dark) — V2's counterpart of V1's *C#* export tab: something to paste into a host.
 */
export function exportThemeCss(theme: VaultThemeDraft): string {
  const block = (selector: string, colors: ThemePresetColors | undefined) =>
    colors && Object.keys(colors).length > 0
      ? `${selector} {\n${Object.entries(colors)
          .map(([token, value]) => `  --${token}: ${value};`)
          .join("\n")}\n}`
      : "";
  return [block(":root", theme.colors.light), block(".dark", theme.colors.dark)]
    .filter(Boolean)
    .join("\n\n");
}

/** `PrimaryForeground` / `primaryForeground` / `primary-foreground` → `primary-foreground`. */
function tokenKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function pick(obj: Record<string, unknown>, ...names: string[]): unknown {
  for (const [key, value] of Object.entries(obj)) {
    if (names.some((name) => name.toLowerCase() === key.toLowerCase())) return value;
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readColors(value: unknown): ThemePresetColors | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;
  const out: ThemePresetColors = {};
  for (const [key, raw] of Object.entries(obj)) {
    const token = tokenKey(key);
    if (typeof raw === "string" && raw.trim() !== "" && VAULT_THEME_TOKENS.includes(token)) {
      out[token] = raw.trim();
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readRadius(value: unknown): VaultThemeRadius | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  return lower in VAULT_THEME_RADII ? (lower as VaultThemeRadius) : null;
}

export type ParsedTheme =
  | { ok: true; theme: VaultThemeDraft }
  | { ok: false; reason: "json" | "shape" };

/**
 * `ThemeSerializationService.TryImportTheme`, for JSON: V2's own export, a V1 Ivy `Theme`
 * (`{ Name, Colors: { Light: { Primary, ... }, Dark: { ... } }, FontFamily, FontSize }`), or a whole
 * V1 `VaultThemeManifest` (`{ Id, Name, Description, IsDark, IvyTheme: { ... } }`). Keys are matched
 * case-insensitively; unknown keys are ignored. V1's C# export is not parsed — it is code, not data.
 */
export function parseThemeJson(raw: string): ParsedTheme {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "json" };
  }
  const root = asObject(parsed);
  if (!root) return { ok: false, reason: "shape" };

  const inner = asObject(pick(root, "ivyTheme")) ?? root;
  const colorsObj = asObject(pick(inner, "colors"));
  const light = readColors(colorsObj ? pick(colorsObj, "light") : undefined);
  const dark = readColors(colorsObj ? pick(colorsObj, "dark") : undefined);
  if (!light && !dark) return { ok: false, reason: "shape" };

  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const isDarkRaw = pick(root, "isDark");
  const isDark = typeof isDarkRaw === "boolean" ? isDarkRaw : !light && !!dark;
  const colors = { ...(light ? { light } : {}), ...(dark ? { dark } : {}) };
  const authored = (isDark ? dark : light) ?? light ?? dark ?? {};

  return {
    ok: true,
    theme: {
      name: str(pick(root, "name")) || str(pick(inner, "name")),
      description: str(pick(root, "description")),
      isDark,
      previewColors: previewColorsFor(authored),
      colors,
      fontFamily: str(pick(inner, "fontFamily")) || null,
      fontSize: str(pick(inner, "fontSize")) || null,
      radius: readRadius(pick(inner, "radius")),
    },
  };
}
