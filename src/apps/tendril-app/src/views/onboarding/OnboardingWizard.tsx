import React from "react";
import { bridge } from "../../api/bridge";
import { jobsStore } from "../../state/jobsStore";
import { describeBridgeError, type DoctorCheck, type OnboardingStatus } from "../../types/api";
import { PrerequisitesStep } from "./PrerequisitesStep";
import { CodingAgentStep } from "./CodingAgentStep";
import { FirstProjectStep } from "./FirstProjectStep";
import { CompleteStep } from "./CompleteStep";

const STEP_TITLES = ["Prerequisites", "Coding agent", "First project", "Finish"] as const;

export interface OnboardingWizardProps {
  status: OnboardingStatus;
  /** Called once the wizard is done — completed *or* dismissed. The shell refetches from here. */
  onFinished: () => void;
}

/**
 * The first-run wizard: four skippable steps over the health registry, the agent list, one project
 * and a summary.
 *
 * Two rules shape all of it. Nothing is written to `config.yaml` before the operator acts — Finish
 * writes `codingAgent` (only if picked) and the onboarding flag, **Skip setup** writes the flag alone
 * — and no step can trap the operator: Continue is never gated on a health check, and every step
 * offers both Skip and Skip setup.
 */
export function OnboardingWizard({ status, onFinished }: OnboardingWizardProps) {
  const [step, setStep] = React.useState(0);
  const [checks, setChecks] = React.useState<DoctorCheck[]>([]);
  const [checksLoading, setChecksLoading] = React.useState(true);
  const [checksError, setChecksError] = React.useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = React.useState<string | null>(null);
  const [projectName, setProjectName] = React.useState("");
  const [repoPaths, setRepoPaths] = React.useState<string[]>([]);
  const [projectRegistered, setProjectRegistered] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
        // the operator can continue or re-check.
        setChecks([]);
        setChecksError(`Health checks unavailable: ${describeBridgeError(err)}`);
        setChecksLoading(false);
      });
  }, []);

  React.useEffect(() => {
    runChecks();
  }, [runChecks]);

  const advance = () => {
    setError(null);
    setStep((s) => Math.min(STEP_TITLES.length - 1, s + 1));
  };

  const finish = async (writeAgent: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (writeAgent && selectedAgent) {
        await bridge.putConfig("codingAgent", selectedAgent);
      }
      await bridge.completeOnboarding();
      onFinished();
    } catch (err) {
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
   * Neither the job nor its result is awaited — the wizard moves on.
   */
  const registerProject = async () => {
    if (busy) return;
    const name = projectName.trim();
    if (!name) {
      setError("Enter a project name, or use Skip to add one later.");
      return;
    }

    setBusy(true);
    setError(null);
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
      advance();
    } catch (err) {
      setError(`Could not create the project: ${describeBridgeError(err)}`);
    } finally {
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

  const isLastStep = step === STEP_TITLES.length - 1;

  const onContinue = () => {
    if (step === 2) {
      void registerProject();
      return;
    }
    if (isLastStep) {
      void finish(true);
      return;
    }
    advance();
  };

  // Skip on the final step means "finish without saving the agent selection" — there is no step
  // after it to advance to, and skipping must never be a way to leave the flag unwritten.
  const onSkip = () => {
    if (isLastStep) {
      void finish(false);
      return;
    }
    advance();
  };

  return (
    <div
      className="flex min-h-screen items-start justify-center bg-background p-6"
      data-testid="onboarding-wizard"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="border-b border-border pb-4">
          <h1 className="text-lg font-bold text-foreground">Welcome to Tendril</h1>
          <p className="text-xs text-muted-foreground">
            {status.reason === "FreshInstall"
              ? "A fresh install — four quick steps and you are done."
              : "No projects configured yet — four quick steps and you are done."}
          </p>
        </div>

        <ol className="flex flex-wrap gap-2 py-4" aria-label="Setup steps">
          {STEP_TITLES.map((title, index) => (
            <li
              key={title}
              aria-current={index === step ? "step" : undefined}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                index === step
                  ? "border-primary bg-primary/10 text-foreground"
                  : index < step
                    ? "border-border text-muted-foreground"
                    : "border-border text-muted-foreground/60"
              }`}
            >
              {index + 1}. {title}
            </li>
          ))}
        </ol>

        {error && (
          <div
            role="alert"
            data-testid="onboarding-error"
            className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
          >
            {error}
          </div>
        )}

        {step === 0 && (
          <PrerequisitesStep
            checks={checks}
            loading={checksLoading}
            error={checksError}
            onRecheck={runChecks}
            tendrilHome={status.tendrilHome}
          />
        )}
        {step === 1 && (
          <CodingAgentStep
            checks={checks}
            selectedAgent={selectedAgent}
            onSelectAgent={setSelectedAgent}
          />
        )}
        {step === 2 && (
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
        {step === 3 && (
          <CompleteStep
            selectedAgent={selectedAgent}
            projectName={projectName}
            projectRegistered={projectRegistered}
          />
        )}

        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <button
            type="button"
            onClick={() => void skipSetup()}
            disabled={busy}
            data-testid="onboarding-skip-setup"
            className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
          >
            Skip setup
          </button>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={busy}
                data-testid="onboarding-back"
                className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={onSkip}
              disabled={busy}
              data-testid="onboarding-skip"
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={onContinue}
              disabled={busy}
              data-testid="onboarding-continue"
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isLastStep ? "Finish" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
