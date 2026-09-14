import { describe, expect, it } from "vitest";
import { parsePages } from "../src/lib/page";
import { buildSearchIndex, plainText, toSearchDocument } from "../src/lib/search";
import { readContent } from "./helpers";

const files = readContent();
const pages = [...parsePages(files).values()];
const index = buildSearchIndex(pages);

describe("buildSearchIndex", () => {
  it("indexes one document per page", () => {
    expect(pages.length).toBeGreaterThan(0);
    expect(index.documentCount).toBe(pages.length);
  });

  it("returns nothing for an empty query", () => {
    expect(index.search("")).toEqual([]);
    expect(index.search("   ")).toEqual([]);
  });

  it("finds the Onboarding page for `worktree`", () => {
    const hits = index.search("worktree");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].route).toBe("/docs/gettingstarted/onboarding");
    expect(hits[0].title).toBe("Onboarding a Codebase");
    expect(hits[0].section).toBe("Getting Started");
    expect(hits[0].snippet.length).toBeGreaterThan(0);
  });

  it("finds a page by a searchHints term the prose never uses", () => {
    // Every page's hints exist precisely to catch words the page itself does not say, so pick one
    // that appears in no other indexed field and prove the index still routes it home.
    const candidates = pages.flatMap((page) => {
      const document = toSearchDocument(page);
      const searchable =
        `${document.title} ${document.description} ${document.headings} ${document.body}`.toLowerCase();
      return page.searchHints
        .filter((hint) => !searchable.includes(hint.toLowerCase()))
        .map((hint) => ({ hint, route: page.route }));
    });

    expect(candidates.length).toBeGreaterThan(0);
    for (const { hint, route } of candidates) {
      const hits = index.search(hint);
      expect(
        hits.map((hit) => hit.route),
        `searchHints entry "${hint}" should reach ${route}`,
      ).toContain(route);
    }
  });

  it("tolerates a typo", () => {
    expect(index.search("worktre").map((hit) => hit.route)).toContain(
      "/docs/gettingstarted/onboarding",
    );
  });

  it("honours the limit", () => {
    expect(index.search("tendril", 2).length).toBeLessThanOrEqual(2);
  });

  it("returns nothing for a term no page contains", () => {
    expect(index.search("zzzquux")).toEqual([]);
  });
});

describe("plainText", () => {
  it("drops fenced code so every page does not match a shell builtin", () => {
    const text = plainText(
      [
        "Install it:",
        "",
        "```bash",
        "pnpm install --frozen-lockfile",
        "```",
        "",
        "Then run it.",
      ].join("\n"),
    );
    expect(text).toBe("Install it: Then run it.");
  });

  it("strips markup but keeps the words", () => {
    const text = plainText(
      [
        "## Plan states",
        "",
        "> [!NOTE]",
        "> A **plan** is a `folder` with [revisions](01_Plans.md).",
        "",
        "| State | Meaning |",
        "| --- | --- |",
        "| Draft | Initial |",
      ].join("\n"),
    );
    expect(text).toContain("Plan states");
    expect(text).toContain("A plan is a folder with revisions.");
    expect(text).toContain("Draft");
    expect(text).not.toContain("[!NOTE]");
    expect(text).not.toContain("**");
  });
});
