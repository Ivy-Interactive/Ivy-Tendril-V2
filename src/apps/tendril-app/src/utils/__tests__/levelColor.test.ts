import { describe, expect, it } from "vitest";
import { levelBadgeColor } from "../levelColor";

/**
 * The legal vocabulary is V1's `Colors` enum, because every V1 renderer of a level colour reads the
 * stored string through `Enum.TryParse<Colors>` (`LevelsSetupView.cs:33`, `ConfigService.cs:703`) —
 * the daemon's `LevelConfig.color` is an unvalidated `String`. What is pinned here is that the whole
 * enum resolves and that a name outside it resolves to nothing, because `ivyColorVar` accepts any
 * string: without the parse, a typo would tint on `var(--gary, currentColor)` and look intentional.
 */

/** `default_levels()` (`crates/tendril-core/src/config/settings.rs:324-351`), colour for colour. */
const SHIPPED_DEFAULTS = [
  ["Red", "Red"],
  ["Blue", "Blue"],
  ["Purple", "Purple"],
  ["Slate", "Slate"],
  ["Gray", "Gray"],
] as const;

describe("levelBadgeColor", () => {
  it.each(SHIPPED_DEFAULTS)("resolves the shipped default %s", (stored, expected) => {
    expect(levelBadgeColor(stored)).toBe(expected);
  });

  /** `Ivy-Framework/src/Ivy/Shared/Colors.cs:4-36`, every member. */
  it.each([
    "Black",
    "White",
    "Slate",
    "Gray",
    "Zinc",
    "Neutral",
    "Stone",
    "Red",
    "Orange",
    "Amber",
    "Yellow",
    "Lime",
    "Green",
    "Emerald",
    "Teal",
    "Cyan",
    "Sky",
    "Blue",
    "Indigo",
    "Violet",
    "Purple",
    "Fuchsia",
    "Pink",
    "Rose",
    "Primary",
    "Secondary",
    "Destructive",
    "Success",
    "Warning",
    "Info",
    "Muted",
    "IvyGreen",
  ])("resolves the Ivy colour %s to itself", (name) => {
    expect(levelBadgeColor(name)).toBe(name);
  });

  /**
   * `Enum.TryParse<Colors>(colorStr, ignoreCase: true, ...)` (`ConfigService.cs:703`). `config.yaml`
   * is hand-edited, so the casing the daemon accepts is the casing this has to accept.
   */
  it("matches a stored colour whatever its casing", () => {
    expect(levelBadgeColor("red")).toBe("Red");
    expect(levelBadgeColor("RED")).toBe("Red");
    expect(levelBadgeColor("rEd")).toBe("Red");
    // The one multi-word name, where a naive `toLowerCase` comparison against the raw token would
    // have to agree with `ivyColorVar`'s `IvyGreen` → `--ivy-green` split rather than fight it.
    expect(levelBadgeColor("ivygreen")).toBe("IvyGreen");
    expect(levelBadgeColor("IVYGREEN")).toBe("IvyGreen");
  });

  /** A YAML scalar carries whatever whitespace was typed around it. */
  it("ignores surrounding whitespace", () => {
    expect(levelBadgeColor("  Blue  ")).toBe("Blue");
  });

  /**
   * The fallback the Color cell draws its neutral badge from. Not V1's `Colors.Gray`: see
   * {@link levelBadgeColor} for why a typo must not render as a deliberate grey.
   */
  it("resolves a name outside the palette to nothing", () => {
    expect(levelBadgeColor("Gary")).toBeUndefined();
    expect(levelBadgeColor("#ff0000")).toBeUndefined();
    expect(levelBadgeColor("ivy green")).toBeUndefined();
    // Not a colour at all, and `ivyColorVar("") ` would still produce a renderable `var(--)`.
    expect(levelBadgeColor("")).toBeUndefined();
    expect(levelBadgeColor("   ")).toBeUndefined();
    expect(levelBadgeColor(undefined)).toBeUndefined();
  });
});
