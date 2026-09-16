import { describe, expect, it, beforeEach } from "vitest";
import {
  applyThemePreset,
  DARK_SELECTOR,
  LIGHT_SELECTOR,
  getThemePreset,
  themePresetCss,
  DEFAULT_THEME_PRESET_ID,
  THEME_PRESETS,
  THEME_PRESET_STYLE_ID,
} from "./theme-presets";

/**
 * The preset table and how it is applied, against `Themes/TendrilThemes.cs`. V1's list is
 * `BuiltInThemes`, in the order Appearance's select shows them, and `ApplyTheme` installs a
 * generated stylesheet rather than per-element styles.
 */
describe("theme presets", () => {
  beforeEach(() => {
    document.getElementById(THEME_PRESET_STYLE_ID)?.remove();
  });

  it("carries V1's BuiltInThemes, in V1's order", () => {
    expect(THEME_PRESETS.map((preset) => preset.id)).toEqual([
      "default",
      "cupcake",
      "cyberpunk",
      "synthwave",
      "retro",
      "dracula",
      "nord",
      "forest",
      "aqua",
      "valentine",
      "sunset",
      "coffee",
      "dim",
      "luxury",
      "lovably",
      "hellokitty",
    ]);
  });

  it("gives every preset four preview swatches, the way PreviewColors does", () => {
    for (const preset of THEME_PRESETS) {
      expect(preset.previewColors).toHaveLength(4);
      for (const color of preset.previewColors) expect(color).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });

  it("overrides only tokens.css's generated colour names", () => {
    const generated = new Set([
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "destructive",
      "destructive-foreground",
      "success",
      "success-foreground",
      "warning",
      "warning-foreground",
      "info",
      "info-foreground",
      "background",
      "foreground",
      "border",
      "input",
      "ring",
      "muted",
      "muted-foreground",
      "accent",
      "accent-foreground",
      "card",
      "card-foreground",
      "popover",
      "popover-foreground",
    ]);

    for (const preset of THEME_PRESETS) {
      for (const mode of [preset.colors.light, preset.colors.dark]) {
        for (const token of Object.keys(mode ?? {})) {
          expect(generated.has(token), `${preset.id} sets an unknown token --${token}`).toBe(true);
        }
      }
    }
  });

  it("resolves an unknown or blank id to the default, the way GetTheme does", () => {
    expect(getThemePreset("nope").id).toBe(DEFAULT_THEME_PRESET_ID);
    expect(getThemePreset("").id).toBe(DEFAULT_THEME_PRESET_ID);
    expect(getThemePreset(null).id).toBe(DEFAULT_THEME_PRESET_ID);
    // Ids are matched case-insensitively, as `BuiltInThemesById`'s comparer is.
    expect(getThemePreset("Dracula").id).toBe("dracula");
  });

  it("emits a light block and a dark block, each outranking tokens.css", () => {
    const css = themePresetCss(getThemePreset("dracula"));
    expect(css).toContain(`${LIGHT_SELECTOR} {`);
    expect(css).toContain(`${DARK_SELECTOR} {`);
    expect(css).toContain("--primary: #bd93f9;");
    // The dark half comes second and is the more specific of the two, so it wins in dark mode
    // whatever order the stylesheets ended up in.
    expect(css.indexOf(LIGHT_SELECTOR)).toBeLessThan(css.indexOf(DARK_SELECTOR));
  });

  it("installs one style element and replaces its contents when the preset changes", () => {
    applyThemePreset("nord");
    const first = document.getElementById(THEME_PRESET_STYLE_ID);
    expect(first?.textContent).toContain("--primary: #88c0d0;");

    applyThemePreset("forest");
    expect(document.querySelectorAll(`#${THEME_PRESET_STYLE_ID}`)).toHaveLength(1);
    expect(document.getElementById(THEME_PRESET_STYLE_ID)?.textContent).toContain(
      "--primary: #1eb854;",
    );
  });

  it("removes the override layer for the default preset rather than restating tokens.css", () => {
    applyThemePreset("cupcake");
    expect(document.getElementById(THEME_PRESET_STYLE_ID)).not.toBeNull();

    const applied = applyThemePreset(DEFAULT_THEME_PRESET_ID);
    expect(applied.id).toBe(DEFAULT_THEME_PRESET_ID);
    expect(themePresetCss(applied)).toBe("");
    expect(document.getElementById(THEME_PRESET_STYLE_ID)).toBeNull();
  });
});
