import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ProjectBadges } from "../ProjectBadges";
import { bridge } from "../../api/bridge";
import type { ProjectSummary } from "../../types/api";

/**
 * `ProjectHelper.BuildBadges(plan.Project, config)`, which both the plan page and the review page pass
 * to `PlanWorkspace.ProjectBadges`.
 */

function project(name: string, color?: string): ProjectSummary {
  return { name, color, repos: [], verifications: [] };
}

beforeEach(() => {
  vi.spyOn(bridge, "listProjects").mockResolvedValue([
    project("Ivy-Tendril-V2", "Blue"),
    project("docs", "Amber"),
    project("beta"),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProjectBadges", () => {
  /** `foreach (var project in ParseProjects(projectValue))` — a joined value is several badges. */
  it("renders one badge per project in a joined value", async () => {
    render(<ProjectBadges project="beta, docs" />);

    await waitFor(() => expect(screen.getByTestId("project-badge-beta")).toBeInTheDocument());
    expect(screen.getByTestId("project-badge-docs")).toBeInTheDocument();
    expect(screen.getByTestId("project-badge-beta")).toHaveTextContent("beta");
    // Not one badge holding the joined string, which is a project nobody has configured.
    expect(screen.queryByText("beta, docs")).not.toBeInTheDocument();
  });

  it("tints a badge with its project's configured colour", async () => {
    render(<ProjectBadges project="docs" />);

    const badge = await waitFor(() => screen.getByTestId("project-badge-docs"));
    expect(badge).toHaveAttribute("data-project-color", "Amber");
    // Resolved through the package's `ivyColorVar`, so the theme's own token is what lands in the
    // style — `styles/tokens.css` defines `--amber` in both the light and the dark block.
    const style = badge.getAttribute("style") ?? "";
    expect(style).toContain("border-color: var(--amber");
    expect(style).toContain("color: var(--amber");
  });

  /**
   * `WithProjectColor` is `color.HasValue ? badge.Color(color.Value) : badge` — it returns the badge
   * *unchanged*. Different from the sidebar markers, which do fall back to Slate: inventing a fallback
   * here would make "nobody configured this" look like a project deliberately coloured grey.
   */
  it("leaves a project with no configured colour untinted", async () => {
    render(<ProjectBadges project="beta" />);

    const badge = await waitFor(() => screen.getByTestId("project-badge-beta"));
    expect(badge).not.toHaveAttribute("data-project-color");
    expect(badge.getAttribute("style")).toBeNull();
  });

  /** `.Variant(BadgeVariant.Outline)` — the tint is on the border and the text, not a filled pill. */
  it("keeps the outline variant, tinted or not", async () => {
    render(<ProjectBadges project="docs, beta" />);

    const tinted = await waitFor(() => screen.getByTestId("project-badge-docs"));
    const plain = screen.getByTestId("project-badge-beta");
    for (const badge of [tinted, plain]) {
      expect(badge.className).toContain("text-foreground");
      expect(badge.className).not.toContain("badge-tinted");
      expect(badge.className).not.toContain("border-transparent");
    }
  });

  it("renders nothing for a plan with no project", async () => {
    const { container } = render(<ProjectBadges project={undefined} />);
    await waitFor(() => expect(bridge.listProjects).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  /** An unreadable project list is an uncoloured badge, never a missing one. */
  it("still names the project when the project list cannot be read", async () => {
    vi.spyOn(bridge, "listProjects").mockRejectedValue(new Error("daemon unreachable"));

    render(<ProjectBadges project="docs" />);

    const badge = await waitFor(() => screen.getByTestId("project-badge-docs"));
    expect(badge).toHaveTextContent("docs");
    expect(badge).not.toHaveAttribute("data-project-color");
  });
});
