import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { MarkdownRenderer, normalizeNestedFences } from "../src/components/MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("renders headers, lists, and bold text", () => {
    const content = "# Main Title\n\n- **Bold Item**\n- Regular Item";
    const { container } = render(<MarkdownRenderer content={content} />);
    expect(container.querySelector("h1")?.textContent).toBe("Main Title");
    expect(container.querySelector("strong")?.textContent).toBe("Bold Item");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders GitHub alert callouts", () => {
    const content = "> [!NOTE]\n> This is a helpful note";
    const { container } = render(<MarkdownRenderer content={content} />);
    expect(container.textContent).toContain("This is a helpful note");
  });

  it("normalizes nested markdown fences", () => {
    const raw = "```markdown\n```csharp\ncode\n```\n```";
    const normalized = normalizeNestedFences(raw);
    expect(normalized).toContain("````markdown");
  });
});
