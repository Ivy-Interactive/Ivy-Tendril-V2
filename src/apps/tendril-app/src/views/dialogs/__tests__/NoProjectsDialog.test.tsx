import { describe, it, expect, vi, afterEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NoProjectsDialog } from "@ivy-interactive/components/dialogs";
import { uiStore } from "../../../state/uiStore";

/**
 * Mirrors the condition App.tsx opens this dialog under: the new-plan flow is
 * open, the project list has arrived, and it is empty. The "has arrived" half
 * matters — without it the empty state flashes on every cold start.
 */
function NewPlanFlow({ projects, loaded }: { projects: string[]; loaded: boolean }) {
  const [isOpen, setIsOpen] = React.useState(true);
  const noProjects = loaded && projects.length === 0;
  return (
    <>
      {!noProjects && isOpen && <div data-testid="new-plan-modal">New plan</div>}
      <NoProjectsDialog
        isOpen={isOpen && noProjects}
        onClose={() => setIsOpen(false)}
        onOpenSettings={() => {
          setIsOpen(false);
          uiStore.setActiveNav("settings");
        }}
      />
    </>
  );
}

afterEach(() => {
  uiStore.setActiveNav("plans");
  vi.restoreAllMocks();
});

describe("NoProjectsDialog", () => {
  it("replaces the new-plan modal when no project is configured", () => {
    render(<NewPlanFlow projects={[]} loaded />);

    expect(screen.getByTestId("no-projects-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("new-plan-modal")).not.toBeInTheDocument();
  });

  it("stays out of the way while the project list is still loading", () => {
    render(<NewPlanFlow projects={[]} loaded={false} />);

    expect(screen.queryByTestId("no-projects-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("new-plan-modal")).toBeInTheDocument();
  });

  it("stays out of the way when a project exists", () => {
    render(<NewPlanFlow projects={["Ivy-Tendril-V2"]} loaded />);

    expect(screen.queryByTestId("no-projects-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("new-plan-modal")).toBeInTheDocument();
  });

  it("navigates to the settings nav id, where projects are configured", async () => {
    render(<NewPlanFlow projects={[]} loaded />);

    fireEvent.click(screen.getByTestId("open-settings"));

    await waitFor(() => expect(uiStore.getState().activeNav).toBe("settings"));
    await waitFor(() => expect(screen.queryByTestId("no-projects-dialog")).not.toBeInTheDocument());
  });

  it("cancels on Escape without navigating", async () => {
    render(<NewPlanFlow projects={[]} loaded />);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("no-projects-dialog")).not.toBeInTheDocument());
    expect(uiStore.getState().activeNav).toBe("plans");
  });
});
