import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFrontmatter } from "../src/lib/frontmatter";
import { parsePage } from "../src/lib/page";
import { readContent } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseFrontmatter", () => {
  it("parses the recognised keys", () => {
    const { data, body } = parseFrontmatter(
      [
        "---",
        "title: Installation",
        "description: How to install Tendril.",
        "icon: Download",
        "searchHints:",
        "  - install",
        "  - setup",
        "groupExpanded: true",
        "---",
        "",
        "# Installation",
        "",
        "Body text.",
      ].join("\n"),
    );

    expect(data.title).toBe("Installation");
    expect(data.description).toBe("How to install Tendril.");
    expect(data.icon).toBe("Download");
    expect(data.searchHints).toEqual(["install", "setup"]);
    expect(data.groupExpanded).toBe(true);
    expect(data.extra).toEqual({});
    expect(body).toBe("\n# Installation\n\nBody text.");
  });

  it("treats a page with no frontmatter as body-only", () => {
    const { data, body } = parseFrontmatter("# Installation\n\nBody text.\n");
    expect(data).toEqual({ extra: {} });
    expect(body).toBe("# Installation\n\nBody text.\n");
  });

  it("degrades to no frontmatter when the YAML is malformed, without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { data, body } = parseFrontmatter(
      '---\ntitle: "unterminated\ndescription: [1, 2\n---\n\n# Still renders\n',
      "01_GettingStarted/02_Installation.md",
    );

    expect(data).toEqual({ extra: {} });
    expect(body).toBe("\n# Still renders\n");
    expect(warn).toHaveBeenCalled();
  });

  it("keeps unknown keys in extra rather than failing", () => {
    const { data } = parseFrontmatter("---\ntitle: T\nweight: 3\ndraft: true\n---\n\nBody\n");
    expect(data.title).toBe("T");
    expect(data.extra).toEqual({ weight: 3, draft: true });
  });

  it("ignores values of the wrong type", () => {
    const { data } = parseFrontmatter(
      "---\ntitle: 42\nsearchHints: nope\ngroupExpanded: yes-please\n---\n\nBody\n",
    );
    expect(data.title).toBeUndefined();
    expect(data.searchHints).toBeUndefined();
    expect(data.groupExpanded).toBeUndefined();
  });

  it("tolerates a frontmatter block with an empty body", () => {
    const { data, body } = parseFrontmatter("---\ntitle: Empty\n---");
    expect(data.title).toBe("Empty");
    expect(body).toBe("");
  });

  it("only honours a block at the very top of the file", () => {
    const { data, body } = parseFrontmatter("Intro\n\n---\ntitle: Nope\n---\n");
    expect(data.title).toBeUndefined();
    expect(body).toBe("Intro\n\n---\ntitle: Nope\n---\n");
  });
});

describe("authored pages", () => {
  const files = readContent();

  it("all carry a title, a description and a known-looking icon", () => {
    for (const [contentPath, raw] of Object.entries(files)) {
      const page = parsePage(contentPath, raw);
      expect(page.frontmatter.title, contentPath).toBeTruthy();
      expect(page.frontmatter.description, contentPath).toBeTruthy();
      expect(page.frontmatter.icon, contentPath).toMatch(/^[A-Z][A-Za-z0-9]*$/);
      expect(page.searchHints.length, contentPath).toBeGreaterThan(0);
    }
  });

  it("open with a `# ` heading matching the frontmatter title", () => {
    for (const [contentPath, raw] of Object.entries(files)) {
      const page = parsePage(contentPath, raw);
      const first = page.headings[0];
      expect(first?.depth, contentPath).toBe(1);
      expect(first?.text, contentPath).toBe(page.title);
    }
  });

  it("set groupExpanded on section indexes only", () => {
    for (const [contentPath, raw] of Object.entries(files)) {
      const page = parsePage(contentPath, raw);
      if (page.isIndex) continue;
      expect(page.frontmatter.groupExpanded, contentPath).toBeUndefined();
    }
  });
});
