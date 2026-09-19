import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewPlanModal } from "../src/views/NewPlanModal";
import type { ProjectSummary } from "../src/types/api";

/**
 * `CreatePlanDialog.Build` picks its surface from the breakpoint:
 *
 * ```
 * breakpoint.Value == Breakpoint.Mobile
 *   ? new Sheet(...).Side(SheetSide.Bottom).Height(Size.Fit())
 *   : new Dialog(...).Width(Size.Rem(30))
 * ```
 *
 * Both dismiss the same three ways and carry the same title, so V2 expresses the swap as placement on
 * one surface rather than as a second component.
 */
const projects: ProjectSummary[] = [
  { name: "Tendril-App", repos: ["/repos/Tendril-App"], verifications: ["RustBuild"] },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NewPlanModal surface", () => {
  it("sits at the bottom of a narrow viewport and centres above sm", () => {
    render(<NewPlanModal isOpen onClose={() => {}} projects={projects} />);

    const backdrop = screen.getByTestId("new-plan-modal");
    // Bottom-anchored by default, centred from `sm` up: V1's Sheet side and the Dialog respectively.
    expect(backdrop.className).toContain("items-end");
    expect(backdrop.className).toContain("sm:items-center");

    const surface = screen.getByTestId("new-plan-surface");
    // `Size.Fit()` height on mobile, `Size.Rem(30)` width on the dialog.
    expect(surface.className).toContain("max-h-[90vh]");
    expect(surface.className).toContain("rounded-t-box");
    expect(surface.className).toContain("sm:max-w-[30rem]");
    expect(surface.className).toContain("sm:rounded-box");
  });

  it("dismisses on a backdrop click but not on a click inside the surface", () => {
    const onClose = vi.fn();
    render(<NewPlanModal isOpen onClose={onClose} projects={projects} />);

    fireEvent.click(screen.getByTestId("new-plan-surface"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("new-plan-modal"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("NewPlanModal project picker", () => {
  /**
   * `CreatePlanDialog.BuildProjectSelectOptions` always appends the entry, and its `UseEffect` on
   * `selectedProject` closes the dialog and navigates to Settings → Projects when it is chosen. V2
   * gates the entry on `onAddProject`, which nothing in `App.tsx` supplies — so today the entry is
   * absent from the running app. These two cases pin what the wiring does once it is supplied.
   */
  it("offers no Add Project entry without a handler to run it", () => {
    render(<NewPlanModal isOpen onClose={() => {}} projects={projects} />);

    expect(screen.queryByRole("radio", { name: "+ Add New Project" })).not.toBeInTheDocument();
  });

  it("closes and hands over to settings when Add Project is chosen", () => {
    const onClose = vi.fn();
    const onAddProject = vi.fn();
    render(
      <NewPlanModal isOpen onClose={onClose} onAddProject={onAddProject} projects={projects} />,
    );

    const entry = screen.getByRole("radio", { name: "+ Add New Project" });
    fireEvent.click(entry);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAddProject).toHaveBeenCalledTimes(1);
    // Never becomes the selection: it is a navigation, not a project.
    expect(entry).toHaveAttribute("aria-checked", "false");
  });

  // `_defaultProject`: one project means that project, so there is nothing to decide and no "Auto".
  it("offers no Auto with exactly one project", () => {
    render(<NewPlanModal isOpen onClose={() => {}} projects={projects} />);

    expect(screen.queryByRole("radio", { name: "Auto" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tendril-App" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("leads with Auto once there is more than one project to choose between", () => {
    render(
      <NewPlanModal
        isOpen
        onClose={() => {}}
        projects={[...projects, { name: "Other", repos: [], verifications: [] }]}
      />,
    );

    const radios = screen.getAllByRole("radio").map((r) => r.textContent);
    expect(radios[0]).toBe("Auto");
    expect(screen.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
  });
});
