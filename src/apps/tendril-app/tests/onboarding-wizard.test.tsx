import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { OnboardingWizard } from "../src/views/onboarding/OnboardingWizard";
import { App } from "../src/App";
import { bridge } from "../src/api/bridge";
import { chatApi } from "../src/api/chatApi";
import { uiStore } from "../src/state/uiStore";
import type { DoctorCheck, OnboardingStatus } from "../src/types/api";

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

describe("OnboardingWizard", () => {
  let runDoctor: ReturnType<typeof vi.spyOn>;
  let dismissOnboarding: ReturnType<typeof vi.spyOn>;
  let completeOnboarding: ReturnType<typeof vi.spyOn>;
  let putConfig: ReturnType<typeof vi.spyOn>;
  let createProject: ReturnType<typeof vi.spyOn>;
  let startJob: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runDoctor = vi.spyOn(bridge, "runDoctor").mockResolvedValue(healthyChecks);
    dismissOnboarding = vi.spyOn(bridge, "dismissOnboarding").mockResolvedValue(undefined);
    completeOnboarding = vi.spyOn(bridge, "completeOnboarding").mockResolvedValue(undefined);
    putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);
    createProject = vi.spyOn(bridge, "createProject").mockResolvedValue({});
    startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "00900", status: "Started" });
    // jobsStore refreshes the job list after starting one.
    vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
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
    expect(createProject).toHaveBeenCalledWith({
      name: "Ivy-Tendril-V2",
      repos: ["/repos/tendril"],
    });
    expect(startJob).toHaveBeenCalledWith({
      type: "AddProject",
      projectName: "Ivy-Tendril-V2",
      repos: [{ path: "/repos/tendril" }],
    });
    // And it advanced to the final step.
    expect(screen.getByTestId("onboarding-step-complete")).toBeInTheDocument();
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
