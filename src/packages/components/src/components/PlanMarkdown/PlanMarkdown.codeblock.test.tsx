import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PlanMarkdown as DraftMarkdown } from "./PlanMarkdown";

const renderContent = (content: string) => {
  const { container } = render(<DraftMarkdown id="w1" content={content} />);
  return container;
};

// The lazily imported highlighter chunk is react-syntax-highlighter plus refractor, transformed on
// demand the first time any suite reaches it. Under a full-suite run that takes well over
// `waitFor`'s 1s default, so the wait below is sized for a cold transform.
const HIGHLIGHTER_TIMEOUT_MS = 15_000;

describe("DraftMarkdown code block rendering and width constraints", () => {
  it("renders a markdown document with long code lines without outer nested pre structure", () => {
    const longLine =
      "const veryLongVariableNameThatExtendsFarBeyondNormalWidth = 'some-very-long-string-value-that-would-cause-horizontal-overflow-if-unconstrained';";
    const markdown = "```typescript\n" + longLine + "\n```";
    const container = renderContent(markdown);

    const markdownBody = container.querySelector(".pmv-markdown");
    expect(markdownBody).not.toBeNull();

    // The code block should be a direct child under .pmv-markdown, not wrapped in an outer <pre>
    const outerPre = markdownBody?.querySelector(":scope > pre");
    expect(outerPre).toBeNull();

    const codeBlock = container.querySelector(".pmv-code-block");
    expect(codeBlock).not.toBeNull();

    // Verify there is only one pre tag inside the code block (inner pre), not nested <pre><div ...><pre>
    const allPres = container.querySelectorAll("pre");
    expect(allPres.length).toBe(1);
    expect(codeBlock?.contains(allPres[0])).toBe(true);
  });

  it("renders code block container with inner pre configured for horizontal scrolling", () => {
    const markdown = "```javascript\nfunction test() {\n  return 42;\n}\n```";
    const container = renderContent(markdown);

    const codeBlock = container.querySelector(".pmv-code-block");
    expect(codeBlock).not.toBeNull();

    const innerPre = codeBlock?.querySelector("pre");
    expect(innerPre).not.toBeNull();
    expect(innerPre?.style.overflowX).toBe("auto");
    expect(innerPre?.style.minWidth).toBe("0px");
    expect(innerPre?.style.maxWidth).toBe("100%");
  });

  it("renders fenced code blocks without language and with specified languages correctly as .pmv-code-block", () => {
    const markdownWithLang = "```csharp\npublic class Foo { }\n```";
    const markdownNoLang = "```\nplain text content\n```";

    const containerWithLang = renderContent(markdownWithLang);
    const codeBlockWithLang = containerWithLang.querySelector(".pmv-code-block");
    expect(codeBlockWithLang).not.toBeNull();
    expect(containerWithLang.querySelectorAll("pre").length).toBe(1);

    const containerNoLang = renderContent(markdownNoLang);
    const codeBlockNoLang = containerNoLang.querySelector(".pmv-code-block");
    expect(codeBlockNoLang).not.toBeNull();
    expect(containerNoLang.querySelectorAll("pre").length).toBe(1);
    expect(codeBlockNoLang?.textContent).toContain("plain text content");
  });

  // The Prism highlighter is behind a lazy import, so a fence with a language first
  // renders the unhighlighted fallback. The code has to be readable throughout -
  // that is the whole reason the fallback is the same <pre> the no-language branch
  // renders, rather than a spinner or nothing.
  it("shows the code before the lazy highlighter resolves and keeps it after", async () => {
    const source = "const answer = 42;";
    const container = renderContent("```typescript\n" + source + "\n```");

    const codeBlock = container.querySelector(".pmv-code-block");
    expect(codeBlock).not.toBeNull();
    expect(codeBlock?.textContent).toContain(source);
    expect(container.querySelectorAll("pre").length).toBe(1);

    // Once the chunk arrives, Prism splits the source across highlighted <span>s,
    // so the token count rises while the text content stays the same.
    await waitFor(
      () => {
        expect(container.querySelectorAll("pre span").length).toBeGreaterThan(0);
      },
      { timeout: HIGHLIGHTER_TIMEOUT_MS },
    );
    expect(container.querySelector(".pmv-code-block")?.textContent).toContain(source);
    expect(container.querySelectorAll("pre").length).toBe(1);
  });
});
