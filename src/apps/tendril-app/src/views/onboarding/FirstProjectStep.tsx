import React from "react";
import { FolderOpen, Plus, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  classifyRepoPath,
  describeProjectNameError,
  extractRepoName,
  isValidProjectName,
  isValidRepoPath,
  normalizeRepoPath,
  sanitizeProjectName,
} from "./validation";

export interface FirstProjectStepProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  repoPaths: string[];
  onReposChange: (paths: string[]) => void;
  /** Starts `SetupProject` for a project that has already been registered. */
  onConfigureVerifications: () => void;
  /** True once Create Project has registered the project and handed off to `AddProject`. */
  projectRegistered: boolean;
  /**
   * True when a project of this name is already in `config.yaml`. V1's `ProjectInputStepView`
   * blocks Create Project on it and offers the existing project instead.
   */
  nameExists: boolean;
  /** V1's "Use Existing Project Configuration": adopt the existing project and move on. */
  onUseExisting: () => void;
  busy: boolean;
}

/**
 * V1's `ProjectInputStepView`, whose whole content is the repo picker followed by the name field -
 * repositories first, because `ProjectRepoPickerView` fills the name in from the first repo it
 * adds. Verifications, review actions and the stack hash are the `AddProject` promptware's job,
 * which the wizard starts on Create Project rather than reimplementing that derivation here.
 *
 * Both of V1's guards on this step are here, because a wizard that finishes with an unusable
 * project is worse than one that refuses: the name is sanitized on every keystroke to V1's
 * character set (`ProjectInputStepView`'s `UseEffect` over `projectName`), and a repository is
 * rejected unless `RepoPathValidator` recognises it (`ProjectRepoPickerView.AddAsync`).
 */
export function FirstProjectStep({
  projectName,
  onProjectNameChange,
  repoPaths,
  onReposChange,
  onConfigureVerifications,
  projectRegistered,
  nameExists,
  onUseExisting,
  busy,
}: FirstProjectStepProps) {
  const [repoInput, setRepoInput] = React.useState("");
  const [addError, setAddError] = React.useState<string | null>(null);

  /**
   * V1 `ProjectRepoPickerView.AddAsync`, in its order: normalize, reject an unrecognised path,
   * dedupe case-insensitively, then add and suggest the project name.
   */
  const addRepo = (raw: string) => {
    const path = normalizeRepoPath(raw);
    if (!path) return;
    setAddError(null);

    if (!isValidRepoPath(path)) {
      // V1's wording, verbatim. A bare `foo` or a relative `../x` lands here.
      setAddError("Invalid repository path.");
      return;
    }

    // V1 clones a remote into `<TendrilHome>/<project>/<owner>/<repo>` before it writes the
    // project (`OnboardingRepoHelper.ResolveReposAsync`). V2 has no clone path in the daemon, so
    // storing the URL as a repository path would write a project nothing downstream can use.
    if (classifyRepoPath(path) !== "local") {
      setAddError(
        `Tendril cannot clone ${path} during setup. Clone it yourself, then add the local folder.`,
      );
      return;
    }

    if (repoPaths.some((existing) => existing.toLowerCase() === path.toLowerCase())) {
      setRepoInput("");
      return;
    }

    onReposChange([...repoPaths, path]);
    setRepoInput("");
    // V1's picker suggests the repo's own name, sanitized, when the operator has not typed one.
    if (!projectName.trim()) {
      const suggested = extractRepoName(path);
      if (suggested) onProjectNameChange(sanitizeProjectName(suggested));
    }
  };

  // V1 replaces this whole step with its sub-step 1 once the project is committed, so nothing here
  // is editable any more; V2 stays on the step, and disabling says the same thing.
  const locked = projectRegistered;

  // V1 keeps the sanitized value in the state itself, so what the operator sees is what gets
  // written. The only names that survive sanitizing and are still invalid are `.` and `..`.
  const trimmedName = projectName.trim();
  const nameError =
    trimmedName.length > 0 && !isValidProjectName(trimmedName)
      ? describeProjectNameError(trimmedName)
      : null;

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
            disabled={locked}
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
            disabled={locked}
            data-testid="onboarding-pick-repos"
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-2 text-xs text-foreground hover:bg-muted disabled:opacity-50"
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
                  disabled={locked}
                  aria-label={`Remove ${path}`}
                  className="shrink-0 rounded-md border border-border p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
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
          disabled={locked || !repoInput.trim()}
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
          disabled={locked}
          onChange={(e) => onProjectNameChange(sanitizeProjectName(e.target.value))}
          data-testid="onboarding-project-name"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
        {nameError && (
          <p className="text-xs text-destructive" data-testid="onboarding-project-name-error">
            {nameError}
          </p>
        )}
      </div>

      {/* V1's conflict box, wording included: a name clash is resolvable two ways, and V1 offers
          both rather than just refusing. */}
      {nameExists && (
        <div
          className="space-y-2 rounded-md border border-destructive p-2"
          data-testid="onboarding-project-name-exists"
        >
          <p className="text-xs font-bold text-destructive">
            A project with this name already exists.
          </p>
          <p className="text-xs text-muted-foreground">
            To resolve this conflict, you can either enter a different name above, or proceed using
            the existing project&apos;s configuration (its repository path and settings will be
            preserved).
          </p>
          <button
            type="button"
            onClick={onUseExisting}
            disabled={busy}
            data-testid="onboarding-use-existing-project"
            className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
          >
            Use Existing Project Configuration
          </button>
        </div>
      )}

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
