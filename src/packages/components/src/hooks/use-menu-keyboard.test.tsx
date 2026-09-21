import "@testing-library/jest-dom/vitest";
import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { useMenuKeyboard } from "./use-menu-keyboard";

const Menu = ({ autoFocusFirst }: { autoFocusFirst?: boolean }) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const onClose = vi.fn(() => setOpen(false));

  useMenuKeyboard(open, { containerRef: menuRef, triggerRef, onClose, autoFocusFirst });

  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Open menu
      </button>
      <textarea aria-label="composer" />
      {open && (
        <div ref={menuRef} role="menu" aria-label="Actions">
          <button type="button" role="menuitem">
            First
          </button>
          <button type="button" role="menuitem">
            Second
          </button>
          <button type="button" role="menuitem" disabled>
            Disabled
          </button>
          <button type="button" role="menuitem">
            Third
          </button>
        </div>
      )}
      <div data-testid="close-calls">{onClose.mock.calls.length}</div>
    </div>
  );
};

describe("useMenuKeyboard", () => {
  it("closes and returns focus to the trigger on Escape", async () => {
    const user = userEvent.setup();
    render(<Menu autoFocusFirst />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("menu");
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(menu).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus();
  });

  it("moves focus between enabled items with ArrowDown/ArrowUp, wrapping and skipping disabled rows", async () => {
    const user = userEvent.setup();
    render(<Menu autoFocusFirst />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));

    expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Second" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Third" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Third" })).toHaveFocus();
  });

  it("jumps to the first/last item on Home/End", async () => {
    const user = userEvent.setup();
    render(<Menu autoFocusFirst />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));

    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Third" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();
  });

  it("does not auto-focus the first item when autoFocusFirst is false", async () => {
    const user = userEvent.setup();
    render(<Menu autoFocusFirst={false} />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));

    expect(screen.getByRole("menuitem", { name: "First" })).not.toHaveFocus();
  });

  it("ignores Escape and arrow keys typed outside the menu, e.g. in a composer textarea", async () => {
    const user = userEvent.setup();
    render(<Menu autoFocusFirst />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("menu");

    await user.click(screen.getByLabelText("composer"));
    await user.keyboard("{Escape}");

    expect(menu).toBeInTheDocument();
  });
});
