import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { XmlRenderer } from "../src/components/XmlRenderer";

describe("XmlRenderer", () => {
  it("parses and renders XML elements and attributes", () => {
    const xml = '<root status="active"><item id="1">First</item></root>';
    const { container } = render(<XmlRenderer data={xml} initialExpanded={2} />);
    expect(container.textContent).toContain("root");
    expect(container.textContent).toContain("status");
    expect(container.textContent).toContain("active");
    expect(container.textContent).toContain("item");
    expect(container.textContent).toContain("First");
  });
});
