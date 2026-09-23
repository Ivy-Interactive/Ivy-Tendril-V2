import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { NewPlanModal, buildCreatePlanAgentPrompt } from "../src/views/NewPlanModal";
import { jobsStore } from "../src/state/jobsStore";
import { bridge } from "../src/api/bridge";
import type { ProjectSummary, RepoStatus } from "../src/types/api";

const PLACEHOLDER = "Enter task description...";

const mockProjects: ProjectSummary[] = [
  { name: "Tendril-App", repos: ["/repos/Tendril-App"], verifications: ["RustBuild"] },
];

const dirty: RepoStatus = {
  path: "/repos/Tendril-App",
  isDirty: true,
  changes: [" M src/main.rs", "?? notes.txt"],
  changeCount: 2,
  baseBranch: "development",
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** Types into the dialog's `ContentInput` and presses its Create button. */
async function typeAndCreate(text: string) {
  const textarea = screen.getByPlaceholderText(PLACEHOLDER);
  fireEvent.change(textarea, { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByTitle("Create"));
  });
}

describe("NewPlanModal ContentInput event handling", () => {
  it("takes the description from ContentInput's OnChange", () => {
    render(<NewPlanModal isOpen={true} onClose={() => {}} projects={mockProjects} />);

    const textarea = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(textarea, { target: { value: "Investigate flaky test" } });

    expect(textarea).toHaveValue("Investigate flaky test");
  });

  it("dispatches a CreatePlan job when ContentInput's own submit button fires OnSubmit", async () => {
    vi.spyOn(bridge, "getProjectRepoStatus").mockResolvedValue([]);
    const startJobSpy = vi
      .spyOn(jobsStore, "startJob")
      .mockResolvedValue({ jobId: "job-1", status: "Queued" });
    const onJobStarted = vi.fn();

    render(
      <NewPlanModal
        isOpen={true}
        onClose={() => {}}
        projects={mockProjects}
        onJobStarted={onJobStarted}
      />,
    );
    await typeAndCreate("Investigate flaky test");

    await waitFor(() => expect(startJobSpy).toHaveBeenCalledTimes(1));
    expect(startJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "CreatePlan",
        project: "Tendril-App",
        description: "Investigate flaky test",
        priority: 0,
      }),
    );
    expect(onJobStarted).toHaveBeenCalledWith({ jobId: "job-1", status: "Queued" });
  });

  it("submits via ⌘/Ctrl+Enter in the ContentInput", async () => {
    vi.spyOn(bridge, "getProjectRepoStatus").mockResolvedValue([]);
    const startJobSpy = vi
      .spyOn(jobsStore, "startJob")
      .mockResolvedValue({ jobId: "job-1", status: "Queued" });

    render(<NewPlanModal isOpen={true} onClose={() => {}} projects={mockProjects} />);

    const textarea = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(textarea, { target: { value: "Investigate flaky test" } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    });

    await waitFor(() => expect(startJobSpy).toHaveBeenCalledTimes(1));
    expect(startJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CreatePlan", description: "Investigate flaky test" }),
    );
  });

  it("creates the plan when the preflight cannot read the repos", async () => {
    vi.spyOn(bridge, "getProjectRepoStatus").mockRejectedValue(new Error("daemon down"));
    const startJobSpy = vi
      .spyOn(jobsStore, "startJob")
      .mockResolvedValue({ jobId: "job-1", status: "Queued" });

    render(<NewPlanModal isOpen={true} onClose={() => {}} projects={mockProjects} />);
    await typeAndCreate("Investigate flaky test");

    await waitFor(() => expect(startJobSpy).toHaveBeenCalledTimes(1));
  });

  it("keeps the dialog open with the failure when the dispatch is refused", async () => {
    vi.spyOn(bridge, "getProjectRepoStatus").mockResolvedValue([]);
    vi.spyOn(jobsStore, "startJob").mockRejectedValue(new Error("Duplicate CreatePlan job"));
    const onClose = vi.fn();

    render(<NewPlanModal isOpen={true} onClose={onClose} projects={mockProjects} />);
    await typeAndCreate("Investigate flaky test");

    expect(await screen.findByText("Duplicate CreatePlan job")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

/** V1 `CreatePlanDialogLauncher`: the dirty-repo preflight in front of CreatePlan. */
describe("NewPlanModal dirty-repo preflight", () => {
  it("asks before creating against a dirty repo, and creates without syncing on request", async () => {
    vi.spyOn(bridge, "getProjectRepoStatus").mockResolvedValue([dirty]);
    const startJobSpy = vi
      .spyOn(jobsStore, "startJob")
      .mockResolvedValue({ jobId: "job-1", status: "Queued" });
    const onClose = vi.fn();

    render(<NewPlanModal isOpen={true} onClose={onClose} projects={mockProjects} />);
    await typeAndCreate("Investigate flaky test");

    expect(await screen.findByTestId("dirty-repo-dialog")).toBeInTheDocument();
    expect(startJobSpy).not.toHaveBeenCalled();
    // The context line names the branch ExecutePlan will start from.
    expect(screen.getByTestId("dirty-repo-context")).toHaveTextContent("origin/development");

    const proceed = screen.getByTestId("guard-proceed");
    expect(proceed).toHaveTextContent("Create Without Syncing");
    await act(async () => {
      fireEvent.click(proceed);
    });

    await waitFor(() => expect(startJobSpy).toHaveBeenCalledTimes(1));
    expect(startJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CreatePlan", project: "Tendril-App" }),
    );
    expect(startJobSpy.mock.calls[0][0]).not.toHaveProperty("waitForJobs");
    expect(onClose).toHaveBeenCalled();
  });

  it("chains a SyncRepo job per dirty repo and has CreatePlan wait for them", async () => {
    vi.spyOn(bridge, "getProjectRepoStatus").mockResolvedValue([dirty]);
    const startJobSpy = vi
      .spyOn(jobsStore, "startJob")
      .mockResolvedValueOnce({ jobId: "sync-1", status: "Queued" })
      .mockResolvedValueOnce({ jobId: "plan-1", status: "Blocked" });

    render(<NewPlanModal isOpen={true} onClose={() => {}} projects={mockProjects} />);
    await typeAndCreate("Investigate flaky test");

    fireEvent.click(await screen.findByTestId("guard-sync-repos"));
    // Local work to reconcile, so V1's policy dialog comes first.
    expect(await screen.findByTestId("sync-repo-dialog")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId("sync-repo-commit"));
    });

    await waitFor(() => expect(startJobSpy).toHaveBeenCalledTimes(2));
    expect(startJobSpy.mock.calls[0][0]).toEqual({
      type: "SyncRepo",
      repoPath: "/repos/Tendril-App",
      baseBranch: "development",
      untrackedChangesPolicy: "Commit",
    });
    expect(startJobSpy.mock.calls[1][0]).toEqual(
      expect.objectContaining({ type: "CreatePlan", waitForJobs: ["sync-1"] }),
    );
  });

  it("does not check repos for Auto, which has none until the agent picks a project", async () => {
    const status = vi.spyOn(bridge, "getProjectRepoStatus").mockResolvedValue([dirty]);
    const startJobSpy = vi
      .spyOn(jobsStore, "startJob")
      .mockResolvedValue({ jobId: "job-1", status: "Queued" });

    render(
      <NewPlanModal
        isOpen={true}
        onClose={() => {}}
        projects={[...mockProjects, { name: "Other", repos: [], verifications: [] }]}
      />,
    );
    await typeAndCreate("Investigate flaky test");

    await waitFor(() => expect(startJobSpy).toHaveBeenCalledTimes(1));
    expect(status).not.toHaveBeenCalled();
    expect(startJobSpy).toHaveBeenCalledWith(expect.objectContaining({ project: "Auto" }));
  });
});

describe("buildCreatePlanAgentPrompt", () => {
  // V1 `CreatePlanDialog.BuildAgentPrompt`, verbatim: it is what the agent reads.
  it("lets the agent pick the project for Auto", () => {
    expect(buildCreatePlanAgentPrompt("Auto", "  Add dark mode ")).toBe(
      'I want to discuss creating a Tendril plan from this description: "Add dark mode". Determine the most appropriate project for it yourself.',
    );
  });

  it("names a picked project", () => {
    expect(buildCreatePlanAgentPrompt("Tendril", "Add dark mode")).toBe(
      'I want to discuss creating a Tendril plan for the project Tendril from this description: "Add dark mode"',
    );
  });
});
