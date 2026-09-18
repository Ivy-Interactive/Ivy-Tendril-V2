import React from "react";
import { Plus, X } from "lucide-react";
import { Button, Callout, Input } from "@ivy-interactive/components/ui";
import { describeBridgeError } from "../../types/api";
import { SaveError, SettingsSection, TextField } from "./fields";

/**
 * `Apps/Settings/Blades/AddProjectBladeView.cs` step 0 (`ProjectInputStepView`), which is what the
 * "Add Project" sub-item under the Projects row opens.
 *
 * V1's blade has three steps: the name and repositories, then an agent-driven stack analysis, then a
 * CRUD confirmation, and it can also hand the whole thing to a background `AddProjectArgs` job. Only
 * the first step has a counterpart here - `POST /api/projects` (`bridge.createProject`) is the one
 * project-creating call the app can make - so the agent step and the background-job button are
 * omitted rather than faked, and the callout says so.
 *
 * The name check is `InputSanitizer.DescribeProjectNameError`'s two refusals plus V1's
 * case-insensitive duplicate check.
 */

export interface AddProjectViewProps {
  existingNames: string[];
  onCreate: (name: string, repos: string[]) => Promise<void>;
}

/** `InputSanitizer.DescribeProjectNameError`: blank, and the characters a directory name cannot hold. */
export function describeProjectNameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "A project needs a name.";
  if (/[/\\:*?"<>|]/.test(trimmed)) {
    return 'A project name cannot contain / \\ : * ? " < > or |.';
  }
  return null;
}

export const AddProjectView: React.FC<AddProjectViewProps> = ({ existingNames, onCreate }) => {
  const [name, setName] = React.useState("");
  const [repos, setRepos] = React.useState<string[]>([]);
  const [repoDraft, setRepoDraft] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const trimmed = name.trim();
  const nameError =
    describeProjectNameError(name) ??
    (existingNames.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())
      ? `A project named '${trimmed}' already exists.`
      : null);

  const addRepo = () => {
    const path = repoDraft.trim();
    if (path === "") return;
    setRepos((prev) =>
      prev.some((p) => p.toLowerCase() === path.toLowerCase()) ? prev : [...prev, path],
    );
    // V1 seeds a blank project name from the repository name on the first add.
    if (trimmed === "") {
      const leaf =
        path
          .replace(/[/\\]+$/, "")
          .split(/[/\\]/)
          .pop() ?? "";
      if (leaf !== "") setName(leaf.replace(/\.git$/i, ""));
    }
    setRepoDraft("");
  };

  const create = async () => {
    if (nameError) return;
    setIsCreating(true);
    setError(null);
    try {
      await onCreate(trimmed, repos);
    } catch (err) {
      setError(`Failed to create project: ${describeBridgeError(err)}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <SettingsSection
      title="Add a Project"
      hint="Name the project and point it at one or more Git repositories."
      testId="add-project-card"
    >
      <form
        className="max-w-170 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Add one or more Git repositories
          </p>
          {repos.map((path, index) => (
            <div key={path} className="flex items-center gap-2 rounded-selector bg-muted/50 p-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-primary">{path}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Remove ${path}`}
                onClick={() => setRepos((prev) => prev.filter((_, i) => i !== index))}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Repository URL or Local Path"
              value={repoDraft}
              placeholder="Repository URL or Local Path"
              className="min-w-60 flex-1"
              onChange={(e) => setRepoDraft(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={repoDraft.trim() === ""}
              onClick={addRepo}
            >
              <Plus className="size-4" aria-hidden />
              Add Repository
            </Button>
          </div>
        </div>

        <TextField
          id="new-project-name"
          label="Name"
          value={name}
          placeholder="Project name..."
          error={name === "" ? null : nameError}
          onChange={setName}
        />

        <SaveError message={error} />

        <Button type="submit" disabled={nameError !== null || isCreating}>
          {isCreating ? "Creating..." : "Create Project"}
        </Button>

        <Callout.Info data-testid="add-project-limits">
          V1 follows this step with an agent-driven stack analysis and can hand the whole setup to a
          background job. Neither is reachable from this app, so the project is created with just
          its name and repositories; everything else is configured from its own row.
        </Callout.Info>
      </form>
    </SettingsSection>
  );
};
