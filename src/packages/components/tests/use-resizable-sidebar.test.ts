// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  useResizableSidebar,
  readStoredWidth,
  writeStoredWidth,
  type UseResizableSidebarOptions,
  type UseResizableSidebarReturn,
} from "../src/hooks/use-resizable-sidebar";

describe("useResizableSidebar Hook", () => {
  let container: HTMLDivElement;
  let root: Root;
  let hookResult: UseResizableSidebarReturn;

  function TestComponent({ options }: { options?: UseResizableSidebarOptions }) {
    hookResult = useResizableSidebar(options);
    return React.createElement(
      "div",
      { "data-testid": "container" },
      React.createElement("div", {
        "data-testid": "sidebar",
        style: { width: `${hookResult.width}px` },
      }),
      React.createElement("div", {
        "data-testid": "resizer",
        ...hookResult.separatorProps,
      }),
    );
  }

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("initializes with default width when localStorage is empty", () => {
    act(() => {
      root.render(React.createElement(TestComponent));
    });
    expect(hookResult.width).toBe(320);
    expect(hookResult.isDragging).toBe(false);

    act(() => {
      root.unmount();
      root = createRoot(container);
      root.render(React.createElement(TestComponent, { options: { defaultWidth: 280 } }));
    });
    expect(hookResult.width).toBe(280);
  });

  it("initializes with persisted width from localStorage", () => {
    localStorage.setItem("test-sidebar-key", "450");
    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            storageKey: "test-sidebar-key",
            defaultWidth: 320,
            minWidth: 200,
            maxWidth: 640,
          },
        }),
      );
    });
    expect(hookResult.width).toBe(450);

    // Tests bounds clamping on storage load
    localStorage.setItem("test-sidebar-key", "100");
    act(() => {
      root.unmount();
      root = createRoot(container);
      root.render(
        React.createElement(TestComponent, {
          options: {
            storageKey: "test-sidebar-key",
            minWidth: 200,
            maxWidth: 640,
          },
        }),
      );
    });
    expect(hookResult.width).toBe(200);

    localStorage.setItem("test-sidebar-key", "900");
    act(() => {
      root.unmount();
      root = createRoot(container);
      root.render(
        React.createElement(TestComponent, {
          options: {
            storageKey: "test-sidebar-key",
            minWidth: 200,
            maxWidth: 640,
          },
        }),
      );
    });
    expect(hookResult.width).toBe(640);
  });

  it("clamps to minWidth and maxWidth on pointer drag", () => {
    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            storageKey: "test-drag-key",
            minWidth: 200,
            maxWidth: 640,
            defaultWidth: 320,
          },
        }),
      );
    });

    const resizer = container.querySelector('[data-testid="resizer"]') as HTMLElement;
    expect(resizer).not.toBeNull();

    // Pointer down
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, pointerId: 1, bubbles: true }),
      );
    });
    expect(hookResult.isDragging).toBe(true);

    // Drag to 450px
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 450, pointerId: 1, bubbles: true }),
      );
    });
    expect(hookResult.width).toBe(450);
    expect(localStorage.getItem("test-drag-key")).toBe("450");

    // Clamp below minWidth
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 100, pointerId: 1, bubbles: true }),
      );
    });
    expect(hookResult.width).toBe(200);
    expect(localStorage.getItem("test-drag-key")).toBe("200");

    // Clamp above maxWidth
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 800, pointerId: 1, bubbles: true }),
      );
    });
    expect(hookResult.width).toBe(640);
    expect(localStorage.getItem("test-drag-key")).toBe("640");

    // Pointer up
    act(() => {
      resizer.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
    });
    expect(hookResult.isDragging).toBe(false);

    // Pointer move after pointer up should be ignored
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 300, pointerId: 1, bubbles: true }),
      );
    });
    expect(hookResult.width).toBe(640);
  });

  it("updates localStorage when width changes via setWidth", () => {
    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            storageKey: "test-set-width",
            minWidth: 200,
            maxWidth: 640,
            defaultWidth: 320,
          },
        }),
      );
    });

    act(() => {
      hookResult.setWidth(500);
    });
    expect(hookResult.width).toBe(500);
    expect(localStorage.getItem("test-set-width")).toBe("500");

    act(() => {
      hookResult.setWidth((prev) => prev - 100);
    });
    expect(hookResult.width).toBe(400);
    expect(localStorage.getItem("test-set-width")).toBe("400");
  });

  it("resets to defaultWidth on double click", () => {
    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            storageKey: "test-reset-key",
            defaultWidth: 320,
            minWidth: 200,
            maxWidth: 640,
          },
        }),
      );
    });

    const resizer = container.querySelector('[data-testid="resizer"]') as HTMLElement;

    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, pointerId: 1, bubbles: true }),
      );
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 520, pointerId: 1, bubbles: true }),
      );
      resizer.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
    });
    expect(hookResult.width).toBe(520);
    expect(localStorage.getItem("test-reset-key")).toBe("520");

    // Double click
    act(() => {
      resizer.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(hookResult.width).toBe(320);
    expect(localStorage.getItem("test-reset-key")).toBe("320");
  });

  it("safely handles errors when localStorage throws or is unavailable (SSR)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            storageKey: "throwing-key",
            defaultWidth: 300,
            minWidth: 200,
            maxWidth: 600,
          },
        }),
      );
    });
    expect(hookResult.width).toBe(300);

    const resizer = container.querySelector('[data-testid="resizer"]') as HTMLElement;
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, pointerId: 1, bubbles: true }),
      );
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 420, pointerId: 1, bubbles: true }),
      );
      resizer.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
    });
    expect(hookResult.width).toBe(420);

    // Test helpers directly with throwing storage
    expect(readStoredWidth("throwing-key", 200, 600)).toBeNull();
    expect(() => writeStoredWidth("throwing-key", 400)).not.toThrow();
  });

  it("handles side 'right' calculation mode when configured", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1200,
    });

    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            side: "right",
            minWidth: 200,
            maxWidth: 640,
            defaultWidth: 300,
          },
        }),
      );
    });

    const resizer = container.querySelector('[data-testid="resizer"]') as HTMLElement;

    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, pointerId: 1, bubbles: true }),
      );
    });

    // Window width is 1200. clientX = 850 -> width = 1200 - 850 = 350
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 850, pointerId: 1, bubbles: true }),
      );
    });
    expect(hookResult.width).toBe(350);

    // Clamping to minWidth: clientX = 1100 -> 1200 - 1100 = 100 -> 200
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 1100, pointerId: 1, bubbles: true }),
      );
    });
    expect(hookResult.width).toBe(200);

    // Clamping to maxWidth: clientX = 400 -> 1200 - 400 = 800 -> 640
    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 400, pointerId: 1, bubbles: true }),
      );
    });
    expect(hookResult.width).toBe(640);
  });

  it("invokes onWidthChange callback when width changes", () => {
    const onWidthChange = vi.fn();
    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            onWidthChange,
            defaultWidth: 320,
            minWidth: 200,
            maxWidth: 640,
          },
        }),
      );
    });

    const resizer = container.querySelector('[data-testid="resizer"]') as HTMLElement;

    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, pointerId: 1, bubbles: true }),
      );
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 380, pointerId: 1, bubbles: true }),
      );
    });
    expect(onWidthChange).toHaveBeenCalledWith(380);

    act(() => {
      hookResult.setWidth(410);
    });
    expect(onWidthChange).toHaveBeenCalledWith(410);

    act(() => {
      hookResult.resetWidth();
    });
    expect(onWidthChange).toHaveBeenCalledWith(320);
  });

  it("ignores pointer down if button is not 0", () => {
    act(() => {
      root.render(React.createElement(TestComponent));
    });

    const resizer = container.querySelector('[data-testid="resizer"]') as HTMLElement;

    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointerdown", { button: 1, pointerId: 1, bubbles: true }),
      );
    });
    expect(hookResult.isDragging).toBe(false);

    act(() => {
      resizer.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 500, pointerId: 1, bubbles: true }),
      );
    });
    expect(hookResult.width).toBe(320);
  });

  it("provides correct separator props for accessibility including ARIA value attributes", () => {
    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            defaultWidth: 320,
            minWidth: 200,
            maxWidth: 640,
          },
        }),
      );
    });

    const resizer = container.querySelector('[data-testid="resizer"]') as HTMLElement;
    expect(resizer.getAttribute("role")).toBe("separator");
    expect(resizer.getAttribute("aria-orientation")).toBe("vertical");
    expect(resizer.getAttribute("tabindex")).toBe("0");
    expect(resizer.getAttribute("aria-valuenow")).toBe("320");
    expect(resizer.getAttribute("aria-valuemin")).toBe("200");
    expect(resizer.getAttribute("aria-valuemax")).toBe("640");

    expect(hookResult.separatorProps["aria-valuenow"]).toBe(320);
    expect(hookResult.separatorProps["aria-valuemin"]).toBe(200);
    expect(hookResult.separatorProps["aria-valuemax"]).toBe(640);
    expect(hookResult.onKeyDown).toBeDefined();
    expect(hookResult.separatorProps.onKeyDown).toBe(hookResult.onKeyDown);
  });

  it("handles keyboard navigation with ArrowRight and ArrowLeft when side is left", () => {
    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            defaultWidth: 320,
            minWidth: 200,
            maxWidth: 640,
          },
        }),
      );
    });

    const resizer = container.querySelector('[data-testid="resizer"]') as HTMLElement;

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(hookResult.width).toBe(330);

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
      );
    });
    expect(hookResult.width).toBe(320);
  });

  it("handles Shift + Arrow keys with larger shiftStep increments", () => {
    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            defaultWidth: 320,
            minWidth: 200,
            maxWidth: 640,
          },
        }),
      );
    });

    const resizer = container.querySelector('[data-testid="resizer"]') as HTMLElement;

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(hookResult.width).toBe(370);

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(hookResult.width).toBe(320);
  });

  it("handles inverted keyboard navigation direction when side is right", () => {
    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            side: "right",
            defaultWidth: 320,
            minWidth: 200,
            maxWidth: 640,
          },
        }),
      );
    });

    const resizer = container.querySelector('[data-testid="resizer"]') as HTMLElement;

    // ArrowLeft expands sidebar when anchored to the right
    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
      );
    });
    expect(hookResult.width).toBe(330);

    // ArrowRight shrinks sidebar when anchored to the right
    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(hookResult.width).toBe(320);

    // Shift + ArrowLeft expands by shiftStep
    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(hookResult.width).toBe(370);

    // Shift + ArrowRight shrinks by shiftStep
    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(hookResult.width).toBe(320);
  });

  it("handles Home and End keys to snap to minWidth and maxWidth with persistence", () => {
    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            storageKey: "test-home-end-key",
            defaultWidth: 350,
            minWidth: 200,
            maxWidth: 600,
          },
        }),
      );
    });

    const resizer = container.querySelector('[data-testid="resizer"]') as HTMLElement;

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }),
      );
    });
    expect(hookResult.width).toBe(200);
    expect(localStorage.getItem("test-home-end-key")).toBe("200");

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }),
      );
    });
    expect(hookResult.width).toBe(600);
    expect(localStorage.getItem("test-home-end-key")).toBe("600");
  });

  it("calls preventDefault on handled navigation keys and ignores unrelated keys", () => {
    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            defaultWidth: 320,
            minWidth: 200,
            maxWidth: 640,
          },
        }),
      );
    });

    const resizer = container.querySelector('[data-testid="resizer"]') as HTMLElement;

    const handledKeys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    for (const key of handledKeys) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      act(() => {
        resizer.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
    }

    const unhandledKeys = ["Tab", "Enter", "KeyA", "Escape", "Space"];
    for (const key of unhandledKeys) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      act(() => {
        resizer.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("supports custom step and shiftStep option overrides", () => {
    act(() => {
      root.render(
        React.createElement(TestComponent, {
          options: {
            defaultWidth: 300,
            minWidth: 200,
            maxWidth: 640,
            step: 15,
            shiftStep: 75,
          },
        }),
      );
    });

    const resizer = container.querySelector('[data-testid="resizer"]') as HTMLElement;

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(hookResult.width).toBe(315);

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(hookResult.width).toBe(390);

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
      );
    });
    expect(hookResult.width).toBe(375);

    act(() => {
      resizer.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(hookResult.width).toBe(300);
  });
});
