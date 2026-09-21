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
