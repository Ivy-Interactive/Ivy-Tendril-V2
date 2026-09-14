/**
 * Intra-doc link handling.
 *
 * Authored content only ever writes **relative `.md` paths** (`../02_Concepts/02_Promptwares.md`,
 * `04_Tutorial.md#step-2`, `_Index.md`) — never a bare route such as `/docs/concepts/plans`. That
 * single rule buys two things at once: `lychee` can validate the links against the file system with
 * the config the repo already has, and the site is free to change its URL scheme without a content
 * migration.
 *
 * At render time {@link rewriteDocLinks} turns those paths into real routes *in the markdown source*,
 * before `MarkdownRenderer` sees them, so the anchor that reaches the DOM already carries the final
 * `href` (good for hover, middle-click and copy-link). {@link rewriteDocLink} is the pure per-href
 * function behind it and is reused by the click handler as a safety net.
 */
import { forEachLine } from "./page";
import { normalizeRoute, routeForPath, segmentsOf } from "./slug";

export type DocLinkKind = "route" | "anchor" | "external" | "asset" | "unresolved";

export interface RewrittenLink {
  href: string;
  kind: DocLinkKind;
}

/** Resolves a source-relative href against the file it appears in, collapsing `.` and `..`. */
export function resolveContentPath(fromContentPath: string, href: string): string {
  const from = segmentsOf(fromContentPath).slice(0, -1);
  const target = href.replace(/\\/g, "/").split("/");
  const out = [...from];
  for (const segment of target) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/** True for a target the browser (or lychee) owns: absolute URL, protocol-relative, or mailto. */
export function isExternalTarget(href: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
}

/**
 * Rewrites one authored href.
 *
 * - `http(s)://…`, `mailto:…`, `plan://…`  -> unchanged (`external`)
 * - `#anchor`                              -> unchanged (`anchor`)
 * - `../02_Concepts/01_Plans.md#states`    -> `/docs/concepts/plans#states` (`route`)
 * - `../assets/diagram.png`                -> whatever `resolveAsset` returns (`asset`)
 *
 * `resolveAsset` is the bundler's view of `content/assets/**` (see `content.ts`). An asset it does
 * not know about comes back `unresolved` with the href untouched, so a typo shows as a broken image
 * rather than crashing the page — `tests/content-links.test.ts` is what actually fails on it.
 */
export function rewriteDocLink(
  href: string,
  fromContentPath: string,
  resolveAsset?: (contentPath: string) => string | undefined,
): RewrittenLink {
  const trimmed = href.trim();
  if (trimmed.length === 0) return { href, kind: "unresolved" };
  if (trimmed.startsWith("#")) return { href: trimmed, kind: "anchor" };
  if (isExternalTarget(trimmed)) return { href: trimmed, kind: "external" };

  const hashIndex = trimmed.indexOf("#");
  const path = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const hash = hashIndex >= 0 ? trimmed.slice(hashIndex) : "";

  if (/\.md$/i.test(path)) {
    return { href: `${routeForPath(resolveContentPath(fromContentPath, path))}${hash}`, kind: "route" };
  }

  const resolved = resolveAsset?.(resolveContentPath(fromContentPath, path));
  if (resolved) {
    return { href: `${resolved}${hash}`, kind: "asset" };
  }
  return { href: trimmed, kind: "unresolved" };
}

/**
 * Splits a line into alternating "outside inline code" / "inside inline code" chunks, so a
 * ``[link](target)`` written inside backticks is left alone.
 */
function outsideInlineCode(line: string, transform: (chunk: string) => string): string {
  const parts = line.split(/(`+[^`]*`+)/);
  return parts.map((part, index) => (index % 2 === 1 ? part : transform(part))).join("");
}

const INLINE_TARGET = /(!?\[(?:[^[\]\\]|\\.)*\]\()([^()\s]+)((?:\s+"[^"]*")?\))/g;
const REFERENCE_DEFINITION = /^(\s{0,3}\[(?:[^[\]\\]|\\.)+\]:\s*)(\S+)(.*)$/;

/**
 * Rewrites every authored link and image target in a markdown body to its final URL.
 *
 * Fenced code blocks and inline code spans are skipped: a `.md` path inside a fence is sample text
 * that must render exactly as written.
 */
export function rewriteDocLinks(
  body: string,
  fromContentPath: string,
  resolveAsset?: (contentPath: string) => string | undefined,
): string {
  const rewriteTarget = (target: string) =>
    rewriteDocLink(target, fromContentPath, resolveAsset).href;

  const out: string[] = [];
  forEachLine(body, (line, _index, inFence) => {
    if (inFence) {
      out.push(line);
      return;
    }
    out.push(
      outsideInlineCode(line, (chunk) => {
        const definition = REFERENCE_DEFINITION.exec(chunk);
        if (definition) {
          return `${definition[1]}${rewriteTarget(definition[2])}${definition[3]}`;
        }
        return chunk.replace(
          INLINE_TARGET,
          (_match, open: string, target: string, close: string) =>
            `${open}${rewriteTarget(target)}${close}`,
        );
      }),
    );
  });
  return out.join("\n");
}

/**
 * True when `href` is a route this site serves, i.e. one the router should handle in-page instead of
 * letting the browser reload.
 */
export function isInternalRoute(href: string, knownRoutes: Iterable<string>): boolean {
  const route = normalizeRoute(href);
  for (const known of knownRoutes) {
    if (known === route) return true;
  }
  return false;
}
