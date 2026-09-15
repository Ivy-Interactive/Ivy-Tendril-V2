import { useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { ThemeContext, type Theme, type ThemeContextType } from "../contexts/theme-context.tsx";
import { getThemeColors, isDarkMode, type ThemeColors } from "../lib/theme.ts";
import { useTheme as useThemeContext } from "../contexts/theme-context.tsx";

export interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  attribute?: string;
}

export const globalThemeRef = {
  setTheme: null as ((theme: Theme) => void) | null,
};

export const setThemeGlobal = (theme: Theme) => {
  if (globalThemeRef.setTheme) {
    globalThemeRef.setTheme(theme);
    return true;
  }
  return false;
};

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "ui-theme",
  attribute = "class",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme;
    try {
      return (localStorage.getItem(storageKey) as Theme) || defaultTheme;
    } catch {
      return defaultTheme;
    }
  });

  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "light";
    if (theme === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme;
  });

  const applyTheme = useCallback(
    (targetTheme: Theme) => {
      const root = window.document.documentElement;
      const isDark =
        targetTheme === "dark" ||
        (targetTheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

      const resolved = isDark ? "dark" : "light";
      setResolvedTheme(resolved);

      if (attribute === "class") {
        root.classList.remove("light", "dark");
        root.classList.add(resolved);
      } else {
        root.setAttribute(attribute, resolved);
      }
    },
    [attribute],
  );

  const setTheme = useCallback(
    (newTheme: Theme) => {
      try {
        localStorage.setItem(storageKey, newTheme);
      } catch {
        // ignore localStorage write errors
      }
      setThemeState(newTheme);
    },
    [storageKey],
  );

  useEffect(() => {
    globalThemeRef.setTheme = setTheme;
    return () => {
      globalThemeRef.setTheme = null;
    };
  }, [setTheme]);

  useEffect(() => {
    applyTheme(theme);

    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      applyTheme("system");
    };

    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, [theme, applyTheme]);

  const value: ThemeContextType = useMemo(
    () => ({
      theme,
      setTheme,
      resolvedTheme,
    }),
    [theme, setTheme, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export interface ThemeMonitorOptions {
  /**
   * Re-read the resolved colours when `documentElement`'s class list changes.
   * Off by default for charts: the `MutationObserver` causes excessive re-renders.
   */
  monitorDOM?: boolean;
  /** Re-read the resolved colours when the system `prefers-color-scheme` changes. */
  monitorSystem?: boolean;
  /** Delay before reading `getComputedStyle`, so the new stylesheet has been applied. */
  updateDelay?: number;
}

export interface ThemeMonitorResult {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Whether the dark theme is currently applied. */
  isDark: boolean;
  /** Every `--token` from the stylesheet, resolved to a concrete value. */
  colors: ThemeColors;
  /** Force a re-read of the resolved colours. */
  refreshTheme: () => void;
}

/**
 * Theme hook that additionally resolves every theme CSS custom property to a concrete
 * value, so a canvas renderer (which cannot read CSS variables) can be handed colours.
 *
 * Values are seeded synchronously from the stylesheet and refreshed whenever the theme
 * changes; charts pass `monitorDOM: false, monitorSystem: true`.
 */
export function useThemeWithMonitoring(options: ThemeMonitorOptions = {}): ThemeMonitorResult {
  const { monitorDOM = true, monitorSystem = true, updateDelay = 50 } = options;

  const { theme, setTheme, resolvedTheme } = useThemeContext();
  const [isDark, setIsDark] = useState(() => isDarkMode());
  const [colors, setColors] = useState<ThemeColors>(() => getThemeColors());

  const updateThemeState = useCallback(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        setIsDark(isDarkMode());
        setColors(getThemeColors());
      }, updateDelay);
    });
  }, [updateDelay]);

  const refreshTheme = useCallback(() => {
    updateThemeState();
  }, [updateThemeState]);

  useEffect(() => {
    // `resolvedTheme` is the provider's own view of light/dark, so re-reading whenever it
    // changes replaces the framework's re-derivation of the theme inside this hook.
    updateThemeState();

    const cleanupFunctions: (() => void)[] = [];

    if (monitorDOM && typeof document !== "undefined") {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === "attributes" && mutation.attributeName === "class") {
            updateThemeState();
          }
        });
      });

      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });

      cleanupFunctions.push(() => observer.disconnect());
    }

    if (monitorSystem && typeof window !== "undefined") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

      const handleMediaChange = () => {
        if (theme === "system") {
          updateThemeState();
        }
      };

      mediaQuery.addEventListener("change", handleMediaChange);
      cleanupFunctions.push(() => mediaQuery.removeEventListener("change", handleMediaChange));
    }

    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup());
    };
  }, [theme, resolvedTheme, monitorDOM, monitorSystem, updateThemeState]);

  return { theme, setTheme, isDark, colors, refreshTheme };
}

export { useTheme } from "../contexts/theme-context.tsx";
export type { Theme, ThemeContextType } from "../contexts/theme-context.tsx";
