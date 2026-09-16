import * as React from "react";
import { ivyColorVar } from "@ivy-interactive/components";
import { Badge } from "@ivy-interactive/components/ui";
import { bridge } from "../api/bridge";
import { parseProjects } from "../views/PlansView";

/**
 * Each project's configured colour, by project name.
 *
 * V1 reads it straight off configuration — `ConfigService.WithProjectColor` is
 * `config.GetProjectColor(projectName)` — so nothing here caches across mounts: a colour changed in
 * Settings should be the colour the next plan page shows. A failed read leaves the map empty, which
 * renders untinted badges rather than no badges.
 */
export function useProjectColors(): Record<string, string> {
  const [colors, setColors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    let cancelled = false;
    bridge
      .listProjects()
      .then((projects) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const project of projects) {
          const color = project.color?.trim();
          if (color) next[project.name] = color;
        }
        setColors(next);
      })
      .catch(() => {
        // An unreadable project list is an uncoloured badge, never a missing one.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return colors;
}

export interface ProjectBadgesProps {
  /** The plan's `project` field, which may name several, comma-joined. */
  project: string | undefined;
}

/**
 * The plan and review pages' project badges — `ProjectHelper.BuildBadges(plan.Project, config)`:
 *
 * ```csharp
 * foreach (var project in ParseProjects(projectValue))
 *     yield return new Badge(project).Variant(BadgeVariant.Outline).WithProjectColor(config, project);
 * ```
 *
 * Two details of that are easy to get wrong and are both deliberate here.
 *
 * **One badge per project.** A plan's `project` can be a joined list — `"beta, docs"` occurs in real
 * data — and V1 splits it. A single badge holding the joined string would read as a project nobody has
 * configured, and would be tinted by nothing.
 *
 * **No colour means no tint.** `WithProjectColor` is `color.HasValue ? badge.Color(color.Value) : badge`
 * — it returns the badge *unchanged*. That is different from the sidebar markers, which fall back to
 * Slate, and inventing a fallback here would make "unconfigured" indistinguishable from a project
 * somebody deliberately coloured grey.
 *
 * The tint is applied to the border and the text of an outline badge rather than by handing `color` to
 * `Badge`, because that prop switches the badge to the filled `tinted` variant and V1 asks for
 * `BadgeVariant.Outline`. `ivyColorVar` is the package's single colour resolver, so no second mapping
 * table appears here.
 */
export const ProjectBadges: React.FC<ProjectBadgesProps> = ({ project }) => {
  const colors = useProjectColors();

  return (
    <>
      {parseProjects(project).map((name) => {
        const color = colors[name];
        return (
          <Badge
            key={name}
            variant="outline"
            data-testid={`project-badge-${name}`}
            data-project-color={color}
            style={
              color ? { borderColor: ivyColorVar(color), color: ivyColorVar(color) } : undefined
            }
          >
            {name}
          </Badge>
        );
      })}
    </>
  );
};
