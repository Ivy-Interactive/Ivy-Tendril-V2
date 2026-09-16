import React from "react";
import {
  applyThemePreset,
  setThemeGlobal,
  THEME_PRESETS,
  getThemePreset,
  type Theme,
} from "@ivy-interactive/components/theme";
import { Badge, Button, Callout } from "@ivy-interactive/components/ui";
import { Moon, PanelLeftClose, PanelLeftOpen, Sun, SunMoon } from "lucide-react";
import { notificationsStore } from "../../state/notificationsStore";
import { describeBridgeError } from "../../types/api";
import type { AppearanceSettings } from "../../state/appearance";
import { NativeSelectField, SaveError, SectionCard, SubSection } from "./fields";

/**
 * `Apps/Settings/AppearanceSetupView.cs`.
 *
 * Four blocks in V1, in this order: the light/dark/system button row, the theme preset select with its
 * preview swatches, the main sidebar default, and the chat mode. Every one of them applies and
 * persists **on the click** - V1 has no Save here, because a look-and-feel setting is judged by
 * looking at it - and each raises its own toast with V1's wording.
 *
 * The chat block is the one thing not ported: see the note at the foot of the pane.
 */

/** V1's button row, with its icons (`Icons.Sun`, `Icons.Moon`, `Icons.SunMoon`) and its labels. */
const THEME_MODES: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun className="size-4" aria-hidden="true" /> },
  { value: "dark", label: "Dark", icon: <Moon className="size-4" aria-hidden="true" /> },
  { value: "system", label: "System", icon: <SunMoon className="size-4" aria-hidden="true" /> },
];

/**
 * `AppearanceSetupView`'s swatch row: one 20px circle per `PreviewColors` entry, with the same faint
 * stroke so a swatch the colour of the card is still visible.
 */
const Swatches: React.FC<{ colors: string[] }> = ({ colors }) => (
  <div className="flex items-center gap-2" data-testid="theme-swatches">
    {colors.map((color, index) => (
      <span
        key={`${color}-${index}`}
        // A theme's colours are data, not tokens: they are the values `theme-presets.ts` will apply,
        // so they can only be shown as literals.
        style={{ backgroundColor: color, borderColor: "rgba(128,128,128,0.3)" }}
        className="size-5 rounded-full border"
        data-color={color}
        aria-hidden="true"
      />
    ))}
  </div>
);

export const AppearanceSection: React.FC<{
  settings: AppearanceSettings;
  /** Writes one `config.yaml` key and re-reads the config, `SettingsView`'s `saveRawKey`. */
  onSaveRaw: (key: string, value: unknown) => Promise<void>;
}> = ({ settings, onSaveRaw }) => {
  // Optimistic local state, the way V1 holds each control in `UseState` and writes config behind it:
  // the click has to change the button that was clicked before the daemon answers.
  const [themeMode, setThemeMode] = React.useState<Theme>(settings.themeMode);
  const [theme, setTheme] = React.useState<string>(settings.theme);
  const [sidebarOpen, setSidebarOpen] = React.useState<boolean>(settings.sidebarOpen);
  const [error, setError] = React.useState<string | null>(null);

  // A config reload (this pane's own write, or an edit to config.yaml) re-seeds the controls.
  React.useEffect(() => {
    setThemeMode(settings.themeMode);
    setTheme(settings.theme);
    setSidebarOpen(settings.sidebarOpen);
  }, [settings.themeMode, settings.theme, settings.sidebarOpen]);

  const write = async (key: string, value: unknown, toast: string, revert: () => void) => {
    setError(null);
    try {
      await onSaveRaw(key, value);
      notificationsStore.notifySuccess("Saved", toast);
    } catch (err) {
      // The applied look is rolled back with the state: leaving the app in a theme config.yaml does
      // not hold would make the next restart look like the setting was lost.
      revert();
      setError(`Failed to save: ${describeBridgeError(err)}`);
    }
  };

  const chooseThemeMode = (mode: Theme, label: string) => {
    const previous = themeMode;
    setThemeMode(mode);
    setThemeGlobal(mode);
    void write("themeMode", mode, `Appearance set to ${label}`, () => {
      setThemeMode(previous);
      setThemeGlobal(previous);
    });
  };

  const chooseTheme = (id: string) => {
    const previous = theme;
    setTheme(id);
    const applied = applyThemePreset(id);
    void write("theme", applied.id, `Theme set to ${applied.name}`, () => {
      setTheme(previous);
      applyThemePreset(previous);
    });
  };

  const chooseSidebar = (open: boolean) => {
    const previous = sidebarOpen;
    setSidebarOpen(open);
    void write(
      "sidebarOpen",
      open,
      `Sidebar set to ${open ? "expanded" : "collapsed"} by default`,
      () => setSidebarOpen(previous),
    );
  };

  const active = getThemePreset(theme);

  return (
    <SectionCard
      title="Appearance"
      hint="Choose how Tendril appears. System matches your OS setting."
      testId="appearance-card"
    >
      <div className="max-w-170 space-y-4">
        <div className="flex flex-wrap gap-2">
          {THEME_MODES.map((mode) => (
            <Button
              key={mode.value}
              type="button"
              variant={themeMode === mode.value ? "default" : "outline"}
              aria-pressed={themeMode === mode.value}
              onClick={() => chooseThemeMode(mode.value, mode.label)}
            >
              {mode.icon}
              {mode.label}
            </Button>
          ))}
        </div>

        <SubSection
          title="Theme"
          hint="Choose a color scheme preset for Tendril."
          testId="theme-preset-block"
        >
          <div className="max-w-120 space-y-2">
            <NativeSelectField
              id="theme-preset-select"
              label="Theme"
              value={theme}
              options={THEME_PRESETS.map((preset) => ({
                value: preset.id,
                // V1 suffixes a vault theme with `(Vault: <name>)`; the shape is kept so a vault
                // theme reads the same the moment vault themes exist in this build.
                label: preset.isVaultTheme
                  ? `${preset.name} (Vault: ${preset.vaultName || "Team"})`
                  : preset.name,
              }))}
              onChange={chooseTheme}
            />
            <div className="flex items-center gap-2">
              <Swatches colors={active.previewColors} />
              {active.isVaultTheme && (
                <Badge variant="secondary" className="text-xs">
                  Team Vault
                </Badge>
              )}
            </div>
          </div>
        </SubSection>

        <SubSection
          title="Main Sidebar"
          hint="Choose the default state for the main sidebar for new client sessions."
          testId="sidebar-default-block"
        >
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={sidebarOpen ? "default" : "outline"}
              aria-pressed={sidebarOpen}
              onClick={() => chooseSidebar(true)}
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
              Expanded
            </Button>
            <Button
              type="button"
              variant={!sidebarOpen ? "default" : "outline"}
              aria-pressed={!sidebarOpen}
              onClick={() => chooseSidebar(false)}
            >
              <PanelLeftClose className="size-4" aria-hidden="true" />
              Collapsed
            </Button>
          </div>
        </SubSection>

        <SaveError message={error} />

        {/* Stated rather than offered, for the reason `SecurityTunnelingSection` states its own gaps:
            a control that cannot do anything is worse than a sentence saying so. */}
        <Callout.Info data-testid="appearance-not-wired">
          <div className="space-y-1 text-xs">
            <p>
              V1&apos;s Chat setting (whether the Chat button opens the chat view or the
              agent&apos;s own terminal) has no counterpart here: this build has no terminal chat
              session, so both choices would open the same view.
            </p>
            <p>
              Themes published by a Team Vault are not listed either - the vault theme subsystem is
              not part of this build, so only the shipped presets are offered.
            </p>
          </div>
        </Callout.Info>
      </div>
    </SectionCard>
  );
};
