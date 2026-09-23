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
 * Both dismiss the same ways and carry the same title, so V2 expresses the swap as placement on one
 * surface - the library `CreatePlanDialog` on `DialogShell` with `mobileSheet` - rather than as a
 * second component.
 */
const projects: ProjectSummary[] = [
  { name: "Tendril-App", repos: ["/repos/Tendril-App"], verifications: ["RustBuild"] },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NewPlanModal surface", () => {
  it("docks to the bottom of a narrow viewport and is 30rem wide above sm", () => {
    render(<NewPlanModal isOpen onClose={() => {}} projects={projects} />);

    const surface = screen.getByTestId("new-plan-modal");
    // V1's bottom `Sheet` below the mobile breakpoint, its `Size.Rem(30)` `Dialog` above it.
    expect(surface).toHaveAttribute("data-mobile-sheet", "true");
    expect(surface.className).toContain("max-sm:!bottom-0");
    expect(surface.className).toContain("sm:!max-w-[30rem]");
  });

  /**
   * The hand-rolled overlay carried a `border-b` under its header, which was asked for removal. The
   * dialog now composes `DialogShell`, whose `DialogHeader` draws no rule - pinned so it stays that way.
   */
  it("draws no rule under the header", () => {
    render(<NewPlanModal isOpen onClose={() => {}} projects={projects} />);

    const title = screen.getByText("Create New Plan");
    expect(title.closest("[class*='border-b']")).toBeNull();
  });

  /**
   * `DialogShell`'s contract, which every dialog shares: Escape and the header close button dismiss,
   * and a click on the overlay does not - a misplaced click must not lose a typed description.
   */
  it("dismisses on Escape and on the header close button", () => {
    const onClose = vi.fn();
    render(<NewPlanModal isOpen onClose={onClose} projects={projects} />);

    fireEvent.keyDown(screen.getByTestId("new-plan-modal"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not dismiss on a click inside the surface", () => {
    const onClose = vi.fn();
    render(<NewPlanModal isOpen onClose={onClose} projects={projects} />);

    fireEvent.click(screen.getByTestId("new-plan-surface"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("NewPlanModal project picker", () => {
  /**
   * `CreatePlanDialog.BuildProjectSelectOptions` always appends the entry, and its `UseEffect` on
   * `selectedProject` closes the dialog and navigates to Settings → Projects when it is chosen. V2
   * gates the entry on `onAddProject`; `App.tsx` supplies it.
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
