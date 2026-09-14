import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";
import {
  extractTextContent,
  parseGitHubAlert,
  githubAlertStyles,
  type GitHubAlertType,
} from "./markdown-utils";

const markup = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

describe("extractTextContent", () => {
  it("returns plain strings unchanged", () => {
    expect(extractTextContent("plain string")).toBe("plain string");
  });

  it("converts numbers to strings", () => {
    expect(extractTextContent(0)).toBe("0");
    expect(extractTextContent(42)).toBe("42");
  });

  it("returns empty string for falsy values", () => {
    expect(extractTextContent(false)).toBe("");
    expect(extractTextContent(null)).toBe("");
    expect(extractTextContent(undefined)).toBe("");
  });

  it("joins arrays with no separator", () => {
    expect(extractTextContent(["a", "b", "c"])).toBe("abc");
  });

  it("handles mixed arrays with falsy values and elements", () => {
    expect(extractTextContent(["a", 0, false, null, <em key="e">b</em>])).toBe("a0b");
  });

  it("extracts text from single elements", () => {
    expect(extractTextContent(<span>hi</span>)).toBe("hi");
  });

  it("extracts text from nested elements", () => {
    expect(
      extractTextContent(
        <div>
          <span>a</span>
          <b>b</b>
        </div>,
      ),
    ).toBe("ab");
  });

  it("returns empty string for elements with no children", () => {
    expect(extractTextContent(<span />)).toBe("");
  });

  it("extracts text from fragments", () => {
    expect(
      extractTextContent(
        <>
          {"a"}
          {"b"}
        </>,
      ),
    ).toBe("ab");
  });
});

describe("parseGitHubAlert", () => {
  const types: GitHubAlertType[] = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];

  types.forEach((type) => {
    it(`parses [!${type}] marker`, () => {
      const result = parseGitHubAlert(<p>{`[!${type}]\nBody text`}</p>);
      expect(result).not.toBeNull();
      expect(result!.type).toBe(type);
      expect(markup(result!.content)).toBe("<p>Body text</p>");
    });
  });

  it("skips leading whitespace text nodes", () => {
    const result = parseGitHubAlert(["\n", <p key="p">{"[!TIP]\nBody"}</p>, "\n"]);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("TIP");
    expect(markup(result!.content)).toBe("<p>Body</p>");
  });

  it("returns null for plain blockquotes", () => {
    expect(parseGitHubAlert(<p>Just a quote</p>)).toBeNull();
  });

  it("returns null when there are no element children", () => {
    expect(parseGitHubAlert(null)).toBeNull();
    expect(parseGitHubAlert(["\n"])).toBeNull();
  });

  it("returns null for case-sensitive marker mismatches", () => {
    expect(parseGitHubAlert(<p>{"[!note]\nBody"}</p>)).toBeNull();
    expect(parseGitHubAlert(<p>{"[!HINT]\nBody"}</p>)).toBeNull();
  });

  it("strips marker-only first paragraph", () => {
    const result = parseGitHubAlert([<p key="a">{"[!WARNING]"}</p>, <p key="b">Body</p>]);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("WARNING");
    expect(markup(result!.content)).toBe("<p>Body</p>");
    expect(markup(result!.content)).not.toContain("[!WARNING]");
  });

  it("returns null content for marker-only alerts", () => {
    const result = parseGitHubAlert([<p key="a">{"[!NOTE]"}</p>]);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("NOTE");
    expect(result!.content).toBeNull();
  });

  it("preserves multiple paragraphs after marker", () => {
    const result = parseGitHubAlert([<p key="a">{"[!TIP]\nFirst"}</p>, <p key="b">Second</p>]);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("TIP");
    expect(markup(result!.content)).toBe("<p>First</p><p>Second</p>");
  });

  it("preserves inline elements after marker", () => {
    const result = parseGitHubAlert(
      <p>
        {"[!NOTE]\n"}
        <strong>bold</strong>
        {" rest"}
      </p>,
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("NOTE");
    expect(markup(result!.content)).toBe("<p><strong>bold</strong> rest</p>");
  });

  it("does not strip marker when nested in an element", () => {
    // Current behaviour: if the marker is inside a child element (not a direct text node),
    // stripAlertMarker returns children untouched. This is lenient divergence from GitHub.
    // If this is tightened in the future, update this test.
    const result = parseGitHubAlert(
      <p>
        <strong>{"[!NOTE]"}</strong>
        {" body"}
      </p>,
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("NOTE");
    const content = markup(result!.content);
    expect(content).toContain("[!NOTE]");
    expect(content).toContain("body");
  });
});

describe("githubAlertStyles", () => {
  const types: GitHubAlertType[] = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];

  types.forEach((type) => {
    it(`has complete config for ${type}`, () => {
      const style = githubAlertStyles[type];
      expect(style).toBeDefined();
      expect(style.title).toBeTruthy();
      expect(style.className).toBeTruthy();
      expect(style.icon in icons).toBe(true);
    });
  });
});
