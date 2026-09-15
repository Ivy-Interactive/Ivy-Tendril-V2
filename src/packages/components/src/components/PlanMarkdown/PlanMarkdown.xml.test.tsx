import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PlanMarkdown as DraftMarkdown } from "./PlanMarkdown";

const renderContent = (content: string) => {
  const { container } = render(<DraftMarkdown id="w1" content={content} />);
  return container;
};

// The Prism highlighter loads through a dynamic import, so `.token` elements only
// appear once its chunk resolves - the first paint is the unhighlighted fallback.
// The assertions are unchanged, they just have to wait for it.
//
// That chunk is react-syntax-highlighter plus refractor, transformed on demand the first time any
// suite reaches it. Under a full-suite run that takes well over `waitFor`'s 1s default, so these
// waits get an allowance sized for a cold transform rather than a warm cache.
const HIGHLIGHTER_TIMEOUT_MS = 15_000;

describe("DraftMarkdown XML syntax highlighting", () => {
  it("renders XML code blocks with Prism syntax highlighting elements", async () => {
    const xmlContent = '```xml\n<note id="1">\n  <to>Tove</to>\n  <from>Jani</from>\n</note>\n```';
    const container = renderContent(xmlContent);

    const codeBlock = container.querySelector(".pmv-code-block");
    expect(codeBlock).not.toBeNull();

    await waitFor(
      () => {
        expect(container.querySelectorAll(".token").length).toBeGreaterThan(0);
      },
      { timeout: HIGHLIGHTER_TIMEOUT_MS },
    );

    const textContent = container.textContent || "";
    expect(textContent).toContain('<note id="1">');
    expect(textContent).toContain("<to>Tove</to>");
  });

  it("renders html, svg, and markup code blocks with syntax highlighting", async () => {
    const htmlContent = '```html\n<div class="container">\n  <p>Hello World</p>\n</div>\n```';
    const container = renderContent(htmlContent);

    expect(container.querySelector(".pmv-code-block")).not.toBeNull();
    await waitFor(
      () => {
        expect(container.querySelectorAll(".token").length).toBeGreaterThan(0);
      },
      { timeout: HIGHLIGHTER_TIMEOUT_MS },
    );
  });
});
