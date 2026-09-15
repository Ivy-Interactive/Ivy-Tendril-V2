import React from "react";
import { FolderOpen, Plus, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";

export interface FirstProjectStepProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  repoPaths: string[];
  onReposChange: (paths: string[]) => void;
  /** Starts `SetupProject` for a project that has already been registered. */
  onConfigureVerifications: () => void;
  /** True once Create Project has registered the project and handed off to `AddProject`. */
  projectRegistered: boolean;
  busy: boolean;
}

/**
 * V1's `ProjectInputStepView`, whose whole content is the repo picker followed by the name field -
 * repositories first, because `ProjectRepoPickerView` fills the name in from the first repo it
 * adds. Verifications, review actions and the stack hash are the `AddProject` promptware's job,
 * which the wizard starts on Create Project rather than reimplementing that derivation here.
 */
export function FirstProjectStep({
  projectName,
  onProjectNameChange,
  repoPaths,
  onReposChange,
  onConfigureVerifications,
  projectRegistered,
  busy,
}: FirstProjectStepProps) {
  const [repoInput, setRepoInput] = React.useState("");
  const [addError, setAddError] = React.useState<string | null>(null);

  const addRepo = (raw: string) => {
    const path = raw.trim();
    if (!path) return;
    setAddError(null);
    if (repoPaths.includes(path)) {
      setRepoInput("");
      return;
    }
    onReposChange([...repoPaths, path]);
    setRepoInput("");
    // V1's picker suggests the repo's own name when the operator has not typed one.
    if (!projectName.trim()) {
      const leaf = path.split(/[/\\]/).filter(Boolean).pop();
      if (leaf) onProjectNameChange(leaf.replace(/\.git$/i, ""));
    }
  };

  /**
   * V1's Browse button fills the input rather than adding straight away, so the path can still be
   * edited before it is added.
   */
  const browse = async () => {
    setAddError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select repository folder",
      });
      if (typeof selected === "string" && selected) setRepoInput(selected);
    } catch (err) {
      // The native picker is unavailable outside the Tauri shell; typing a path still works.
      setAddError(
        `Folder picker unavailable (${err instanceof Error ? err.message : String(err)}). Type a path instead.`,
      );
    }
  };

  return (
    <div className="space-y-4" data-testid="onboarding-step-project">
      <h3 className="text-base font-semibold text-foreground">Setup your first project</h3>
      <p className="text-sm text-muted-foreground">
        A project groups one or more repositories together so Tendril can plan and verify changes
        across them.
      </p>

      <div className="space-y-2">
        <span className="block text-xs font-medium text-foreground">
          Add one or more Git repositories
        </span>

        {addError && (
          <p className="text-xs text-destructive" data-testid="onboarding-picker-error">
            {addError}
          </p>
        )}

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="Repository URL or Local Path"
            data-testid="onboarding-repo-input"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              addRepo(e.currentTarget.value);
            }}
          />
          <button
            type="button"
            onClick={() => void browse()}
            data-testid="onboarding-pick-repos"
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-2 text-xs text-foreground hover:bg-muted"
          >
            <FolderOpen className="size-3.5" aria-hidden="true" />
            Browse
          </button>
        </div>

        {repoPaths.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {repoPaths.map((path) => (
              <li key={path} className="flex items-center justify-between gap-3 p-2">
                <span className="min-w-0 break-all font-mono text-xs text-primary">{path}</span>
                <button
                  type="button"
                  onClick={() => onReposChange(repoPaths.filter((p) => p !== path))}
                  aria-label={`Remove ${path}`}
                  className="shrink-0 rounded-md border border-border p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => addRepo(repoInput)}
          disabled={!repoInput.trim()}
          data-testid="onboarding-add-repo"
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add Repository
        </button>
      </div>

      <div className="space-y-1">
        <label
          className="block text-xs font-medium text-foreground"
          htmlFor="onboarding-project-name"
        >
          Project Name <span className="text-destructive">*</span>
        </label>
        <input
          id="onboarding-project-name"
          type="text"
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          data-testid="onboarding-project-name"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {projectRegistered && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p data-testid="onboarding-project-registered">
            Tendril is detecting your tech stack and configuring your agentic harness. This will
            take a few minutes, so treat yourself to a ☕ while you wait. You can watch{" "}
            {projectName} under Jobs.
          </p>
          <button
            type="button"
            onClick={onConfigureVerifications}
            disabled={busy}
            data-testid="onboarding-configure-verifications"
            className="mt-2 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
          >
            Configure verifications now
          </button>
        </div>
      )}
    </div>
  );
}
