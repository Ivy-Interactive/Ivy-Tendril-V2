/**
 * The navigation tree is derived from `content/`, so this test derives the same thing independently
 * (with `node:fs`) and demands a bijection. A stray file, a missing file or a renamed section fails
 * here rather than rendering a half-navigable site.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NavStructureError,
  buildNavTree,
  flattenNavContentPaths,
  flattenNavRoutes,
  type NavSection,
} from "../src/lib/nav";
import { isSectionIndex, routeForPath } from "../src/lib/slug";
import { absoluteContentPath, readContent } from "./helpers";

const files = readContent();
const tree = buildNavTree(files);

function everySection(sections: NavSection[]): NavSection[] {
  return sections.flatMap((section) => [section, ...everySection(section.sections)]);
}

describe("buildNavTree", () => {
  it("has the two authored sections, in numeric order", () => {
    expect(tree.map((section) => section.name)).toEqual(["01_GettingStarted", "02_Concepts"]);
    expect(tree.map((section) => section.title)).toEqual(["Getting Started", "Concepts"]);
    expect(tree.map((section) => section.route)).toEqual([
      "/docs/gettingstarted",
      "/docs/concepts",
    ]);
  });

  it("lists the Getting Started pages in 01…06 order", () => {
    const [gettingStarted] = tree;
    expect(gettingStarted.pages.map((page) => page.contentPath)).toEqual([
      "01_GettingStarted/01_Introduction.md",
      "01_GettingStarted/02_Installation.md",
      "01_GettingStarted/03_Onboarding.md",
      "01_GettingStarted/04_Tutorial.md",
      "01_GettingStarted/05_GettingHelp.md",
      "01_GettingStarted/06_Troubleshooting.md",
    ]);
    expect(gettingStarted.pages).toHaveLength(6);
    expect(gettingStarted.sections).toEqual([]);
  });

  it("lists the three Concepts pages in order", () => {
    const concepts = tree[1];
    expect(concepts.pages.map((page) => page.contentPath)).toEqual([
      "02_Concepts/01_Plans.md",
      "02_Concepts/02_Promptwares.md",
      "02_Concepts/03_Lifecycle.md",
    ]);
    expect(concepts.pages).toHaveLength(3);
    expect(concepts.sections).toEqual([]);
  });

  it("maps every on-disk markdown file to exactly one node, and back", () => {
    const inTree = flattenNavContentPaths(tree);
    expect(new Set(inTree).size).toBe(inTree.length);
    expect([...inTree].sort()).toEqual(Object.keys(files).sort());

    for (const contentPath of inTree) {
      expect(existsSync(absoluteContentPath(contentPath)), contentPath).toBe(true);
    }
  });

  it("gives every section its own _Index.md page", () => {
    const sections = everySection(tree);
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(isSectionIndex(section.contentPath), section.name).toBe(true);
      expect(existsSync(absoluteContentPath(section.contentPath))).toBe(true);
      expect(section.route).toBe(routeForPath(section.contentPath));
      expect(section.title.length).toBeGreaterThan(0);
    }
  });

  it("expands both authored sections in the sidebar", () => {
    for (const section of tree) {
      expect(section.groupExpanded, section.name).toBe(true);
      expect(section.icon, section.name).toBeTruthy();
    }
  });

  it("flattens to a unique route per page, section index first", () => {
    const routes = flattenNavRoutes(tree);
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes[0]).toBe("/docs/gettingstarted");
    expect(routes).toContain("/docs/concepts/lifecycle");
    expect(routes).toHaveLength(Object.keys(files).length);
  });

  it("supports nested sub-sections", () => {
    const nested = buildNavTree({
      "01_Guides/_Index.md": "---\ntitle: Guides\n---\n\n# Guides\n",
      "01_Guides/01_First.md": "# First\n",
      "01_Guides/02_Deeper/_Index.md": "# Deeper\n",
      "01_Guides/02_Deeper/01_Inner.md": "# Inner\n",
    });
    expect(nested).toHaveLength(1);
    expect(nested[0].sections.map((section) => section.route)).toEqual(["/docs/guides/deeper"]);
    expect(flattenNavRoutes(nested)).toEqual([
      "/docs/guides",
      "/docs/guides/first",
      "/docs/guides/deeper",
      "/docs/guides/deeper/inner",
    ]);
  });

  it("throws for a section folder without an _Index.md", () => {
    expect(() =>
      buildNavTree({
        "01_GettingStarted/_Index.md": "# Getting Started\n",
        "02_Concepts/01_Plans.md": "# Plans\n",
      }),
    ).toThrow(NavStructureError);
  });

  it("throws for a markdown file sitting directly in content/", () => {
    expect(() =>
      buildNavTree({
        "README.md": "# Stray\n",
        "01_GettingStarted/_Index.md": "# Getting Started\n",
      }),
    ).toThrow(NavStructureError);
  });
});
