/**
 * An Ivy `Colors` name as the CSS custom property the theme publishes for it.
 *
 * The framework's widgets are coloured by *name* — `Colors.Blue`, `Colors.Amber`, `Colors.Slate` — and
 * a host hands those names straight through (a project's configured colour, V1's
 * `Constants.JobStatusColors`, its `JobTypeColors`). `styles/tokens.css` defines one variable per name,
 * so resolving a name is a string transform rather than a lookup table that would have to be kept in
 * step with the palette.
 *
 * `PascalCase` and `camelCase` both split on the case boundary, so `IvyGreen` reaches `--ivy-green`.
 * `currentColor` is the fallback: an unknown name inherits the text colour rather than rendering
 * transparent, so a badge whose colour nobody defined is still readable.
 */
export const ivyColorVar = (name: string): string =>
  `var(--${name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}, currentColor)`;
