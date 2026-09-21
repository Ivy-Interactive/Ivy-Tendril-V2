import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { DebugView } from "../src/views/debug/DebugView";
import { SURFACES } from "../src/views/debug/scenarios/registry";
import { APP_DESCRIPTORS, isFullBleedApp } from "../src/state/navigation";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * The harness itself: that it is registered, hidden, and actually opens a dialog.
 *
 * `dialog-scenarios.test.tsx` covers the catalogs. This covers the view V1 calls `DialogsApp` -
 * the part that would otherwise be "registered an app that renders nothing", which is its own
 * class of bug and one this repository has hit before.
 */
describe("debug harness registration", () => {
  it("is registered as an app, so the shell can title its tab", () => {
    expect(APP_DESCRIPTORS.debug).toBeDefined();
    expect(APP_DESCRIPTORS.debug.title).toBe("Debug");
  });

  it("takes the shell's inset rather than supplying its own", () => {
    // The view sets neither padding nor a scroll container on its root, so it must not be
    // full-bleed or it loses both.
    expect(isFullBleedApp("debug")).toBe(false);
  });

  it("stays out of the nav, the way V1 marks it `isVisible: false`", async () => {
    // V2 has no `isVisible` field: an app hides by being absent from `buildNavItems`. Asserting on
    // the built nav rather than on a flag is what actually keeps it hidden.
    const { buildNavItems } = await import("../src/views/ShellLayout");
    const ids = buildNavItems("plans", {
      draftCount: 0,
      reviewCount: 0,
      inboxCount: 0,
      chatCount: 0,
      recommendationCount: 0,
      onSelectNav: () => {},
    } as never).map((item: { id: string }) => item.id);

    expect(ids).not.toContain("debug");
  });
});

describe("DebugView", () => {
  it("lists every registered surface", () => {
    render(<DebugView />);

    for (const surface of SURFACES) {
      expect(screen.getByTestId(`harness-surface-${surface.id}`)).toBeInTheDocument();
    }
  });

  it("keeps V1's heading and hint copy", () => {
    render(<DebugView />);

    expect(screen.getByText("Dialog Test Harness")).toBeInTheDocument();
    expect(
      screen.getByText("Expand a dialog to preview how it renders across input permutations."),
    ).toBeInTheDocument();
  });

  it("opens the first surface expanded, so the page is not a wall of closed rows", () => {
    render(<DebugView />);

    const first = screen.getByTestId(`harness-surface-${SURFACES[0].id}`);
    expect(first).toHaveAttribute("aria-expanded", "true");
  });

  it("shows each scenario's hint beside its button", () => {
    render(<DebugView />);

    const surface = SURFACES[0];
    for (const scenario of surface.scenarios) {
      expect(screen.getByText(scenario.hint)).toBeInTheDocument();
    }
  });

  it("opens the real dialog for a scenario, and closes it again", () => {
    render(<DebugView />);

    const surface = SURFACES[0];
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`harness-scenario-${surface.id}-0`));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName();

    fireEvent.click(within(dialog).getByTestId("dialog-cancel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows one scenario at a time, remounting between them", () => {
    render(<DebugView />);
    const surface = SURFACES[0];

    fireEvent.click(screen.getByTestId(`harness-scenario-${surface.id}-0`));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    // Switching scenarios must replace rather than stack. Several dialogs seed their fields once
    // per opening, so a second one rendered beside the first would show the first one's values.
    fireEvent.click(screen.getByTestId(`harness-scenario-${surface.id}-1`));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("collapses a surface when its header is clicked again", () => {
    render(<DebugView />);
    const surface = SURFACES[0];

    fireEvent.click(screen.getByTestId(`harness-surface-${surface.id}`));

    expect(screen.getByTestId(`harness-surface-${surface.id}`)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByTestId(`harness-scenario-${surface.id}-0`)).not.toBeInTheDocument();
  });
});
