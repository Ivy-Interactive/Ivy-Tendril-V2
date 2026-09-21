import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ShellSectionItems } from "./ShellSectionItems";
import type { ShellSectionItemDto } from "./types";

const items: ShellSectionItemDto[] = [
  { id: "1", title: "First chat" },
  { id: "2", title: "Second chat" },
];

describe("ShellSectionItems row menu keyboard support", () => {
  it("opens the row menu focused on its first item, navigates with arrows, and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <ShellSectionItems
        items={items}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );

    const trigger = screen.getAllByRole("button", { name: /options/i })[0];
    await user.click(trigger);

    const menu = screen.getByRole("menu");
    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems.map((el) => el.textContent)).toEqual(["Pin chat", "Edit name", "Delete"]);
    expect(menuItems[0]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(menuItems[1]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(menuItems[0]).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(menu).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
