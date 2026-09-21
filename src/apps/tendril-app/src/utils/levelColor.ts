/**
 * A level's configured colour name, resolved to the Ivy `Colors` name `Badge`'s `color` prop tints
 * from.
 *
 * `LevelConfig.color` (`crates/tendril-core/src/models/project.rs:336-341`) is a free `String` — the
 * daemon neither validates it nor knows what a colour is, so the legal vocabulary is V1's: every
 * renderer of a level colour funnels the stored string through `Enum.TryParse<Colors>`
 * (`Apps/Settings/LevelsSetupView.cs:33`, `Services/ConfigService.cs:703`), so a name is legal exactly
 * when it is a member of `Ivy/Shared/Colors.cs`. That enum is reproduced below rather than derived,
 * because nothing in V2 imports the framework.
 *
 * Every one of those names has a token in `styles/tokens.css` (light and dark), which is what makes a
 * lookup table the honest shape here: `ivyColorVar` would happily transform *any* string into a
 * `var(--whatever, currentColor)` that renders, so passing an unvalidated name straight to `Badge`
 * would tint a typo'd colour with the foreground colour and look deliberate. Matching V1's parse first
 * is what turns "not a colour" back into something the caller can decide about.
 */

/**
 * `Colors` (`Ivy-Framework/src/Ivy/Shared/Colors.cs:4-36`) in declaration order, which is also the
 * order V1's colour picker offers (`Enum.GetNames<Colors>()`, `LevelsSetupView.cs:110`).
 */
const IVY_COLOR_NAMES = [
  "Black",
  "White",
  "Slate",
  "Gray",
  "Zinc",
  "Neutral",
  "Stone",
  "Red",
  "Orange",
  "Amber",
  "Yellow",
  "Lime",
  "Green",
  "Emerald",
  "Teal",
  "Cyan",
  "Sky",
  "Blue",
  "Indigo",
  "Violet",
  "Purple",
  "Fuchsia",
  "Pink",
  "Rose",
  "Primary",
  "Secondary",
  "Destructive",
  "Success",
  "Warning",
  "Info",
  "Muted",
  "IvyGreen",
] as const;

export type IvyColorName = (typeof IVY_COLOR_NAMES)[number];

/**
 * Keyed lowercase because `config.yaml` is hand-edited and `Enum.TryParse<Colors>(..., ignoreCase:
 * true)` is what reads it (`ConfigService.cs:703`) — `red`, `Red` and `RED` are one colour to the
 * daemon, so they have to be one colour here.
 */
const BY_LOWER_NAME = new Map<string, IvyColorName>(
  IVY_COLOR_NAMES.map((name) => [name.toLowerCase(), name]),
);

/**
 * The Ivy colour a level's stored `color` names, or `undefined` when it names none.
 *
 * `undefined` rather than V1's `Colors.Gray` fallback (`LevelsSetupView.cs:33`,
 * `SidebarView.cs:25`), which is the one deliberate departure: V1 renders a misspelt colour and a
 * level somebody deliberately coloured `Gray` identically, so a typo in `config.yaml` is invisible at
 * exactly the screen where it would be corrected. Leaving the caller to draw its neutral badge keeps
 * "this is not a colour" distinguishable, and is the same choice `ProjectBadges` already makes for an
 * unconfigured project colour.
 */
export function levelBadgeColor(color: string | undefined): IvyColorName | undefined {
  return BY_LOWER_NAME.get((color ?? "").trim().toLowerCase());
}

/**
 * A level's name and its configured colour string, which is the shape `readLevels` produces and the
 * only part of `LevelConfig` a colour lookup needs.
 */
export interface LevelColorSource {
  name: string;
  color: string;
}

/** Level name to resolved Ivy colour, for the levels whose configured colour is a colour at all. */
export type LevelColors = Readonly<Record<string, IvyColorName>>;

/**
 * `config.yaml`'s `levels` as the lookup `GetLevelColor` is
 * (`Services/ConfigService.cs:700-704`):
 *
 * ```csharp
 * var colorStr = Settings.Levels.FirstOrDefault(l => l.Name == level)?.Color;
 * return !string.IsNullOrEmpty(colorStr) && Enum.TryParse<Colors>(colorStr, ignoreCase: true, out var c) ? c : null;
 * ```
 *
 * Keyed by the level name exactly as stored, because that `==` is an ordinal comparison — V1 matches
 * a level's name case-sensitively even though it parses its *colour* case-insensitively, and a lookup
 * that quietly matched more than V1's would colour badges V1 leaves grey.
 *
 * A level whose colour does not parse is left out rather than stored as a fallback, so
 * {@link resolveLevelColor} cannot tell it apart from a level nobody configured — which is precisely
 * V1's behaviour, since `GetLevelColor` returns `null` for both.
 */
export function levelColorMap(levels: readonly LevelColorSource[]): LevelColors {
  const map: Record<string, IvyColorName> = {};
  for (const level of levels) {
    const color = levelBadgeColor(level.color);
    if (color) map[level.name] = color;
  }
  return map;
}

/**
 * The colour a level badge is tinted, or `undefined` for no tint.
 *
 * `config.GetLevelColor(plan.Level) ?? Colors.Gray` (`Apps/Icebox/SidebarView.cs:25`): a level the
 * configuration does not colour still gets a badge, and that badge is grey. Unlike the Settings
 * colour cell — see {@link levelBadgeColor} — grey *is* the right answer here, because this badge
 * exists to label the level rather than to report whether its colour was spelt correctly.
 *
 * `colors` being `undefined` is the separate case of configuration not having been read yet, and is
 * the one thing that renders untinted: a card must not flash grey on its way to its real colour, and
 * a failed config read must leave a plain badge rather than assert a colour nobody chose. That is the
 * same choice `ProjectBadges` makes while `listProjects` is in flight.
 */
export function resolveLevelColor(
  level: string | undefined,
  colors: LevelColors | undefined,
): IvyColorName | undefined {
  if (!level || !colors) return undefined;
  return colors[level] ?? "Gray";
}
