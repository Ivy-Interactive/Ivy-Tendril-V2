import React from "react";
import { ArrowLeft, ArrowRight, Plus, X } from "lucide-react";
import { Button, Callout, Input, Spinner } from "@ivy-interactive/components/ui";
import { jobsStore } from "../../state/jobsStore";
import { describeBridgeError } from "../../types/api";
import { i18n, useTranslation } from "../../i18n";
import type { ProjectEntry } from "./projectConfig";
import { SaveError, SettingsSection, SubSection, TextField } from "./fields";
import {
  classifyRepoPath,
  extractRepoName,
  isValidRepoPath,
  normalizeRepoPath,
} from "../onboarding/validation";

/**
 * `Apps/Settings/Blades/AddProjectBladeView.cs`, which is what the "Add Project" sub-item under the
 * Projects row opens.
 *
 * V1's blade is three steps, and so is this: `ProjectInputStepView` takes the name and repositories,
 * `ProjectAgentStepView` registers the project and runs the stack-analysis agent over it, and
 * `ProjectCrudStepView` shows the harness that run produced. This used to stop after the first step
 * and say in a callout that the other two were unreachable - they are not: `AddProjectArgs` is a real
 * job type (`tendril-core/src/models/job.rs`), its promptware is `src/promptwares/AddProject`, and
 * `OnboardingWizard` has been starting it the whole time. The blade was simply the one caller that
 * never wired it up.
 *
 * Two deliberate differences from V1, both because V2's job hand-off is a daemon call rather than an
 * in-process `PromptwareRunHandle`:
 *
 * - **V1's Background button and its Next run the same job**; the difference is only whether the
 *   blade stays open to watch it. Since V2 always watches through the jobs stream, the pair collapses
 *   into "Create Project" (watch it here) and "Create in Background" (hand it over and close), which
 *   is what V1's two buttons amount to.
 * - **Cancelling after the agent step does not un-create the project.** V1's `RemoveCommittedProject`
 *   edits `config.Settings.Projects` in memory and saves, silently. V2's removal is
 *   `DELETE /api/projects/:name`, and it is deliberately not run from here: a Cancel that deleted a
 *   project the setup agent may already have cloned repositories into is a destructive act behind a
 *   non-destructive word. So the step-1 Back button is gone once the project is registered, the copy
 *   says the project exists rather than pretending it can be rolled back, and Remove Project on the
 *   project's own screen - with its confirm - is where a removal goes.
 *
 * The name check is `InputSanitizer.DescribeProjectNameError`'s two refusals plus V1's
 * case-insensitive duplicate check.
 */

/** V1 `AddProjectBladeView`'s `step`: input, the agent run, then the harness it produced. */
type Step = "input" | "agent" | "harness";

export interface AddProjectViewProps {
  existingNames: string[];
  /**
   * Registers the project and re-reads the config. Resolves once the row exists, which is the
   * precondition `AddProject`'s promptware opens with ("Run `tendril project list` to confirm the
   * project exists"), so the job is only started after this settles.
   */
  /** Writes the project row and answers with the repository paths that were actually stored. */
  onCreate: (name: string, repos: string[]) => Promise<string[]>;
  /** The freshly written project, once the config has been re-read. Drives the harness step. */
  createdProject?: ProjectEntry | null;
  /**
   * Leaves the blade, the way V1's final `bladeContext.Pop(this)` does. `"background"` is the
   * hand-off exit (V1 `onBgJob`) and `"created"` the one after Finish, because V1 raises a different
   * toast for each.
   *
   * The name is passed rather than read back off the caller's state: the background exit fires from
   * inside the same `create` call that registered the project, so a `createdProjectName` set by
   * {@link onCreate} has not reached the closure this `onFinish` came from, and the caller would
   * name a project it thinks does not exist yet.
   */
  onFinish: (outcome: "created" | "background", name: string) => void;
  /**
   * Re-reads config.yaml. Called when the setup run ends: the agent writes verifications and review
   * actions through the `tendril` CLI, so the harness step is reading a file that changed under the
   * app. V1 does the same from its completion handler (`config.ReloadSettings()` then a refresh
   * token bump that `ProjectCrudStepView` reads through).
   */
  onReloadConfig: () => Promise<void>;
}

/**
 * `InputSanitizer.DescribeProjectNameError`: blank, and the characters a directory name cannot hold.
 * Translated when it is called, in the language current at that moment.
 */
export function describeProjectNameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return i18n.t("onboarding:addProject.nameRequired");
  if (/[/\\:*?"<>|]/.test(trimmed)) {
    return i18n.t("onboarding:addProject.nameInvalidChars");
  }
  return null;
}

/**
 * The live `AddProject` run. Lazy for the reason `JobsView` gives for the same component: it is the
 * only thing in the settings area that pulls in `AgentViewer`, and it is fetched when a project is
 * actually created rather than with the settings pane.
 */
const AgentRunPanel = React.lazy(() =>
  import("./AddProjectAgentRun").then((m) => ({ default: m.AddProjectAgentRun })),
);

export const AddProjectView: React.FC<AddProjectViewProps> = ({
  existingNames,
  onCreate,
  createdProject,
  onFinish,
  onReloadConfig,
}) => {
  const { t } = useTranslation("onboarding");
  const [step, setStep] = React.useState<Step>("input");
  const [name, setName] = React.useState("");
  const [repos, setRepos] = React.useState<string[]>([]);
  const [repoDraft, setRepoDraft] = React.useState("");
  const [repoError, setRepoError] = React.useState<string | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);
  /** Set once the run reports a terminal status, which is what ungates Next on the agent step. */
  const [agentFinished, setAgentFinished] = React.useState(false);

  const trimmed = name.trim();
  const nameError =
    describeProjectNameError(name) ??
    (existingNames.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())
      ? t("addProject.nameExists", { name: trimmed })
      : null);

  /**
   * V1 `ProjectRepoPickerView.AddAsync`, in its order: normalize, refuse what `RepoPathValidator`
   * does not recognise, dedupe case-insensitively, then seed the name. Without the refusal a typo
   * like `tendril` reaches `POST /api/projects` as a repository path and is stored as one.
   */
  const addRepo = () => {
    const path = normalizeRepoPath(repoDraft);
    if (path === "") return;
    setRepoError(null);

    if (!isValidRepoPath(path)) {
      setRepoError(t("repoPicker.invalidPath"));
      return;
    }

    setRepos((prev) =>
      prev.some((p) => p.toLowerCase() === path.toLowerCase()) ? prev : [...prev, path],
    );
    // V1 seeds a blank project name from the repository name on the first add.
    if (trimmed === "") {
      const leaf = extractRepoName(path) ?? "";
      if (leaf !== "") setName(leaf);
    }
    setRepoDraft("");
  };

  /**
   * `ProjectAgentStepView`'s effect, in the order it runs it: write the project, *then* hand the
   * derivation work to the agent. The order matters and is the same reason `OnboardingWizard` gives -
   * the promptware's first step confirms the project exists, so the config row has to be there first.
   *
   * A failed hand-off is reported but does not undo the create: the project is registered and usable,
   * and V1 does not roll back on a failed promptware run either.
   */
  const create = async (background: boolean) => {
    if (nameError || repos.length === 0) return;
    setIsCreating(true);
    setError(null);
    let resolved = repos;
    try {
      // A remote among `repos` is cloned by the create, and the paths it answers with are the only
      // record of where. `AddProject` inspects them on disk, so it gets those, not the URLs.
      resolved = await onCreate(trimmed, repos);
    } catch (err) {
      setError(t("addProject.createFailed", { error: describeBridgeError(err) }));
      setIsCreating(false);
      return;
    }

    try {
      const started = await jobsStore.startJob({
        type: "AddProject",
        projectName: trimmed,
        repos: resolved.map((path) => ({ path })),
      });
      setJobId(started.jobId);
      if (background) {
        // V1's Background button: `Toast("Created background job...")` then `Pop(this)`. The job runs
        // on without a viewer; the Jobs app is where it is watched from.
        onFinish("background", trimmed);
        return;
      }
      setStep("agent");
    } catch (err) {
      setError(t("addProject.setupNotStarted", { error: describeBridgeError(err) }));
      // The project exists, so there is no going back to the input step - forward to the harness,
      // which will simply show it unconfigured.
      setStep("harness");
    } finally {
      setIsCreating(false);
    }
  };

  const canContinue = repos.length > 0 && nameError === null;

  if (step === "input") {
    return (
      <SettingsSection
        title={t("addProject.title")}
        hint={t("addProject.hint")}
        testId="add-project-card"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create(false);
          }}
        >
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">{t("repoPicker.label")}</p>
            {repos.map((path, index) => (
              <div key={path} className="flex items-center gap-2 rounded-selector bg-muted/50 p-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-primary">
                  {path}
                  {classifyRepoPath(path) !== "local" && (
                    <span className="ml-2 font-sans text-muted-foreground">
                      {t("repoPicker.willClone")}
                    </span>
                  )}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("repoPicker.remove", { path })}
                  onClick={() => setRepos((prev) => prev.filter((_, i) => i !== index))}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={t("repoPicker.inputLabel")}
                value={repoDraft}
                placeholder={t("repoPicker.placeholder")}
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
                {t("repoPicker.add")}
              </Button>
            </div>
            {repoError && (
              <p className="text-xs text-destructive" data-testid="add-project-repo-error">
                {repoError}
              </p>
            )}
          </div>

          <TextField
            id="new-project-name"
            label={t("addProject.nameLabel")}
            value={name}
            placeholder={t("addProject.namePlaceholder")}
            error={name === "" ? null : nameError}
            onChange={setName}
          />

          <SaveError message={error} />

          {/* `ProjectInputStepView`'s button area: the background hand-off beside the one that stays
              to watch. V1 gates Background behind the beta flag; V2 does not, because it is the only
              way to start the run without holding the blade open and nothing about it is unfinished. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!canContinue || isCreating}>
              {isCreating ? t("addProject.creating") : t("actions.createProject")}
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canContinue || isCreating}
              onClick={() => void create(true)}
              data-testid="add-project-background"
            >
              {t("addProject.createInBackground")}
            </Button>
          </div>
        </form>
      </SettingsSection>
    );
  }

  if (step === "agent") {
    return (
      <SettingsSection
        title={t("agentRun.title")}
        hint={t("addProject.agentHint")}
        testId="add-project-agent-step"
      >
        <div className="space-y-4">
          <SaveError message={error} />
          <React.Suspense
            fallback={
              <div
                className="flex h-32 items-center justify-center text-muted-foreground"
                data-testid="add-project-agent-loading"
              >
                <Spinner size="lg" className="text-success" aria-hidden />
              </div>
            }
          >
            {jobId && (
              <AgentRunPanel
                jobId={jobId}
                onFinished={() => {
                  setAgentFinished(true);
                  void onReloadConfig();
                }}
              />
            )}
          </React.Suspense>

          {/* No Back: V1's goes with `RemoveCommittedProject`, and V2 cannot remove a project. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => setStep("harness")}
              disabled={!agentFinished}
              data-testid="add-project-agent-next"
            >
              {t("actions.next")}
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep("harness")}
              data-testid="add-project-agent-skip"
            >
              {t("actions.skip")}
            </Button>
          </div>
        </div>
      </SettingsSection>
    );
  }

  /**
   * `ProjectCrudStepView`: what the run configured, read back off the project row. It lists rather
   * than edits - every one of these has a full editor on the project's own settings screen, which
   * Finish lands on, so duplicating the blades here would be two places to fix one bug.
   */
  const verifications = createdProject?.verifications ?? [];
  const reviewActions = createdProject?.reviewActions ?? [];

  return (
    <SettingsSection
      title={t("harness.title")}
      hint={t("harness.description")}
      testId="add-project-harness-step"
    >
      <div className="space-y-6">
        <SaveError message={error} />

        <SubSection
          title={t("harness.verifications.title")}
          hint={t("harness.verifications.hint")}
          count={verifications.length}
          testId="add-project-verifications"
        >
          {verifications.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("addProject.noVerifications")}</p>
          ) : (
            <ul className="space-y-1">
              {verifications.map((verification) => (
                <li
                  key={verification.name}
                  className="flex items-center gap-2 rounded-selector bg-muted/50 px-2 py-1.5 text-xs"
                >
                  <span className="font-medium text-foreground">{verification.name}</span>
                  {verification.required && (
                    <span className="text-muted-foreground">
                      {t("addProject.verificationRequired")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SubSection>

        <SubSection
          title={t("harness.reviewActions.title")}
          hint={t("harness.reviewActions.hint")}
          count={reviewActions.length}
          testId="add-project-review-actions"
        >
          {reviewActions.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("addProject.noReviewActions")}</p>
          ) : (
            <ul className="space-y-1">
              {reviewActions.map((action) => (
                <li key={action.name} className="rounded-selector bg-muted/50 px-2 py-1.5">
                  <p className="text-xs font-medium text-foreground">{action.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {action.command}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SubSection>

        {verifications.length === 0 && reviewActions.length === 0 && (
          <Callout.Info data-testid="add-project-harness-empty">
            {t("addProject.harnessEmpty")}
          </Callout.Info>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setStep("agent")}>
            <ArrowLeft className="size-4" aria-hidden />
            {t("actions.back")}
          </Button>
          <Button
            type="button"
            onClick={() => onFinish("created", trimmed)}
            data-testid="add-project-finish"
          >
            {t("actions.finish")}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
};
