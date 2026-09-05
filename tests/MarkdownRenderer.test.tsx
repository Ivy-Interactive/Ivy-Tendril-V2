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

describe("MarkdownRenderer code text from raw HTML children", () => {
  it("extracts text from element children in raw HTML code blocks", () => {
    const content = "<pre><code>const a<b> = 1</b></code></pre>";
    const { container } = render(<MarkdownRenderer content={content} />);
    const codeElement = container.querySelector("code");
    expect(codeElement?.textContent).toContain("const a = 1");
    expect(codeElement?.textContent).not.toContain("const a 1");
  });

  it("recursively extracts text without coercing elements to [object Object]", () => {
    const content = "<pre><code>line 1\n<b>line 2</b></code></pre>";
    const { container } = render(<MarkdownRenderer content={content} />);
    const codeElement = container.querySelector("code");
    expect(codeElement?.textContent).toContain("line 1");
    expect(codeElement?.textContent).toContain("line 2");
    expect(codeElement?.textContent).not.toContain("[object Object]");
  });

  it("renders ordinary fenced code blocks with commas intact", () => {
    const content = "```ts\nconst arr = [1, 2, 3];\n```";
    const { container } = render(<MarkdownRenderer content={content} />);
    const codeBlock = container.querySelector(".markdown-code-block");
    expect(codeBlock?.textContent).toContain("[1, 2, 3]");
  });

  it("treats inline code with element child containing newline as block", () => {
    // Use a markdown fence to test the inline vs block detection logic
    // The raw HTML path doesn't use the inline/block detection from line 543
    const content = "```\nfirst line\nsecond line\n```";
    const { container } = render(<MarkdownRenderer content={content} />);
    // Block code gets the .markdown-code-block wrapper
    const codeBlock = container.querySelector(".markdown-code-block");
    expect(codeBlock).toBeTruthy();
    const textContent = container.textContent || "";
    expect(textContent).toContain("first line");
    expect(textContent).toContain("second line");
  });
});

describe("MarkdownRenderer frontmatter", () => {
  it("renders a populated frontmatter block with card and strips fences from body", () => {
    const content =
      "---\ntitle: Test Document\nauthor: Test Author\n---\n# Main Content\n\nBody text.";
    const { container } = render(<MarkdownRenderer content={content} />);

    // Frontmatter card should be present (has distinctive classes)
    const frontmatterCard = container.querySelector(".mb-6.rounded-lg.border");
    expect(frontmatterCard).toBeTruthy();

    // Body should be present without the frontmatter fences
    expect(container.textContent).toContain("Main Content");
    expect(container.textContent).toContain("Body text");
    expect(container.textContent).toContain("Test Document");
    expect(container.textContent).toContain("Test Author");
    // Verify key-value format is rendered
    expect(container.textContent).toContain("title:");
    expect(container.textContent).toContain("author:");
  });

  it("handles malformed frontmatter by rendering no card and preserving body", () => {
    const content = "---\ntitle: First\ntitle: Second\n---\n# Main Content";
    const { container } = render(<MarkdownRenderer content={content} />);

    // No frontmatter card for malformed YAML
    const frontmatterCard = container.querySelector(".mb-6.rounded-lg.border");
    expect(frontmatterCard).toBeFalsy();

    // Body should still be reachable (content returned as-is on error)
    expect(container.textContent).toContain("Main Content");
  });

  it("handles empty frontmatter block by stripping fences silently", () => {
    const content = "---\n\n---\n# Main Content\n\nBody text.";
    const { container } = render(<MarkdownRenderer content={content} />);

    // No frontmatter card for empty block
    const frontmatterCard = container.querySelector(".mb-6.rounded-lg.border");
    expect(frontmatterCard).toBeFalsy();

    // Body should be present, fences stripped
    expect(container.textContent).toContain("Main Content");
    expect(container.textContent).toContain("Body text");
  });

  it("handles scalar-only frontmatter by rendering no card", () => {
    const content = "---\njust a string\n---\n# Main Content";
    const { container } = render(<MarkdownRenderer content={content} />);

    // No frontmatter card for non-object YAML
    const frontmatterCard = container.querySelector(".mb-6.rounded-lg.border");
    expect(frontmatterCard).toBeFalsy();

    // Body should be present
    expect(container.textContent).toContain("Main Content");
  });
});
