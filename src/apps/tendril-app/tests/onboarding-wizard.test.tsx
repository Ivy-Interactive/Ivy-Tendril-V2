import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { OnboardingWizard } from "../src/views/onboarding/OnboardingWizard";
import { App } from "../src/App";
import { bridge } from "../src/api/bridge";
import { chatApi } from "../src/api/chatApi";
import { jobsStore } from "../src/state/jobsStore";
import { uiStore } from "../src/state/uiStore";
import type { DoctorCheck, JobDetail, OnboardingStatus } from "../src/types/api";

const freshInstall: OnboardingStatus = {
  needed: true,
  reason: "FreshInstall",
  projectCount: 0,
  configExists: false,
  tendrilHome: "/tmp/tendril-home",
};

/** Git is required and failing, which is what V1 refuses to move past. */
const checks: DoctorCheck[] = [
  {
    name: "Git",
    status: "Fail",
    message: "Git not found on PATH",
    required: true,
    installUrl: "https://git-scm.com/downloads",
    category: "Prerequisite",
  },
  {
    name: "GitHub CLI",
    status: "Warn",
    message: "GitHub CLI ('gh') not found on PATH",
    required: false,
    installUrl: "https://cli.github.com",
    category: "Prerequisite",
  },
  {
    name: "Claude",
    status: "Ok",
    message: "Claude installed: 1.2.3",
    required: false,
    installUrl: "https://claude.com/claude-code",
    category: "Prerequisite",
  },
  // The registry reports every agent CLI, present or not; a missing one warns rather than fails.
  {
    name: "Gemini",
    status: "Warn",
    message: "Gemini CLI ('gemini') not found on PATH",
    required: false,
    installUrl: "https://github.com/google-gemini/gemini-cli",
    category: "Prerequisite",
  },
];

/** The same registry with nothing required missing, so picking an agent advances. */
const healthyChecks: DoctorCheck[] = checks.map((check) =>
  check.name === "Git"
    ? { ...check, status: "Ok" as const, message: "Git installed: git version 2.43.0" }
    : check,
);

/** Renders the wizard with the doctor call resolved, so the first step is never mid-flight. */
async function renderWizard(onFinished = vi.fn()) {
  await act(async () => {
    render(<OnboardingWizard status={freshInstall} onFinished={onFinished} />);
  });
  return onFinished;
}

const click = async (testId: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

/** Types a repository into the picker and submits it, the way V1's `OnSubmit` handler does. */
const addRepo = async (path: string) => {
  await act(async () => {
    fireEvent.change(screen.getByTestId("onboarding-repo-input"), { target: { value: path } });
    fireEvent.keyDown(screen.getByTestId("onboarding-repo-input"), { key: "Enter" });
  });
};

/**
 * V1's stepper is how you get past a step you do not want to fill in - `OnboardingApp.OnSelect`
 * accepts any target unless you are on the last step, where it only goes backwards - so the walks
 * below navigate with it rather than with a per-step Skip button, which V1 only has on the project
 * step.
 */
const goToStep = (index: number) => click(`onboarding-step-nav-${index}`);

const AGENT_STEP = 0;
const HOME_STEP = 1;
const PROJECT_STEP = 2;
const COMPLETE_STEP = 3;

/** The `AddProject` run every project walk below starts, matching the `startJob` mock. */
const SETUP_JOB = "00900";

/**
 * Fills in sub-step 0 and presses Create Project, landing on the agent sub-step with the viewer
 * mounted - which is lazy, so the assertion is what waits for its chunk.
 */
async function createProjectAndWatch(name = "Ivy-Tendril-V2") {
  await goToStep(PROJECT_STEP);
  await addRepo("/repos/tendril");
  await act(async () => {
    fireEvent.change(screen.getByTestId("onboarding-project-name"), { target: { value: name } });
  });
  await click("onboarding-continue");
  await screen.findByTestId("add-project-agent-viewer");
}

describe("OnboardingWizard", () => {
  let runDoctor: ReturnType<typeof vi.spyOn>;
  let dismissOnboarding: ReturnType<typeof vi.spyOn>;
  let completeOnboarding: ReturnType<typeof vi.spyOn>;
  let putConfig: ReturnType<typeof vi.spyOn>;
  let createProject: ReturnType<typeof vi.spyOn>;
  let startJob: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The job store is a module singleton, so a run one case left in it would arrive in the next
    // already terminal - which is exactly the state these cases are trying to distinguish.
    const jobs = jobsStore.getState();
    jobs.jobs = [];
    jobs.jobDetails = {};
    jobsStore.clearSession(SETUP_JOB);
    jobsStore.resetExitTracking();

    runDoctor = vi.spyOn(bridge, "runDoctor").mockResolvedValue(healthyChecks);
    dismissOnboarding = vi.spyOn(bridge, "dismissOnboarding").mockResolvedValue(undefined);
    completeOnboarding = vi.spyOn(bridge, "completeOnboarding").mockResolvedValue(undefined);
    putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);
    createProject = vi.spyOn(bridge, "createProject").mockImplementation(async (request) => ({
      name: request.name,
      repos: (request.repos ?? []).map((path) => ({ path })),
    }));
    startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "00900", status: "Started" });
    // jobsStore refreshes the job list after starting one.
    vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
    // The wizard reads the project list to spot a name clash before it calls create.
    vi.spyOn(bridge, "listProjects").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens on the agent picker with the machine prerequisites under it", async () => {
    await renderWizard();

    expect(runDoctor).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("onboarding-step-agent")).toBeInTheDocument();
    expect(screen.getByText("What is your coding agent?")).toBeInTheDocument();
    // Git and gh are the machine's tools; the agent CLIs annotate their own cards instead.
    expect(screen.getByTestId("onboarding-check-Git")).toBeInTheDocument();
    expect(screen.getByText("GitHub CLI ('gh') not found on PATH")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-check-Claude")).not.toBeInTheDocument();
  });

  it("blocks the pick while a required check fails, and offers its install link", async () => {
    // V1 parity: `CodingAgentStepView.RunFlowAsync` reopens `InstallMissingDialog` instead of
    // advancing, so a failed required probe keeps the operator on this step. The old expectation
    // (Continue never gated on a health check) was the behaviour this change replaces.
    runDoctor.mockResolvedValue(checks);
    await renderWizard();

    expect(screen.getByTestId("onboarding-install-Git")).toBeInTheDocument();

    await click("onboarding-agent-claude");

    expect(screen.getByTestId("onboarding-step-agent")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-error")).toHaveTextContent(
      "Tendril needs Git but it isn't installed.",
    );
    // The pick is still recorded, so the card shows what was chosen.
    expect(screen.getByTestId("onboarding-agent-claude")).toHaveAttribute("aria-pressed", "true");
  });

  it("advances on the pick itself when nothing required is missing", async () => {
    await renderWizard();

    await click("onboarding-agent-claude");

    expect(screen.getByTestId("onboarding-step-data-storage")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-tendril-home")).toHaveValue("/tmp/tendril-home");
  });

  it("re-runs the checks when Re-check is pressed", async () => {
    await renderWizard();
    await click("onboarding-recheck");
    expect(runDoctor).toHaveBeenCalledTimes(2);
  });

  it("blocks the pick when the picked agent's own CLI is missing", async () => {
    // V1 parity: `BuildAgentCheck` marks the selected agent's check required, so
    // `RunFlowAsync` opens `InstallMissingDialog` for it instead of advancing - even though the
    // registry marks every agent optional, since only the selected one has to be there.
    await renderWizard();

    await click("onboarding-agent-gemini");

    expect(screen.getByTestId("onboarding-step-agent")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-error")).toHaveTextContent(
      "Tendril needs Gemini but it isn't installed.",
    );
  });

  it("re-probes on the pick, so installing the CLI works without pressing Re-check", async () => {
    // V1's `RunFlowAsync` re-runs its checks on every pick rather than trusting what the last
    // render fetched.
    // The mount probe and the first click both see a machine without git.
    runDoctor.mockResolvedValueOnce(checks).mockResolvedValueOnce(checks);
    await renderWizard();
    await click("onboarding-agent-claude");
    expect(screen.getByTestId("onboarding-step-agent")).toBeInTheDocument();

    // Git appears; the second probe is the one the click makes.
    await click("onboarding-agent-claude");

    expect(runDoctor).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("onboarding-step-data-storage")).toBeInTheDocument();
  });

  it("fails the pick closed when the probe cannot reach the daemon", async () => {
    await renderWizard();
    runDoctor.mockRejectedValue(new Error("daemon offline"));

    await click("onboarding-agent-claude");

    expect(screen.getByTestId("onboarding-step-agent")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-error")).toHaveTextContent(
      "Please make sure your agent is present and you are authorized.",
    );
    // The stepper is still the way out of a step the wizard cannot satisfy.
    await goToStep(HOME_STEP);
    expect(screen.getByTestId("onboarding-step-data-storage")).toBeInTheDocument();
  });

  it("shows an installed-but-unauthenticated GitHub CLI", async () => {
    // `health.rs::github_cli_checks` reports auth as an Environment row; hiding it would leave the
    // one gh state an operator has to act on invisible. It must not block: gh is optional in V1.
    runDoctor.mockResolvedValue([
      ...healthyChecks,
      {
        name: "GitHub CLI auth",
        status: "Fail",
        message: "GitHub CLI installed but not authenticated — run 'gh auth login'",
        required: false,
        category: "Environment",
      },
    ]);
    await renderWizard();

    expect(screen.getByTestId("onboarding-check-GitHub CLI auth")).toBeInTheDocument();

    await click("onboarding-agent-claude");
    expect(screen.getByTestId("onboarding-step-data-storage")).toBeInTheDocument();
  });

  it("only goes backwards from the last step", async () => {
    await renderWizard();
    await goToStep(COMPLETE_STEP);
    expect(screen.getByTestId("onboarding-step-complete")).toBeInTheDocument();

    // Forwards is already impossible here; a backwards target is still honoured.
    await goToStep(HOME_STEP);
    expect(screen.getByTestId("onboarding-step-data-storage")).toBeInTheDocument();
  });

  it.each([AGENT_STEP, HOME_STEP, PROJECT_STEP, COMPLETE_STEP])(
    "Skip setup on step %i dismisses onboarding and writes nothing else",
    async (step) => {
      const onFinished = await renderWizard();

      if (step !== AGENT_STEP) await goToStep(step);

      await click("onboarding-skip-setup");

      expect(dismissOnboarding).toHaveBeenCalledTimes(1);
      expect(createProject).not.toHaveBeenCalled();
      expect(putConfig).not.toHaveBeenCalled();
      expect(completeOnboarding).not.toHaveBeenCalled();
      expect(onFinished).toHaveBeenCalledTimes(1);
    },
  );

  it("creates the project before starting AddProject on the project step", async () => {
    const order: string[] = [];
    createProject.mockImplementation(async () => {
      order.push("createProject");
      return {};
    });
    startJob.mockImplementation(async () => {
      order.push("startJob");
      return { jobId: "00900", status: "Started" };
    });

    await renderWizard();
    await goToStep(PROJECT_STEP);
    expect(screen.getByTestId("onboarding-step-project")).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByTestId("onboarding-repo-input"), {
        target: { value: "/repos/tendril" },
      });
      fireEvent.keyDown(screen.getByTestId("onboarding-repo-input"), { key: "Enter" });
    });
    // V1's picker fills the name in from the first repository it adds.
    expect(screen.getByTestId("onboarding-project-name")).toHaveValue("tendril");
    await act(async () => {
      fireEvent.change(screen.getByTestId("onboarding-project-name"), {
        target: { value: "Ivy-Tendril-V2" },
      });
    });

    await click("onboarding-continue");

    expect(order).toEqual(["createProject", "startJob"]);
    // `color: "Green"` is what V1's onboarding writes (`ProjectAgentStepView.Build`); the daemon's
    // own default is Blue, so the wizard has to say so.
    expect(createProject).toHaveBeenCalledWith({
      name: "Ivy-Tendril-V2",
      color: "Green",
      repos: ["/repos/tendril"],
    });
    expect(startJob).toHaveBeenCalledWith({
      type: "AddProject",
      projectName: "Ivy-Tendril-V2",
      repos: [{ path: "/repos/tendril" }],
    });
    // V1 parity: the section does not auto-advance out of itself, it advances *within* itself. V1's
    // sub-step 1 is the live run, so Create Project lands on the viewer over the job it just started
    // rather than on a paragraph telling the operator to go and find it under Jobs.
    expect(screen.getByTestId("onboarding-step-project-agent")).toBeInTheDocument();
    // The viewer is lazy, so this await is what loads its chunk - the step around it is not.
    expect(await screen.findByTestId("add-project-agent-viewer")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-step-complete")).not.toBeInTheDocument();
  });

  it("walks V1's three project sub-steps: input, the run, then the harness", async () => {
    vi.spyOn(bridge, "getJob").mockResolvedValue({
      id: SETUP_JOB,
      type: "AddProject",
      project: "Ivy-Tendril-V2",
      status: "Completed",
    } as JobDetail);

    await renderWizard();
    await createProjectAndWatch();

    // V1 `.Disabled(running)`: Next opens only once the run reaches a terminal status.
    expect(screen.getByTestId("onboarding-continue")).toBeDisabled();

    // The harness re-reads config.yaml on the run's completion, as V1's `ReloadSettings()` does.
    vi.spyOn(bridge, "listProjects").mockResolvedValue([
      {
        name: "Ivy-Tendril-V2",
        repos: ["/repos/tendril"],
        verifications: ["build"],
        reviewActions: [{ name: "Run dev", condition: "", command: "pnpm dev" }],
      },
    ]);
    await act(async () => {
      await jobsStore.fetchJobDetail(SETUP_JOB);
    });

    expect(screen.getByTestId("onboarding-continue")).not.toBeDisabled();
    await click("onboarding-continue");

    expect(await screen.findByTestId("onboarding-step-harness")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-harness-verifications")).toHaveTextContent("build");
    expect(screen.getByTestId("onboarding-harness-review-actions")).toHaveTextContent("pnpm dev");

    // Only the harness's Next leaves the section, which is V1's `stepperIndex.Set(3)`.
    await click("onboarding-continue");
    expect(screen.getByTestId("onboarding-step-complete")).toBeInTheDocument();
  });

  it("says the harness could not be read rather than that it is empty", async () => {
    // These two render the same nothing but mean opposite things. "Nothing is configured yet" sends
    // the operator to reconfigure a harness that may be perfectly fine; what actually happened is
    // that the read failed. Swallowing the rejection made the first message stand in for the second.
    vi.spyOn(bridge, "getJob").mockResolvedValue({
      id: SETUP_JOB,
      type: "AddProject",
      project: "Ivy-Tendril-V2",
      status: "Completed",
    } as JobDetail);

    await renderWizard();
    await createProjectAndWatch();

    vi.spyOn(bridge, "listProjects").mockRejectedValue(new Error("daemon is not running"));
    await act(async () => {
      await jobsStore.fetchJobDetail(SETUP_JOB);
    });
    await click("onboarding-continue");

    const error = await screen.findByTestId("onboarding-harness-error");
    expect(error).toHaveTextContent("daemon is not running");
    expect(screen.queryByTestId("onboarding-harness-empty")).not.toBeInTheDocument();

    // And the step is still traversable - a failed read must not trap the wizard on it.
    await click("onboarding-continue");
    expect(screen.getByTestId("onboarding-step-complete")).toBeInTheDocument();
  });

  it("cancels the run and lands on the harness when the agent sub-step is skipped", async () => {
    // V1's Skip here calls `session.Reset()`, which kills the handle, and goes to sub-step 2 - not
    // to Complete, which is what the section's own Skip on sub-step 0 does.
    const cancelJob = vi.spyOn(bridge, "cancelJob").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listJobs").mockResolvedValue([
      { id: SETUP_JOB, type: "AddProject", project: "Ivy-Tendril-V2", status: "Running" },
    ]);

    await renderWizard();
    await createProjectAndWatch();
    await act(async () => {
      await jobsStore.fetchJobs();
    });

    await click("onboarding-skip");

    expect(cancelJob).toHaveBeenCalledWith(SETUP_JOB, undefined);
    expect(await screen.findByTestId("onboarding-step-harness")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-step-complete")).not.toBeInTheDocument();
  });

  it("cancels the run and returns to the input when the agent sub-step goes Back", async () => {
    const cancelJob = vi.spyOn(bridge, "cancelJob").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listJobs").mockResolvedValue([
      { id: SETUP_JOB, type: "AddProject", project: "Ivy-Tendril-V2", status: "Running" },
    ]);

    await renderWizard();
    await createProjectAndWatch();
    await act(async () => {
      await jobsStore.fetchJobs();
    });

    await click("onboarding-back");

    expect(cancelJob).toHaveBeenCalledWith(SETUP_JOB, undefined);
    expect(screen.getByTestId("onboarding-step-project")).toBeInTheDocument();
  });

  it("shows why a failed run failed instead of ungating Next silently", async () => {
    // Every terminal status ungates Next, `Failed` included, so without this line a failed setup is
    // indistinguishable from a successful one - V1 renders `Text.Danger(session.Error)` for it.
    vi.spyOn(bridge, "getJob").mockResolvedValue({
      id: SETUP_JOB,
      type: "AddProject",
      project: "Ivy-Tendril-V2",
      status: "Failed",
      reportedFailureReason: "Agent exited before writing any verifications",
    } as JobDetail);

    await renderWizard();
    await createProjectAndWatch();
    await act(async () => {
      await jobsStore.fetchJobDetail(SETUP_JOB);
    });

    expect(screen.getByTestId("add-project-agent-error")).toHaveTextContent(
      "Agent exited before writing any verifications",
    );
    expect(screen.getByTestId("onboarding-continue")).not.toBeDisabled();
  });

  it("adopts an existing project into the run sub-step with nothing to watch", async () => {
    // `UseExisting` starts no job, so the sub-step must say so and open Next rather than wait for a
    // terminal status that is never coming.
    vi.spyOn(bridge, "listProjects").mockResolvedValue([
      { name: "Ivy-Tendril-V2", repos: ["/repos/existing"], verifications: [] },
    ]);
    await renderWizard();
    await goToStep(PROJECT_STEP);
    await act(async () => {
      fireEvent.change(screen.getByTestId("onboarding-project-name"), {
        target: { value: "Ivy-Tendril-V2" },
      });
    });

    await click("onboarding-use-existing-project");

    expect(screen.getByTestId("onboarding-step-project-agent")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-agent-no-run")).toBeInTheDocument();
    expect(screen.queryByTestId("add-project-agent-viewer")).not.toBeInTheDocument();
    expect(screen.getByTestId("onboarding-continue")).not.toBeDisabled();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("keeps a Cancel alive while the create is cloning, and frees the wizard with it", async () => {
    // The clone runs inside `createProject`, before any job id exists, so `jobsStore.cancelJob` has
    // nothing to reach - and every control on the step is gated on `busy`. Without this Cancel a
    // wrong or enormous remote froze Back, Skip and Skip setup alike until the app transport's
    // ten-minute `CLONE_TIMEOUT` fired. V1 never needed one: its clone runs under the step's own
    // `CancellationTokenSource`, which Back and Skip cancel.
    let settle: (value: { name: string; repos: { path: string }[] }) => void = () => {};
    createProject.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );

    await renderWizard();
    await goToStep(PROJECT_STEP);
    await addRepo("https://github.com/acme/widgets.git");
    await click("onboarding-continue");

    // Still in flight: the wait is named, timed, and abandonable.
    expect(screen.getByTestId("onboarding-progress")).toHaveTextContent("Cloning repositories...");
    expect(screen.getByTestId("onboarding-elapsed")).toHaveTextContent("0:00");
    expect(screen.getByTestId("onboarding-skip-setup")).toBeDisabled();

    await click("onboarding-cancel-create");

    expect(screen.getByTestId("onboarding-error")).toHaveTextContent("Stopped waiting");
    expect(screen.queryByTestId("onboarding-progress")).not.toBeInTheDocument();
    // The wizard is usable again, which is the whole point.
    expect(screen.getByTestId("onboarding-skip-setup")).not.toBeDisabled();
    expect(screen.getByTestId("onboarding-step-project")).toBeInTheDocument();

    // The daemon went on cloning and answers eventually; the abandoned answer must not drag the
    // operator onto the run sub-step they walked away from.
    await act(async () => {
      settle({ name: "widgets", repos: [{ path: "/clones/widgets" }] });
    });
    expect(screen.getByTestId("onboarding-step-project")).toBeInTheDocument();
    expect(startJob).not.toHaveBeenCalled();
  });

  it("records the name of an abandoned create so the retry offers the existing project", async () => {
    // The daemon wrote the project whatever this side did, so a blind retry would earn a bare 409.
    let settle: (value: { name: string; repos: { path: string }[] }) => void = () => {};
    createProject.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );

    await renderWizard();
    await goToStep(PROJECT_STEP);
    await addRepo("/repos/tendril");
    await act(async () => {
      fireEvent.change(screen.getByTestId("onboarding-project-name"), {
        target: { value: "Ivy-Tendril-V2" },
      });
    });
    await click("onboarding-continue");
    await click("onboarding-cancel-create");

    await act(async () => {
      settle({ name: "Ivy-Tendril-V2", repos: [{ path: "/repos/tendril" }] });
    });

    expect(screen.getByTestId("onboarding-project-name-exists")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-use-existing-project")).toBeInTheDocument();
  });

  it("opens the run sub-step with no viewer when the hand-off could not start", async () => {
    startJob.mockRejectedValue(new Error("daemon is down"));

    await renderWizard();
    await goToStep(PROJECT_STEP);
    await addRepo("/repos/tendril");
    await click("onboarding-continue");

    // The project is registered; V1 does not roll one back over a promptware that would not start.
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("onboarding-error")).toHaveTextContent("AddProject could not start");
    expect(screen.getByTestId("onboarding-step-project-agent")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-continue")).not.toBeDisabled();
  });

  it("returns to the section's first sub-step through the stepper", async () => {
    // `OnboardingApp.OnSelect` sets `projectSubStep` to 0 whenever it targets the project section.
    vi.spyOn(bridge, "getJob").mockResolvedValue({
      id: SETUP_JOB,
      type: "AddProject",
      project: "Ivy-Tendril-V2",
      status: "Completed",
    } as JobDetail);
    await renderWizard();
    await createProjectAndWatch();
    // The stepper is locked while the run is live (below), so this walk starts once it has landed.
    await act(async () => {
      await jobsStore.fetchJobDetail(SETUP_JOB);
    });

    await goToStep(HOME_STEP);
    await goToStep(PROJECT_STEP);

    expect(screen.getByTestId("onboarding-step-project")).toBeInTheDocument();
  });

  it("locks the stepper while the AddProject run is still going", async () => {
    // V1 `OnboardingApp.cs:118` builds the stepper `.Disabled(isStepLoading.Value ||
    // verificationRunning.Value)` and `OnSelect` returns early on the same condition. `busy` alone
    // does not cover it: it goes false the moment `registerProject` returns, while the run it
    // started has minutes left - so one stepper click orphaned the run and put Finish, which writes
    // the onboarding flag, within reach of a project still being configured underneath. Back and
    // Skip stay open because those cancel the run first.
    vi.spyOn(bridge, "cancelJob").mockResolvedValue(undefined);
    await renderWizard();
    await createProjectAndWatch();

    expect(screen.getByTestId(`onboarding-step-nav-${COMPLETE_STEP}`)).toBeDisabled();
    await goToStep(COMPLETE_STEP);
    expect(screen.getByTestId("onboarding-step-project-agent")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-step-complete")).not.toBeInTheDocument();

    // Cancelling through Back releases it, because now there is no run to orphan.
    await click("onboarding-back");
    expect(screen.getByTestId(`onboarding-step-nav-${COMPLETE_STEP}`)).not.toBeDisabled();
  });

  it("forgets the cancelled run rather than re-mounting the viewer over it", async () => {
    // V1's Back calls `session.Reset()`, which clears Handle, Running, Started, Cancelled and Error
    // - not just the handle. Cancelling the job while keeping `setupJobId` and `setupFinished` left
    // the input sub-step's primary reading "Next" over a job the operator had explicitly killed,
    // with the run sub-step's own Next already open.
    vi.spyOn(bridge, "cancelJob").mockResolvedValue(undefined);
    await renderWizard();
    await createProjectAndWatch();

    await click("onboarding-back");
    expect(screen.getByTestId("onboarding-step-project")).toBeInTheDocument();

    // Forward again: the project is registered, so the primary is "Next" - but it must land on a
    // sub-step with nothing to watch rather than on the viewer for the dead job.
    await click("onboarding-continue");
    expect(screen.getByTestId("onboarding-agent-no-run")).toBeInTheDocument();
    expect(screen.queryByTestId("add-project-agent-viewer")).not.toBeInTheDocument();
    expect(startJob).toHaveBeenCalledTimes(1);
  });

  it("persists the agent pick with the project, not only on Finish", async () => {
    // V1 parity: the pick is written into the settings object on step 0 and `SaveSettings()` on the
    // project step flushes it, so a wizard abandoned after the project exists still has an agent.
    await renderWizard();
    await click("onboarding-agent-claude");
    await goToStep(PROJECT_STEP);
    await addRepo("/repos/tendril");
    await click("onboarding-continue");

    expect(putConfig).toHaveBeenCalledWith("codingAgent", "claude");
    expect(createProject).toHaveBeenCalledTimes(1);
  });

  it("does not create the project twice when the operator comes back to the step", async () => {
    vi.spyOn(bridge, "getJob").mockResolvedValue({
      id: SETUP_JOB,
      type: "AddProject",
      project: "Ivy-Tendril-V2",
      status: "Completed",
    } as JobDetail);
    await renderWizard();
    await createProjectAndWatch();
    expect(createProject).toHaveBeenCalledTimes(1);
    // The run has to land before the stepper unlocks; see the lock case above.
    await act(async () => {
      await jobsStore.fetchJobDetail(SETUP_JOB);
    });

    // Out of the section and back in, with the same name still typed.
    await goToStep(COMPLETE_STEP);
    await goToStep(PROJECT_STEP);

    // V1 only builds a ProjectConfig when the name is not already in the list, and
    // `CommitPendingProjectAsync` checks again before adding; Create Project is gone here.
    expect(screen.getByTestId("onboarding-project-registered")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-continue")).toHaveTextContent("Next");
    await click("onboarding-continue");

    expect(screen.getByTestId("onboarding-step-project-agent")).toBeInTheDocument();
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(startJob).toHaveBeenCalledTimes(1);
  });

  it("offers the existing project instead of creating a duplicate", async () => {
    vi.spyOn(bridge, "listProjects").mockResolvedValue([
      { name: "Ivy-Tendril-V2", repos: ["/repos/existing"], verifications: [] },
    ]);
    await renderWizard();
    await goToStep(PROJECT_STEP);
    await act(async () => {
      fireEvent.change(screen.getByTestId("onboarding-project-name"), {
        target: { value: "ivy-tendril-v2" },
      });
    });
    await addRepo("/repos/tendril");

    // V1 compares names case-insensitively and disables its next button on a clash.
    expect(screen.getByTestId("onboarding-project-name-exists")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-continue")).toBeDisabled();

    await click("onboarding-use-existing-project");
    expect(createProject).not.toHaveBeenCalled();

    // The existing project's repositories are adopted, as `UseExisting` does - visible again once
    // Back returns to the input, which is the only sub-step that lists them.
    await click("onboarding-back");
    expect(screen.getByTestId("onboarding-project-registered")).toBeInTheDocument();
    expect(screen.getByText("/repos/existing")).toBeInTheDocument();
  });

  it("surfaces the daemon's duplicate-name conflict as V1's conflict box", async () => {
    createProject.mockRejectedValue(new Error("Project 'Ivy-Tendril-V2' already exists"));
    await renderWizard();
    await goToStep(PROJECT_STEP);
    await addRepo("/repos/Ivy-Tendril-V2");
    await click("onboarding-continue");

    expect(screen.getByTestId("onboarding-error")).toHaveTextContent("already exists");
    expect(screen.getByTestId("onboarding-project-name-exists")).toBeInTheDocument();
  });

  it("disables Create Project until there is a name and a repository", async () => {
    // V1 parity: `ProjectInputStepView` disables its next button rather than reporting an error
    // after the fact, which is what the old "refuses to create a project" case asserted.
    await renderWizard();
    await goToStep(PROJECT_STEP);

    expect(screen.getByTestId("onboarding-continue")).toBeDisabled();

    await act(async () => {
      fireEvent.change(screen.getByTestId("onboarding-project-name"), {
        target: { value: "Ivy-Tendril-V2" },
      });
    });
    // A name on its own is not enough - V1 wants at least one repository too.
    expect(screen.getByTestId("onboarding-continue")).toBeDisabled();

    await act(async () => {
      fireEvent.change(screen.getByTestId("onboarding-repo-input"), {
        target: { value: "/repos/tendril" },
      });
      fireEvent.keyDown(screen.getByTestId("onboarding-repo-input"), { key: "Enter" });
    });
    expect(screen.getByTestId("onboarding-continue")).not.toBeDisabled();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("rejects a repository path RepoPathValidator does not recognise", async () => {
    // V1 `ProjectRepoPickerView.AddAsync`: anything `IsValid` says no to never reaches `repos`.
    await renderWizard();
    await goToStep(PROJECT_STEP);

    await addRepo("tendril");

    expect(screen.getByTestId("onboarding-picker-error")).toHaveTextContent(
      "Invalid repository path.",
    );
    expect(screen.queryByText("tendril")).not.toBeInTheDocument();
    expect(screen.getByTestId("onboarding-continue")).toBeDisabled();
  });

  it("accepts a remote URL and hands it to the daemon to clone", async () => {
    // V1 clones it into TendrilHome before the project is written
    // (`OnboardingRepoHelper.ResolveReposAsync`); V2's `POST /api/projects` does the same, so the
    // URL goes over the wire and the path that lands in config.yaml is the clone's.
    const url = "https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git";
    await renderWizard();
    await goToStep(PROJECT_STEP);

    await addRepo(url);

    expect(screen.queryByTestId("onboarding-picker-error")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Remove ${url}` })).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByTestId("onboarding-project-name"), {
        target: { value: "Ivy-Tendril-V2" },
      });
    });
    // The daemon clones it and answers with the path it landed on.
    const cloned =
      "/home/user/.tendril/Projects/Ivy-Tendril-V2/Repos/Ivy-Interactive/Ivy-Tendril-V2";
    createProject.mockResolvedValue({ name: "Ivy-Tendril-V2", repos: [{ path: cloned }] });

    await click("onboarding-continue");

    expect(createProject).toHaveBeenCalledWith({
      name: "Ivy-Tendril-V2",
      color: "Green",
      repos: [url],
    });
    // `AddProject` runs `tendril project-analyzer <repo-path>` over these, so it gets the clone,
    // not the URL it was cloned from.
    expect(startJob).toHaveBeenCalledWith({
      type: "AddProject",
      projectName: "Ivy-Tendril-V2",
      repos: [{ path: cloned }],
    });
  });

  it("dedupes repositories case-insensitively, as V1 does", async () => {
    await renderWizard();
    await goToStep(PROJECT_STEP);

    await addRepo("/repos/Tendril");
    await addRepo("/repos/tendril");

    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(1);
  });

  it("sanitizes the project name to V1's character set", async () => {
    // V1 `ProjectInputStepView`'s UseEffect rewrites the state, so what is shown is what is written.
    await renderWizard();
    await goToStep(PROJECT_STEP);

    await act(async () => {
      fireEvent.change(screen.getByTestId("onboarding-project-name"), {
        target: { value: "my project/v2!" },
      });
    });

    expect(screen.getByTestId("onboarding-project-name")).toHaveValue("myprojectv2");
  });

  it("suggests the repository's name, sanitized and without .git", async () => {
    await renderWizard();
    await goToStep(PROJECT_STEP);

    await addRepo("/repos/my repo.git");

    expect(screen.getByTestId("onboarding-project-name")).toHaveValue("myrepo.git");
  });

  it("refuses a name sanitizing cannot rescue", async () => {
    // `.` survives the character filter but is still a path segment, which is why V1 has both a
    // sanitizer and a validator.
    await renderWizard();
    await goToStep(PROJECT_STEP);
    await addRepo("/repos/tendril");
    await act(async () => {
      fireEvent.change(screen.getByTestId("onboarding-project-name"), { target: { value: ".." } });
    });

    expect(screen.getByTestId("onboarding-project-name-error")).toHaveTextContent(
      "Invalid project name '..'",
    );
    expect(screen.getByTestId("onboarding-continue")).toBeDisabled();
  });

  it("skips the whole project section straight to the last step", async () => {
    await renderWizard();
    await goToStep(PROJECT_STEP);

    await click("onboarding-skip");

    expect(screen.getByTestId("onboarding-step-complete")).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("writes the selected coding agent and then completes on Finish", async () => {
    const order: string[] = [];
    putConfig.mockImplementation(async () => {
      order.push("putConfig");
    });
    completeOnboarding.mockImplementation(async () => {
      order.push("completeOnboarding");
    });

    const onFinished = await renderWizard();
    await click("onboarding-agent-claude");
    await goToStep(COMPLETE_STEP);
    expect(screen.getByText("Ready to Go!")).toBeInTheDocument();

    await click("onboarding-continue");

    expect(order).toEqual(["putConfig", "completeOnboarding"]);
    expect(putConfig).toHaveBeenCalledWith("codingAgent", "claude");
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("completes without touching config when no agent was selected", async () => {
    const onFinished = await renderWizard();
    await goToStep(COMPLETE_STEP);

    await click("onboarding-continue");

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    expect(putConfig).not.toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("still finishes when the newsletter signup on the Finish step fails", async () => {
    vi.spyOn(bridge, "subscribeNewsletter").mockRejectedValue(new Error("daemon unreachable"));

    const onFinished = await renderWizard();
    await goToStep(COMPLETE_STEP);

    await act(async () => {
      fireEvent.change(screen.getByTestId("newsletter-email"), {
        target: { value: "a@b.co" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("newsletter-submit"));
    });
    await screen.findByTestId("newsletter-error");

    await click("onboarding-continue");

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});

describe("App onboarding gate", () => {
  beforeEach(() => {
    vi.spyOn(bridge, "listPlans").mockResolvedValue([]);
    vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
    vi.spyOn(bridge, "listProjects").mockResolvedValue([]);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
    uiStore.setActiveNav("dashboard");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the shell, not the wizard, when onboarding is not needed", async () => {
    vi.spyOn(bridge, "getOnboardingStatus").mockResolvedValue({
      needed: false,
      reason: "AlreadyConfigured",
      projectCount: 2,
      configExists: true,
      tendrilHome: "/tmp/tendril-home",
    });

    await act(async () => {
      render(<App />);
    });

    expect(screen.queryByTestId("onboarding-wizard")).not.toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("renders the shell when the status call fails", async () => {
    vi.spyOn(bridge, "getOnboardingStatus").mockRejectedValue(new Error("daemon offline"));

    await act(async () => {
      render(<App />);
    });

    expect(screen.queryByTestId("onboarding-wizard")).not.toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("renders the wizard when onboarding is needed", async () => {
    vi.spyOn(bridge, "getOnboardingStatus").mockResolvedValue(freshInstall);
    vi.spyOn(bridge, "runDoctor").mockResolvedValue(checks);

    await act(async () => {
      render(<App />);
    });

    expect(screen.getByTestId("onboarding-wizard")).toBeInTheDocument();
  });
});
