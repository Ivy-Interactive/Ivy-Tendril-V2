import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { NewPlanModal } from "../src/views/NewPlanModal";
import { jobsStore } from "../src/state/jobsStore";
import type { ProjectSummary } from "../src/types/api";

vi.mock("@spacecorps/components-storybook/tendril", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ContentInput: ({
      id,
      value,
      eventHandler,
    }: {
      id: string;
      value: string;
      eventHandler?: (evt: string, id: string, args?: unknown[]) => void;
    }) => (
      <div>
        <textarea
          placeholder="Describe the task, bug to fix, feature to build, or files to inspect..."
          value={value}
          onChange={(e) => {
            eventHandler?.("OnChange", id, [e.target.value]);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              eventHandler?.("OnSubmit", id, [{ value, Value: value }]);
            }
          }}
        />
        <button
          title="Send"
          onClick={() => eventHandler?.("OnSubmit", id, [{ value, Value: value }])}
        >
          Send
        </button>
        <button
          title="Send malformed"
          onClick={() => eventHandler?.("OnSubmit", id, [{ value: 42, Value: 42 }])}
        >
          Send malformed
        </button>
      </div>
    ),
  };
});

describe("NewPlanModal ContentInput event handling", () => {
  const mockProjects: ProjectSummary[] = [
    { name: "Tendril-App", repos: ["/repos/Tendril-App"], verifications: ["RustBuild"] },
  ];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates the description when ContentInput fires OnChange", () => {
    render(<NewPlanModal isOpen={true} onClose={() => {}} projects={mockProjects} />);

    const contentInputTextarea = screen.getByPlaceholderText(
      /describe the task, bug to fix, feature to build/i,
    );
    fireEvent.change(contentInputTextarea, { target: { value: "Investigate flaky test" } });

    const fallbackTextarea = screen.getByLabelText(/task description/i);
    expect(fallbackTextarea).toHaveValue("Investigate flaky test");
  });

  it("dispatches a CreatePlan job when ContentInput's own submit button fires OnSubmit", async () => {
    const startJobSpy = vi
      .spyOn(jobsStore, "startJob")
      .mockResolvedValue({ jobId: "job-1", status: "Queued" });

    render(<NewPlanModal isOpen={true} onClose={() => {}} projects={mockProjects} />);

    const contentInputTextarea = screen.getByPlaceholderText(
      /describe the task, bug to fix, feature to build/i,
    );
    fireEvent.change(contentInputTextarea, { target: { value: "Investigate flaky test" } });

    const submitButton = screen.getByTitle("Send");
    await act(async () => {
      fireEvent.click(submitButton);
    });

    await waitFor(() => {
      expect(startJobSpy).toHaveBeenCalledTimes(1);
    });
    expect(startJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CreatePlan", description: "Investigate flaky test" }),
    );
  });

  it("submits via ⌘/Ctrl+Enter in the ContentInput", async () => {
    const startJobSpy = vi
      .spyOn(jobsStore, "startJob")
      .mockResolvedValue({ jobId: "job-1", status: "Queued" });

    render(<NewPlanModal isOpen={true} onClose={() => {}} projects={mockProjects} />);

    const contentInputTextarea = screen.getByPlaceholderText(
      /describe the task, bug to fix, feature to build/i,
    );
    fireEvent.change(contentInputTextarea, { target: { value: "Investigate flaky test" } });

    await act(async () => {
      fireEvent.keyDown(contentInputTextarea, { key: "Enter", metaKey: true });
    });

    await waitFor(() => {
      expect(startJobSpy).toHaveBeenCalledTimes(1);
    });
    expect(startJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CreatePlan", description: "Investigate flaky test" }),
    );
  });

  it("does not dispatch when OnSubmit carries a non-string payload", async () => {
    const startJobSpy = vi.spyOn(jobsStore, "startJob");

    render(<NewPlanModal isOpen={true} onClose={() => {}} projects={mockProjects} />);

    const contentInputTextarea = screen.getByPlaceholderText(
      /describe the task, bug to fix, feature to build/i,
    );
    fireEvent.change(contentInputTextarea, { target: { value: "Investigate flaky test" } });

    const malformedButton = screen.getByTitle("Send malformed");
    fireEvent.click(malformedButton);

    const fallbackTextarea = screen.getByLabelText(/task description/i);
    expect(fallbackTextarea).not.toHaveValue("[object Object]");
    expect(startJobSpy).not.toHaveBeenCalled();
  });
});
