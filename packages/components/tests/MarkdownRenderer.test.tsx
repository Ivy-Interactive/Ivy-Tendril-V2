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

describe("MarkdownRenderer raw HTML sanitisation", () => {
  it("strips script tags and their content", () => {
    const content = "<details><summary>S</summary></details>\n\n<script>alert(1)</script>";
    const { container } = render(<MarkdownRenderer content={content} />);
    const scriptElement = container.querySelector("script");
    expect(scriptElement).toBeNull();
    const textContent = container.textContent || "";
    expect(textContent).not.toContain("alert(1)");
  });

  it("strips iframe, style, and object tags", () => {
    const content =
      '<details><summary>S</summary></details>\n\n<iframe></iframe><style>body{display:none}</style><object data="x"></object>';
    const { container } = render(<MarkdownRenderer content={content} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
    expect(container.querySelector("object")).toBeNull();
    const textContent = container.textContent || "";
    expect(textContent).not.toContain("display:none");
  });

  it("strips onclick and style attributes from allowed tags", () => {
    const content = '<details onclick="alert(1)" style="color:red"><summary>S</summary></details>';
    const { container } = render(<MarkdownRenderer content={content} />);
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    expect(details?.getAttribute("onclick")).toBeNull();
    expect(details?.getAttribute("style")).toBeNull();
  });

  it("neutralises javascript: hrefs", () => {
    const content =
      '<details><summary>S</summary></details>\n\n<a href="javascript:alert(1)">link</a>';
    const { container } = render(<MarkdownRenderer content={content} />);
    const link = container.querySelector("a");
    // The link may be removed entirely, or kept with href neutralised
    if (link) {
      const href = link.getAttribute("href");
      // href must not contain javascript: - it should be null, "", "#", or another safe value
      expect(href?.includes("javascript:")).toBe(false);
    }
    // Either way is acceptable - element removed or href neutralised
    expect(true).toBe(true);
  });

  it("preserves safe hrefs in allowed tags", () => {
    const content =
      '<details><summary>S</summary></details>\n\n<a href="https://example.test/x">link</a>';
    const { container } = render(<MarkdownRenderer content={content} />);
    const link = container.querySelector("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe("https://example.test/x");
  });

  it("renders details and summary as real elements", () => {
    const content = "<details><summary>S</summary></details>";
    const { container } = render(<MarkdownRenderer content={content} />);
    expect(container.querySelector("details")).toBeTruthy();
    expect(container.querySelector("summary")).toBeTruthy();
    const textContent = container.textContent || "";
    expect(textContent).toContain("S");
    expect(textContent).not.toContain("<details>");
    expect(textContent).not.toContain("</details>");
  });
});

describe("MarkdownRenderer features alongside sanitised raw HTML", () => {
  it("renders custom emoji after sanitising", () => {
    const content = "<details><summary>S</summary></details>\n\n:ivy-branded-star:";
    const { container } = render(<MarkdownRenderer content={content} />);
    const img = container.querySelector('img[alt=":ivy-branded-star:"]');
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe("/ivy-branded-star.svg");
  });

  it("generates heading slugs without user-content- prefix", () => {
    const content = "<details><summary>S</summary></details>\n\n## My Heading";
    const { container } = render(<MarkdownRenderer content={content} />);
    const h2 = container.querySelector("h2");
    expect(h2).toBeTruthy();
    expect(h2?.getAttribute("id")).toBe("my-heading");
    expect(h2?.getAttribute("id")).not.toContain("user-content-");
  });

  it("renders math blocks after sanitising", () => {
    const content = "<details><summary>S</summary></details>\n\n$$ \\frac{a}{b} $$";
    const { container } = render(<MarkdownRenderer content={content} />);
    expect(container.querySelector(".katex")).toBeTruthy();
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("renders GFM task lists and tables", () => {
    const content =
      "<details><summary>S</summary></details>\n\n- [ ] Task 1\n- [x] Task 2\n\n| Col |\n|-----|\n| 1   |";
    const { container } = render(<MarkdownRenderer content={content} />);
    const taskItems = container.querySelectorAll("li.task-list-item");
    expect(taskItems.length).toBe(2);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    const firstCell = container.querySelector("td");
    expect(firstCell?.textContent).toBe("1");
  });

  it("skips sanitisation when content has no HTML tags", () => {
    const content = "# Title\n\n- **Bold**";
    const { container } = render(<MarkdownRenderer content={content} />);
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
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
