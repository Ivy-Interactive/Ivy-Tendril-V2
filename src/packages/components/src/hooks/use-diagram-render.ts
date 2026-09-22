import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { logger } from "@/lib/logger";
import { i18n } from "@/i18n/uiCommon";

interface UseDiagramRenderResult {
  elementRef: RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Shared render lifecycle for diagram renderers (Mermaid, Graphviz): tracks the current
 * light/dark theme via a debounced MutationObserver, re-renders on content or theme change,
 * and writes the rendered SVG into `elementRef`.
 */
export function useDiagramRender(
  content: string,
  render: (content: string) => Promise<string>,
): UseDiagramRenderResult {
  const elementRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ isLoading: boolean; error: string | null }>({
    isLoading: true,
    error: null,
  });
  const [currentTheme, setCurrentTheme] = useState<"light" | "dark">("light");
  const themeRef = useRef<"light" | "dark">("light");
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const detectTheme = useCallback(() => {
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  }, []);

  const debouncedRender = useCallback((theme: "light" | "dark") => {
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    renderTimeoutRef.current = setTimeout(() => {
      if (theme !== themeRef.current) {
        setCurrentTheme(theme);
        themeRef.current = theme;
      }
    }, 100); // Small delay to avoid excessive re-renders
  }, []);

  useEffect(() => {
    const initialTheme = detectTheme();
    setCurrentTheme(initialTheme);
    themeRef.current = initialTheme;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          const newTheme = detectTheme();
          if (newTheme !== themeRef.current) {
            debouncedRender(newTheme);
          }
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Track cleanup to prevent double cleanup during rapid theme changes
    let cleanedUp = false;
    const currentTimeout = renderTimeoutRef.current;

    return () => {
      if (cleanedUp) return;
      cleanedUp = true;

      observer.disconnect();
      if (currentTimeout) {
        clearTimeout(currentTimeout);
      }
      if (renderTimeoutRef.current === currentTimeout) {
        renderTimeoutRef.current = null;
      }
    };
  }, [detectTheme, debouncedRender]);

  const renderDiagram = useCallback(
    async (mountedObj: { current: boolean }) => {
      if (!elementRef.current) return;

      try {
        setState({ isLoading: true, error: null });
        elementRef.current.innerHTML = "";

        const svg = await render(content);

        if (mountedObj.current && elementRef.current) {
          elementRef.current.innerHTML = svg;
          setState((prev) => ({ ...prev, isLoading: false }));
        }
      } catch (err) {
        logger.error("Diagram rendering error:", err);
        if (mountedObj.current) {
          setState({
            isLoading: false,
            error: err instanceof Error ? err.message : i18n.t("uiCommon:diagram.renderFailed"),
          });
        }
      }
    },
    [content, render],
  );

  useEffect(() => {
    const mountedObj = { current: true };
    void renderDiagram(mountedObj);

    return () => {
      mountedObj.current = false;
    };
  }, [renderDiagram, currentTheme]); // Re-render when content or theme changes

  return { elementRef, isLoading: state.isLoading, error: state.error };
}
