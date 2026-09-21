import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ColorSwatchField, ColorSwatchGrid } from "../src/views/settings/fields";
import { IVY_COLOR_NAMES } from "../src/utils/levelColor";

/**
 * V1's project colour control, which is
 * `projectColor.ToColorInput().Variant(ColorInputVariant.SwatchPicker)`
 * (`Ivy.Tendril/Apps/Settings/ProjectDetailView.cs:222`) rendered by `ColorSwatchGrid`
 * (`Ivy-Framework/src/frontend/src/widgets/inputs/ColorInputWidget.tsx:63-108`).
 *
 * The thing being pinned is that the colour is *picked from a fixed palette* rather than typed. It
 * matters beyond looks: `config.yaml`'s `color` is a free `String` the daemon never validates, and
 * V1's `ConfigService.MigrateProjectColor` rewrites anything that is not a `Colors` member to
 * `Slate` the next time it saves. A text field could therefore accept a value that silently became
 * a different one; a grid of the 32 legal names cannot.
 */

// Radix's popover is slow to open under jsdom - `chat-header.test.tsx` raises the same two knobs
// for the same reason.
vi.setConfig({ testTimeout: 120_000 });
const POPOVER_TIMEOUT = { timeout: 60_000 };

const openPalette = async (label = "Color") => {
  fireEvent.click(screen.getByRole("button", { name: label }));
  return waitFor(() => screen.getByRole("group", { name: "Colors" }), POPOVER_TIMEOUT);
};

describe("ColorSwatchGrid", () => {
  /**
   * V1 offers `Object.keys(enumColorsToCssVar)` - the `Colors` enum in declaration order - and
   * nothing else. Order is asserted as well as membership because the grid is six wide, so a
   * reordering moves every swatch to a different row.
   */
  it("offers the 32 Ivy colour names, in the enum's declaration order", () => {
    render(<ColorSwatchGrid value="Slate" onSelect={() => {}} />);

    const grid = screen.getByRole("group", { name: "Colors" });
    const names = within(grid)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

    expect(names).toEqual([...IVY_COLOR_NAMES]);
    expect(names).toHaveLength(32);
    expect(names[0]).toBe("Black");
    expect(names[names.length - 1]).toBe("IvyGreen");
  });

  /** `isSelected ? "border-foreground ring-2 ring-foreground/30" : "border-transparent"`, plus the tick. */
  it("rings and ticks the selected swatch, and only that one", () => {
    render(<ColorSwatchGrid value="Emerald" onSelect={() => {}} />);

    const emerald = screen.getByRole("button", { name: "Emerald" });
    expect(emerald).toHaveAttribute("aria-pressed", "true");
    expect(emerald.className).toContain("ring-foreground/30");
    expect(emerald.querySelector("svg")).not.toBeNull();

    const blue = screen.getByRole("button", { name: "Blue" });
    expect(blue).toHaveAttribute("aria-pressed", "false");
    expect(blue.querySelector("svg")).toBeNull();
  });

  /** `Enum.TryParse<Colors>(..., ignoreCase: true)` is what reads the stored value. */
  it("matches the stored colour case-insensitively", () => {
    render(<ColorSwatchGrid value="  emerald " onSelect={() => {}} />);

    expect(screen.getByRole("button", { name: "Emerald" })).toHaveAttribute("aria-pressed", "true");
  });

  /** A hand-written hex is not one of the 32, so nothing is selected rather than something arbitrary. */
  it("selects nothing when the stored value names no Ivy colour", () => {
    render(<ColorSwatchGrid value="#ff0000" onSelect={() => {}} />);

    const pressed = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed).toEqual([]);
  });

  /** The name, not a hex: `config.yaml` stores `Emerald`, and `ivyColorVar` resolves it for rendering. */
  it("reports the picked colour by its enum name", () => {
    const onSelect = vi.fn();
    render(<ColorSwatchGrid value="Slate" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "IvyGreen" }));

    expect(onSelect).toHaveBeenCalledWith("IvyGreen");
  });
});

describe("ColorSwatchField", () => {
  /** V1's trigger is a filled square that opens the grid in a popover; the grid is not inline. */
  it("keeps the palette behind a trigger and opens it on click", async () => {
    render(<ColorSwatchField id="project-color" label="Color" value="Slate" onChange={() => {}} />);

    expect(screen.queryByRole("group", { name: "Colors" })).toBeNull();

    const grid = await openPalette();
    expect(within(grid).getAllByRole("button")).toHaveLength(32);
  });

  /** `handleSwatchSelect`: fire the change, then `setSwatchPickerOpen(false)`. */
  it("reports the pick and closes", async () => {
    const onChange = vi.fn();
    render(<ColorSwatchField id="project-color" label="Color" value="Slate" onChange={onChange} />);

    const grid = await openPalette();
    fireEvent.click(within(grid).getByRole("button", { name: "Emerald" }));

    expect(onChange).toHaveBeenCalledWith("Emerald");
    await waitFor(
      () => expect(screen.queryByRole("group", { name: "Colors" })).toBeNull(),
      POPOVER_TIMEOUT,
    );
  });

  /** The trigger carries the current colour, so the screen says which one is set without opening it. */
  it("names the current colour on the trigger", () => {
    render(<ColorSwatchField id="project-color" label="Color" value="emerald" onChange={() => {}} />);

    expect(screen.getByTestId("project-color-trigger")).toHaveAttribute("data-color", "Emerald");
    expect(screen.getByText("Emerald")).toBeInTheDocument();
  });

  /** An unparseable stored value is named as unset rather than drawn as if it were a colour. */
  it("shows an unrecognised stored value as no colour", () => {
    render(<ColorSwatchField id="project-color" label="Color" value="#ff0000" onChange={() => {}} />);

    expect(screen.getByTestId("project-color-trigger")).toHaveAttribute("data-color", "");
    expect(screen.getByText("None")).toBeInTheDocument();
  });
});
