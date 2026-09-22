import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LevelsSection } from "../LevelsSection";
import type { LevelEntry } from "../projectConfig";

/**
 * The Color column's one job: `.Builder(t => t.Color, ... new Badge(color).Color(...))`
 * (`Apps/Settings/LevelsSetupView.cs:31-35`). A cell whose text reads "Red" and whose fill is grey
 * says nothing the Name column did not already say, which is what this pins.
 *
 * The tint lands as inline custom properties rather than a class (`Badge`'s `tintStyle`), so the
 * assertion is on `style` — the same seam `ProjectBadges.test.tsx` asserts against.
 */

const level = (name: string, color: string): LevelEntry => ({ name, color, rest: {} });

/** `default_levels()` (`crates/tendril-core/src/config/settings.rs:324-351`). */
const DEFAULTS = [
  level("Bug", "Red"),
  level("Feature", "Blue"),
  level("Epic", "Purple"),
  level("Chore", "Slate"),
  level("Nitpick", "Gray"),
];

const renderSection = (levels: LevelEntry[]) =>
  render(<LevelsSection levels={levels} onSaveRaw={vi.fn().mockResolvedValue(undefined)} />);

describe("LevelsSection colour cell", () => {
  it("tints the Red level's badge from the theme's red token, not the neutral surface", () => {
    renderSection(DEFAULTS);

    const badge = screen.getByTestId("level-color-Bug");
    expect(badge).toHaveTextContent("Red");
    // `Badge`'s `color` prop selects the `tinted` variant and mixes `--red` into the fill and text.
    expect(badge.className).toContain("badge-tinted");
    const style = badge.getAttribute("style") ?? "";
    expect(style).toContain("var(--red");
    // The bug: every cell used to be `variant="secondary"`, whose fill is `--secondary`.
    expect(badge.className).not.toContain("bg-secondary");
  });

  it("gives each shipped level its own colour rather than one shared grey", () => {
    renderSection(DEFAULTS);

    for (const [name, token] of [
      ["Bug", "--red"],
      ["Feature", "--blue"],
      ["Epic", "--purple"],
      ["Chore", "--slate"],
      ["Nitpick", "--gray"],
    ] as const) {
      expect(screen.getByTestId(`level-color-${name}`).getAttribute("style") ?? "").toContain(
        `var(${token}`,
      );
    }
  });

  /** `Enum.TryParse<Colors>(..., ignoreCase: true)` (`Services/ConfigService.cs:703`). */
  it("tints a lowercase colour from config.yaml the same as a capitalised one", () => {
    renderSection([level("Bug", "red")]);

    const badge = screen.getByTestId("level-color-Bug");
    // The stored spelling is what is shown - this edits `config.yaml`, so it must not lie about it.
    expect(badge).toHaveTextContent("red");
    expect(badge.getAttribute("style") ?? "").toContain("var(--red");
  });

  /**
   * The departure from V1's `Colors.Gray` fallback: a misspelling must not render as a level somebody
   * deliberately coloured grey, because this is the screen where it would be corrected.
   */
  it("leaves an unrecognised colour on the neutral badge", () => {
    renderSection([level("Bug", "Gary")]);

    const badge = screen.getByTestId("level-color-Bug");
    expect(badge).toHaveTextContent("Gary");
    expect(badge.className).not.toContain("badge-tinted");
    expect(badge.className).toContain("bg-secondary");
  });

  it("still labels a level that stores no colour at all", () => {
    renderSection([level("Bug", "")]);

    const badge = screen.getByTestId("level-color-Bug");
    expect(badge).toHaveTextContent("unset");
    expect(badge.className).not.toContain("badge-tinted");
  });
});
