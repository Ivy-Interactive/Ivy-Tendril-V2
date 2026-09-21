import * as React from "react";
import { Badge } from "@ivy-interactive/components/ui";
import { bridge } from "../api/bridge";
import { readLevels } from "../views/settings/projectConfig";
import { levelColorMap, resolveLevelColor, type LevelColors } from "../utils/levelColor";

/**
 * Every configured level's colour, by level name — `IConfigService.GetLevelColor` as a hook.
 *
 * `undefined` until configuration has been read, which is not the same as "no level is coloured":
 * {@link resolveLevelColor} tints nothing while it is undefined and falls back to V1's grey once it
 * is known, so a badge cannot flash the wrong colour on the way to the right one.
 *
 * Read per mount rather than cached, for the reason `useProjectColors` gives: V1 reads the colour
 * straight off `IConfigService` at render, so a colour changed in Settings is the colour the next
 * screen shows. A failed read leaves the colours unknown and the badges plain, never missing.
 */
export function useLevelColors(): LevelColors | undefined {
  const [colors, setColors] = React.useState<LevelColors | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    bridge
      .getConfig()
      .then((config) => {
        if (cancelled) return;
        setColors(levelColorMap(readLevels(config)));
      })
      .catch(() => {
        // An unreadable config is an untinted badge, never a missing one.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return colors;
}

export interface LevelBadgeProps {
  /** The plan's `level`, i.e. the name of one of `config.yaml`'s `levels`. */
  level: string | undefined;
  /** `Small` for the sidebar-sized badge V1's Icebox row uses (`new Badge(...).Small()`). */
  density?: "Small" | "Medium" | "Large";
}

/**
 * A plan's level, tinted the colour that level is configured with.
 *
 * `Apps/Icebox/SidebarView.cs:25`:
 *
 * ```csharp
 * new Badge(plan.Level).Color(config.GetLevelColor(plan.Level) ?? Colors.Gray).Small()
 * ```
 *
 * The colour is a *lookup of the level's name* in `config.yaml`'s `levels`, not a property of the
 * plan and not a palette invented here — the shipped defaults are Bug/Red, Feature/Blue, Epic/Purple,
 * Chore/Slate and Nitpick/Gray (`default_levels()`, `config/settings.rs`, matching V1's
 * `ConfigService.cs:314-318`), and an operator who recolours a level in Settings recolours every one
 * of these badges.
 *
 * The tint is handed to `Badge`'s `color` prop, which is the package's existing `BadgeColorMapping`
 * route — the same one the Settings colour cell uses — so no colour classes are written at a call
 * site and nothing here needs to know what a design token is.
 *
 * Nothing is rendered for a plan with no level, matching `PlansApp.BuildRowBadges`'s
 * `if (!string.IsNullOrEmpty(plan.Level))` guard. An empty badge would otherwise be a coloured chip
 * with no text in it.
 */
export const LevelBadge: React.FC<LevelBadgeProps> = ({ level, density }) => {
  const colors = useLevelColors();
  if (!level) return null;

  const color = resolveLevelColor(level, colors);
  return (
    <Badge
      color={color}
      variant={color ? undefined : "outline"}
      density={density}
      data-testid={`level-badge-${level}`}
      data-level-color={color}
    >
      {level}
    </Badge>
  );
};
