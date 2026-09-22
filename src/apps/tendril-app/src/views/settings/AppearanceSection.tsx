import React from "react";
import {
  applyThemePreset,
  setThemeGlobal,
  THEME_PRESETS,
  getThemePreset,
  type Theme,
} from "@ivy-interactive/components/theme";
import { Badge, Button, Callout } from "@ivy-interactive/components/ui";
import {
  MessageCircle,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  SunMoon,
  Terminal,
} from "lucide-react";
import { LOCALES, SITE_LOCALES } from "@ivy-interactive/components/i18n";
import { useTranslation } from "../../i18n";
import { chatLauncher } from "../../state/chatLauncher";
import {
  applyLanguagePreference,
  asLanguagePreference,
  chooseLanguagePreference,
  type LanguagePreference,
} from "../../state/language";
import { notificationsStore } from "../../state/notificationsStore";
import { describeBridgeError } from "../../types/api";
import type { AppearanceSettings, ChatMode } from "../../state/appearance";
import { NativeSelectField, SaveError, SettingsSection, SubSection } from "./fields";

/**
 * `Apps/Settings/AppearanceSetupView.cs`.
 *
 * Four blocks in V1, in this order: the light/dark/system button row, the theme preset select with its
 * preview swatches, the main sidebar default, and the chat mode. Every one of them applies and
 * persists **on the click** - V1 has no Save here, because a look-and-feel setting is judged by
 * looking at it - and each raises its own toast with V1's wording.
 *
 * V2 adds a fifth, the UI language, which V1 does not have (it pins `en-US`). It follows the same
 * rules: applied on the change, persisted to `config.yaml`'s `language`, rolled back if either fails.
 */

/**
 * V1's button row, with its icons (`Icons.Sun`, `Icons.Moon`, `Icons.SunMoon`). Each label is
 * `settings:appearance.themeMode.<value>`, looked up at render time.
 */
const THEME_MODES: { value: Theme; icon: React.ReactNode }[] = [
  { value: "light", icon: <Sun className="size-4" aria-hidden="true" /> },
  { value: "dark", icon: <Moon className="size-4" aria-hidden="true" /> },
  { value: "system", icon: <SunMoon className="size-4" aria-hidden="true" /> },
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
  /** `config.yaml`'s `language`, which is not one of the {@link AppearanceSettings}. */
  language: LanguagePreference;
  /** Writes one `config.yaml` key and re-reads the config, `SettingsView`'s `saveRawKey`. */
  onSaveRaw: (key: string, value: unknown) => Promise<void>;
}> = ({ settings, language: savedLanguage, onSaveRaw }) => {
  const { t } = useTranslation("settings");
  // Optimistic local state, the way V1 holds each control in `UseState` and writes config behind it:
  // the click has to change the button that was clicked before the daemon answers.
  const [themeMode, setThemeMode] = React.useState<Theme>(settings.themeMode);
  const [theme, setTheme] = React.useState<string>(settings.theme);
  const [sidebarOpen, setSidebarOpen] = React.useState<boolean>(settings.sidebarOpen);
  const [chatMode, setChatMode] = React.useState<ChatMode>(settings.chatMode);
  const [language, setLanguage] = React.useState<LanguagePreference>(savedLanguage);
  const [error, setError] = React.useState<string | null>(null);

  // A config reload (this pane's own write, or an edit to config.yaml) re-seeds the controls.
  React.useEffect(() => {
    setThemeMode(settings.themeMode);
    setTheme(settings.theme);
    setSidebarOpen(settings.sidebarOpen);
    setChatMode(settings.chatMode);
  }, [settings.themeMode, settings.theme, settings.sidebarOpen, settings.chatMode]);
  React.useEffect(() => setLanguage(savedLanguage), [savedLanguage]);

  const write = async (key: string, value: unknown, toast: string, revert: () => void) => {
    setError(null);
    try {
      await onSaveRaw(key, value);
      notificationsStore.notifySuccess(t("shared.toastSaved"), toast);
    } catch (err) {
      // The applied look is rolled back with the state: leaving the app in a theme config.yaml does
      // not hold would make the next restart look like the setting was lost.
      revert();
      setError(t("shared.saveFailed", { error: describeBridgeError(err) }));
    }
  };

  const chooseThemeMode = (mode: Theme) => {
    const previous = themeMode;
    setThemeMode(mode);
    setThemeGlobal(mode);
    void write("themeMode", mode, t("appearance.themeMode.saved", { context: mode }), () => {
      setThemeMode(previous);
      setThemeGlobal(previous);
    });
  };

  const chooseTheme = (id: string) => {
    const previous = theme;
    setTheme(id);
    const applied = applyThemePreset(id);
    void write("theme", applied.id, t("appearance.theme.saved", { name: applied.name }), () => {
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
      t("appearance.sidebar.saved", { context: open ? "expanded" : "collapsed" }),
      () => setSidebarOpen(previous),
    );
  };

  /**
   * `SetChatMode`, which is persist plus a toast and nothing else: V1 does not navigate or close tabs
   * here, so an open pane is left alone and the mode is read the next time Chat is opened.
   */
  const chooseChatMode = (mode: ChatMode) => {
    const previous = chatMode;
    setChatMode(mode);
    // Published to the launcher as well as this pane's own state, the same optimism the theme
    // buttons above apply: the write plus its filesystem event is a round trip, and a new chat
    // started in between would otherwise open in the mode the user just changed away from.
    chatLauncher.setMode(mode);
    void write("chatMode", mode, t("appearance.chatMode.saved", { context: mode }), () => {
      setChatMode(previous);
      chatLauncher.setMode(previous);
    });
  };

  /** "System default", or the language's own name for itself. */
  const languageLabel = (preference: LanguagePreference) =>
    preference === "system" ? t("appearance.language.system") : LOCALES[preference].label;

  /**
   * Switches the UI first and persists second, like the theme: the language is judged by looking at
   * it. The toast is worded after the switch, so it is already in the language just chosen. A
   * language whose catalogs will not load is never persisted; a failed write switches back.
   *
   * Choices can overlap - arrow keys on a focused native select fire `change` per option - and one
   * overtaken while its catalogs load is dropped by `chooseLanguagePreference` before it is saved:
   * never written, toasted or rolled back, since the later choice is. Rolling back returns to what
   * config.yaml holds rather than to the select's previous value, which may be a choice that was
   * overtaken before it ever applied.
   */
  const chooseLanguage = (value: string) => {
    const next = asLanguagePreference(value);
    const saved = savedLanguage;
    setLanguage(next);
    setError(null);
    const save = () =>
      write(
        "language",
        next,
        t("appearance.language.saved", { language: languageLabel(next) }),
        () => {
          setLanguage(saved);
          void applyLanguagePreference(saved);
        },
      );
    void chooseLanguagePreference(next, save).catch(() => {
      setLanguage(saved);
      setError(t("appearance.language.loadFailed", { language: languageLabel(next) }));
    });
  };

  const active = getThemePreset(theme);

  return (
    <SettingsSection
      title={t("appearance.title")}
      hint={t("appearance.hint")}
      testId="appearance-card"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {THEME_MODES.map((mode) => (
            <Button
              key={mode.value}
              type="button"
              variant={themeMode === mode.value ? "default" : "outline"}
              aria-pressed={themeMode === mode.value}
              onClick={() => chooseThemeMode(mode.value)}
            >
              {mode.icon}
              {t(`appearance.themeMode.${mode.value}`)}
            </Button>
          ))}
        </div>

        <SubSection
          title={t("appearance.theme.title")}
          hint={t("appearance.theme.hint")}
          testId="theme-preset-block"
        >
          <div className="max-w-120 space-y-2">
            <NativeSelectField
              id="theme-preset-select"
              label={t("appearance.theme.label")}
              value={theme}
              options={THEME_PRESETS.map((preset) => ({
                value: preset.id,
                // V1 suffixes a vault theme with `(Vault: <name>)`; the shape is kept so a vault
                // theme reads the same the moment vault themes exist in this build.
                label: preset.isVaultTheme
                  ? t("appearance.theme.vaultOption", {
                      name: preset.name,
                      vault: preset.vaultName || t("appearance.theme.vaultFallback"),
                    })
                  : preset.name,
              }))}
              onChange={chooseTheme}
            />
            <div className="flex items-center gap-2">
              <Swatches colors={active.previewColors} />
              {active.isVaultTheme && (
                <Badge variant="secondary" className="text-xs">
                  {t("appearance.theme.vaultBadge")}
                </Badge>
              )}
            </div>
          </div>
        </SubSection>

        <SubSection
          title={t("appearance.sidebar.title")}
          hint={t("appearance.sidebar.hint")}
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
              {t("appearance.sidebar.expanded")}
            </Button>
            <Button
              type="button"
              variant={!sidebarOpen ? "default" : "outline"}
              aria-pressed={!sidebarOpen}
              onClick={() => chooseSidebar(false)}
            >
              <PanelLeftClose className="size-4" aria-hidden="true" />
              {t("appearance.sidebar.collapsed")}
            </Button>
          </div>
        </SubSection>

        <SubSection
          title={t("appearance.chatMode.title")}
          hint={t("appearance.chatMode.hint")}
          testId="chat-mode-block"
        >
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={chatMode === "chat" ? "default" : "outline"}
              aria-pressed={chatMode === "chat"}
              onClick={() => chooseChatMode("chat")}
              data-testid="chat-mode-chat"
            >
              <MessageCircle className="size-4" aria-hidden="true" />
              {t("appearance.chatMode.chat")}
            </Button>
            <Button
              type="button"
              variant={chatMode === "terminal" ? "default" : "outline"}
              aria-pressed={chatMode === "terminal"}
              onClick={() => chooseChatMode("terminal")}
              data-testid="chat-mode-terminal"
            >
              <Terminal className="size-4" aria-hidden="true" />
              {t("appearance.chatMode.terminal")}
            </Button>
          </div>
        </SubSection>

        <SubSection
          title={t("appearance.language.title")}
          hint={t("appearance.language.hint")}
          testId="language-block"
        >
          <div className="max-w-120">
            <NativeSelectField
              id="language-select"
              label={t("appearance.language.label")}
              value={language}
              options={[
                { value: "system", label: languageLabel("system") },
                // Each language by its own name, and marked as such, so a reader who cannot read the
                // current UI can still find theirs.
                ...SITE_LOCALES.map((locale) => ({
                  value: locale.code,
                  label: locale.label,
                  lang: locale.hreflang,
                })),
              ]}
              onChange={chooseLanguage}
            />
          </div>
        </SubSection>

        <SaveError message={error} />

        {/* Stated rather than offered, for the reason `SecurityTunnelingSection` states its own gaps:
            a control that cannot do anything is worse than a sentence saying so. */}
        <Callout.Info data-testid="appearance-not-wired">
          <div className="space-y-1 text-xs">
            <p>{t("appearance.vaultThemesNote")}</p>
          </div>
        </Callout.Info>
      </div>
    </SettingsSection>
  );
};
