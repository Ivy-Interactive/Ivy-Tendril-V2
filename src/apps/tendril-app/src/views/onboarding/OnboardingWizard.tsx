import React from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { bridge } from "../../api/bridge";
import { jobsStore } from "../../state/jobsStore";
import { describeBridgeError, type DoctorCheck, type OnboardingStatus } from "../../types/api";
import { Button, Progress } from "@ivy-interactive/components/ui";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useTranslation } from "../../i18n";
import { jobTypeLabel } from "../../i18n/enumLabels";
import { DataStorageStep, blockingChecks, missingToolsMessage } from "./PrerequisitesStep";
import { CodingAgentStep, agentCheck, agentLabel, machinePrerequisites } from "./CodingAgentStep";
import { FirstProjectStep } from "./FirstProjectStep";
import { ProjectAgentStep } from "./ProjectAgentStep";
import { ProjectHarnessStep } from "./ProjectHarnessStep";
import { CompleteStep } from "./CompleteStep";
import { classifyRepoPath, isValidProjectName, sanitizeProjectName } from "./validation";

/**
 * V1 `OnboardingApp.GetSteps`: four steps, in this order. The ids are what the stepper keys its
 * items by; the labels (V1's) are `onboarding:wizard.steps.<id>`, looked up at render time.
 */
const STEP_IDS = ["codingAgent", "dataStorage", "firstProject", "complete"] as const;

const AGENT_STEP = 0;
const HOME_STEP = 1;
const PROJECT_STEP = 2;
const COMPLETE_STEP = 3;

/**
 * V1 `OnboardingApp`'s `projectSubStep`: the whole project section lives inside stepper index 2, and
 * the stepper itself stays four items. Input, then the agent run, then the harness it produced.
 */
const SUB_INPUT = 0;
const SUB_AGENT = 1;
const SUB_HARNESS = 2;

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

/**
 * `m:ss` for the wait the create call owns. A clone of a large remote runs for minutes and the
 * progress bar tops out at 92% after fifteen seconds, so without a clock on screen the operator has
 * no way to tell a slow clone from a hung one - which is the whole reason the Cancel next to it
 * exists.
 */
function formatElapsed(seconds: number): string {
  return `${Math.trunc(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
 * The project section does not auto-advance, and it is three sub-steps inside the one stepper item,
 * as V1's is: input, the live agent run, then Review Harness. Create Project moves to the run and
 * only the operator's Next reaches Complete.
 */
export function OnboardingWizard({ status, onFinished }: OnboardingWizardProps) {
  const { t } = useTranslation("onboarding");
  const [step, setStep] = React.useState(AGENT_STEP);
  const [checks, setChecks] = React.useState<DoctorCheck[]>([]);
  const [checksLoading, setChecksLoading] = React.useState(true);
  /**
   * Why the health checks could not run - the daemon's own words - or null. Worded at render time,
   * so the sentence around it follows the language.
   */
  const [checksError, setChecksError] = React.useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = React.useState<string | null>(null);
  const [projectName, setProjectName] = React.useState("");
  const [repoPaths, setRepoPaths] = React.useState<string[]>([]);
  const [projectRegistered, setProjectRegistered] = React.useState(false);
  const [projectSubStep, setProjectSubStep] = React.useState(SUB_INPUT);
  /** The `AddProject` run the agent sub-step watches. Null when nothing was started for it. */
  const [setupJobId, setSetupJobId] = React.useState<string | null>(null);
  const [setupFinished, setSetupFinished] = React.useState(false);
  /** Bumped when the run ends, which is what makes the harness sub-step re-read config.yaml. */
  const [harnessToken, setHarnessToken] = React.useState(0);
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
  /**
   * Seconds the create call has been in flight, or null when none is. Non-null is also what puts
   * Cancel on screen: the clone happens *inside* `createProject`, before any job id exists, so
   * `jobsStore.cancelJob` has nothing to cancel and this is the only abort the operator has.
   */
  const [registerElapsed, setRegisterElapsed] = React.useState<number | null>(null);

  const progressTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Bumped every time a create starts *and* every time one is abandoned, so the call that resolves
   * can tell whether it is still the one the operator is waiting on. There is no `AbortSignal` to
   * reach for - `bridge.createProject` is a Tauri `invoke`, and the daemon goes on cloning whatever
   * this side does - so abandoning means ignoring the answer, not stopping the work.
   */
  const registerRun = React.useRef(0);

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

  const stopElapsedTimer = React.useCallback(() => {
    if (elapsedTimer.current !== null) {
      clearInterval(elapsedTimer.current);
      elapsedTimer.current = null;
    }
  }, []);

  const clearProgress = React.useCallback(() => {
    stopProgressTimer();
    stopElapsedTimer();
    setProgress(null);
    setProgressMessage(null);
    setRegisterElapsed(null);
  }, [stopProgressTimer, stopElapsedTimer]);

  React.useEffect(
    () => () => {
      stopProgressTimer();
      stopElapsedTimer();
    },
    [stopProgressTimer, stopElapsedTimer],
  );

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
        setChecksError(describeBridgeError(err));
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
   * V1 `OnboardingApp`'s `verificationRunning`: an `AddProject` run that has been started and has not
   * reached a terminal status. The adopt-an-existing-project and failed-hand-off paths set
   * `setupFinished` with no job, so both read as not running, which is right - there is nothing to
   * orphan.
   */
  const setupRunning = setupJobId !== null && !setupFinished;

  /**
   * V1 `OnboardingApp.OnSelect`: nothing moves while a step is loading, and from the last step you
   * may only go backwards. Otherwise any step is reachable, which is V1's way past a step rather
   * than a per-step Skip button.
   *
   * `verificationRunning` gates it as well as `isStepLoading`, exactly as V1's does. `busy` alone is
   * not enough: it goes false the moment `registerProject` returns, while the run it started has
   * minutes left, so a single stepper click orphaned that run and put Finish within reach with the
   * project still being configured underneath. Back and Skip remain the way out of a live run,
   * because those cancel it.
   */
  const selectStep = (target: number) => {
    if (busy || setupRunning) return;
    if (target < step || step !== COMPLETE_STEP) {
      setError(null);
      // `OnboardingApp.OnSelect`: arriving at the project section through the stepper always lands
      // on its first sub-step, whatever it was left on.
      if (target === PROJECT_STEP) setProjectSubStep(SUB_INPUT);
      setStep(target);
    }
  };

  const goTo = (target: number) => {
    setError(null);
    // `CompleteStepView.OnBack` sets `projectSubStep` to 0 before it sets the stepper, so Back out of
    // Complete lands on the section's first sub-step rather than on whatever it was left showing.
    if (target === PROJECT_STEP) setProjectSubStep(SUB_INPUT);
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
    startProgress(t("wizard.progress.checkingAgent", { agent: agentLabel(agentId) }));
    try {
      const fresh = await bridge.runDoctor();
      setChecks(fresh);
      setChecksError(null);
      const missing = missingRequirement(fresh, agentId);
      if (missing) {
        setError(missingToolsMessage(t, [missing]));
        return;
      }
      goTo(HOME_STEP);
    } catch (err) {
      setError(t("wizard.errors.agentProbeFailed", { error: describeBridgeError(err) }));
    } finally {
      clearProgress();
      setBusy(false);
    }
  };

  const finish = async (writeAgent: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    startProgress(t("wizard.progress.finishing"));
    try {
      if (writeAgent && selectedAgent) {
        await bridge.putConfig("codingAgent", selectedAgent);
      }
      await bridge.completeOnboarding();
      clearProgress();
      onFinished();
    } catch (err) {
      clearProgress();
      setError(t("wizard.errors.finishFailed", { error: describeBridgeError(err) }));
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
      setError(t("wizard.errors.skipFailed", { error: describeBridgeError(err) }));
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

    const run = registerRun.current + 1;
    registerRun.current = run;
    // Still the call the operator is waiting on? Cancel bumps the token, and every state write
    // below is gated on this. Without it a create abandoned at minute four still lands its
    // `setProjectSubStep(SUB_AGENT)` on whatever step the operator has since walked to.
    const stillWaiting = () => registerRun.current === run;

    setBusy(true);
    setError(null);
    // A remote is cloned by the daemon inside this one call and a large repository takes minutes,
    // so the busy state has to say what is taking the time rather than look hung.
    const cloning = repoPaths.some((path) => classifyRepoPath(path) !== "local");
    startProgress(cloning ? t("wizard.progress.cloning") : t("wizard.progress.settingUp"));
    // The bar stops moving after fifteen seconds; the clock does not, and it is what the Cancel
    // beside it is a decision about.
    setRegisterElapsed(0);
    stopElapsedTimer();
    elapsedTimer.current = setInterval(() => {
      setRegisterElapsed((seconds) => (seconds === null ? null : seconds + 1));
    }, 1000);
    try {
      // V1's step 0 mutates `config.Settings.CodingAgent` in memory and the project step's
      // `CommitPendingProjectAsync` calls `SaveSettings()`, so V1's config.yaml carries the agent
      // pick from the moment the project is written - not only from Finish. That matters because an
      // abandoned wizard with a project in it never returns, and the pick would be lost.
      if (selectedAgent) {
        await bridge.putConfig("codingAgent", selectedAgent);
      }
      const created = await bridge.createProject({
        name,
        color: FIRST_PROJECT_COLOR,
        repos: repoPaths,
      });
      // A remote was cloned by the create, and only its response says where to. `AddProject` reads
      // these paths off disk (`tendril project-analyzer <repo-path>`), so handing it the URL back
      // would point the run at nothing.
      const resolvedRepos = created?.repos?.map((repo) => repo.path) ?? repoPaths;
      // Recorded even for an abandoned call, and *before* the abandonment check: the daemon went on
      // and wrote the project whatever this side did, so the name is taken now. Leaving it out is
      // how the operator gets a bare 409 on the retry instead of the "use the existing one" box.
      setKnownProjects((known) =>
        known.some((p) => p.name.toLowerCase() === name.toLowerCase())
          ? known
          : [...known, { name, repos: resolvedRepos }],
      );
      if (!stillWaiting()) return;
      setRepoPaths(resolvedRepos);
      setProjectRegistered(true);
      try {
        const started = await jobsStore.startJob({
          type: "AddProject",
          projectName: name,
          repos: resolvedRepos.map((path) => ({ path })),
        });
        if (!stillWaiting()) {
          // Cancelled during the hand-off. The run is real and unwatched, so it is stopped rather
          // than left going - the same thing `leaveAgentSubStep` does to a run being walked away
          // from.
          jobsStore.cancelJob(started.jobId).catch(() => {});
          return;
        }
        setSetupJobId(started.jobId);
      } catch (err) {
        // The project itself is registered; a failed hand-off is worth saying, not worth blocking
        // on. The sub-step still advances, with no run to watch - V1 does not roll a project back
        // over a promptware that would not start either.
        if (!stillWaiting()) return;
        setError(
          t("wizard.errors.setupNotStarted", {
            jobType: jobTypeLabel("AddProject"),
            error: describeBridgeError(err),
          }),
        );
        setSetupFinished(true);
      }
      if (!stillWaiting()) return;
      setProjectSubStep(SUB_AGENT);
    } catch (err) {
      // The daemon answers a duplicate name with 409; record it so the conflict box appears rather
      // than only a raw error, which is what V1 shows for the same state. The pattern matches the
      // daemon's English message, never the UI's own text, so it is not translated.
      const message = describeBridgeError(err);
      if (/already exists/i.test(message)) {
        setKnownProjects((known) =>
          known.some((p) => p.name.toLowerCase() === name.toLowerCase())
            ? known
            : [...known, { name, repos: [] }],
        );
      }
      // An abandoned call's failure is not news: the operator already stopped waiting on it, and
      // `abandonRegister` has put its own line on screen.
      if (!stillWaiting()) return;
      setError(t("wizard.errors.createFailed", { error: message }));
    } finally {
      // Guarded, or the abandoned call clears the progress and the busy flag of the *next* create.
      if (stillWaiting()) {
        clearProgress();
        setBusy(false);
      }
    }
  };

  /**
   * Stops waiting on an in-flight create. There is nothing to abort: `bridge.createProject` is a
   * Tauri `invoke` over a daemon that goes on cloning regardless, and the app's own transport gives
   * up on it after ten minutes (`CLONE_TIMEOUT` in `service/client.rs`). What this gives back is the
   * wizard - every control on the step is gated on `busy`, so without it a wrong or enormous remote
   * freezes Back, Skip and Skip setup alike until that timeout fires.
   *
   * V1 never needed one: its clone runs inside `OnboardingRepoHelper.ResolveReposAsync` under the
   * step's own `CancellationTokenSource`, which its Back and Skip cancel.
   */
  const abandonRegister = () => {
    if (registerElapsed === null) return;
    registerRun.current += 1;
    clearProgress();
    setBusy(false);
    setError(t("wizard.errors.createAbandoned"));
  };

  /**
   * V1 `ProjectInputStepView.UseExisting`: adopt the existing project's repositories and move to the
   * next sub-step without writing anything. Nothing is run over it - the project is already
   * configured, which is the whole reason it was offered - so the agent sub-step has no job to watch
   * and its Next is open immediately.
   */
  const useExistingProject = () => {
    if (busy) return;
    const existing = knownProjects.find(
      (p) => p.name.toLowerCase() === projectName.trim().toLowerCase(),
    );
    if (!existing) return;
    setRepoPaths(existing.repos);
    setProjectRegistered(true);
    setSetupFinished(true);
    setProjectSubStep(SUB_AGENT);
    setError(null);
  };

  /**
   * V1's Back and Skip on the agent sub-step both call `session.Reset()`, which cancels the handle:
   * leaving the step kills the run rather than leaving it going unwatched. `cancelJob` is a no-op
   * for a run that already reached a terminal status.
   *
   * `Reset()` clears the whole session - Handle, Running, Started, Cancelled and Error - and so does
   * this. Cancelling the job but keeping `setupJobId` and `setupFinished` left the wizard naming a
   * run the operator had just killed: the input sub-step's primary read "Next" instead of waiting,
   * and pressing it re-mounted the viewer over the dead job with the step's own Next already open.
   */
  const leaveAgentSubStep = (target: number) => {
    if (setupJobId) jobsStore.cancelJob(setupJobId).catch(() => {});
    setSetupJobId(null);
    setSetupFinished(false);
    setError(null);
    setProjectSubStep(target);
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
    <Button
      type="button"
      variant="outline"
      onClick={() => goTo(Math.max(AGENT_STEP, step - 1))}
      disabled={busy}
      data-testid="onboarding-back"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {t("actions.back")}
    </Button>
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
          <Button
            type="button"
            onClick={() => goTo(PROJECT_STEP)}
            disabled={busy || !canLeaveHomeStep}
            data-testid="onboarding-continue"
          >
            {t("actions.next")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </>
      );
    }

    if (step === PROJECT_STEP) {
      /**
       * V1 `OnboardingApp.cs`'s sub-step 1 row: Back and Skip both cancel the run, Back returning to
       * the input and Skip going *forward* to the harness - not to Complete, which is what the
       * section's own Skip on sub-step 0 does. Next is disabled while the run is still going.
       */
      if (projectSubStep === SUB_AGENT) {
        return (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => leaveAgentSubStep(SUB_INPUT)}
              disabled={busy}
              data-testid="onboarding-back"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("actions.back")}
            </Button>
            <div className="flex-1" />
            <Button
              type="button"
              variant="ghost"
              onClick={() => leaveAgentSubStep(SUB_HARNESS)}
              disabled={busy}
              data-testid="onboarding-skip"
              className="text-muted-foreground"
            >
              {t("actions.skip")}
            </Button>
            {/* V1 `ProjectAgentStepView`'s `.Disabled(running)`. Gated on the run, not on
                `setupFinished` alone: the sub-step is also reached with nothing to watch - an
                adopted project, a hand-off that would not start, a run Back has just reset - and
                nothing will ever call `onFinished` for those, so waiting on it is a dead end. */}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setProjectSubStep(SUB_HARNESS)}
              disabled={busy || setupRunning}
              data-testid="onboarding-continue"
            >
              {t("actions.next")}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </>
        );
      }

      // V1's sub-step 2: Back to the input, Next out of the section.
      if (projectSubStep === SUB_HARNESS) {
        return (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setProjectSubStep(SUB_INPUT)}
              disabled={busy}
              data-testid="onboarding-back"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("actions.back")}
            </Button>
            <div className="flex-1" />
            <Button
              type="button"
              variant="secondary"
              onClick={() => goTo(COMPLETE_STEP)}
              disabled={busy}
              data-testid="onboarding-continue"
            >
              {t("actions.next")}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </>
        );
      }

      return (
        <>
          {/* V1's Skip on this step jumps the whole project section, straight to Complete. */}
          <Button
            type="button"
            variant="ghost"
            onClick={() => goTo(COMPLETE_STEP)}
            disabled={busy}
            data-testid="onboarding-skip"
            className="text-muted-foreground"
          >
            {t("actions.skip")}
          </Button>
          <div className="flex-1" />
          {/* The one control that stays live while the create is in flight, and the only reason the
              rest being gated on `busy` is survivable: the clone runs inside that call, so there is
              no job to stop and no other way off this step until the transport's own ten-minute
              timeout fires. */}
          {registerElapsed !== null ? (
            <Button
              type="button"
              variant="outline"
              onClick={abandonRegister}
              data-testid="onboarding-cancel-create"
            >
              {t("common:actions.cancel")}
            </Button>
          ) : (
            backButton
          )}
          {/* Coming back here with the project already written, there is nothing left to create.
              V1 disables its Next on the name clash and routes forward through the conflict box's
              "Use Existing Project Configuration"; with the fields already locked that would be a
              dead end, so the primary carries on to the run instead. */}
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              projectRegistered ? setProjectSubStep(SUB_AGENT) : void registerProject()
            }
            disabled={busy || (!projectRegistered && !canCreateProject)}
            data-testid="onboarding-continue"
          >
            {projectRegistered ? t("actions.next") : t("actions.createProject")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </>
      );
    }

    return (
      <>
        {backButton}
        <div className="flex-1" />
        <Button
          type="button"
          onClick={() => void finish(true)}
          disabled={busy}
          data-testid="onboarding-continue"
        >
          {t("actions.finish")}
          <Check className="size-4" aria-hidden="true" />
        </Button>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-background" data-testid="onboarding-wizard">
      <div className="mx-auto flex w-150 max-w-full flex-col gap-4 px-6 py-20">
        {/* V1 pairs the Tendril mark with an H2; V2 has no logo asset yet, so the heading stands
            alone. */}
        <h2 className="text-2xl font-bold text-foreground">{t("wizard.title")}</h2>

        <nav aria-label={t("wizard.stepsLabel")}>
          <ol className="flex w-full items-center">
            {STEP_IDS.map((id, index) => {
              const completed = index < step;
              const active = index === step;
              return (
                <li
                  key={id}
                  className="flex items-center last:flex-none [&:not(:last-child)]:flex-1"
                >
                  <button
                    type="button"
                    onClick={() => selectStep(index)}
                    disabled={busy || setupRunning}
                    aria-current={active ? "step" : undefined}
                    data-testid={`onboarding-step-nav-${index}`}
                    className="flex items-center gap-2 rounded-selector px-1 py-0.5 transition-colors hover:bg-secondary/60 disabled:pointer-events-none disabled:opacity-50"
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
                      {t(`wizard.steps.${id}`)}
                    </span>
                  </button>
                  {index < STEP_IDS.length - 1 && (
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

        {error && <ErrorBanner data-testid="onboarding-error">{error}</ErrorBanner>}

        {step === AGENT_STEP && (
          <CodingAgentStep
            checks={checks}
            checksLoading={checksLoading}
            checksError={
              checksError === null
                ? null
                : t("wizard.errors.checksUnavailable", { error: checksError })
            }
            onRecheck={runChecks}
            selectedAgent={selectedAgent}
            onSelectAgent={(agent) => void pickAgent(agent)}
            busy={busy}
          />
        )}
        {step === HOME_STEP && <DataStorageStep tendrilHome={status.tendrilHome} />}
        {step === PROJECT_STEP && projectSubStep === SUB_INPUT && (
          <FirstProjectStep
            projectName={projectName}
            onProjectNameChange={(name) => setProjectName(sanitizeProjectName(name))}
            repoPaths={repoPaths}
            onReposChange={setRepoPaths}
            projectRegistered={projectRegistered}
            nameExists={nameExists && !projectRegistered}
            onUseExisting={useExistingProject}
            busy={busy}
          />
        )}
        {step === PROJECT_STEP && projectSubStep === SUB_AGENT && (
          <ProjectAgentStep
            jobId={setupJobId}
            onFinished={() => {
              setSetupFinished(true);
              // V1's completion handler reloads the settings and bumps the refresh token the harness
              // sub-step reads through; the agent writes through the `tendril` CLI, so what that step
              // shows changed under the app.
              setHarnessToken((token) => token + 1);
            }}
          />
        )}
        {step === PROJECT_STEP && projectSubStep === SUB_HARNESS && (
          <ProjectHarnessStep projectName={projectName} refreshToken={harnessToken} />
        )}
        {step === COMPLETE_STEP && <CompleteStep />}

        {progress !== null && (
          <div className="space-y-1" data-testid="onboarding-progress">
            {progressMessage && (
              <p className="text-xs text-muted-foreground">
                {progressMessage}
                {/* The bar stops at 92% after fifteen seconds and a clone runs for minutes, so the
                    clock is the only thing on screen that keeps moving. */}
                {registerElapsed !== null && (
                  <span data-testid="onboarding-elapsed"> {formatElapsed(registerElapsed)}</span>
                )}
              </p>
            )}
            {/* The library component, not a hand-rolled bar: it is the same `h-2 rounded-full` track
                over a 10%-primary fill, and Radix gives it the progressbar role and aria-value* for
                free. */}
            <Progress value={progress} aria-label={progressMessage ?? t("wizard.progress.label")} />
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-border pt-4">{footer()}</div>

        {/* V1 has no way out of onboarding; V2's daemon does, and the shell has to be reachable
            when the wizard cannot be satisfied. */}
        <div>
          {/* `inline`: the shared link treatment — underlined, no padding, no height — which is
              what this was drawing by hand. */}
          <Button
            type="button"
            variant="inline"
            onClick={() => void skipSetup()}
            disabled={busy}
            data-testid="onboarding-skip-setup"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("wizard.skipSetup")}
          </Button>
        </div>
      </div>
    </div>
  );
}
