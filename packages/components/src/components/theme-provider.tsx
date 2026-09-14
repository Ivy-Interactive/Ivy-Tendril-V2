import { useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { ThemeContext, type Theme, type ThemeContextType } from "../contexts/theme-context.tsx";

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

export { useTheme } from "../contexts/theme-context.tsx";
export type { Theme, ThemeContextType } from "../contexts/theme-context.tsx";
