import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { NumberInput } from "../src/components/NumberInput";

describe("NumberInput", () => {
  it("renders initial value formatted", () => {
    const { container } = render(<NumberInput value={1234.5} />);
    const input = container.querySelector("input")!;
    expect(input).not.toBeNull();
    expect(input.value).toContain("1,234.5");
  });

  it("formats bytes correctly when isBytesFormat is true", () => {
    const { container } = render(<NumberInput value={1048576} isBytesFormat={true} />);
    const input = container.querySelector("input")!;
    expect(input.value).toBe("1.00 MB");
  });

  it("calls onChange with updated numeric value", () => {
    const handleChange = vi.fn();
    const { container } = render(<NumberInput value={10} onChange={handleChange} />);
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.blur(input);
    expect(handleChange).toHaveBeenCalledWith(25);
  });
});
