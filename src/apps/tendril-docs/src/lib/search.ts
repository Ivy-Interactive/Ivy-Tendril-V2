/**
 * Full-text search over the authored content.
 *
 * This module is only ever reached through a dynamic `import("./lib/search")` from `SearchDialog`, so
 * MiniSearch and the index it builds stay out of the initial bundle — the first paint of a docs page
 * should not pay for a feature behind `⌘K`.
 */
import MiniSearch, { type SearchResult } from "minisearch";
import { forEachLine, type DocPage } from "./page";
import { segmentsOf, titleFromName } from "./slug";

/** One indexed page. `id` is the route, which is also what a hit navigates to. */
export interface SearchDocument {
  id: string;
  route: string;
  title: string;
  /** Title of the section the page belongs to, shown as the group heading in the dialog. */
  section: string;
  description: string;
  /** Frontmatter `searchHints`, joined — terms a reader might use that the prose never says. */
  hints: string;
  headings: string;
  body: string;
}

export interface SearchHit {
  route: string;
  title: string;
  section: string;
  /** Short excerpt around the first match, or the page description when the title matched. */
  snippet: string;
  score: number;
}

export interface DocsSearchIndex {
  /** One document per page. */
  readonly documentCount: number;
  search(query: string, limit?: number): SearchHit[];
}

const SEARCH_FIELDS = ["title", "hints", "headings", "description", "body"] as const;

/**
 * Reduces a markdown body to prose.
 *
 * Fenced code blocks go entirely: indexing them makes every page match `let`, `const` and `pnpm`,
 * which buries the page that actually explains the command.
 */
export function plainText(body: string): string {
  const lines: string[] = [];
  forEachLine(body, (line, _index, inFence) => {
    if (inFence) return;
    lines.push(line);
  });

  return lines
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?\[![A-Z]+\]\s*/gim, "")
    .replace(/^\s{0,3}[>*+-]\s+/gm, "")
    .replace(/^\s{0,3}\|/gm, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Title of the top-level section a content path belongs to. */
function sectionTitleOf(contentPath: string): string {
  const [section] = segmentsOf(contentPath);
  return section ? titleFromName(section) : "";
}

/** Turns a page into its indexable document. */
export function toSearchDocument(page: DocPage): SearchDocument {
  return {
    id: page.route,
    route: page.route,
    title: page.title,
    section: sectionTitleOf(page.contentPath),
    description: page.description ?? "",
    hints: page.searchHints.join(" "),
    headings: page.headings.map((heading) => heading.text).join(" "),
    body: plainText(page.body),
  };
}

/** Excerpt of `text` around the first occurrence of any query term. */
function snippetFor(text: string, terms: string[], length = 140): string {
  if (text.length === 0) return "";
  const lowered = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lowered.indexOf(term.toLowerCase());
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) return text.slice(0, length).trimEnd() + (text.length > length ? "…" : "");

  const start = Math.max(0, at - Math.floor(length / 3));
  const end = Math.min(text.length, start + length);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Builds the index.
 *
 * `title` and `hints` are boosted so an exact page name always outranks a passing mention, and
 * matching is prefix + fuzzy so `worktre` and `worktree` both find the Onboarding page.
 */
export function buildSearchIndex(pages: Iterable<DocPage>): DocsSearchIndex {
  const documents = [...pages].map(toSearchDocument);
  const byId = new Map(documents.map((document) => [document.id, document]));

  const miniSearch = new MiniSearch<SearchDocument>({
    fields: [...SEARCH_FIELDS],
    storeFields: ["route", "title", "section", "description"],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      boost: { title: 4, hints: 3, headings: 2 },
      combineWith: "AND",
    },
  });
  miniSearch.addAll(documents);

  return {
    documentCount: documents.length,
    search(query: string, limit = 20): SearchHit[] {
      const trimmed = query.trim();
      if (trimmed.length === 0) return [];

      const results: SearchResult[] = miniSearch.search(trimmed);
      return results.slice(0, limit).map((result) => {
        const document = byId.get(result.id as string);
        const terms = result.terms.length > 0 ? result.terms : [trimmed];
        const haystack = document ? `${document.description} ${document.body}`.trim() : "";
        return {
          route: (result.route as string) ?? (result.id as string),
          title: (result.title as string) ?? "",
          section: (result.section as string) ?? "",
          snippet: snippetFor(haystack, terms),
          score: result.score,
        };
      });
    },
  };
}
