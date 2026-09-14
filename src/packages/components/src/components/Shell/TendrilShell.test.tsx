// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BrandIcon, brandIcons } from "./brandIcons.tsx";
import { ShellAgentButton } from "./ShellAgentButton.tsx";
import { ShellContext, useShell } from "./ShellContext.tsx";
import { ShellNav } from "./ShellNav.tsx";
import { ShellNewPlanButton } from "./ShellNewPlanButton.tsx";
import { ShellSettingsButton } from "./ShellSettingsButton.tsx";
import { ShellSidebarHeader } from "./ShellSidebarHeader.tsx";
import { ShellSidebarSection } from "./ShellSidebarSection.tsx";
import { ShellTabs } from "./ShellTabs.tsx";
import { TendrilShell } from "./TendrilShell.tsx";
import type { ShellNavItemDto, ShellSectionItemDto, ShellTabDto } from "./types.ts";

describe("TendrilShell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders sidebar slots, content slot, and tab strip", () => {
    const handler = vi.fn();
    act(() => {
      root.render(
        <TendrilShell
          id="test-shell"
          eventHandler={handler}
          hasTabs
          slots={{
            SidebarHeader: <div data-testid="sidebar-header">Header</div>,
            SidebarBody: <div data-testid="sidebar-body">Body</div>,
            SidebarFooter: <div data-testid="sidebar-footer">Footer</div>,
            Content: <div data-testid="main-content">Workspace Content</div>,
            Tabs: <div data-testid="tab-strip">Tabs Strip</div>,
          }}
        />,
      );
    });

    expect(container.querySelector('[data-testid="sidebar-header"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="sidebar-body"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="sidebar-footer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="main-content"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tab-strip"]')).not.toBeNull();
  });

  it("verifies collapse toggle state changes when toggle button is clicked or Cmd/Ctrl+B is pressed", () => {
    const handler = vi.fn();
    act(() => {
      root.render(
        <TendrilShell
          id="test-shell"
          events={["OnCollapsedChanged"]}
          eventHandler={handler}
          slots={{
            SidebarHeader: (
              <ShellSidebarHeader id="header" title="Tendril" eventHandler={handler} />
            ),
            Content: <div>Content</div>,
          }}
        />,
      );
    });

    const rootEl = container.querySelector(".tsh-root");
    expect(rootEl?.getAttribute("data-collapsed")).toBe("false");

    // Click collapse toggle in header
    const toggleBtn = container.querySelector(".tsh-header-toggle") as HTMLButtonElement;
    expect(toggleBtn).not.toBeNull();
    act(() => {
      toggleBtn.click();
    });

    expect(handler).toHaveBeenCalledWith("OnCollapsedChanged", "test-shell", [true]);
    expect(rootEl?.getAttribute("data-collapsed")).toBe("true");

    // Press Ctrl+B to toggle back
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true }));
    });
    expect(handler).toHaveBeenCalledWith("OnCollapsedChanged", "test-shell", [false]);
    expect(rootEl?.getAttribute("data-collapsed")).toBe("false");
  });

  it("switches to active session pane when activeSessionIndex is provided", () => {
    act(() => {
      root.render(
        <TendrilShell
          id="test-shell"
          eventHandler={vi.fn()}
          activeSessionIndex={0}
          slots={{
            Content: <div data-testid="content-pane">Default Pane</div>,
            SessionContents: [
              <div key="session-0" data-testid="session-0-pane">
                Session 0 Active
              </div>,
              <div key="session-1" data-testid="session-1-pane">
                Session 1 Inactive
              </div>,
            ],
          }}
        />,
      );
    });

    const panes = container.querySelectorAll(".tsh-frame-pane");
    expect(panes[0]?.getAttribute("data-active")).toBe("false");
    expect(panes[1]?.getAttribute("data-active")).toBe("true");
    expect(panes[2]?.getAttribute("data-active")).toBe("false");
  });

  it("supports sidebar resizing within min/max bounds and resets on double click", () => {
    localStorage.clear();
    act(() => {
      root.render(
        <TendrilShell
          id="test-shell"
          eventHandler={vi.fn()}
          slots={{
            SidebarHeader: <div>Header</div>,
            Content: <div>Content</div>,
          }}
        />,
      );
    });

    const rootEl = container.querySelector(".tsh-root") as HTMLElement;
    const resizer = container.querySelector(".tsh-sidebar-resizer") as HTMLElement;
    expect(resizer).not.toBeNull();
    expect(rootEl.style.getPropertyValue("--tsh-sidebar-width")).toBe("320px");

    // Pointer down to start drag
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, pointerId: 1, bubbles: true }),
      );
    });

    // Move to 450px
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 450, pointerId: 1, bubbles: true }),
      );
    });
    expect(rootEl.style.getPropertyValue("--tsh-sidebar-width")).toBe("450px");
    expect(localStorage.getItem("tendril.shell.sidebarWidth")).toBe("450");

    // Clamp to MIN_SIDEBAR_WIDTH (200)
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 100, pointerId: 1, bubbles: true }),
      );
    });
    expect(rootEl.style.getPropertyValue("--tsh-sidebar-width")).toBe("200px");
    expect(localStorage.getItem("tendril.shell.sidebarWidth")).toBe("200");

    // Clamp to MAX_SIDEBAR_WIDTH (640)
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 800, pointerId: 1, bubbles: true }),
      );
    });
    expect(rootEl.style.getPropertyValue("--tsh-sidebar-width")).toBe("640px");
    expect(localStorage.getItem("tendril.shell.sidebarWidth")).toBe("640");

    // Pointer up
    act(() => {
      resizer.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
    });

    // Double-click resets to default (320px)
    act(() => {
      resizer.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(rootEl.style.getPropertyValue("--tsh-sidebar-width")).toBe("320px");
    expect(localStorage.getItem("tendril.shell.sidebarWidth")).toBe("320");
  });

  it("makes the sidebar resizer keyboard-focusable", () => {
    act(() => {
      root.render(
        <TendrilShell
          id="test-shell"
          eventHandler={vi.fn()}
          slots={{
            SidebarHeader: <div>Header</div>,
            Content: <div>Content</div>,
          }}
        />,
      );
    });

    const resizer = container.querySelector(".tsh-sidebar-resizer") as HTMLElement;
    expect(resizer).not.toBeNull();

    act(() => {
      resizer.focus();
    });
    expect(document.activeElement).toBe(resizer);
  });

  it("restores stored sidebar width from localStorage on mount", () => {
    localStorage.setItem("tendril.shell.sidebarWidth", "400");
    act(() => {
      root.render(
        <TendrilShell
          id="test-shell"
          eventHandler={vi.fn()}
          slots={{
            Content: <div>Content</div>,
          }}
        />,
      );
    });

    const rootEl = container.querySelector(".tsh-root") as HTMLElement;
    expect(rootEl.style.getPropertyValue("--tsh-sidebar-width")).toBe("400px");
  });
});

describe("ShellNav", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const items: ShellNavItemDto[] = [
    { id: "plans", label: "Plans", icon: "Feather", badge: "3", isActive: true },
    { id: "jobs", label: "Jobs", icon: "Activity" },
  ];

  it("renders navigation links and dispatches selection events", () => {
    const handler = vi.fn();
    act(() => {
      root.render(
        <ShellNav
          id="nav"
          items={items}
          events={["OnSelect"]}
          eventHandler={handler}
          showDivider
        />,
      );
    });

    const buttons = container.querySelectorAll<HTMLButtonElement>(".tsh-nav-item");
    expect(buttons.length).toBe(2);
    expect(buttons[0]?.getAttribute("data-active")).toBe("true");
    expect(buttons[1]?.getAttribute("data-active")).toBe("false");

    act(() => {
      buttons[1]?.click();
    });
    expect(handler).toHaveBeenCalledWith("OnSelect", "nav", ["jobs"]);
  });
});

describe("ShellTabs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const tabs: ShellTabDto[] = [
    { id: "t1", title: "Plan Execution" },
    { id: "t2", title: "Review Chat" },
  ];

  it("renders active tab styling and fires tab selection, close, and new callbacks", () => {
    const handler = vi.fn();
    act(() => {
      root.render(
        <ShellTabs
          id="tabs"
          tabs={tabs}
          selectedId="t1"
          events={["OnSelect", "OnClose", "OnNew"]}
          eventHandler={handler}
        />,
      );
    });

    const tabElements = container.querySelectorAll<HTMLDivElement>(".tsh-tab");
    expect(tabElements.length).toBe(2);
    expect(tabElements[0]?.getAttribute("data-active")).toBe("true");
    expect(tabElements[1]?.getAttribute("data-active")).toBe("false");

    // Select tab 2
    act(() => {
      tabElements[1]?.click();
    });
    expect(handler).toHaveBeenCalledWith("OnSelect", "tabs", ["t2"]);

    // Close tab 1
    const closeBtn = tabElements[0]?.querySelector<HTMLButtonElement>(".tsh-tab-close");
    act(() => {
      closeBtn?.click();
    });
    expect(handler).toHaveBeenCalledWith("OnClose", "tabs", ["t1"]);

    // New session
    const newBtn = container.querySelector<HTMLButtonElement>(".tsh-tab-new");
    act(() => {
      newBtn?.click();
    });
    expect(handler).toHaveBeenCalledWith("OnNew", "tabs", []);
  });

  it("renders nothing when tabs list is empty", () => {
    act(() => {
      root.render(<ShellTabs id="tabs" tabs={[]} eventHandler={vi.fn()} />);
    });
    expect(container.firstChild).toBeNull();
  });
});

describe("ShellSidebarSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const items: ShellSectionItemDto[] = [
    {
      id: "p1",
      title: "Task One",
      tag: "#001",
      badges: [{ label: "ready", kind: "success" }],
    },
  ];

  it("renders section header, search button, and items with badges", () => {
    const handler = vi.fn();
    act(() => {
      root.render(
        <ShellSidebarSection
          id="sec"
          title="Section Plans"
          searchable
          items={items}
          selectedId="p1"
          events={["OnSelectItem", "OnSearch"]}
          eventHandler={handler}
        />,
      );
    });

    expect(container.textContent).toContain("Section Plans");
    expect(container.textContent).toContain("Task One");
    expect(container.textContent).toContain("#001");
    expect(container.textContent).toContain("ready");

    const searchBtn = container.querySelector<HTMLButtonElement>(".tsh-section-search");
    act(() => {
      searchBtn?.click();
    });
    expect(handler).toHaveBeenCalledWith("OnSearch", "sec", []);

    const itemBtn = container.querySelector<HTMLButtonElement>(".tsh-section-item");
    act(() => {
      itemBtn?.click();
    });
    expect(handler).toHaveBeenCalledWith("OnSelectItem", "sec", ["p1"]);
  });

  it("renders rail chips when collapsed inside ShellContext", () => {
    act(() => {
      root.render(
        <ShellContext.Provider value={{ collapsed: true, toggle: vi.fn() }}>
          <ShellSidebarSection
            id="sec"
            title="Section Plans"
            searchable
            items={items}
            eventHandler={vi.fn()}
          />
        </ShellContext.Provider>,
      );
    });

    expect(container.querySelector(".tsh-section-rail")).not.toBeNull();
    expect(container.textContent).toContain("#001");
  });
});

describe("Shell Sidebar Buttons", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("fires events on button clicks", () => {
    const handler = vi.fn();
    act(() => {
      root.render(
        <div>
          <ShellAgentButton
            id="agent"
            label="Coding Agent"
            events={["OnOpen"]}
            eventHandler={handler}
          />
          <ShellNewPlanButton id="newplan" events={["OnClick"]} eventHandler={handler} />
          <ShellSettingsButton id="settings" events={["OnClick"]} eventHandler={handler} />
        </div>,
      );
    });

    const agentBtn = container.querySelector<HTMLButtonElement>(".tsh-agent");
    const newPlanBtn = container.querySelector<HTMLButtonElement>(".tsh-newplan");
    const settingsBtn = container.querySelector<HTMLButtonElement>(".tsh-settings");

    act(() => {
      agentBtn?.click();
    });
    expect(handler).toHaveBeenCalledWith("OnOpen", "agent", []);

    act(() => {
      newPlanBtn?.click();
    });
    expect(handler).toHaveBeenCalledWith("OnClick", "newplan", []);

    act(() => {
      settingsBtn?.click();
    });
    expect(handler).toHaveBeenCalledWith("OnClick", "settings", []);
  });
});

describe("BrandIcon", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders known brand icons and fallbacks", () => {
    act(() => {
      root.render(
        <div>
          <BrandIcon name="ClaudeCode" size={20} />
          <BrandIcon name="Antigravity" size={20} />
          <BrandIcon name="UnknownBrand" size={20} />
        </div>,
      );
    });
    expect(container.querySelectorAll("svg").length).toBe(3);
    expect(Object.keys(brandIcons).length).toBeGreaterThan(5);
  });
});

describe("useShell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("returns default context values outside provider", () => {
    let ctxValue: { collapsed: boolean; toggle: () => void } | null = null;
    function Consumer() {
      ctxValue = useShell();
      return null;
    }
    act(() => {
      root.render(<Consumer />);
    });
    expect(ctxValue).toEqual({ collapsed: false, toggle: expect.any(Function) });
  });
});
