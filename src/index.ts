// Root Entrypoint for components-storybook
// Exports commonly needed components, theme provider, and utilities

// Styles
import "./styles/globals.css";

// Utilities & Helpers
export * from "./lib/utils";
export * from "./lib/formatters";
export * from "./lib/logger";
export { getMarkdownPlugins, hasMath } from "./lib/math";
export { rawHtmlSchema, hasRawHtml } from "./lib/rawHtml";
export { getWidth, getHeight } from "./lib/styles";
export { prismTheme } from "./lib/prismTheme";
export { copyToClipboard } from "./lib/clipboard";
export { getPlatformShortcut, formatShortcut } from "./lib/shortcut";

// Types
export * from "./types/density";
export { widgetCallSiteRegistry, type CallSite } from "./types/widgets";

// Hooks
export * from "./hooks/use-mobile";
export * from "./hooks/use-toast";
export { useErrorSheet, showError, type ErrorItem } from "./hooks/use-error-sheet";

// Theme
export {
  ThemeContext,
  useTheme,
  type Theme,
  type ThemeContextType,
} from "./contexts/theme-context.tsx";
export { ThemeProvider, type ThemeProviderProps } from "./components/theme-provider.tsx";
export { TypographyContext, useTypography } from "./contexts/TypographyContext";

// Density
export {
  DensityContext,
  DensityProvider,
  useDensity,
  DensityScale,
  useDensityScale,
  type DensityContextValue,
  type DensityProviderProps,
  type DensityScaleProps,
  type DensityScaleValue,
} from "./contexts/density-context.tsx";

// Density Scales
export * from "./components/ui/density-scale";

// Commonly Used UI Primitives
export * from "./components/ui/button";
export * from "./components/ui/input.tsx";
export * from "./components/ui/card";
export * from "./components/ui/badge";
export * from "./components/ui/dialog";
export * from "./components/ui/tabs";

// Primary Renderers
export {
  MarkdownRenderer,
  normalizeNestedFences,
  type MarkdownRendererProps,
} from "./components/MarkdownRenderer";
export { MermaidRenderer, type MermaidRendererProps } from "./components/MermaidRenderer";
export { GraphvizRenderer, type GraphvizRendererProps } from "./components/GraphvizRenderer";

// Error Handling
export {
  ErrorBoundary,
  type ErrorBoundaryProps,
  type ErrorBoundaryState,
} from "./components/ErrorBoundary";
export { ErrorDisplay, type ErrorDisplayProps } from "./components/ErrorDisplay";
export { ErrorSheet } from "./components/ErrorSheet";
export { DevTools, type WidgetInfo } from "./components/DevTools";

// Primary Tendril Widgets
export { TendrilShell } from "./components/Shell/index.ts";
export { AgentViewer } from "./components/AgentViewer/index.ts";
export { PlanMarkdown } from "./components/PlanMarkdown";
export { TendrilDashboard } from "./components/TendrilDashboard/index.ts";

export function fn() {
  return "Hello, tsdown!";
}
