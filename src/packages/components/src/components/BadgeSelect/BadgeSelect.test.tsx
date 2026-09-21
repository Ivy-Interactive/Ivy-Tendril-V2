import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { BadgeSelect, type BadgeSelectOption } from "./BadgeSelect";

const projectOptions: BadgeSelectOption[] = [
  { value: "Tendril-Services", label: "Tendril-Services" },
  { value: "lots-of-dev-tools", label: "lots-of-dev-tools" },
];

const addProjectAction: BadgeSelectOption[] = [
  { value: "__tendril_add_project__", label: "Add Project", icon: "Plus" },
];

describe("BadgeSelect actions", () => {
  it("renders the action row label below the options when the trigger is opened", () => {
    render(<BadgeSelect id="bs-1" options={projectOptions} actions={addProjectAction} />);

    fireEvent.click(screen.getByRole("button", { name: /select/i }));

    const optionLabels = screen.getAllByRole("option").map((el) => el.textContent);
    const actionButton = screen.getByText("Add Project");

    expect(optionLabels).toEqual(["Tendril-Services", "lots-of-dev-tools"]);
    expect(actionButton).toBeInTheDocument();
    expect(actionButton).not.toHaveAttribute("role", "option");
  });

  it("emits OnAction with the action value and not OnChange when the action row is clicked", () => {
    const eventHandler = vi.fn();
    render(
      <BadgeSelect
        id="bs-1"
        options={projectOptions}
        actions={addProjectAction}
        events={["OnChange", "OnAction"]}
        eventHandler={eventHandler}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /select/i }));
    fireEvent.click(screen.getByText("Add Project"));

    expect(eventHandler).toHaveBeenCalledWith("OnAction", "bs-1", ["__tendril_add_project__"]);
    expect(eventHandler).not.toHaveBeenCalledWith("OnChange", "bs-1", expect.anything());
  });

  it("closes the menu when the action row is clicked", () => {
    render(
      <BadgeSelect
        id="bs-1"
        options={projectOptions}
        actions={addProjectAction}
        events={["OnAction"]}
        eventHandler={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /select/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText("Add Project"));

    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("still emits OnChange for a normal option and never includes the action value", () => {
    const eventHandler = vi.fn();
    render(
      <BadgeSelect
        id="bs-1"
        options={projectOptions}
        actions={addProjectAction}
        multiple
        events={["OnChange", "OnAction"]}
        eventHandler={eventHandler}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /select/i }));
    fireEvent.click(screen.getByText("Tendril-Services"));

    expect(eventHandler).toHaveBeenCalledWith("OnChange", "bs-1", [["Tendril-Services"]]);
    const [, , args] = eventHandler.mock.calls[0];
    expect((args as string[][])[0]).not.toContain("__tendril_add_project__");
  });

  it("renders no separator and no extra row when actions is omitted", () => {
    render(<BadgeSelect id="bs-1" options={projectOptions} />);

    fireEvent.click(screen.getByRole("button", { name: /select/i }));

    expect(document.querySelector(".bselect-separator")).toBeNull();
    expect(document.querySelectorAll(".bselect-action").length).toBe(0);
  });
});

describe("BadgeSelect keyboard support", () => {
  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<BadgeSelect id="bs-3" options={projectOptions} />);

    const trigger = screen.getByRole("button", { name: /select/i });
    await user.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("navigates options with ArrowDown/ArrowUp", async () => {
    const user = userEvent.setup();
    render(<BadgeSelect id="bs-4" options={projectOptions} />);

    await user.click(screen.getByRole("button", { name: /select/i }));
    const options = screen.getAllByRole("option");

    await user.keyboard("{ArrowDown}");
    expect(options[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(options[1]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(options[0]).toHaveFocus();
  });

  it("closes on an outside click via the shared outside-click hook", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <BadgeSelect id="bs-5" options={projectOptions} />
        <button type="button">outside</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: /select/i }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "outside" }));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("BadgeSelect chip overflow", () => {
  it("keeps every chip that fits in the available width, instead of collapsing to +N", () => {
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(500);
    const offsetWidthSpy = vi
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockReturnValue(80);

    try {
      render(
        <BadgeSelect
          id="bs-2"
          options={[
            { value: "Tendril-Services", label: "Tendril-Services" },
            { value: "Urgent Priority", label: "Urgent Priority" },
          ]}
          multiple
          value={["Tendril-Services", "Urgent Priority"]}
        />,
      );

      const container = document.querySelector(".bselect-badges") as HTMLElement;
      const chips = Array.from(container.querySelectorAll(".bselect-badge")) as HTMLElement[];
      expect(chips).toHaveLength(2);
      expect(chips.every((chip) => chip.style.display !== "none")).toBe(true);
      expect(document.querySelector(".bselect-count")).toBeNull();
    } finally {
      clientWidthSpy.mockRestore();
      offsetWidthSpy.mockRestore();
    }
  });
});
