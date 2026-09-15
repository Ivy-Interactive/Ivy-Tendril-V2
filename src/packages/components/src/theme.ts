/**
 * Theme entry point.
 *
 * Kept deliberately tiny so an application entry module can install the provider without
 * pulling the component barrels — and therefore the whole library — into its entry chunk.
 */

export {
  ThemeProvider,
  setThemeGlobal,
  useThemeWithMonitoring,
  type ThemeProviderProps,
  type ThemeMonitorOptions,
  type ThemeMonitorResult,
} from "./components/theme-provider";
export { useTheme, type Theme, type ThemeContextType } from "./contexts/theme-context";
export {
  getCSSVariable,
  getSystemThemePreference,
  getThemeColors,
  isDarkMode,
  type ThemeColors,
} from "./lib/theme";
