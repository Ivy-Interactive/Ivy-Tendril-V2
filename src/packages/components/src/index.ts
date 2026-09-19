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
/**
 * Already used inside the package by `Badge` and `TuiBadge`; exported because hosts carry Ivy `Colors`
 * names of their own (a project's configured colour) and must resolve them the same single way.
 */
export { ivyColorVar } from "./lib/ivy-color";
export { prismTheme } from "./lib/prismTheme";
export { copyToClipboard } from "./lib/clipboard";
export { getPlatformShortcut, formatShortcut } from "./lib/shortcut";
// Not `export *` — shortcutRegistry's `_`-prefixed test seams must stay off the public surface.
export {
  registerShortcut,
  unregisterShortcut,
  getRegisteredShortcuts,
  serializeShortcut,
  type ShortcutInfo,
  type ShortcutRegistration,
} from "./lib/shortcutRegistry";
export { useShortcut } from "./lib/useShortcut";
export { debugLog, isDebugLoggingEnabled } from "./lib/debug-log";
export {
  isImageFile,
  isCompressibleImage,
  processImageFile,
  MAX_IMAGE_DIMENSION,
  COMPRESSION_QUALITY,
  MAX_UNCOMPRESSED_SIZE,
  type ImageProcessOptions,
} from "./lib/imageUtils";

// Types
export * from "./types/density";
export { widgetCallSiteRegistry, type CallSite } from "./types/widgets";

// Hooks
export * from "./hooks/use-mobile";
export * from "./hooks/use-toast";
export { useErrorSheet, showError, type ErrorItem } from "./hooks/use-error-sheet";
export {
  useResizableSidebar,
  type UseResizableSidebarOptions,
  type UseResizableSidebarReturn,
} from "./hooks/use-resizable-sidebar";
export {
  useFocusManagement,
  useFocusable,
  type FocusManager,
  type FocusDirection,
} from "./hooks/use-focus-management";
export { useDebounce } from "./hooks/use-debounce";
export { useScrollShadow, type ScrollShadowDirection } from "./hooks/use-scroll-shadow";

// Theme
export {
  ThemeContext,
  useTheme,
  type Theme,
  type ThemeContextType,
} from "./contexts/theme-context.tsx";
export {
  ThemeProvider,
  setThemeGlobal,
  type ThemeProviderProps,
} from "./components/theme-provider.tsx";
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
export * from "./components/ui/data-table";
export * from "./components/ui/dialog";
export * from "./components/ui/tabs";
export * from "./components/ui/virtual-list";

// Primary Renderers
export {
  MarkdownRenderer,
  normalizeNestedFences,
  type MarkdownRendererProps,
} from "./components/MarkdownRenderer";

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
export { TendrilQuestions, type TendrilQuestionsProps } from "./components/TendrilQuestions";
export { PlanWorkspace } from "./components/PlanWorkspace/index.ts";

export function fn() {
  return "Hello, tsdown!";
}
