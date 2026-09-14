import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { Checkbox } from "../src/components/ui/checkbox";
import { Densities } from "../src/types/density";

describe("Checkbox component", () => {
  it("toggles checked state", () => {
    const handleChange = vi.fn();
    render(<Checkbox id="test-cb" onCheckedChange={handleChange} />);
    const cb = screen.getByRole("checkbox");
    expect(cb.getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(cb);
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it("supports 3-state cycling when nullable", () => {
    const handleChange = vi.fn();
    const { rerender } = render(
      <Checkbox id="test-null" nullable checked={null} onCheckedChange={handleChange} />,
    );
    const cb = screen.getByRole("checkbox");
    expect(cb.getAttribute("data-state")).toBe("indeterminate");
    fireEvent.click(cb);
    expect(handleChange).toHaveBeenCalledWith(true);

    rerender(<Checkbox id="test-null" nullable checked={true} onCheckedChange={handleChange} />);
    fireEvent.click(cb);
    expect(handleChange).toHaveBeenCalledWith(false);

    rerender(<Checkbox id="test-null" nullable checked={false} onCheckedChange={handleChange} />);
    fireEvent.click(cb);
    expect(handleChange).toHaveBeenCalledWith(null);
  });

  it("applies density sizing classes", () => {
    const { container } = render(<Checkbox id="density-cb" density={Densities.Large} />);
    const cb = container.querySelector("button");
    expect(cb?.className).toContain("size-5");
  });
});
