import { applyThemePreset, setThemeGlobal, type Theme } from "@ivy-interactive/components/theme";
import { bridge } from "../api/bridge";
import type { TendrilConfig } from "../types/api";

/**
 * The appearance settings `config.yaml` owns, and applying them.
 *
 * V1's `AppearanceSetupView` writes three keys - `themeMode`, `theme` and `sidebarOpen` - and V1's
 * shell reads all three back **per client session**: `TendrilAppShell` seeds the sidebar from
 * `SidebarOpen`, and `TendrilThemes.ApplyTheme` / `ApplyThemeMode` install the preset and the
 * light/dark mode. That is why this module exists at all: without a start-up read, the settings pane
 * would only be applying them to the session that changed them, and a restart would show whatever
 * `localStorage` last held instead of what is on disk.
 *
 * `sidebarOpen` is deliberately not applied here - `uiStore.init` owns it, because the collapsed flag
 * is its state and the value is a *default for a new session* rather than live state.
 */
export interface AppearanceSettings {
  /** `light` / `dark` / `system`, V1's `ThemeMode`. */
  themeMode: Theme;
  /** A `theme-presets.ts` preset id, V1's `Theme`. */
  theme: string;
  /** Whether the main sidebar starts expanded, V1's `SidebarOpen`. */
  sidebarOpen: boolean;
  /** What the Chat button opens, V1's `ChatMode`: the chat view, or the agent's own terminal. */
  chatMode: ChatMode;
}

/** V1's `ChatModes`, whose members are these two strings. */
export type ChatMode = "chat" | "terminal";

export const APPEARANCE_DEFAULTS: AppearanceSettings = {
  themeMode: "system",
  theme: "default",
  sidebarOpen: true,
  chatMode: "chat",
};

/**
 * `ChatModes.Normalize`: only the exact `terminal` opt-in counts, so an unrecognised value — including
 * one hand-edited into `config.yaml` — resolves to the chat view rather than to a pane the user may
 * not know how to leave. `chat_mode_is_terminal` in `crates/tendril-core/src/config.rs` is the same
 * rule on the daemon's side of the wire.
 */
export const asChatMode = (value: unknown): ChatMode =>
  typeof value === "string" && value.trim().toLowerCase() === "terminal" ? "terminal" : "chat";

/** `ConfigService.ValidateSettings`: anything but `light`/`dark` falls back to `system`. */
export const asThemeMode = (value: unknown): Theme =>
  value === "light" || value === "dark" ? value : "system";

/**
 * Reads the three keys off a config. They live on `raw` rather than on `TendrilConfigDto`, so an
 * absent key reads as the daemon's own default (`themeMode: system`, `theme: default`,
 * `sidebarOpen: true`) rather than as unset.
 */
export function readAppearance(config: TendrilConfig | null): AppearanceSettings {
  const raw = config?.raw ?? {};
  const theme = raw.theme;
  const sidebarOpen = raw.sidebarOpen;
  return {
    themeMode: asThemeMode(raw.themeMode),
    theme: typeof theme === "string" && theme.trim() !== "" ? theme : APPEARANCE_DEFAULTS.theme,
    sidebarOpen: typeof sidebarOpen === "boolean" ? sidebarOpen : APPEARANCE_DEFAULTS.sidebarOpen,
    chatMode: asChatMode(raw.chatMode),
  };
}

/**
 * Installs a preset and a mode, the pair `AppearanceSetupView` applies on every click and
 * `TendrilAppShell` applies on every session start.
 */
export function applyAppearance(settings: Pick<AppearanceSettings, "themeMode" | "theme">): void {
  applyThemePreset(settings.theme);
  setThemeGlobal(settings.themeMode);
}

/**
 * Applies what is on disk, once, at start-up. Awaiting the config read is also what orders this after
 * `ThemeProvider`'s own mount effect, which is what publishes the setter `setThemeGlobal` needs.
 *
 * A failure is swallowed: an unreachable daemon must leave the app on `ThemeProvider`'s default
 * rather than blocking the first render behind a config request.
 */
export async function initAppearance(): Promise<AppearanceSettings> {
  try {
    const settings = readAppearance(await bridge.getConfig());
    applyAppearance(settings);
    return settings;
  } catch {
    // Keep the provider's default.
    return APPEARANCE_DEFAULTS;
  }
}
