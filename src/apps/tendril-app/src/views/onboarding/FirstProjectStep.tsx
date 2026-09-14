import React from "react";
import { open } from "@tauri-apps/plugin-dialog";

export interface FirstProjectStepProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  repoPaths: string[];
  onReposChange: (paths: string[]) => void;
  /** Starts `SetupProject` for a project that has already been registered. */
  onConfigureVerifications: () => void;
  /** True once Continue has registered the project and handed off to `AddProject`. */
  projectRegistered: boolean;
  busy: boolean;
}

/**
 * Name plus repository paths — nothing more. Verifications, review actions and the stack hash are
 * the `AddProject` promptware's job, which the wizard starts on Continue rather than reimplementing
 * that derivation here.
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
  const [pickerError, setPickerError] = React.useState<string | null>(null);

  const pickRepos = async () => {
    setPickerError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: true,
        title: "Select Repositories",
      });
      if (selected === null) return;
      const picked = Array.isArray(selected) ? selected : [selected];
      const merged = [...repoPaths];
      for (const path of picked) {
        if (!merged.includes(path)) merged.push(path);
      }
      onReposChange(merged);
      // A first repo is the natural project name when the operator has not typed one.
      if (!projectName.trim() && picked[0]) {
        const leaf = picked[0].split(/[/\\]/).filter(Boolean).pop();
        if (leaf) onProjectNameChange(leaf);
      }
    } catch (err) {
      // The native picker is unavailable outside the Tauri shell; typing a path still works.
      setPickerError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-4" data-testid="onboarding-step-project">
      <p className="text-sm text-muted-foreground">
        A project is a name and the repositories its plans touch. Tendril works out the
        verifications and review actions for you once the project exists.
      </p>

      <label
        className="block text-xs font-medium text-foreground"
        htmlFor="onboarding-project-name"
      >
        Project name
      </label>
      <input
        id="onboarding-project-name"
        type="text"
        value={projectName}
        onChange={(e) => onProjectNameChange(e.target.value)}
        placeholder="My-Project"
        data-testid="onboarding-project-name"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
      />

      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Repositories</span>
        <button
          type="button"
          onClick={() => void pickRepos()}
          data-testid="onboarding-pick-repos"
          className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted"
        >
          Choose folders…
        </button>
      </div>

      {pickerError && (
        <p className="text-xs text-muted-foreground" data-testid="onboarding-picker-error">
          Folder picker unavailable ({pickerError}). Paste a path below instead.
        </p>
      )}

      <input
        type="text"
        placeholder="/path/to/repo — press Enter to add"
        data-testid="onboarding-repo-input"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const value = e.currentTarget.value.trim();
          if (!value || repoPaths.includes(value)) return;
          onReposChange([...repoPaths, value]);
          e.currentTarget.value = "";
        }}
      />

      {repoPaths.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {repoPaths.map((path) => (
            <li key={path} className="flex items-center justify-between gap-3 p-2">
              <span className="min-w-0 break-all font-mono text-xs text-foreground">{path}</span>
              <button
                type="button"
                onClick={() => onReposChange(repoPaths.filter((p) => p !== path))}
                aria-label={`Remove ${path}`}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {projectRegistered && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p data-testid="onboarding-project-registered">
            {projectName} is registered and an AddProject job is deriving its verifications. You can
            watch it under Jobs.
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
