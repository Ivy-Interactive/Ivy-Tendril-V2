import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ComponentProps } from "react";
import { Bold, Redo2, Undo2 } from "lucide-react";

import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
  ToolbarToggleButton,
} from "../src/components/ui/toolbar";

function items(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-toolbar-item]"));
}

function renderToolbar(extra?: Partial<ComponentProps<typeof Toolbar>>) {
  return render(
    <Toolbar aria-label="Plan actions" {...extra}>
      <ToolbarGroup aria-label="History">
        <ToolbarButton label="Undo" />
        <ToolbarButton label="Redo" />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarButton label="Save" />
    </Toolbar>,
  );
}

describe("Toolbar component", () => {
  it("renders the toolbar, group and separator roles", () => {
    renderToolbar();

    const toolbar = screen.getByRole("toolbar", { name: "Plan actions" });
    expect(toolbar.getAttribute("aria-orientation")).toBe("horizontal");
    expect(screen.getByRole("group", { name: "History" })).toBeDefined();

    const separator = screen.getByRole("separator");
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
  });

  it("renders a horizontal separator when the toolbar is vertical", () => {
    renderToolbar({ orientation: "vertical" });
    expect(screen.getByRole("toolbar").getAttribute("aria-orientation")).toBe("vertical");
    expect(screen.getByRole("separator").getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("keeps exactly one item tabbable", () => {
    renderToolbar();
    const tabbable = items().filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(items().filter((el) => el.getAttribute("tabindex") === "-1")).toHaveLength(
      items().length - 1,
    );
  });

  it("moves focus with arrow keys and wraps at both ends", () => {
    renderToolbar();
    const [undo, redo, save] = items();

    undo.focus();
    fireEvent.keyDown(undo, { key: "ArrowRight" });
    expect(document.activeElement).toBe(redo);

    fireEvent.keyDown(redo, { key: "ArrowRight" });
    expect(document.activeElement).toBe(save);

    // wraps forward
    fireEvent.keyDown(save, { key: "ArrowRight" });
    expect(document.activeElement).toBe(undo);

    // wraps backward
    fireEvent.keyDown(undo, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(save);
  });

  it("jumps to first and last with Home and End", () => {
    renderToolbar();
    const all = items();
    const first = all[0];
    const last = all[all.length - 1];

    first.focus();
    fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "Home" });
    expect(document.activeElement).toBe(first);
  });

  it("skips disabled items and separators during navigation", () => {
    render(
      <Toolbar aria-label="Plan actions">
        <ToolbarButton label="Undo" />
        <ToolbarButton label="Redo" disabled />
        <ToolbarSeparator />
        <ToolbarButton label="Save" />
      </Toolbar>,
    );

    const undo = screen.getByRole("button", { name: "Undo" });
    const save = screen.getByRole("button", { name: "Save" });

    undo.focus();
    fireEvent.keyDown(undo, { key: "ArrowRight" });
    expect(document.activeElement).toBe(save);
  });

  it("navigates a vertical toolbar with ArrowDown and ArrowUp", () => {
    renderToolbar({ orientation: "vertical" });
    const [undo, redo] = items();

    undo.focus();
    fireEvent.keyDown(undo, { key: "ArrowDown" });
    expect(document.activeElement).toBe(redo);

    fireEvent.keyDown(redo, { key: "ArrowUp" });
    expect(document.activeElement).toBe(undo);
  });

  it("moves items past maxVisibleItems into an overflow menu", () => {
    const onThird = vi.fn();
    render(
      <Toolbar aria-label="Plan actions" overflow="menu" maxVisibleItems={2}>
        <ToolbarButton label="First" />
        <ToolbarButton label="Second" />
        <ToolbarSeparator />
        <ToolbarButton label="Third" onClick={onThird} />
        <ToolbarButton label="Fourth" />
      </Toolbar>,
    );

    expect(screen.getByRole("button", { name: "First" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Second" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Third" })).toBeNull();
    // The separator adjacent to the moved items collapses.
    expect(screen.queryByRole("separator")).toBeNull();

    const trigger = screen.getByRole("button", { name: "More actions" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    const third = screen.getByRole("menuitem", { name: "Third" });
    expect(screen.getByRole("menuitem", { name: "Fourth" })).toBeDefined();

    fireEvent.click(third);
    expect(onThird).toHaveBeenCalledTimes(1);
  });

  it("marks the overflow trigger as a toolbar item so the menu stays keyboard reachable", () => {
    render(
      <Toolbar aria-label="Plan actions" overflow="menu" maxVisibleItems={1}>
        <ToolbarButton label="First" />
        <ToolbarButton label="Second" />
      </Toolbar>,
    );
    const trigger = screen.getByRole("button", { name: "More actions" });
    expect(trigger.getAttribute("data-toolbar-item")).toBe("");
  });

  it("sets aria-disabled on the root when disabled", () => {
    renderToolbar({ disabled: true });
    expect(screen.getByRole("toolbar").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("button", { name: "Undo" })).toHaveProperty("disabled", true);
  });

  it("names an icon-only button from its tooltip", () => {
    render(
      <Toolbar aria-label="Plan actions">
        <ToolbarButton icon={<Undo2 />} tooltip="Undo" />
        <ToolbarButton icon={<Redo2 />} tooltip="Redo" />
      </Toolbar>,
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDefined();
  });

  it("reflects pressed state and reports changes from the toggle button", () => {
    const onPressedChange = vi.fn();
    render(
      <Toolbar aria-label="Formatting">
        <ToolbarToggleButton
          icon={<Bold />}
          tooltip="Bold"
          pressed
          onPressedChange={onPressedChange}
        />
      </Toolbar>,
    );

    const button = screen.getByRole("button", { name: "Bold" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.className).toContain("bg-accent");

    fireEvent.click(button);
    expect(onPressedChange).toHaveBeenCalledWith(false);
  });

  it("excludes leading and trailing slots from arrow-key navigation", () => {
    render(
      <Toolbar
        aria-label="Plan actions"
        leading={<ToolbarButton label="Leading" />}
        trailing={<ToolbarButton label="Trailing" />}
      >
        <ToolbarButton label="Undo" />
        <ToolbarButton label="Redo" />
      </Toolbar>,
    );

    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });

    undo.focus();
    fireEvent.keyDown(undo, { key: "ArrowRight" });
    expect(document.activeElement).toBe(redo);

    // wrapping returns to Undo rather than reaching the slot buttons
    fireEvent.keyDown(redo, { key: "ArrowRight" });
    expect(document.activeElement).toBe(undo);
  });
});
