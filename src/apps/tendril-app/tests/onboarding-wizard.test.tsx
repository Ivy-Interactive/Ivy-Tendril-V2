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

/** Renders the wizard with the doctor call resolved, so step 1 is never mid-flight. */
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

describe("OnboardingWizard", () => {
  let runDoctor: ReturnType<typeof vi.spyOn>;
  let dismissOnboarding: ReturnType<typeof vi.spyOn>;
  let completeOnboarding: ReturnType<typeof vi.spyOn>;
  let putConfig: ReturnType<typeof vi.spyOn>;
  let createProject: ReturnType<typeof vi.spyOn>;
  let startJob: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runDoctor = vi.spyOn(bridge, "runDoctor").mockResolvedValue(checks);
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

  it("renders the doctor results on step 1 and keeps Continue enabled while a check fails", async () => {
    await renderWizard();

    expect(runDoctor).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("onboarding-step-prerequisites")).toBeInTheDocument();
    expect(screen.getByText("Git not found on PATH")).toBeInTheDocument();
    expect(screen.getByText("GitHub CLI ('gh') not found on PATH")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-tendril-home")).toHaveTextContent("/tmp/tendril-home");

    // A failing required check offers an install link but must not gate the flow.
    expect(screen.getByTestId("onboarding-install-Git")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-continue")).not.toBeDisabled();
  });

  it("re-runs the checks when Re-check is pressed", async () => {
    await renderWizard();
    await click("onboarding-recheck");
    expect(runDoctor).toHaveBeenCalledTimes(2);
  });

  it.each([0, 1, 2, 3])(
    "Skip setup on step %i dismisses onboarding and writes nothing else",
    async (step) => {
      const onFinished = await renderWizard();

      for (let i = 0; i < step; i += 1) {
        await click("onboarding-skip");
      }

      await click("onboarding-skip-setup");

      expect(dismissOnboarding).toHaveBeenCalledTimes(1);
      expect(createProject).not.toHaveBeenCalled();
      expect(putConfig).not.toHaveBeenCalled();
      expect(completeOnboarding).not.toHaveBeenCalled();
      expect(onFinished).toHaveBeenCalledTimes(1);
    },
  );

  it("creates the project before starting AddProject on step 3", async () => {
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
    await click("onboarding-skip");
    await click("onboarding-skip");
    expect(screen.getByTestId("onboarding-step-project")).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByTestId("onboarding-project-name"), {
        target: { value: "Ivy-Tendril-V2" },
      });
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("onboarding-repo-input"), {
        target: { value: "/repos/tendril" },
      });
      fireEvent.keyDown(screen.getByTestId("onboarding-repo-input"), { key: "Enter" });
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

  it("refuses to create a project without a name and does not advance", async () => {
    await renderWizard();
    await click("onboarding-skip");
    await click("onboarding-skip");
    await click("onboarding-continue");

    expect(createProject).not.toHaveBeenCalled();
    expect(screen.getByTestId("onboarding-error")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-step-project")).toBeInTheDocument();
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
    await click("onboarding-skip");
    await click("onboarding-agent-claude");
    await click("onboarding-skip");
    await click("onboarding-skip");
    expect(screen.getByTestId("onboarding-summary-agent")).toHaveTextContent("Claude Code");

    await click("onboarding-continue");

    expect(order).toEqual(["putConfig", "completeOnboarding"]);
    expect(putConfig).toHaveBeenCalledWith("codingAgent", "claude");
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("completes without touching config when no agent was selected", async () => {
    const onFinished = await renderWizard();
    await click("onboarding-skip");
    await click("onboarding-skip");
    await click("onboarding-skip");

    await click("onboarding-continue");

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    expect(putConfig).not.toHaveBeenCalled();
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
