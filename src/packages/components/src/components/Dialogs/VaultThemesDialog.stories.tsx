import type { Meta, StoryObj } from "@storybook/react";
import { THEME_PRESETS } from "../../lib/theme-presets";
import {
  VaultThemeExportDialog,
  VaultThemeImportDialog,
  VaultThemesDialog,
} from "./VaultThemesDialog";
import { completeColors, themeFromPreset, type VaultTheme } from "./vaultThemes";

const TEAM_BRAND: VaultTheme = {
  id: "team-brand",
  name: "Team Brand",
  description: "Acme's green, with a warmer card surface.",
  isDark: false,
  previewColors: ["#0f766e", "#ccfbf1", "#f59e0b", "#fffbeb"],
  colors: completeColors({
    light: {
      primary: "#0f766e",
      "primary-foreground": "#ffffff",
      secondary: "#ccfbf1",
      accent: "#f59e0b",
      background: "#fffbeb",
      card: "#fef3c7",
    },
  }),
  radius: "large",
};

const MIDNIGHT: VaultTheme = {
  id: "acme-midnight",
  name: "Acme Midnight",
  description: "",
  isDark: true,
  previewColors: ["#818cf8", "#1e1b4b", "#f472b6", "#0b0a1a"],
  colors: completeColors({
    dark: {
      primary: "#818cf8",
      "primary-foreground": "#0b0a1a",
      secondary: "#1e1b4b",
      accent: "#f472b6",
      background: "#0b0a1a",
      foreground: "#e0e7ff",
    },
  }),
  fontFamily: "Inter, system-ui, sans-serif",
};

/**
 * V1's `Apps/Settings/Dialogs/VaultThemesDialog.cs`: the theme generator, and the themes a Team
 * Vault publishes. Only the generator shows until the vault has a theme; after that it is one of two
 * tabs. The preview is scoped to its own box, so changing a swatch here does not repaint the page.
 */
const meta: Meta<typeof VaultThemesDialog> = {
  title: "Dialogs/VaultThemesDialog",
  component: VaultThemesDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    onClose: () => {},
    onSave: () => {},
    onApply: () => {},
    onDelete: () => {},
    themes: [TEAM_BRAND, MIDNIGHT],
    activeThemeId: "team-brand",
  },
};

export default meta;
type Story = StoryObj<typeof VaultThemesDialog>;

/** A vault with no themes yet: the generator alone, titled *Create Custom Theme*. */
export const EmptyVault: Story = {
  args: { themes: [] },
};

/** The generator tab, with the vault's two themes one tab over. */
export const Generator: Story = {};

/** The vault's themes: the active one says so, the rest offer Apply. */
export const VaultThemes: Story = {
  args: { initialTab: "themes" },
};

/** Loading the vault's themes. */
export const LoadingThemes: Story = {
  args: { themes: [], isLoadingThemes: true },
};

/** *Edit* on a dark theme: the generator opens on it, on its dark half. */
export const EditingTheme: Story = {
  args: { editTheme: MIDNIGHT },
};

/** The commit and push are running. */
export const Saving: Story = {
  args: { isSaving: true },
};

/** A delete in flight on one row. */
export const Deleting: Story = {
  args: { initialTab: "themes", deletingId: "acme-midnight" },
};

/** No vault is connected (or the host cannot publish yet), so upload is refused with the reason. */
export const UploadUnavailable: Story = {
  args: {
    themes: [],
    saveDisabledReason:
      "Connect a Team Vault in Settings > Team Vault to publish themes. You can still copy the configuration.",
  },
};

/** The push was refused. */
export const SaveFailed: Story = {
  args: {
    error:
      "Failed to push themes/team-brand.json: remote rejected (protected branch hook declined).",
  },
};

/** The export sub-dialog on its own. */
export const ExportConfiguration: StoryObj<typeof VaultThemeExportDialog> = {
  render: () => (
    <VaultThemeExportDialog
      isOpen
      onClose={() => {}}
      theme={themeFromPreset(THEME_PRESETS.find((p) => p.id === "cupcake") ?? THEME_PRESETS[0])}
    />
  ),
};

/** The import sub-dialog on its own. Paste something that is not JSON to see the refusal. */
export const ImportConfiguration: StoryObj<typeof VaultThemeImportDialog> = {
  render: () => <VaultThemeImportDialog isOpen onClose={() => {}} onImport={() => {}} />,
};
