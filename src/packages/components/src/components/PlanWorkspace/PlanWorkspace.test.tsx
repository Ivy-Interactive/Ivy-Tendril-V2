import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { PlanWorkspace } from "./PlanWorkspace";
import {
  CHAT_WIDTH_STORAGE_KEY,
  chatWidthStorageKey,
  readStoredChatWidth,
  writeStoredChatWidth,
} from "./chatWidth";
import { matchesShortcut, shortcutKeys } from "./shortcuts";

const actions = [
  { tag: "Edit", label: "Edit", icon: "Pencil", shortcut: "E" },
  {
    tag: "Chat",
    label: "Update",
    icon: "WandSparkles",
    shortcut: "U",
    active: true,
    focusChat: true,
  },
];
const menuItems = [
  { tag: "Delete", label: "Delete", icon: "Trash", shortcut: "Backspace", danger: true },
];
const primary = { tag: "Execute", label: "Execute", icon: "Rocket", shortcut: "x" };
const tabs = [
  { id: "plan", label: "Plan" },
  { id: "details", label: "Details", badge: "3" },
];

const renderWorkspace = (handler = vi.fn(), extra: Record<string, unknown> = {}) =>
  render(
    <PlanWorkspace
      id="w"
      planId="#59"
      title="Revamp the User Authentication Experience"
      meta="1/32 plans"
      actions={actions}
      menuItems={menuItems}
      primary={primary}
      tabs={tabs}
      selectedTab="plan"
      events={["OnAction", "OnTabSelect"]}
      eventHandler={handler}
      slots={{
        Content: [<div key="c">plan body</div>],
        Verifications: [<div key="v">verification rows</div>],
        Questions: [<div key="q">question rows</div>],
        ...(extra.slots as object),
      }}
      {...extra}
    />,
  );

describe("PlanWorkspace", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as unknown as typeof ResizeObserver;
    window.localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("renders the title bar, tabs and the selected tab's content", () => {
    renderWorkspace();
    expect(screen.getByText("#59")).toBeInTheDocument();
    expect(screen.getByText("Revamp the User Authentication Experience")).toBeInTheDocument();
    expect(screen.getByText("1/32 plans")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Plan/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Details/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("plan body")).toBeInTheDocument();
  });

  it("fires OnTabSelect with the tab id", () => {
    const handler = vi.fn();
    renderWorkspace(handler);
    fireEvent.click(screen.getByRole("tab", { name: /Details/ }));
    expect(handler).toHaveBeenCalledWith("OnTabSelect", "w", ["details"]);
  });

  it("fires OnAction for icon buttons, the primary button and menu items", () => {
    const handler = vi.fn();
    renderWorkspace(handler);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(handler).toHaveBeenCalledWith("OnAction", "w", ["Edit"]);

    fireEvent.click(screen.getByRole("button", { name: /Execute/ }));
    expect(handler).toHaveBeenCalledWith("OnAction", "w", ["Execute"]);

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(handler).toHaveBeenCalledWith("OnAction", "w", ["Delete"]);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the overflow menu on Escape and returns focus to its trigger", () => {
    renderWorkspace();
    const trigger = screen.getByRole("button", { name: "More actions" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("moves focus between overflow menu items with ArrowDown/ArrowUp", () => {
    const manyMenuItems = [
      { tag: "Rename", label: "Rename", icon: "Pencil" },
      { tag: "Duplicate", label: "Duplicate", icon: "Copy" },
      { tag: "Delete", label: "Delete", icon: "Trash", danger: true },
    ];
    renderWorkspace(vi.fn(), { menuItems: manyMenuItems });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = screen.getByRole("menu");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((el) => el.getAttribute("data-tag"))).toEqual([
      "Rename",
      "Duplicate",
      "Delete",
    ]);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(items[0]).toHaveFocus();
  });

  it("marks the active icon action as pressed", () => {
    renderWorkspace();
    expect(screen.getByRole("button", { name: "Update" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Edit" })).not.toHaveAttribute("aria-pressed");
  });

  it("binds shortcuts on the document but not while typing", () => {
    const handler = vi.fn();
    renderWorkspace(handler, { slots: { Content: [<textarea key="t" aria-label="editor" />] } });

    fireEvent.keyDown(document.body, { key: "x" });
    expect(handler).toHaveBeenCalledWith("OnAction", "w", ["Execute"]);

    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(handler).toHaveBeenCalledWith("OnAction", "w", ["Delete"]);

    handler.mockClear();
    fireEvent.keyDown(screen.getByLabelText("editor"), { key: "x" });
    fireEvent.keyDown(document.body, { key: "x", metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers keys while focus is stuck in a hidden editable, and stays quiet while itself hidden", () => {
    // jsdom has no checkVisibility; hidden = an inline visibility:hidden on the element or an ancestor.
    const hiddenBy = (el: Element | null): boolean =>
      !!el && ((el as HTMLElement).style?.visibility === "hidden" || hiddenBy(el.parentElement));
    Element.prototype.checkVisibility = function (this: Element) {
      return !hiddenBy(this);
    };
    try {
      const handler = vi.fn();
      const { unmount } = renderWorkspace(handler);
      const pane = document.createElement("div");
      pane.style.visibility = "hidden";
      pane.innerHTML = '<div class="xterm"><textarea aria-label="stuck terminal"></textarea></div>';
      document.body.appendChild(pane);

      fireEvent.keyDown(screen.getByLabelText("stuck terminal"), { key: "Backspace" });
      expect(handler).toHaveBeenCalledWith("OnAction", "w", ["Delete"]);
      pane.remove();
      unmount();

      handler.mockClear();
      const wrapper = document.createElement("div");
      wrapper.style.visibility = "hidden";
      document.body.appendChild(wrapper);
      render(
        <PlanWorkspace
          id="w"
          actions={actions}
          events={["OnAction"]}
          eventHandler={handler}
          slots={{ Content: [] }}
        />,
        { container: wrapper },
      );
      fireEvent.keyDown(document.body, { key: "e" });
      expect(handler).not.toHaveBeenCalled();
      wrapper.remove();
    } finally {
      delete (Element.prototype as { checkVisibility?: unknown }).checkVisibility;
    }
  });

  it("binds keyboard-only shortcuts without rendering them", () => {
    const handler = vi.fn();
    const shortcuts = [
      { tag: "PreviousPlan", label: "Previous plan", shortcut: "ArrowLeft" },
      { tag: "NextPlan", label: "Next plan", shortcut: "ArrowRight" },
    ];
    renderWorkspace(handler, {
      shortcuts,
      slots: { Content: [<textarea key="t" aria-label="editor" />] },
    });

    expect(screen.queryByText("Next plan")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Next plan")).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(handler).toHaveBeenCalledWith("OnAction", "w", ["NextPlan"]);
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(handler).toHaveBeenCalledWith("OnAction", "w", ["PreviousPlan"]);

    handler.mockClear();
    fireEvent.keyDown(screen.getByLabelText("editor"), { key: "ArrowRight" });
    expect(handler).not.toHaveBeenCalled();

    // A menu, list or tab strip that moves its own focus with the arrows keeps them.
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = '<div role="menuitem" tabindex="0" aria-label="row"></div>';
    document.body.appendChild(menu);
    fireEvent.keyDown(screen.getByLabelText("row"), { key: "ArrowRight" });
    expect(handler).not.toHaveBeenCalled();
    menu.remove();
  });

  it("stays quiet under a host modal, on auto-repeat, and inside a listbox", () => {
    const handler = vi.fn();
    renderWorkspace(handler, {
      shortcuts: [{ tag: "NextPlan", label: "Next plan", shortcut: "ArrowRight" }],
    });

    // A dialog the host opened owns the keyboard.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.appendChild(dialog);
    fireEvent.keyDown(document.body, { key: "x" });
    expect(handler).not.toHaveBeenCalled();
    dialog.remove();

    // An auto-repeat is a key held down, not a fresh press.
    fireEvent.keyDown(document.body, { key: "x", repeat: true });
    expect(handler).not.toHaveBeenCalled();

    // A listbox moves its own selection with the arrows.
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    listbox.innerHTML = '<div role="option" tabindex="0" aria-label="option"></div>';
    document.body.appendChild(listbox);
    fireEvent.keyDown(screen.getByLabelText("option"), { key: "ArrowRight" });
    expect(handler).not.toHaveBeenCalled();
    listbox.remove();

    // With every gate lifted the same key does fire, so the assertions above mean something.
    fireEvent.keyDown(document.body, { key: "x" });
    expect(handler).toHaveBeenCalledWith("OnAction", "w", ["Execute"]);
  });

  it("opens the verifications and questions dropdowns from the tab strip corner", () => {
    renderWorkspace();
    expect(screen.queryByText("verification rows")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Verifications" }));
    expect(screen.getByText("verification rows")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Questions" }));
    expect(screen.queryByText("verification rows")).not.toBeInTheDocument();
    expect(screen.getByText("question rows")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("question rows")).not.toBeInTheDocument();
  });

  it("marks the Questions icon until its dropdown has been opened for the plan", () => {
    renderWorkspace(vi.fn(), { unansweredQuestions: 2, planId: "#77" });
    const questionsButton = () => screen.getByRole("button", { name: /Questions/ });
    expect(questionsButton()).toHaveAttribute("data-indicator", "true");

    fireEvent.click(questionsButton());
    expect(questionsButton()).toHaveAttribute("data-indicator", "false");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(questionsButton()).toHaveAttribute("data-indicator", "false");
  });

  it("shows no indicator when every question is answered", () => {
    renderWorkspace(vi.fn(), { unansweredQuestions: 0, planId: "#78" });
    expect(screen.getByRole("button", { name: /Questions/ })).toHaveAttribute(
      "data-indicator",
      "false",
    );
  });

  it("opens the Questions panel on hover after 120 ms", () => {
    renderWorkspace();
    const questionsButton = screen.getByRole("button", { name: /Questions/ });
    expect(screen.queryByText("question rows")).not.toBeInTheDocument();

    fireEvent.pointerEnter(questionsButton, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(screen.getByText("question rows")).toBeInTheDocument();
  });

  it("delays and cancels the close when hovering between button and panel", () => {
    renderWorkspace();
    const questionsButton = screen.getByRole("button", { name: /Questions/ });

    fireEvent.pointerEnter(questionsButton, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(screen.getByText("question rows")).toBeInTheDocument();

    fireEvent.pointerLeave(questionsButton, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText("question rows")).toBeInTheDocument();

    const dropdown = screen.getByText("question rows").closest(".pws-dropdown")!;
    fireEvent.pointerEnter(dropdown, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText("question rows")).toBeInTheDocument();

    fireEvent.pointerLeave(dropdown, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(screen.queryByText("question rows")).not.toBeInTheDocument();
  });

  it("pins the panel on click and prevents hover-close", () => {
    renderWorkspace();
    const questionsButton = screen.getByRole("button", { name: /Questions/ });

    fireEvent.pointerEnter(questionsButton, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(screen.getByText("question rows")).toBeInTheDocument();

    fireEvent.pointerLeave(questionsButton, { pointerType: "mouse" });
    fireEvent.click(questionsButton);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText("question rows")).toBeInTheDocument();

    fireEvent.click(questionsButton);
    expect(screen.queryByText("question rows")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByText("question rows")).not.toBeInTheDocument();
  });

  it("unpins on Escape and allows hover to reopen", () => {
    renderWorkspace();
    const questionsButton = screen.getByRole("button", { name: /Questions/ });

    fireEvent.click(questionsButton);
    expect(screen.getByText("question rows")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("question rows")).not.toBeInTheDocument();

    fireEvent.pointerEnter(questionsButton, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(screen.getByText("question rows")).toBeInTheDocument();
  });

  it("suppresses the tooltip while the panel is open", () => {
    renderWorkspace();
    const questionsButton = screen.getByRole("button", { name: /Questions/ });

    fireEvent.pointerEnter(questionsButton, { pointerType: "mouse" });
    fireEvent.pointerMove(questionsButton, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.click(questionsButton);
    fireEvent.click(questionsButton);
    expect(screen.queryByText("question rows")).not.toBeInTheDocument();

    fireEvent.pointerMove(questionsButton, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("retires the indicator dot on hover-open", () => {
    renderWorkspace(vi.fn(), { unansweredQuestions: 2, planId: "#79" });
    const questionsButton = screen.getByRole("button", { name: /Questions/ });
    expect(questionsButton).toHaveAttribute("data-indicator", "true");

    fireEvent.pointerEnter(questionsButton, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(questionsButton).toHaveAttribute("data-indicator", "false");
  });

  it("hides the dropdown icons when their slots are empty", () => {
    renderWorkspace(vi.fn(), {
      slots: { Content: [<div key="c" />], Verifications: [], Questions: undefined },
    });
    expect(screen.queryByRole("button", { name: "Verifications" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Questions" })).not.toBeInTheDocument();
  });

  it("shows the chat panel whenever a Chat slot exists", () => {
    const { rerender } = renderWorkspace();
    expect(screen.queryByLabelText("Plan chat")).not.toBeInTheDocument();

    rerender(<PlanWorkspace id="w" slots={{ Chat: [<div key="chat">chat body</div>] }} />);
    expect(screen.getByLabelText("Plan chat")).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize chat" })).toBeInTheDocument();
  });

  it("puts the caret in the chat composer for a focusChat action and its shortcut", () => {
    const handler = vi.fn();
    renderWorkspace(handler, { slots: { Chat: [<textarea key="c" aria-label="composer" />] } });
    const composer = screen.getByLabelText("composer");

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(composer).toHaveFocus();
    expect(handler).toHaveBeenCalledWith("OnAction", "w", ["Chat"]);

    composer.blur();
    fireEvent.keyDown(document.body, { key: "u" });
    expect(composer).toHaveFocus();
  });

  it("resizes the chat by dragging the divider and remembers the width", () => {
    const { container } = render(
      <PlanWorkspace id="w" chatWidth={420} slots={{ Chat: [<div key="chat">chat body</div>] }} />,
    );
    const root = container.querySelector(".pws-root") as HTMLElement;
    root.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 1200,
        top: 0,
        bottom: 800,
        width: 1200,
        height: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const handle = screen.getByRole("separator", { name: "Resize chat" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 780 });
    fireEvent.pointerMove(window, { clientX: 700 });
    fireEvent.pointerUp(window, { clientX: 700 });

    expect(root.style.getPropertyValue("--pws-chat-width")).toBe("500px");
    expect(window.localStorage.getItem(chatWidthStorageKey("w"))).toBe("500");
    // Not the plan page's key: this workspace is `id="w"`, and the two must not share a slot.
    expect(window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY)).toBeNull();

    fireEvent.doubleClick(handle);
    expect(root.style.getPropertyValue("--pws-chat-width")).toBe("420px");
    expect(window.localStorage.getItem(chatWidthStorageKey("w"))).toBeNull();
  });

  it("never lets the chat grow past its share of the workspace", () => {
    const { container } = render(
      <PlanWorkspace id="w" slots={{ Chat: [<div key="chat">chat body</div>] }} />,
    );
    const root = container.querySelector(".pws-root") as HTMLElement;
    root.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 1000,
        top: 0,
        bottom: 800,
        width: 1000,
        height: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const handle = screen.getByRole("separator", { name: "Resize chat" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 580 });
    fireEvent.pointerMove(window, { clientX: 100 });
    fireEvent.pointerUp(window, { clientX: 100 });
    expect(root.style.getPropertyValue("--pws-chat-width")).toBe("600px");
  });

  it("shows the reviewer persona in share mode", () => {
    renderWorkspace(vi.fn(), { persona: "Curious Otter", personaInitials: "CO" });
    expect(screen.getByText("Curious Otter")).toBeInTheDocument();
    expect(screen.getByText("CO")).toBeInTheDocument();
  });

  it("renders project badges to the left of topbar actions", () => {
    renderWorkspace(vi.fn(), {
      slots: {
        ProjectBadges: [
          <span key="1" data-testid="test-badge">
            tendril
          </span>,
        ],
      },
    });

    const badge = screen.getByTestId("test-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("tendril");

    const badgesContainer = badge.closest(".pws-project-badges");
    expect(badgesContainer).toBeInTheDocument();
    const topbarRight = badgesContainer?.parentElement;
    expect(topbarRight).toHaveClass("pws-topbar-right");
    const children = Array.from(topbarRight?.children || []);
    const badgeIdx = children.indexOf(badgesContainer!);
    const actionsIdx = children.findIndex((el) => el.classList.contains("pws-icon-group"));
    expect(badgeIdx).toBeLessThan(actionsIdx);
  });
});

describe("shortcuts", () => {
  it("formats keys for display", () => {
    expect(shortcutKeys("E")).toEqual(["E"]);
    expect(shortcutKeys("Backspace")).toEqual(["⌫"]);
    expect(shortcutKeys("Ctrl+Enter")).toEqual(["Ctrl", "↵"]);
    expect(shortcutKeys("ArrowLeft")).toEqual(["←"]);
    expect(shortcutKeys("ArrowRight")).toEqual(["→"]);
  });

  it("matches plain keys case-insensitively and rejects extra modifiers", () => {
    const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
    expect(matchesShortcut(key({ key: "E" }), "e")).toBe(true);
    expect(matchesShortcut(key({ key: "e", ctrlKey: true }), "e")).toBe(false);
    expect(matchesShortcut(key({ key: "Enter", ctrlKey: true }), "Ctrl+Enter")).toBe(true);
    expect(matchesShortcut(key({ key: "Enter" }), "Ctrl+Enter")).toBe(false);
    expect(matchesShortcut(key({ key: "Backspace" }), "Backspace")).toBe(true);
  });

  /**
   * `matchesShortcut` above is the reference; the registry is what actually fires. These pin the two
   * places the registry does not behave like V1's `keydown` handler on its own, both of which bite as
   * soon as a second view mounts this widget.
   */
  it("registers per instance, so two mounted workspaces both answer their key", () => {
    const first = vi.fn();
    const second = vi.fn();
    renderWorkspace(first);
    renderWorkspace(second);

    fireEvent.keyDown(document.body, { key: "x", code: "KeyX" });

    // The registry is a module-level Map: with one id per tag there is one registration, and only one
    // of these two would ever be called.
    expect(first).toHaveBeenCalledWith("OnAction", "w", ["Execute"]);
    expect(second).toHaveBeenCalledWith("OnAction", "w", ["Execute"]);
  });

  it("leaves the survivor's keys registered when another instance unmounts", () => {
    const survivor = vi.fn();
    renderWorkspace(survivor);
    const { unmount } = renderWorkspace(vi.fn());

    // With a shared id, this cleanup deletes the entry the survivor's mount made.
    unmount();
    fireEvent.keyDown(document.body, { key: "x", code: "KeyX" });

    expect(survivor).toHaveBeenCalledWith("OnAction", "w", ["Execute"]);
  });

  it("gives a key to the first binding that claims it, as V1's bindings.find did", () => {
    const handler = vi.fn();
    // `bindings` is `[...actions, ...menuItems, ...secondary, primary, ...shortcuts]`, so the primary's
    // `x` is ahead of this one. The registry would otherwise run both registrations for one press.
    renderWorkspace(handler, {
      shortcuts: [{ tag: "Shadow", label: "Shadow", shortcut: "x" }],
    });

    fireEvent.keyDown(document.body, { key: "x", code: "KeyX" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("OnAction", "w", ["Execute"]);
  });
});

/**
 * The width key was global — `tendril.plan.chatWidth` for every workspace — and that was only ever
 * correct while exactly one `PlanWorkspace` existed in the app. It no longer does: the config editor
 * mounts a second one, and under a shared key the last pane dragged silently resized the other the
 * next time it opened. The key is now derived from the `id` the workspace already takes.
 *
 * The compatibility half is the part worth pinning. `plan-workspace` keeps the original key verbatim
 * rather than moving to a derived one, because a rename would read as a reset of the width every
 * existing operator has already dragged the plan chat to.
 */
describe("chatWidthStorageKey", () => {
  it("keeps the plan workspace on the key its width is already stored under", () => {
    expect(chatWidthStorageKey("plan-workspace")).toBe(CHAT_WIDTH_STORAGE_KEY);
    expect(CHAT_WIDTH_STORAGE_KEY).toBe("tendril.plan.chatWidth");
  });

  it("gives every other workspace a key of its own", () => {
    expect(chatWidthStorageKey("config-editor-workspace")).toBe(
      "tendril.chatWidth.config-editor-workspace",
    );
    expect(chatWidthStorageKey("review-workspace")).not.toBe(chatWidthStorageKey("plan-workspace"));
  });

  it("reads and writes each workspace's width independently", () => {
    window.localStorage.clear();

    writeStoredChatWidth("plan-workspace", 700);
    writeStoredChatWidth("config-editor-workspace", 500);

    expect(readStoredChatWidth("plan-workspace")).toBe(700);
    expect(readStoredChatWidth("config-editor-workspace")).toBe(500);
    // An operator who had dragged the plan chat before this change finds that width still there.
    expect(window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY)).toBe("700");

    // Resetting one pane leaves the other alone, which is the whole point of the parameterisation.
    writeStoredChatWidth("config-editor-workspace", null);
    expect(readStoredChatWidth("config-editor-workspace")).toBeNull();
    expect(readStoredChatWidth("plan-workspace")).toBe(700);

    window.localStorage.clear();
  });

  /** A width below the floor is not a width, whichever key it came off. */
  it("ignores a stored value that is not a usable width", () => {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, "not-a-number");
    expect(readStoredChatWidth("plan-workspace")).toBeNull();

    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, "12");
    expect(readStoredChatWidth("plan-workspace")).toBeNull();

    window.localStorage.clear();
  });
});
