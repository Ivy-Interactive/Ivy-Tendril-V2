import React from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { bridge } from "../../api/bridge";
import { jobsStore } from "../../state/jobsStore";
import { describeBridgeError, type DoctorCheck, type OnboardingStatus } from "../../types/api";
import { DataStorageStep, blockingChecks } from "./PrerequisitesStep";
import { CodingAgentStep, agentCheck, agentLabel, machinePrerequisites } from "./CodingAgentStep";
import { FirstProjectStep } from "./FirstProjectStep";
import { CompleteStep } from "./CompleteStep";
import { isValidProjectName, sanitizeProjectName } from "./validation";

/** V1 `OnboardingApp.GetSteps`: four steps, in this order, with these labels. */
const STEP_TITLES = ["Coding Agent", "Data Storage", "Your First Project", "Complete"] as const;

const AGENT_STEP = 0;
const HOME_STEP = 1;
const PROJECT_STEP = 2;
const COMPLETE_STEP = 3;

/**
 * V1 `UxHelper.AnimateProgressAsync` and its `DualLinearEasing`, ported rather than re-tuned: one
 * hundred ticks over fifteen seconds up to a 92% ceiling, three quarters of which are spent in the
 * first quarter of the time. V1 drives this bar for every wait an onboarding step owns.
 */
const PROGRESS_STEPS = 100;
const PROGRESS_DURATION_SECONDS = 15;
const PROGRESS_CEILING = 92;

function dualLinearEasing(t: number): number {
  const transitionPoint = 0.25;
  if (t <= transitionPoint) return (t / transitionPoint) * 0.75;
  return 0.75 + 0.25 * ((t - transitionPoint) / (1 - transitionPoint));
}

export interface OnboardingWizardProps {
  status: OnboardingStatus;
  /** Called once the wizard is done — completed *or* dismissed. The shell refetches from here. */
  onFinished: () => void;
}

const INDICATOR_BASE =
  "relative flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium";

/**
 * V1's onboarding writes `Color = "Green"` on the project it creates
 * (`ProjectAgentStepView.Build`); the daemon's own default is `Blue`, so the wizard has to say so.
 */
const FIRST_PROJECT_COLOR = "Green";

/**
 * The first thing V1 refuses to move past, in `CodingAgentStepView.BuildChecks`'s order: the
 * machine's required tools, then the selected agent's own CLI. The agent row is required here even
 * though the registry marks every agent optional - `BuildAgentCheck` passes `required: true`,
 * because only the agent being picked matters and that one has to be installed.
 */
function missingRequirement(checks: DoctorCheck[], agentId: string): DoctorCheck | null {
  const machine = blockingChecks(machinePrerequisites(checks));
  if (machine.length > 0) return machine[0];
  const agent = agentCheck(checks, agentId);
  if (agent && agent.status !== "Ok") return agent;
  return null;
}

/** V1 `InstallMissingDialog`'s body, collapsed to one line: what is missing and what to do. */
function installMessage(missing: DoctorCheck[]): string {
  return `Tendril needs ${missing.map((check) => check.name).join(", ")} but it isn't installed. Install it, then press Re-check.`;
}

/**
 * The first-run wizard, mirroring V1's `OnboardingApp`: a welcome heading, a four-item stepper, and
 * the step's own view underneath, each step building its own button row.
 *
 * Two V1 decisions shape the flow. Advancing is gated where V1 gates it — a required prerequisite
 * that fails, *or the picked agent's own CLI being absent*, keeps you on the Coding Agent step (V1
 * reopens `InstallMissingDialog` instead of moving on), the Data Storage step needs a path, and Your
 * First Project needs a valid, unused name and at least one repository — and the stepper itself is
 * the way past a step you do not want to fill in, since V1 offers Skip only on the project step.
 * Nothing is written to `config.yaml` before the operator acts: Create Project writes the project,
 * Finish writes `codingAgent` (only if picked) and the onboarding flag, and **Skip setup** — V2's own
 * escape hatch, which V1 has no equivalent for — writes the flag alone.
 *
 * The project section does not auto-advance. V1 spends three sub-steps there (input, the agent run,
 * then Review Harness) and only reaches Complete when the operator asks for it, so Create Project
 * leaves you on the step with the hand-off panel visible and Next takes it from there.
 */
export function OnboardingWizard({ status, onFinished }: OnboardingWizardProps) {
  const [step, setStep] = React.useState(AGENT_STEP);
  const [checks, setChecks] = React.useState<DoctorCheck[]>([]);
  const [checksLoading, setChecksLoading] = React.useState(true);
  const [checksError, setChecksError] = React.useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = React.useState<string | null>(null);
  const [projectName, setProjectName] = React.useState("");
  const [repoPaths, setRepoPaths] = React.useState<string[]>([]);
  const [projectRegistered, setProjectRegistered] = React.useState(false);
  /**
   * The projects `config.yaml` already has, plus anything this wizard registered. V1 reads
   * `config.Settings.Projects` on every render of its project step to decide whether the typed name
   * is a conflict; the daemon's own create refuses a duplicate with a 409, so this is the same
   * answer, one round trip earlier.
   */
  const [knownProjects, setKnownProjects] = React.useState<{ name: string; repos: string[] }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [progressMessage, setProgressMessage] = React.useState<string | null>(null);

  const progressTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const stopProgressTimer = React.useCallback(() => {
    if (progressTimer.current !== null) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }, []);

  const startProgress = React.useCallback(
    (message: string) => {
      stopProgressTimer();
      setProgressMessage(message);
      setProgress(0);
      let tick = 0;
      progressTimer.current = setInterval(
        () => {
          tick += 1;
          if (tick > PROGRESS_STEPS) {
            stopProgressTimer();
            return;
          }
          setProgress(Math.trunc(dualLinearEasing(tick / PROGRESS_STEPS) * PROGRESS_CEILING));
        },
        (PROGRESS_DURATION_SECONDS * 1000) / PROGRESS_STEPS,
      );
    },
    [stopProgressTimer],
  );

  const clearProgress = React.useCallback(() => {
    stopProgressTimer();
    setProgress(null);
    setProgressMessage(null);
  }, [stopProgressTimer]);

  React.useEffect(() => stopProgressTimer, [stopProgressTimer]);

  const runChecks = React.useCallback(() => {
    setChecksLoading(true);
    setChecksError(null);
    bridge
      .runDoctor()
      .then((results) => {
        setChecks(results);
        setChecksLoading(false);
      })
      .catch((err) => {
        // A wizard that cannot reach the daemon still has to be usable; the failure is reported and
        // the operator can re-check or move on through the stepper.
        setChecks([]);
        setChecksError(`Health checks unavailable: ${describeBridgeError(err)}`);
        setChecksLoading(false);
      });
  }, []);

  React.useEffect(() => {
    runChecks();
  }, [runChecks]);

  /**
   * Re-entry: a wizard reopened after an interrupted run can already have a project in
   * `config.yaml` (`createProject` is the only thing this wizard writes before Finish). The list is
   * what makes the name conflict visible instead of failing on the create call.
   */
  React.useEffect(() => {
    bridge
      .listProjects()
      .then((list) => setKnownProjects(list.map(({ name, repos }) => ({ name, repos }))))
      .catch(() => {
        // A wizard that cannot list projects still has to run; the daemon's 409 is the backstop.
      });
  }, []);

  /** V1 `ProjectInputStepView.nameExists`: the comparison is case-insensitive, as the daemon's is. */
  const nameExists =
    projectName.trim().length > 0 &&
    knownProjects.some((p) => p.name.toLowerCase() === projectName.trim().toLowerCase());

  /**
   * V1 `OnboardingApp.OnSelect`: nothing moves while a step is loading, and from the last step you
   * may only go backwards. Otherwise any step is reachable, which is V1's way past a step rather
   * than a per-step Skip button.
   */
  const selectStep = (target: number) => {
    if (busy) return;
    if (target < step || step !== COMPLETE_STEP) {
      setError(null);
      setStep(target);
    }
  };

  const goTo = (target: number) => {
    setError(null);
    setStep(target);
  };

  /**
   * V1's `BuildPicker` has no Next button: the click on a card *is* the advance, and it only lands
   * on the next step once that agent's checks pass. The pick is recorded either way, so coming back
   * to the step shows what was chosen.
   *
   * The checks are re-run here rather than read from state, because `RunFlowAsync` re-probes on
   * every pick: an operator who installs the CLI in another window and clicks the card again must
   * get through without pressing Re-check first. A probe that cannot reach the daemon fails closed,
   * exactly as V1's `catch` does - the stepper is still the way out.
   */
  const pickAgent = async (agentId: string) => {
    if (busy) return;
    setSelectedAgent(agentId);
    setBusy(true);
    setError(null);
    startProgress(`Checking ${agentLabel(agentId)}...`);
    try {
      const fresh = await bridge.runDoctor();
      setChecks(fresh);
      setChecksError(null);
      const missing = missingRequirement(fresh, agentId);
      if (missing) {
        setError(installMessage([missing]));
        return;
      }
      goTo(HOME_STEP);
    } catch (err) {
      setError(
        `Please make sure your agent is present and you are authorized. (${describeBridgeError(err)})`,
      );
    } finally {
      clearProgress();
      setBusy(false);
    }
  };

  const finish = async (writeAgent: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    startProgress("Finishing setup...");
    try {
      if (writeAgent && selectedAgent) {
        await bridge.putConfig("codingAgent", selectedAgent);
      }
      await bridge.completeOnboarding();
      clearProgress();
      onFinished();
    } catch (err) {
      clearProgress();
      setError(`Could not finish setup: ${describeBridgeError(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const skipSetup = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await bridge.dismissOnboarding();
      onFinished();
    } catch (err) {
      setError(`Could not skip setup: ${describeBridgeError(err)}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Registers the project, then hands the derivation work to `AddProject`. The order matters: that
   * promptware's first step confirms the project exists, so the config row has to be written first.
   * The job is started but its result is not awaited, as V1's project step does once
   * `CommitPendingProjectAsync` returns.
   *
   * V1 will not create a second project of the same name - `ProjectAgentStepView` only builds a
   * `ProjectConfig` when `existingProject == null`, and `CommitPendingProjectAsync` checks the list
   * again before adding - so a name already in `config.yaml` never reaches the create call here
   * either. The step does *not* advance on success: V1 stays inside the project section (its
   * sub-step 1) with the run in flight and waits for Next.
   */
  const registerProject = async () => {
    if (busy) return;
    const name = projectName.trim();
    // V1 `ProjectAgentStepView`: the same name check that gates the button also guards the commit.
    if (!isValidProjectName(name) || repoPaths.length === 0 || nameExists) return;

    setBusy(true);
    setError(null);
    startProgress("Setting up your project...");
    try {
      // V1's step 0 mutates `config.Settings.CodingAgent` in memory and the project step's
      // `CommitPendingProjectAsync` calls `SaveSettings()`, so V1's config.yaml carries the agent
      // pick from the moment the project is written - not only from Finish. That matters because an
      // abandoned wizard with a project in it never returns, and the pick would be lost.
      if (selectedAgent) {
        await bridge.putConfig("codingAgent", selectedAgent);
      }
      await bridge.createProject({ name, color: FIRST_PROJECT_COLOR, repos: repoPaths });
      setProjectRegistered(true);
      // Remembered so a Back-and-forth cannot ask the daemon to create it twice.
      setKnownProjects((current) =>
        current.some((p) => p.name.toLowerCase() === name.toLowerCase())
          ? current
          : [...current, { name, repos: repoPaths }],
      );
      try {
        await jobsStore.startJob({
          type: "AddProject",
          projectName: name,
          repos: repoPaths.map((path) => ({ path })),
        });
      } catch (err) {
        // The project itself is registered; a failed hand-off is worth saying, not worth blocking on.
        setError(`Project created, but AddProject could not start: ${describeBridgeError(err)}`);
      }
    } catch (err) {
      // The daemon answers a duplicate name with 409; record it so the conflict box appears rather
      // than only a raw error, which is what V1 shows for the same state.
      const message = describeBridgeError(err);
      if (/already exists/i.test(message)) {
        setKnownProjects((current) =>
          current.some((p) => p.name.toLowerCase() === name.toLowerCase())
            ? current
            : [...current, { name, repos: [] }],
        );
      }
      setError(`Could not create the project: ${message}`);
    } finally {
      clearProgress();
      setBusy(false);
    }
  };

  /**
   * V1 `ProjectInputStepView.UseExisting`: adopt the existing project's repositories and carry on
   * without writing anything. V1 then runs its setup promptware against that project; here the
   * equivalent is the registered panel's "Configure verifications now", which starts `SetupProject`.
   */
  const useExistingProject = () => {
    if (busy) return;
    const existing = knownProjects.find(
      (p) => p.name.toLowerCase() === projectName.trim().toLowerCase(),
    );
    if (!existing) return;
    setRepoPaths(existing.repos);
    setProjectRegistered(true);
    setError(null);
  };

  const configureVerifications = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await jobsStore.startJob({ type: "SetupProject", folderPath: projectName.trim() });
    } catch (err) {
      setError(`Could not start SetupProject: ${describeBridgeError(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const canLeaveHomeStep = status.tendrilHome.trim().length > 0;
  /**
   * V1 `ProjectInputStepView.canContinue`: at least one repository, a name, and no name clash. The
   * name has already been sanitized on the way in, so `isValidProjectName` only rejects the two
   * cases sanitizing cannot fix - empty, and a bare `.`/`..`.
   */
  const canCreateProject =
    repoPaths.length > 0 && isValidProjectName(projectName) && !nameExists && !projectRegistered;

  const backButton = (
    <button
      type="button"
      onClick={() => goTo(Math.max(AGENT_STEP, step - 1))}
      disabled={busy}
      data-testid="onboarding-back"
      className="flex items-center gap-1.5 rounded-field border border-border px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back
    </button>
  );

  /**
   * V1 builds one button row per step view, and they differ: the picker has none, Data Storage has
   * Back/Next, the project step adds Skip on the left, and Complete swaps Next for Finish.
   */
  const footer = () => {
    if (step === AGENT_STEP) return null;

    if (step === HOME_STEP) {
      return (
        <>
          {backButton}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => goTo(PROJECT_STEP)}
            disabled={busy || !canLeaveHomeStep}
            data-testid="onboarding-continue"
            className="flex items-center gap-1.5 rounded-field bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Next
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </>
      );
    }

    if (step === PROJECT_STEP) {
      // Once the project exists this is V1's sub-step 1, whose buttons are Back, Skip and Next -
      // Create Project is gone, because there is nothing left to create.
      if (projectRegistered) {
        return (
          <>
            {backButton}
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => goTo(COMPLETE_STEP)}
              disabled={busy}
              data-testid="onboarding-continue"
              className="flex items-center gap-1.5 rounded-field bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
            >
              Next
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          </>
        );
      }

      return (
        <>
          {/* V1's Skip on this step jumps the whole project section, straight to Complete. */}
          <button
            type="button"
            onClick={() => goTo(COMPLETE_STEP)}
            disabled={busy}
            data-testid="onboarding-skip"
            className="rounded-field px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            Skip
          </button>
          <div className="flex-1" />
          {backButton}
          <button
            type="button"
            onClick={() => void registerProject()}
            disabled={busy || !canCreateProject}
            data-testid="onboarding-continue"
            className="flex items-center gap-1.5 rounded-field bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
          >
            Create Project
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </>
      );
    }

    return (
      <>
        {backButton}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void finish(true)}
          disabled={busy}
          data-testid="onboarding-continue"
          className="flex items-center gap-1.5 rounded-field bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Finish
          <Check className="size-4" aria-hidden="true" />
        </button>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-background" data-testid="onboarding-wizard">
      <div className="mx-auto flex w-150 max-w-full flex-col gap-4 px-6 py-20">
        {/* V1 pairs the Tendril mark with an H2; V2 has no logo asset yet, so the heading stands
            alone. */}
        <h2 className="text-2xl font-bold text-foreground">Welcome to Tendril</h2>

        <nav aria-label="Setup steps">
          <ol className="flex w-full items-center">
            {STEP_TITLES.map((title, index) => {
              const completed = index < step;
              const active = index === step;
              return (
                <li
                  key={title}
                  className="flex items-center last:flex-none [&:not(:last-child)]:flex-1"
                >
                  <button
                    type="button"
                    onClick={() => selectStep(index)}
                    disabled={busy}
                    aria-current={active ? "step" : undefined}
                    data-testid={`onboarding-step-nav-${index}`}
                    className="flex items-center gap-2 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span
                      className={`${INDICATOR_BASE} ${
                        completed || active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {completed ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <span>{index + 1}</span>
                      )}
                    </span>
                    <span
                      className={`text-sm font-medium ${
                        active ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {title}
                    </span>
                  </button>
                  {index < STEP_TITLES.length - 1 && (
                    <span
                      aria-hidden="true"
                      className={`mx-2 h-0.5 flex-1 ${completed ? "bg-primary" : "bg-muted"}`}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        {error && (
          <div
            role="alert"
            data-testid="onboarding-error"
            className="rounded-box border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
          >
            {error}
          </div>
        )}

        {step === AGENT_STEP && (
          <CodingAgentStep
            checks={checks}
            checksLoading={checksLoading}
            checksError={checksError}
            onRecheck={runChecks}
            selectedAgent={selectedAgent}
            onSelectAgent={(agent) => void pickAgent(agent)}
            busy={busy}
          />
        )}
        {step === HOME_STEP && <DataStorageStep tendrilHome={status.tendrilHome} />}
        {step === PROJECT_STEP && (
          <FirstProjectStep
            projectName={projectName}
            onProjectNameChange={(name) => setProjectName(sanitizeProjectName(name))}
            repoPaths={repoPaths}
            onReposChange={setRepoPaths}
            onConfigureVerifications={() => void configureVerifications()}
            projectRegistered={projectRegistered}
            nameExists={nameExists && !projectRegistered}
            onUseExisting={useExistingProject}
            busy={busy}
          />
        )}
        {step === COMPLETE_STEP && <CompleteStep />}

        {progress !== null && (
          <div className="space-y-1" data-testid="onboarding-progress">
            {progressMessage && <p className="text-xs text-muted-foreground">{progressMessage}</p>}
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 w-full overflow-hidden rounded-full bg-primary/10"
            >
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-border pt-4">{footer()}</div>

        {/* V1 has no way out of onboarding; V2's daemon does, and the shell has to be reachable
            when the wizard cannot be satisfied. */}
        <div>
          <button
            type="button"
            onClick={() => void skipSetup()}
            disabled={busy}
            data-testid="onboarding-skip-setup"
            className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
          >
            Skip setup
          </button>
        </div>
      </div>
    </div>
  );
}
