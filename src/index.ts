export { cn } from "./lib/utils.ts";
export {
  ThemeContext,
  useTheme,
  type Theme,
  type ThemeContextType,
} from "./contexts/theme-context.tsx";
export { ThemeProvider, type ThemeProviderProps } from "./components/theme-provider.tsx";

export function fn() {
  return "Hello, tsdown!";
}
