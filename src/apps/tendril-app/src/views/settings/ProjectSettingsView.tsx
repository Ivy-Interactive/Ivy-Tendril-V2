import React from "react";
import { Pencil } from "lucide-react";
import { BladeContainer, Button } from "@ivy-interactive/components/ui";
import { ProjectNameEditor } from "./projectSettings/blades";
import { ProjectDetailBody } from "./projectSettings/ProjectDetailBody";
import { type ProjectSettingsViewProps } from "./projectSettings/types";

export type { ProjectSettingsViewProps };

/**
 * `Apps/Settings/ProjectDetailView.cs` plus the editors in `Apps/Settings/Blades/`, which is where
 * V1 puts every per-project setting. V2 had none of it: repos and base branches, verifications and
 * their run order, review actions, MCP servers, skills, ports, env files, colour, the inline rename
 * and the danger zone had no counterpart anywhere in the app.
 *
 * The block order is `ProjectDetailView.innerContent`'s: header, repositories, review actions,
 * verifications, ports, environment files, agent behaviour, security, local permissions (MCP),
 * customizations (skills), danger zone. `isBeta` gates the same three blocks it gates in V1.
 *
 * V1 opens each editor as a blade (`IBladeContext.Push`/`Pop`); this uses `BladeContainer`, whose
 * `push`/`pop` are the same contract, with the project detail as the non-closable root at depth 1.
 *
 * Saving mirrors `ProjectDetailView.SaveProjectChanges`: an edit is persisted the moment it is
 * confirmed rather than behind a form-wide Save, because that is what V1's
 * `UseEffect(SaveProjectChanges, [...])` does. Each write sends only the keys that changed, as the
 * one-element `projects` array `merge_projects_by_name` matches by name.
 */

/**
 * The project screen, with `ProjectDetailView` as the non-closable root blade and every editor
 * pushed on top of it - V1's `bladeContext.Push(this, new Edit...BladeView(...))`.
 */
export const ProjectSettingsView: React.FC<ProjectSettingsViewProps> = (props) => {
  const [isRenaming, setIsRenaming] = React.useState(false);

  return (
    <BladeContainer
      aria-label="Project configuration"
      data-testid="project-settings-blades"
      root={{
        title: props.project.name,
        subtitle: "Project configuration",
        width: "flex",
        // V1 renders the name with a Rename pencil beside it. The blade header already renders the
        // name, so the pencil belongs there rather than on a second row that repeats it, and the
        // editor replaces the heading the same way V1's `nameHeader` swaps its `Text.H2`.
        titleSlot: isRenaming ? (
          <ProjectNameEditor
            name={props.project.name}
            siblingNames={props.siblingNames ?? []}
            onReloadConfig={props.onReloadConfig}
            onDone={() => setIsRenaming(false)}
          />
        ) : undefined,
        headerAction: isRenaming ? undefined : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Rename Project"
            aria-label="Rename Project"
            onClick={() => setIsRenaming(true)}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
        ),
        content: <ProjectDetailBody {...props} />,
      }}
    />
  );
};
