import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Folder } from "lucide-react";

import {
  SidebarListRow,
  SidebarListRowExpandable,
  SidebarListRowSubItem,
} from "./SidebarListRow.tsx";

/**
 * V1 `Helpers/SidebarListRow.cs` as one component.
 *
 * Three sidebars - the Shell's own, the Settings nested rail (`Apps/Settings/SettingsApp.cs`) and
 * `InboxView`'s category rail - had each reimplemented these rows, and the copies had drifted: only
 * the two app-side ones carried V1's project-colour marker, and only two of the three let a row take
 * a `role`. What is asserted here is the *union*, because that is what the three delegations now
 * depend on; the app-side suites still pin their own rails, and those keep passing precisely because
 * this behaviour is the same in all three.
 */

const Icon: React.FC<{ className?: string }> = ({ className }) => (
  <span className={className} data-testid="row-icon" />
);

describe("SidebarListRow", () => {
  /** V1's `count is > 0`. A zero is suppressed rather than drawn as an empty badge. */
  it("badges a positive count and suppresses a zero one", () => {
    const { rerender } = render(<SidebarListRow label="Assigned" icon={Icon} count={3} />);
    expect(screen.getByRole("button")).toHaveTextContent("3");

    rerender(<SidebarListRow label="Assigned" icon={Icon} count={0} />);
    expect(screen.getByRole("button")).not.toHaveTextContent("0");
  });

  /**
   * V1's `BuildButton` is `Secondary` while selected and `Ghost` otherwise. The tone is a class, so
   * it is pinned through `data-selected`, which every consumer's tests can read without knowing the
   * token names.
   */
  it("reports its selected state without claiming a role it was not given", () => {
    const { rerender } = render(<SidebarListRow label="Plain" icon={Icon} selected />);
    const row = screen.getByRole("button");
    expect(row.dataset.selected).toBe("true");
    // A row outside a tab set must not announce `aria-selected`: that is only meaningful to a
    // `tablist`, and both the Shell's plain lists and the inbox expander are outside one.
    expect(row).not.toHaveAttribute("aria-selected");

    rerender(<SidebarListRow label="Plain" icon={Icon} role="tab" selected />);
    expect(screen.getByRole("tab")).toHaveAttribute("aria-selected", "true");
  });

  /**
   * V1's rounding rule, which is about the container rather than the row: the plain overloads sit in
   * a `List` between its straight separator lines and stay square, the icon overload lives in
   * gap-spaced menus and keeps its rounding.
   */
  it("rounds only the icon overload, as V1's two containers do", () => {
    const { rerender } = render(<SidebarListRow label="Icon" icon={Icon} />);
    expect(screen.getByRole("button").className).toContain("rounded-field");

    rerender(<SidebarListRow label="Bare" />);
    expect(screen.getByRole("button").className).toContain("rounded-none");
  });

  /** V1's `Build(title, content, ...)` overload: a second, muted line under the label. */
  it("stacks the detail overload under the label", () => {
    render(<SidebarListRow label="Tendril" detail="3 open" icon={Icon} />);
    const row = screen.getByRole("button");
    expect(row).toHaveTextContent("Tendril");
    expect(row).toHaveTextContent("3 open");
    expect(row.querySelector(".text-muted-foreground")).toHaveTextContent("3 open");
  });

  it("does not fire while disabled", () => {
    const onClick = vi.fn();
    render(<SidebarListRow label="Off" icon={Icon} disabled onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("SidebarListRowExpandable", () => {
  it("swaps the chevron on the open state and reports it", () => {
    const { rerender } = render(
      <SidebarListRowExpandable label="Projects" icon={Folder} expanded onClick={vi.fn()} />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");

    rerender(
      <SidebarListRowExpandable
        label="Projects"
        icon={Folder}
        expanded={false}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  /**
   * The Shell's copy had no `role`, so the Settings rail - where the expander *is* one of the tabs in
   * its `role="tablist"` - could not have used it. That is why the three copies existed, and it is
   * the gap the union closes.
   */
  it("can be a tab, because in the Settings rail the expander is one", () => {
    render(
      <SidebarListRowExpandable
        label="Projects"
        icon={Folder}
        expanded
        selected
        role="tab"
        onClick={vi.fn()}
      />,
    );
    const tab = screen.getByRole("tab");
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(tab).toHaveAttribute("aria-expanded", "true");
  });

  it("stays a plain button when no role is given, as the inbox rail's expander is", () => {
    render(<SidebarListRowExpandable label="Projects" icon={Folder} expanded onClick={vi.fn()} />);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-selected");
  });
});

describe("SidebarListRowSubItem", () => {
  /**
   * V1's marker: `new Box().Background(color).BorderRadius(BorderRadius.Rounded).Width(Size.Units(3))
   * .Height(Size.Units(3))` - 0.75rem at the framework's `Rounded`, which resolves to 0.5rem, so it
   * reads as a dot without being a circle. The Shell's copy had no colour at all; both app rails did,
   * and their suites assert this exact shape, so the union has to keep it.
   */
  it("draws a project's colour as V1's 0.75rem box, resolved through ivyColorVar", () => {
    render(
      <SidebarListRowSubItem label="Tendril" color="Emerald" testId="sub" onClick={vi.fn()} />,
    );
    const dot = screen.getByTestId("sub-dot");

    expect(dot).toHaveAttribute("data-color", "Emerald");
    // The one name-to-token mapping in the codebase, shared with Badge and TuiBadge - not a hex.
    expect(dot.style.backgroundColor).toBe("var(--emerald, currentColor)");
    expect(dot.className).toContain("size-3");
    expect(dot.className).toContain("rounded-box");
    expect(dot.className).not.toContain("rounded-full");
  });

  /** Icon *or* colour, never both: the inbox's "No projects in settings" row keeps its folder icon. */
  it("prefers an icon over a colour and draws no dot beside it", () => {
    render(
      <SidebarListRowSubItem
        label="Add Project"
        icon={Icon}
        color="Emerald"
        testId="sub"
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("row-icon")).toBeInTheDocument();
    expect(screen.queryByTestId("sub-dot")).not.toBeInTheDocument();
  });

  /** Neither: the rails build sub-items that are not projects, and those have nothing to colour. */
  it("falls back to a neutral marker with neither icon nor colour", () => {
    const { container } = render(<SidebarListRowSubItem label="Other" onClick={vi.fn()} />);
    expect(container.querySelector("[data-color]")).toBeNull();
    expect(container.querySelector(".rounded-full")).not.toBeNull();
  });

  /** A sub-item that does not navigate is static text, not a tab nobody can select. */
  it("renders without a handler as text rather than a button", () => {
    render(<SidebarListRowSubItem label="Static" testId="static" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("static").tagName).toBe("SPAN");
  });

  /** The 1rem indent is V1's, and it is on the padding rather than a margin so the hover fill spans. */
  it("indents by 1rem on the leading edge", () => {
    render(<SidebarListRowSubItem label="Tendril" onClick={vi.fn()} />);
    expect(screen.getByRole("button").className).toContain("pl-4");
  });
});
