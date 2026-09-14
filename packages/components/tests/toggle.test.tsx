import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { Toggle, ToggleGroup, ToggleGroupItem } from "../src/components/ui/toggle";

describe("Toggle and ToggleGroup components", () => {
  it("toggles single toggle state", () => {
    const handleChange = vi.fn();
    render(
      <Toggle aria-label="Toggle Bold" onPressedChange={handleChange}>
        B
      </Toggle>,
    );
    const btn = screen.getByRole("button", { name: "Toggle Bold" });
    expect(btn.getAttribute("data-state")).toBe("off");
    fireEvent.click(btn);
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it("handles toggle group selection", () => {
    const handleChange = vi.fn();
    render(
      <ToggleGroup type="multiple" onValueChange={handleChange}>
        <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
        <ToggleGroupItem value="italic">Italic</ToggleGroupItem>
      </ToggleGroup>,
    );

    const bold = screen.getByRole("button", { name: "Bold" });
    fireEvent.click(bold);
    expect(handleChange).toHaveBeenCalledWith(["bold"]);
  });
});
