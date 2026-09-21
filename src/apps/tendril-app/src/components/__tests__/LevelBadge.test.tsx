import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LevelBadge } from "../LevelBadge";
import { bridge } from "../../api/bridge";
import type { TendrilConfig } from "../../types/api";

/**
 * `new Badge(plan.Level).Color(config.GetLevelColor(plan.Level) ?? Colors.Gray).Small()`
 * (`Apps/Icebox/SidebarView.cs:25`).
 *
 * The assertions are on the *colour each level gets*, not on a class being present: the defect these
 * cover is a level badge rendered with no colour at all, and a test that only checked "some tint"
 * would pass against a badge that coloured every level identically.
 */

/** `default_levels()` (`crates/tendril-core/src/config/settings.rs`), V1's `ConfigService.cs:314-318`. */
const DEFAULT_LEVELS = [
  { name: "Bug", color: "Red" },
  { name: "Feature", color: "Blue" },
  { name: "Epic", color: "Purple" },
  { name: "Chore", color: "Slate" },
  { name: "Nitpick", color: "Gray" },
];

const configWith = (levels: unknown): TendrilConfig => ({ raw: { levels } });

beforeEach(() => {
  vi.spyOn(bridge, "getConfig").mockResolvedValue(configWith(DEFAULT_LEVELS));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The Ivy colour token `Badge`'s `color` prop tints from, as it lands in the element's style. */
const tintToken = (el: HTMLElement) => el.getAttribute("style") ?? "";

describe("LevelBadge", () => {
  it.each([
    ["Bug", "Red", "--red"],
    ["Feature", "Blue", "--blue"],
    ["Epic", "Purple", "--purple"],
    ["Chore", "Slate", "--slate"],
    ["Nitpick", "Gray", "--gray"],
  ])("colours %s with its configured %s", async (level, color, token) => {
    render(<LevelBadge level={level} />);

    const badge = await waitFor(() => {
      const el = screen.getByTestId(`level-badge-${level}`);
      expect(el).toHaveAttribute("data-level-color", color);
      return el;
    });
    expect(badge).toHaveTextContent(level);
    // Resolved through the package's own `ivyColorVar`, so the theme token is what tints it.
    expect(tintToken(badge)).toContain(`var(${token}`);
  });

  /**
   * The mapping has to be the configuration's, not a table in the frontend: an operator who recolours
   * a level in Settings must see that colour on the badge.
   */
  it("follows a recoloured level rather than any built-in palette", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(
      configWith([{ name: "Bug", color: "Emerald" }]),
    );
    render(<LevelBadge level="Bug" />);

    await waitFor(() =>
      expect(screen.getByTestId("level-badge-Bug")).toHaveAttribute("data-level-color", "Emerald"),
    );
  });

  it("colours a level the configuration does not name with V1's Gray fallback", async () => {
    render(<LevelBadge level="Spike" />);

    await waitFor(() =>
      expect(screen.getByTestId("level-badge-Spike")).toHaveAttribute("data-level-color", "Gray"),
    );
  });

  /** `if (!string.IsNullOrEmpty(plan.Level))` — no level, no chip. */
  it("renders nothing without a level", () => {
    const { container } = render(<LevelBadge level={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("leaves the badge untinted when the config cannot be read, rather than dropping it", async () => {
    vi.spyOn(bridge, "getConfig").mockRejectedValue(new Error("offline"));
    render(<LevelBadge level="Bug" />);

    const badge = screen.getByTestId("level-badge-Bug");
    expect(badge).toHaveTextContent("Bug");
    await waitFor(() => expect(badge).not.toHaveAttribute("data-level-color"));
  });
});
