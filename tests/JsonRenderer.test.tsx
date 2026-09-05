import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { JsonRenderer } from "../src/components/JsonRenderer";

describe("JsonRenderer", () => {
  it("renders json keys and values", () => {
    const data = { title: "Test", count: 42 };
    const { container } = render(<JsonRenderer data={data} initialExpanded={1} />);
    expect(container.textContent).toContain("title");
    expect(container.textContent).toContain("Test");
    expect(container.textContent).toContain("42");
  });

  it("expands and collapses objects on toggle", () => {
    const data = { secret: "xyz" };
    const { container } = render(<JsonRenderer data={data} initialExpanded={0} />);
    const toggle = container.querySelector('[role="button"]');
    expect(toggle).not.toBeNull();
    if (toggle) {
      fireEvent.click(toggle);
      expect(container.textContent).toContain("secret");
      expect(container.textContent).toContain("xyz");
    }
  });
});
