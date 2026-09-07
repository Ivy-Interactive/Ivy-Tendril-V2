import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewPlanModal } from "../src/views/NewPlanModal";
import type { ProjectSummary } from "../src/types/api";

describe("NewPlanModal ContentInput event handling", () => {
  const mockProjects: ProjectSummary[] = [
    { name: "Tendril-App", repos: ["/repos/Tendril-App"], verifications: ["RustBuild"] },
  ];

  it("updates the description when ContentInput fires OnChange", () => {
    render(<NewPlanModal isOpen={true} onClose={() => {}} projects={mockProjects} />);

    const contentInputTextarea = screen.getByPlaceholderText(
      /describe the task, bug to fix, feature to build/i,
    );
    fireEvent.change(contentInputTextarea, { target: { value: "Investigate flaky test" } });

    const fallbackTextarea = screen.getByLabelText(/task description/i);
    expect(fallbackTextarea).toHaveValue("Investigate flaky test");
  });

  it("leaves the description unchanged when ContentInput's own submit fires OnSubmit", () => {
    render(<NewPlanModal isOpen={true} onClose={() => {}} projects={mockProjects} />);

    const contentInputTextarea = screen.getByPlaceholderText(
      /describe the task, bug to fix, feature to build/i,
    );
    fireEvent.change(contentInputTextarea, { target: { value: "Investigate flaky test" } });

    const submitButton = screen.getByRole("button", { name: /start createplan job/i });
    fireEvent.click(submitButton);

    const fallbackTextarea = screen.getByLabelText(/task description/i);
    expect(fallbackTextarea).toHaveValue("Investigate flaky test");
    expect(fallbackTextarea).not.toHaveValue("[object Object]");
  });
});
