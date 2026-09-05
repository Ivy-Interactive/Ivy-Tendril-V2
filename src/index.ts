// Root Entrypoint for components-storybook
// Exports commonly needed components, theme provider, and utilities

// Styles
import "./styles/globals.css";

// Utilities & Helpers
export * from "./lib/utils";
export * from "./lib/formatters";
export * from "./lib/logger";

// Types
export * from "./types/density";

// Hooks
export * from "./hooks/use-mobile";
export * from "./hooks/use-toast";

// Theme
export {
  ThemeContext,
  useTheme,
  type Theme,
  type ThemeContextType,
} from "./contexts/theme-context.tsx";
export { ThemeProvider, type ThemeProviderProps } from "./components/theme-provider.tsx";

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

// Primary Tendril Widgets
export { TendrilShell } from "./components/Shell/index.ts";
export { AgentViewer } from "./components/AgentViewer/index.ts";
export { PlanMarkdown } from "./components/PlanMarkdown";
export { TendrilDashboard } from "./components/TendrilDashboard/index.ts";
