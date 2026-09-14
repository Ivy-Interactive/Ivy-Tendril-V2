// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, beforeEach, afterEach, vi } from "vite-plus/test";
import { ThemeProvider, useTheme } from "../src/components/theme-provider.tsx";

function Consumer() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button data-testid="set-dark" onClick={() => setTheme("dark")}>
        Dark
      </button>
      <button data-testid="set-light" onClick={() => setTheme("light")}>
        Light
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    if (!window.matchMedia) {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
    }
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders children properly", () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <div data-testid="child">Hello Theme</div>
        </ThemeProvider>,
      );
    });

    const child = container.querySelector('[data-testid="child"]');
    expect(child).not.toBeNull();
    expect(child?.textContent).toBe("Hello Theme");
  });

  it("throws an error when useTheme is used outside ThemeProvider", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      act(() => {
        root.render(<Consumer />);
      });
    }).toThrow("useTheme must be used within a ThemeProvider");

    consoleSpy.mockRestore();
  });

  it("defaults to specified default theme", () => {
    act(() => {
      root.render(
        <ThemeProvider defaultTheme="dark">
          <Consumer />
        </ThemeProvider>,
      );
    });

    const theme = container.querySelector('[data-testid="theme"]')?.textContent;
    const resolved = container.querySelector('[data-testid="resolved"]')?.textContent;
    expect(theme).toBe("dark");
    expect(resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("updates context state and toggles .dark class on document.documentElement", () => {
    act(() => {
      root.render(
        <ThemeProvider defaultTheme="light">
          <Consumer />
        </ThemeProvider>,
      );
    });

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    const darkButton = container.querySelector('[data-testid="set-dark"]') as HTMLButtonElement;
    act(() => {
      darkButton.click();
    });

    expect(container.querySelector('[data-testid="theme"]')?.textContent).toBe("dark");
    expect(container.querySelector('[data-testid="resolved"]')?.textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("synchronizes with localStorage using custom storageKey", () => {
    const customKey = "custom-theme-key";

    act(() => {
      root.render(
        <ThemeProvider defaultTheme="light" storageKey={customKey}>
          <Consumer />
        </ThemeProvider>,
      );
    });

    const darkButton = container.querySelector('[data-testid="set-dark"]') as HTMLButtonElement;
    act(() => {
      darkButton.click();
    });

    expect(localStorage.getItem(customKey)).toBe("dark");
  });
});
