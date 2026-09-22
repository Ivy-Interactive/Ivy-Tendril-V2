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

describe("ShellSectionItems pinned ordering", () => {
  it("floats pinned items to the top without a group label, keeping relative order within each group", () => {
    const mixed: ShellSectionItemDto[] = [
      { id: "1", title: "First" },
      { id: "2", title: "Second", pinned: true },
      { id: "3", title: "Third" },
      { id: "4", title: "Fourth", pinned: true },
    ];
    render(<ShellSectionItems items={mixed} onSelect={vi.fn()} />);

    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();

    const titles = screen
      .getAllByRole("button")
      .map((button) => button.querySelector(".tsh-section-item-title")?.textContent);
    expect(titles).toEqual(["Second", "Fourth", "First", "Third"]);
  });

  it("renders items in their given order when none are pinned", () => {
    render(<ShellSectionItems items={items} onSelect={vi.fn()} />);
    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
    const titles = screen
      .getAllByRole("button")
      .map((button) => button.querySelector(".tsh-section-item-title")?.textContent);
    expect(titles).toEqual(["First chat", "Second chat"]);
  });
});
