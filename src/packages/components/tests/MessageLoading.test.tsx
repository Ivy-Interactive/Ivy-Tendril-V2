import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { MessageLoading } from "../src/components/MessageLoading";

describe("MessageLoading", () => {
  it("renders SVG with 3 pulsing circle dots and animation elements", () => {
    const { container } = render(<MessageLoading />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(3);
    const animates = container.querySelectorAll("animate");
    expect(animates).toHaveLength(3);
  });
});
