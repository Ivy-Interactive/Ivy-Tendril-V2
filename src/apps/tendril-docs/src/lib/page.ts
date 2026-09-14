/**
 * Turns one authored markdown file into the page model the UI and the search index consume.
 */
import { parseFrontmatter, type Frontmatter } from "./frontmatter";
import {
  isSectionIndex,
  routeForPath,
  segmentsOf,
  slugifyHeading,
  titleFromName,
} from "./slug";

export interface Heading {
  /** Heading depth, 1-6. */
  depth: number;
  text: string;
  /** Anchor id, produced with the same algorithm `rehype-slug` uses. */
  id: string;
}

export interface DocPage {
  /** Content-relative source path, e.g. `01_GettingStarted/02_Installation.md`. */
  contentPath: string;
  route: string;
  title: string;
  description?: string;
  icon?: string;
  searchHints: string[];
  /** Whether this page is a section's `_Index.md`. */
  isIndex: boolean;
  headings: Heading[];
  /** Markdown body with the frontmatter removed. */
  body: string;
  frontmatter: Frontmatter;
}

/**
 * Iterates the lines of a markdown body, reporting which ones are inside a fenced code block.
 *
 * Fence detection has to be shared by heading extraction and link rewriting: a `#` or a `](…)`
 * inside a fence is sample text, not markup.
 */
export function forEachLine(
  body: string,
  visit: (line: string, index: number, inFence: boolean) => void,
): void {
  const lines = body.split("\n");
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence === null) {
      if (fenceMatch) {
        fence = fenceMatch[1][0].repeat(fenceMatch[1].length);
        visit(line, index, true);
        continue;
      }
      visit(line, index, false);
    } else {
      const closes =
        fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length;
      visit(line, index, true);
      if (closes && fenceMatch[2].trim() === "") {
        fence = null;
      }
    }
  }
}

/** Strips the inline markdown a heading may contain so the anchor slug matches the rendered text. */
function headingText(raw: string): string {
  return raw
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/\s+#+\s*$/, "")
    .trim();
}

/** Extracts every ATX heading outside fenced code blocks, in document order. */
export function extractHeadings(body: string): Heading[] {
  const headings: Heading[] = [];
  const seen = new Map<string, number>();
  forEachLine(body, (line, _index, inFence) => {
    if (inFence) return;
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!match) return;
    const text = headingText(match[2]);
    if (text.length === 0) return;
    const base = slugifyHeading(text);
    // github-slugger de-duplicates repeated headings by appending -1, -2, …; mirror that.
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    headings.push({ depth: match[1].length, text, id: count === 0 ? base : `${base}-${count}` });
  });
  return headings;
}

/**
 * Splits a leading `# ` heading off a body.
 *
 * The page header is rendered from the page model (title, then the `description` lead paragraph, then
 * the prose), so the `# ` heading the file opens with would otherwise appear twice — or, worse, below
 * its own lead paragraph. Anything that is not a level-1 heading on the first non-blank line is left
 * alone.
 */
export function splitLeadHeading(body: string): { heading?: string; rest: string } {
  const lines = body.split("\n");
  let index = 0;
  while (index < lines.length && lines[index].trim() === "") index += 1;
  const match = index < lines.length ? /^#\s+(.*)$/.exec(lines[index]) : null;
  if (!match) return { rest: body };
  return { heading: headingText(match[1]), rest: lines.slice(index + 1).join("\n") };
}

/** Parses one markdown file into a {@link DocPage}. */
export function parsePage(contentPath: string, raw: string): DocPage {
  const { data, body } = parseFrontmatter(raw, contentPath);
  const headings = extractHeadings(body);
  const segments = segmentsOf(contentPath);
  const fileName = segments[segments.length - 1];
  const isIndex = isSectionIndex(contentPath);
  const nameForFallback = isIndex ? (segments[segments.length - 2] ?? fileName) : fileName;

  const firstHeading = headings.find((heading) => heading.depth === 1);
  const title = data.title ?? firstHeading?.text ?? titleFromName(nameForFallback);

  return {
    contentPath,
    route: routeForPath(contentPath),
    title,
    description: data.description,
    icon: data.icon,
    searchHints: data.searchHints ?? [],
    isIndex,
    headings,
    body,
    frontmatter: data,
  };
}

/** Parses a whole `path -> raw markdown` record, keyed by content-relative path. */
export function parsePages(files: Record<string, string>): Map<string, DocPage> {
  const pages = new Map<string, DocPage>();
  for (const [contentPath, raw] of Object.entries(files)) {
    pages.set(contentPath, parsePage(contentPath, raw));
  }
  return pages;
}
