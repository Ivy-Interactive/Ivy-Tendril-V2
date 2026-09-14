import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { Slider } from "../src/components/ui/slider";
import { formatBytes } from "../src/lib/formatters";

describe("Slider component and formatters", () => {
  it("renders with default values and slider role", () => {
    const { container } = render(<Slider defaultValue={[40]} max={100} step={1} />);
    const slider = container.querySelector('[role="slider"]');
    expect(slider).toBeDefined();
    expect(slider?.getAttribute("aria-valuenow")).toBe("40");
  });

  it("formats bytes accurately", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(1048576)).toBe("1.00 MB");
  });
});
