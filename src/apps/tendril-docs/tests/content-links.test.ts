/**
 * The internal-link gate.
 *
 * Every relative target in every authored page has to resolve to a file that exists, and every
 * fragment has to match a heading that will actually carry that id in the DOM. Absolute `http(s)` and
 * `mailto:` targets are skipped — `lychee` (via the root `check:links` script and the CI `link-check`
 * job) owns those.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isExternalTarget, resolveContentPath } from "../src/lib/links";
import { extractHeadings, forEachLine, splitLeadHeading } from "../src/lib/page";
import { parseFrontmatter } from "../src/lib/frontmatter";
import { ROUTE_BASE } from "../src/lib/slug";
import { absoluteContentPath, readContent } from "./helpers";

interface LinkRef {
  /** File the link was written in. */
  from: string;
  /** Raw target exactly as authored. */
  target: string;
  isImage: boolean;
  line: number;
}

const INLINE_TARGET = /(!?)\[(?:[^[\]\\]|\\.)*\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g;
const REFERENCE_DEFINITION = /^\s{0,3}\[(?:[^[\]\\]|\\.)+\]:\s*(\S+)/;

/** Splits out inline-code spans, which are sample text rather than markup. */
function withoutInlineCode(line: string): string {
  return line
    .split(/(`+[^`]*`+)/)
    .map((part, index) => (index % 2 === 1 ? "" : part))
    .join("");
}

function collectLinks(contentPath: string, raw: string): LinkRef[] {
  const { body } = parseFrontmatter(raw, contentPath);
  const links: LinkRef[] = [];
  forEachLine(body, (rawLine, index, inFence) => {
    if (inFence) return;
    const line = withoutInlineCode(rawLine);

    const definition = REFERENCE_DEFINITION.exec(line);
    if (definition) {
      links.push({ from: contentPath, target: definition[1], isImage: false, line: index + 1 });
      return;
    }

    for (const match of line.matchAll(INLINE_TARGET)) {
      links.push({
        from: contentPath,
        target: match[2],
        isImage: match[1] === "!",
        line: index + 1,
      });
    }
  });
  return links;
}

/**
 * Every anchor id the rendered page will carry.
 *
 * `DocPage` renders the title as `<h1 id="top">` and strips the file's own `# ` heading from the body,
 * so the ids come from the remaining headings — the same set `rehype-slug` produces.
 */
function anchorsOf(raw: string, contentPath: string): Set<string> {
  const { body } = parseFrontmatter(raw, contentPath);
  const ids = extractHeadings(splitLeadHeading(body).rest).map((heading) => heading.id);
  return new Set(["top", ...ids]);
}

const files = readContent();
const links = Object.entries(files).flatMap(([contentPath, raw]) => collectLinks(contentPath, raw));

function where(link: LinkRef): string {
  return `${link.from}:${link.line} -> ${link.target}`;
}

describe("authored links", () => {
  it("finds links to check", () => {
    expect(Object.keys(files).length).toBeGreaterThan(0);
    expect(links.length).toBeGreaterThan(10);
  });

  it("never hard-codes an absolute docs route", () => {
    const absolute = links.filter((link) => link.target.startsWith(`${ROUTE_BASE}/`));
    expect(
      absolute.map(where),
      `Link to a page with a relative .md path, not a ${ROUTE_BASE}/ route — that is what lets lychee ` +
        `validate it and what keeps the URL scheme changeable.`,
    ).toEqual([]);
  });

  it("never points at a file outside content/", () => {
    const escaping = links
      .filter((link) => !isExternalTarget(link.target) && !link.target.startsWith("#"))
      .filter((link) => resolveContentPath(link.from, link.target.split("#")[0]).startsWith(".."));
    expect(escaping.map(where)).toEqual([]);
  });

  it("resolves every relative .md target to a file that exists", () => {
    const targets = links.filter(
      (link) => !link.isImage && !isExternalTarget(link.target) && !link.target.startsWith("#"),
    );
    expect(targets.length).toBeGreaterThan(10);

    const broken = targets.filter((link) => {
      const [pathPart] = link.target.split("#");
      if (!/\.md$/i.test(pathPart)) return false;
      return !existsSync(absoluteContentPath(resolveContentPath(link.from, pathPart)));
    });
    expect(broken.map(where)).toEqual([]);
  });

  it("resolves every fragment to a heading in the target page", () => {
    const anchorCache = new Map<string, Set<string>>();
    const anchorsFor = (contentPath: string): Set<string> | undefined => {
      if (!anchorCache.has(contentPath)) {
        const raw = files[contentPath];
        if (raw === undefined) return undefined;
        anchorCache.set(contentPath, anchorsOf(raw, contentPath));
      }
      return anchorCache.get(contentPath);
    };

    const broken: string[] = [];
    for (const link of links) {
      if (isExternalTarget(link.target)) continue;
      const hashIndex = link.target.indexOf("#");
      if (hashIndex < 0) continue;

      const fragment = link.target.slice(hashIndex + 1);
      if (fragment.length === 0) continue;

      const pathPart = link.target.slice(0, hashIndex);
      const targetPath =
        pathPart.length === 0 ? link.from : resolveContentPath(link.from, pathPart);
      if (!/\.md$/i.test(targetPath)) continue;

      const anchors = anchorsFor(targetPath);
      if (!anchors) {
        broken.push(`${where(link)} (no such page)`);
        continue;
      }
      if (!anchors.has(fragment)) {
        broken.push(`${where(link)} (no heading with id "${fragment}")`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("resolves every image target under content/assets/", () => {
    const images = links.filter((link) => link.isImage && !isExternalTarget(link.target));
    for (const image of images) {
      const resolved = resolveContentPath(image.from, image.target.split("#")[0]);
      expect(resolved.startsWith("assets/"), where(image)).toBe(true);
      expect(existsSync(absoluteContentPath(resolved)), where(image)).toBe(true);
    }
  });
});
