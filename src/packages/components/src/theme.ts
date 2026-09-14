/**
 * Theme entry point.
 *
 * Kept deliberately tiny so an application entry module can install the provider without
 * pulling the component barrels — and therefore the whole library — into its entry chunk.
 */

export {
  ThemeProvider,
  setThemeGlobal,
  type ThemeProviderProps,
} from "./components/theme-provider";
export { useTheme, type Theme, type ThemeContextType } from "./contexts/theme-context";
