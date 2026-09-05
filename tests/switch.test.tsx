import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { Switch } from "../src/components/ui/switch";

describe("Switch component", () => {
  it("toggles checked state on click", () => {
    const handleChange = vi.fn();
    render(<Switch id="switch-test" onCheckedChange={handleChange} />);
    const el = screen.getByRole("switch");
    expect(el.getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(el);
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it("handles keyboard activation (Enter / Space)", () => {
    const handleChange = vi.fn();
    render(<Switch id="switch-key" onCheckedChange={handleChange} />);
    const el = screen.getByRole("switch");
    fireEvent.keyDown(el, { key: "Enter", code: "Enter" });
    fireEvent.click(el);
    expect(handleChange).toHaveBeenCalled();
  });

  it("does not trigger when disabled", () => {
    const handleChange = vi.fn();
    render(<Switch id="switch-dis" disabled onCheckedChange={handleChange} />);
    const el = screen.getByRole("switch");
    expect(el.hasAttribute("disabled")).toBe(true);
    fireEvent.click(el);
    expect(handleChange).not.toHaveBeenCalled();
  });
});
