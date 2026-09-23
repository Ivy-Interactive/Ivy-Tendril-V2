import * as React from "react";
import {
  Activity,
  Check,
  ChevronDown,
  Copy,
  FileDown,
  Moon,
  Palette,
  Pencil,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslation } from "@/i18n/uiSettings";
import { THEME_PRESETS } from "../../lib/theme-presets";
import { CopyToClipboardButton } from "../CopyToClipboardButton";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { IconButton } from "../ui/IconButton";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { NativeSelect } from "../ui/native-select";
import { Separator } from "../ui/separator";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { ConfirmDialog } from "./ConfirmDialog";
import { DialogShell } from "./DialogShell";
import {
  VAULT_THEME_COLOR_GROUPS,
  VAULT_THEME_RADII,
  completeColors,
  exportThemeCss,
  exportThemeJson,
  parseThemeJson,
  previewColorsFor,
  previewStyle,
  themeFromPreset,
  type VaultTheme,
  type VaultThemeDraft,
  type VaultThemeRadius,
} from "./vaultThemes";

export type VaultThemesTab = "generator" | "themes";
type Mode = "light" | "dark";

export interface VaultThemesDialogProps {
  open: boolean;
  /** V1's `HandleClose`: the host restores whatever theme was applied before the dialog opened. */
  onClose: () => void;
  /** The themes the vault publishes (`themes/*.json`). */
  themes: VaultTheme[];
  isLoadingThemes?: boolean;
  /** `config.yaml`'s `theme`, so the matching row shows *Active* instead of *Apply*. */
  activeThemeId?: string | null;
  /** Generator starting points. Defaults to the shipped presets (`lib/theme-presets.ts`). */
  presets?: VaultTheme[];
  /** Which tab to open on — V1's `requestedTab`. Ignored while the vault has no themes. */
  initialTab?: VaultThemesTab;
  /** Opens the generator on this theme — V1's `themeToEdit`. */
  editTheme?: VaultTheme | null;
  /** *Upload to Team Vault*. The host commits it to the vault and applies it. */
  onSave: (draft: VaultThemeDraft) => void;
  isSaving?: boolean;
  /** Why upload is unavailable (no vault connected, …). Set, the button stays visible but disabled. */
  saveDisabledReason?: string | null;
  onApply: (themeId: string) => void;
  onDelete: (themeId: string) => void;
  /** The theme whose delete is in flight. */
  deletingId?: string | null;
  /** A failed save, apply or delete, shown in the dialog. */
  error?: string | null;
}

const DEFAULT_PRESETS: VaultTheme[] = THEME_PRESETS.map(themeFromPreset);

interface GeneratorState {
  editingId: string | null;
  name: string;
  description: string;
  presetId: string;
  mode: Mode;
  colors: { light: Record<string, string>; dark: Record<string, string> };
  fontFamily: string;
  fontSize: string;
  radius: VaultThemeRadius;
}

function initialGenerator(
  presets: VaultTheme[],
  name: string,
  description: string,
): GeneratorState {
  const first = presets[0];
  return {
    editingId: null,
    name,
    description,
    presetId: first?.id ?? "",
    mode: "light",
    colors: completeColors(first?.colors ?? {}),
    fontFamily: "",
    fontSize: "",
    radius: "medium",
  };
}

function generatorFromTheme(theme: VaultTheme): GeneratorState {
  return {
    editingId: theme.id,
    name: theme.name,
    description: theme.description,
    presetId: "",
    mode: theme.isDark ? "dark" : "light",
    colors: completeColors(theme.colors),
    fontFamily: theme.fontFamily ?? "",
    fontSize: theme.fontSize ?? "",
    radius: theme.radius ?? "medium",
  };
}

function draftOf(state: GeneratorState): VaultThemeDraft {
  return {
    ...(state.editingId ? { id: state.editingId } : {}),
    name: state.name.trim(),
    description: state.description.trim(),
    isDark: state.mode === "dark",
    previewColors: previewColorsFor(state.colors[state.mode]),
    colors: state.colors,
    fontFamily: state.fontFamily.trim() || null,
    fontSize: state.fontSize.trim() || null,
    radius: state.radius,
  };
}

/** A `#rgb`/`#rrggbb` value an `<input type="color">` can show; anything else shows black. */
function colorInputValue(value: string | undefined): string {
  if (!value) return "#000000";
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return `#${v
      .slice(1)
      .split("")
      .map((c) => c + c)
      .join("")}`.toLowerCase();
  }
  if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(0, 7).toLowerCase();
  return "#000000";
}

function Swatches({ colors, size = "size-4" }: { colors: string[]; size?: string }) {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {colors.map((color, index) => (
        <span
          key={`${color}-${index}`}
          className={`${size} rounded-full border border-border`}
          // A theme's colours are data, not tokens: they are the values the theme will apply.
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

function Section({
  title,
  accessory,
  defaultOpen = true,
  children,
  testId,
}: {
  title: string;
  accessory?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="rounded-box border border-border"
      data-testid={testId}
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-foreground">
        {title}
        <span className="ml-auto flex items-center gap-2">
          {accessory}
          <ChevronDown
            className="size-4 shrink-0 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * V1's "Mock Components Preview": the library's own controls under the theme being edited.
 *
 * Scoped rather than global — the colours are set as custom properties on this box only, so the
 * rest of the app (and the dialog around it) stays in the operator's theme while they experiment,
 * and closing the dialog has nothing to undo. V1 pushed every keystroke into the whole client with
 * `client.ApplyTheme(css)` and had to restore it in `HandleClose`.
 */
function ThemePreview({ state }: { state: GeneratorState }) {
  const { t } = useTranslation("uiSettings");
  const [text, setText] = React.useState("Ivy Tendril");
  const [on, setOn] = React.useState(true);
  return (
    <div
      className="space-y-3 rounded-box border border-border bg-background p-3 text-foreground"
      style={previewStyle(state.colors[state.mode], state.radius, state.fontFamily, state.fontSize)}
      data-testid="vault-theme-preview"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{t("vaultThemes.preview.heading")}</p>
          <p className="text-xs text-muted-foreground">{t("vaultThemes.preview.hint")}</p>
        </div>
        <Badge variant="secondary">
          {state.mode === "dark"
            ? t("vaultThemes.mode.darkBadge")
            : t("vaultThemes.mode.lightBadge")}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="button">
          <Sparkles className="size-3.5" aria-hidden />
          {t("vaultThemes.preview.primary")}
        </Button>
        <Button size="sm" type="button" variant="secondary">
          {t("vaultThemes.preview.secondary")}
        </Button>
        <Button size="sm" type="button" variant="outline">
          {t("vaultThemes.preview.outline")}
        </Button>
        <Button size="sm" type="button" variant="destructive">
          <Trash2 className="size-3.5" aria-hidden />
          {t("vaultThemes.preview.destructive")}
        </Button>
        <Button size="sm" type="button" variant="ghost">
          {t("vaultThemes.preview.ghost")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{t("vaultThemes.preview.primary")}</Badge>
        <Badge variant="secondary">{t("vaultThemes.preview.secondary")}</Badge>
        <Badge variant="outline">{t("vaultThemes.preview.outline")}</Badge>
        <Badge variant="destructive">{t("vaultThemes.preview.destructive")}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="vault-theme-preview-input">{t("vaultThemes.preview.textField")}</Label>
          <Input
            id="vault-theme-preview-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <label
          className="flex items-center gap-2 self-end text-sm"
          htmlFor="vault-theme-preview-switch"
        >
          <Switch id="vault-theme-preview-switch" checked={on} onCheckedChange={setOn} />
          {t("vaultThemes.preview.switch")}
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-[3fr_2fr]">
        <Callout.Info>{t("vaultThemes.preview.callout")}</Callout.Info>
        <div className="space-y-1 rounded-box border border-border bg-card p-3 text-card-foreground">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            {t("vaultThemes.preview.metric")}
            <Activity className="size-3.5" aria-hidden />
          </div>
          <p className="text-base font-semibold">99.9%</p>
          <Badge variant="secondary">{t("vaultThemes.preview.healthy")}</Badge>
        </div>
      </div>
    </div>
  );
}

export interface VaultThemeExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  theme: VaultThemeDraft;
}

/**
 * V1's "Export Theme Configuration": the theme as JSON (to share or re-import) and as CSS — V2's
 * counterpart of V1's C# tab, since a V2 theme is custom properties rather than an Ivy `Theme`.
 */
export function VaultThemeExportDialog({ isOpen, onClose, theme }: VaultThemeExportDialogProps) {
  const { t } = useTranslation("uiSettings");
  const [format, setFormat] = React.useState<"json" | "css">("json");
  const code = format === "json" ? exportThemeJson(theme) : exportThemeCss(theme);
  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("vaultThemes.export.title")}
      testId="vault-theme-export-dialog"
      width="rem40"
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("vaultThemes.close")}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2" role="group" aria-label={t("vaultThemes.export.format")}>
          {(["json", "css"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={format === value ? "default" : "outline"}
              aria-pressed={format === value}
              onClick={() => setFormat(value)}
            >
              {value.toUpperCase()}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t(format === "json" ? "vaultThemes.export.jsonHint" : "vaultThemes.export.cssHint")}
        </p>
        <div className="relative">
          <pre
            className="max-h-80 overflow-auto rounded-field bg-muted p-3 font-mono text-xs"
            data-testid="vault-theme-export-code"
          >
            {code}
          </pre>
          <div className="absolute right-2 top-2">
            <CopyToClipboardButton
              textToCopy={code}
              aria-label={t("vaultThemes.export.copy", { format: format.toUpperCase() })}
            />
          </div>
        </div>
      </div>
    </DialogShell>
  );
}

export interface VaultThemeImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** A parsed theme; the dialog has already refused anything it could not read. */
  onImport: (theme: VaultThemeDraft) => void;
}

/** V1's "Import Theme Configuration": paste a JSON theme (V2's export, or a V1 theme/manifest). */
export function VaultThemeImportDialog({ isOpen, onClose, onImport }: VaultThemeImportDialogProps) {
  const { t } = useTranslation("uiSettings");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setCode("");
      setError(null);
    }
  }, [isOpen]);

  const submit = () => {
    const parsed = parseThemeJson(code);
    if (!parsed.ok) {
      setError(
        t(
          parsed.reason === "json"
            ? "vaultThemes.import.invalidJson"
            : "vaultThemes.import.invalidShape",
        ),
      );
      return;
    }
    onImport(parsed.theme);
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("vaultThemes.import.title")}
      description={t("vaultThemes.import.description")}
      testId="vault-theme-import-dialog"
      width="rem40"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("vaultThemes.cancel")}
          </Button>
          <Button
            type="button"
            disabled={code.trim() === ""}
            onClick={submit}
            data-testid="vault-theme-import-submit"
          >
            <FileDown className="size-4" aria-hidden />
            {t("vaultThemes.import.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Callout.Error data-testid="vault-theme-import-error">{error}</Callout.Error>}
        <Textarea
          aria-label={t("vaultThemes.import.fieldLabel")}
          value={code}
          className="min-h-56 font-mono text-xs"
          placeholder={
            '{\n  "name": "Ocean",\n  "colors": {\n    "light": { ... },\n    "dark": { ... }\n  }\n}'
          }
          onChange={(event) => setCode(event.target.value)}
        />
      </div>
    </DialogShell>
  );
}

/**
 * `Apps/Settings/Dialogs/VaultThemesDialog.cs`: build a theme and publish it to the Team Vault, and
 * manage the themes the vault already has — apply, edit, delete.
 *
 * Two tabs once the vault has any themes (*Theme Generator*, *Vault Themes (n)*), only the generator
 * before that, exactly as V1 decides it. The generator starts from a preset, edits either half
 * (light/dark) token by token, sets typography and corner radius, previews it on the library's own
 * controls, and can round-trip through JSON (the export and import sub-dialogs).
 *
 * **Presentational.** Reading the vault's themes, committing a new one, applying one and deleting
 * one are the host's. Two V1 behaviours are deliberately not ported: the live global preview (see
 * {@link ThemePreview}), and delete-on-click — a vault delete commits and pushes for the whole team,
 * so it goes through a confirm like every other destructive action.
 */
export function VaultThemesDialog({
  open,
  onClose,
  themes,
  isLoadingThemes = false,
  activeThemeId,
  presets = DEFAULT_PRESETS,
  initialTab = "generator",
  editTheme,
  onSave,
  isSaving = false,
  saveDisabledReason,
  onApply,
  onDelete,
  deletingId,
  error,
}: VaultThemesDialogProps) {
  const { t } = useTranslation("uiSettings");
  const defaultName = t("vaultThemes.defaults.name");
  const defaultDescription = t("vaultThemes.defaults.description");
  const [tab, setTab] = React.useState<VaultThemesTab>(initialTab);
  const [state, setState] = React.useState<GeneratorState>(() =>
    editTheme
      ? generatorFromTheme(editTheme)
      : initialGenerator(presets, defaultName, defaultDescription),
  );
  const [exportOpen, setExportOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<VaultTheme | null>(null);

  React.useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  React.useEffect(() => {
    if (editTheme) {
      setState(generatorFromTheme(editTheme));
      setTab("generator");
    }
  }, [editTheme]);

  const hasThemes = themes.length > 0;
  const generatorActive = !hasThemes || tab === "generator";
  const update = (patch: Partial<GeneratorState>) =>
    setState((current) => ({ ...current, ...patch }));
  const setColor = (token: string, value: string) =>
    setState((current) => ({
      ...current,
      colors: {
        ...current.colors,
        [current.mode]: { ...current.colors[current.mode], [token]: value },
      },
    }));

  const newTheme = () => {
    setState(initialGenerator(presets, defaultName, defaultDescription));
    setTab("generator");
  };

  const title = hasThemes
    ? t("vaultThemes.title")
    : state.editingId
      ? t("vaultThemes.editTitle")
      : t("vaultThemes.createTitle");

  const saveBlocked = isSaving || state.name.trim() === "" || !!saveDisabledReason;
  const current = state.colors[state.mode];

  const generator = (
    <div className="space-y-4" data-testid="vault-theme-generator">
      <div className="grid gap-3 sm:grid-cols-[2fr_3fr]">
        <div className="space-y-1.5">
          <Label htmlFor="vault-theme-name">{t("vaultThemes.fields.name")}</Label>
          <Input
            id="vault-theme-name"
            value={state.name}
            required
            aria-required="true"
            onChange={(event) => update({ name: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vault-theme-description">{t("vaultThemes.fields.description")}</Label>
          <Input
            id="vault-theme-description"
            value={state.description}
            onChange={(event) => update({ description: event.target.value })}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="vault-theme-preset">{t("vaultThemes.fields.preset")}</Label>
          <NativeSelect
            id="vault-theme-preset"
            value={state.presetId}
            onChange={(event) => {
              const preset = presets.find((p) => p.id === event.target.value);
              if (!preset) return;
              // `LoadPreset`: the colours, and the typography when the preset carries any.
              update({
                presetId: preset.id,
                colors: completeColors(preset.colors),
                ...(preset.fontFamily ? { fontFamily: preset.fontFamily } : {}),
                ...(preset.fontSize ? { fontSize: preset.fontSize } : {}),
              });
            }}
          >
            {state.presetId === "" && (
              <option value="">{t("vaultThemes.fields.presetCustom")}</option>
            )}
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">{t("vaultThemes.fields.mode")}</p>
          <div
            className="grid grid-cols-2 gap-2"
            role="group"
            aria-label={t("vaultThemes.fields.mode")}
          >
            {(["light", "dark"] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                variant={state.mode === mode ? "default" : "outline"}
                aria-pressed={state.mode === mode}
                data-testid={`vault-theme-mode-${mode}`}
                onClick={() => update({ mode })}
              >
                {mode === "light" ? (
                  <Sun className="size-4" aria-hidden />
                ) : (
                  <Moon className="size-4" aria-hidden />
                )}
                {t(`vaultThemes.mode.${mode}`)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <Section
        title={t("vaultThemes.sections.preview")}
        accessory={
          <Swatches
            colors={[
              current.primary,
              current.secondary,
              current.accent,
              current.background,
              current.foreground,
            ].map((c) => c ?? "#888888")}
          />
        }
        testId="vault-theme-preview-section"
      >
        <ThemePreview state={state} />
      </Section>

      <Section title={t("vaultThemes.sections.colors")} testId="vault-theme-colors-section">
        {VAULT_THEME_COLOR_GROUPS.map((group) => (
          <div key={group.id} className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              {t(`vaultThemes.colorGroups.${group.id}`)}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
              {group.tokens.map((token) => {
                const value = current[token] ?? "";
                const id = `vault-theme-color-${token}`;
                return (
                  <div key={token} className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label={`--${token}`}
                      className="size-8 shrink-0 cursor-pointer rounded-selector border border-border bg-transparent p-0.5"
                      value={colorInputValue(value)}
                      onChange={(event) => setColor(token, event.target.value)}
                    />
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor={id}
                        className="block truncate font-mono text-[11px] text-muted-foreground"
                      >
                        --{token}
                      </label>
                      <Input
                        id={id}
                        value={value}
                        className="h-7 font-mono text-xs"
                        onChange={(event) => setColor(token, event.target.value)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </Section>

      <Section
        title={t("vaultThemes.sections.typography")}
        defaultOpen={false}
        testId="vault-theme-typography-section"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="vault-theme-font-family">{t("vaultThemes.fields.fontFamily")}</Label>
            <Input
              id="vault-theme-font-family"
              value={state.fontFamily}
              placeholder="Inter, system-ui, sans-serif"
              onChange={(event) => update({ fontFamily: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vault-theme-font-size">{t("vaultThemes.fields.fontSize")}</Label>
            <Input
              id="vault-theme-font-size"
              value={state.fontSize}
              placeholder="16px, 1rem"
              onChange={(event) => update({ fontSize: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vault-theme-radius">{t("vaultThemes.fields.radius")}</Label>
            <NativeSelect
              id="vault-theme-radius"
              value={state.radius}
              onChange={(event) => update({ radius: event.target.value as VaultThemeRadius })}
            >
              {(Object.keys(VAULT_THEME_RADII) as VaultThemeRadius[]).map((radius) => (
                <option key={radius} value={radius}>
                  {t(`vaultThemes.radius.${radius}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setExportOpen(true)}
          data-testid="vault-theme-export"
        >
          <Copy className="size-4" aria-hidden />
          {t("vaultThemes.copyConfiguration")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setImportOpen(true)}
          data-testid="vault-theme-import"
        >
          <FileDown className="size-4" aria-hidden />
          {t("vaultThemes.importConfiguration")}
        </Button>
      </div>
    </div>
  );

  const themesList = (
    <div className="space-y-3" data-testid="vault-themes-list">
      {isLoadingThemes && themes.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" />
          {t("vaultThemes.list.loading")}
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              {t("vaultThemes.list.count", { count: themes.length })}
            </p>
            <Button type="button" size="sm" onClick={newTheme}>
              <Plus className="size-4" aria-hidden />
              {t("vaultThemes.newTheme")}
            </Button>
          </div>
          <Separator />
          <ul className="space-y-3">
            {themes.map((theme) => {
              const isActive =
                !!activeThemeId && activeThemeId.toLowerCase() === theme.id.toLowerCase();
              return (
                <li
                  key={theme.id}
                  className="flex flex-wrap items-center justify-between gap-3"
                  data-testid={`vault-theme-row-${theme.id}`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{theme.name}</span>
                      <Badge variant="outline">
                        {theme.isDark ? t("vaultThemes.mode.dark") : t("vaultThemes.mode.light")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {theme.description.trim() !== ""
                        ? theme.description
                        : t("vaultThemes.list.noDescription")}
                    </p>
                    <Swatches colors={theme.previewColors} />
                  </div>
                  <div className="flex items-center gap-2">
                    {isActive ? (
                      <Badge variant="secondary">{t("vaultThemes.list.active")}</Badge>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onApply(theme.id)}
                      >
                        <Check className="size-3.5" aria-hidden />
                        {t("vaultThemes.list.apply")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setState(generatorFromTheme(theme));
                        setTab("generator");
                      }}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                      {t("vaultThemes.list.edit")}
                    </Button>
                    <IconButton
                      label={t("vaultThemes.list.delete", { name: theme.name })}
                      size="sm"
                      variant="danger"
                      disabled={deletingId === theme.id}
                      onClick={() => setPendingDelete(theme)}
                    >
                      {deletingId === theme.id ? (
                        <Spinner size="sm" />
                      ) : (
                        <Trash2 className="size-4" aria-hidden />
                      )}
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );

  const emptyVault = (
    <div className="space-y-2" data-testid="vault-themes-empty">
      <p className="font-semibold">{t("vaultThemes.empty.title")}</p>
      <p className="text-xs text-muted-foreground">{t("vaultThemes.empty.body")}</p>
    </div>
  );

  const draft = draftOf(state);

  return (
    <>
      <DialogShell
        isOpen={open}
        onClose={onClose}
        title={title}
        testId="vault-themes-dialog"
        width="units190"
        footerClassName="flex-wrap"
        footer={
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("vaultThemes.close")}
            </Button>
            {generatorActive ? (
              <Button
                type="button"
                disabled={saveBlocked}
                title={saveDisabledReason ?? undefined}
                data-testid="vault-theme-save"
                onClick={() => {
                  if (!saveBlocked) onSave(draft);
                }}
              >
                {isSaving ? <Spinner size="sm" /> : <Upload className="size-4" aria-hidden />}
                {t("vaultThemes.upload")}
              </Button>
            ) : (
              <Button type="button" onClick={newTheme}>
                <Plus className="size-4" aria-hidden />
                {t("vaultThemes.newTheme")}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {hasThemes ? (
            <>
              <div className="flex gap-2 border-b border-border" role="tablist">
                {(["generator", "themes"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    data-testid={`vault-themes-tab-${value}`}
                    className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
                      tab === value
                        ? "border-primary font-semibold text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setTab(value)}
                  >
                    {value === "generator" ? (
                      <SlidersHorizontal className="size-4" aria-hidden />
                    ) : (
                      <Palette className="size-4" aria-hidden />
                    )}
                    {value === "generator"
                      ? t("vaultThemes.tabs.generator")
                      : t("vaultThemes.tabs.themes", { count: themes.length })}
                  </button>
                ))}
              </div>
              <div role="tabpanel">{tab === "generator" ? generator : themesList}</div>
            </>
          ) : (
            <>
              {isLoadingThemes ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner size="sm" />
                  {t("vaultThemes.list.loading")}
                </p>
              ) : (
                emptyVault
              )}
              {generator}
            </>
          )}
          {saveDisabledReason && generatorActive && (
            <Callout.Info data-testid="vault-theme-save-disabled">
              {saveDisabledReason}
            </Callout.Info>
          )}
          {error && <Callout.Error data-testid="vault-themes-error">{error}</Callout.Error>}
        </div>
      </DialogShell>

      <VaultThemeExportDialog
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        theme={draft}
      />
      <VaultThemeImportDialog
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={(imported) => {
          setState((currentState) => ({
            ...currentState,
            name: imported.name || currentState.name,
            description: imported.description || currentState.description,
            presetId: "",
            mode: imported.isDark ? "dark" : "light",
            colors: completeColors(imported.colors),
            fontFamily: imported.fontFamily ?? currentState.fontFamily,
            fontSize: imported.fontSize ?? currentState.fontSize,
            radius: imported.radius ?? currentState.radius,
          }));
          setImportOpen(false);
        }}
      />
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={t("vaultThemes.deleteConfirm.title", { name: pendingDelete?.name ?? "" })}
        body={<p>{t("vaultThemes.deleteConfirm.body")}</p>}
        confirmLabel={t("vaultThemes.deleteConfirm.confirm")}
        confirmVariant="destructive"
        testId="vault-theme-delete-dialog"
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </>
  );
}
