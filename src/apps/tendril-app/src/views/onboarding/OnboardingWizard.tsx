import React from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { bridge } from "../../api/bridge";
import { jobsStore } from "../../state/jobsStore";
import { describeBridgeError, type DoctorCheck, type OnboardingStatus } from "../../types/api";
import { DataStorageStep, blockingChecks } from "./PrerequisitesStep";
import { CodingAgentStep, machinePrerequisites } from "./CodingAgentStep";
import { FirstProjectStep } from "./FirstProjectStep";
import { CompleteStep } from "./CompleteStep";

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
 * The first-run wizard, mirroring V1's `OnboardingApp`: a welcome heading, a four-item stepper, and
 * the step's own view underneath, each step building its own button row.
 *
 * Two V1 decisions shape the flow. Advancing is gated where V1 gates it — a required prerequisite
 * that fails keeps you on the Coding Agent step (V1 reopens `InstallMissingDialog` instead of
 * moving on), the Data Storage step needs a path, and Your First Project needs a name and at least
 * one repository — and the stepper itself is the way past a step you do not want to fill in, since
 * V1 offers Skip only on the project step. Nothing is written to `config.yaml` before the operator
 * acts: Finish writes `codingAgent` (only if picked) and the onboarding flag, and **Skip setup** —
 * V2's own escape hatch, which V1 has no equivalent for — writes the flag alone.
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

  /** The required probes V1 will not let you leave the Coding Agent step with. */
  const blocking = blockingChecks(machinePrerequisites(checks));

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
   */
  const pickAgent = (agentId: string) => {
    setSelectedAgent(agentId);
    if (blocking.length > 0) {
      setError(
        `Tendril needs ${blocking.map((check) => check.name).join(", ")} but it isn't installed. Install it, then press Re-check.`,
      );
      return;
    }
    goTo(HOME_STEP);
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
   * Neither the job nor its result is awaited — the wizard moves on, as V1's project step does once
   * `CommitPendingProjectAsync` returns.
   */
  const registerProject = async () => {
    if (busy) return;
    const name = projectName.trim();
    if (!name || repoPaths.length === 0) return;

    setBusy(true);
    setError(null);
    startProgress("Setting up your project...");
    try {
      await bridge.createProject({ name, repos: repoPaths });
      setProjectRegistered(true);
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
      // V1 ends its progress at 100 with "Done" before moving the stepper on.
      stopProgressTimer();
      setProgress(100);
      setProgressMessage("Done");
      goTo(COMPLETE_STEP);
    } catch (err) {
      setError(`Could not create the project: ${describeBridgeError(err)}`);
    } finally {
      clearProgress();
      setBusy(false);
    }
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
  const canCreateProject = repoPaths.length > 0 && projectName.trim().length > 0;

  const backButton = (
    <button
      type="button"
      onClick={() => goTo(Math.max(AGENT_STEP, step - 1))}
      disabled={busy}
      data-testid="onboarding-back"
      className="flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
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
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Next
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </>
      );
    }

    if (step === PROJECT_STEP) {
      return (
        <>
          {/* V1's Skip on this step jumps the whole project section, straight to Complete. */}
          <button
            type="button"
            onClick={() => goTo(COMPLETE_STEP)}
            disabled={busy}
            data-testid="onboarding-skip"
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
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
            className="flex items-center gap-1.5 rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
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
          className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
            className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
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
            onSelectAgent={pickAgent}
          />
        )}
        {step === HOME_STEP && <DataStorageStep tendrilHome={status.tendrilHome} />}
        {step === PROJECT_STEP && (
          <FirstProjectStep
            projectName={projectName}
            onProjectNameChange={setProjectName}
            repoPaths={repoPaths}
            onReposChange={setRepoPaths}
            onConfigureVerifications={() => void configureVerifications()}
            projectRegistered={projectRegistered}
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
