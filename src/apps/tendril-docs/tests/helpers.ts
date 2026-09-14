/**
 * Shared test helpers.
 *
 * The content-driven tests read `content/` with `node:fs` rather than `import.meta.glob`, on purpose:
 * the point of `nav-structure.test.ts` and `content-links.test.ts` is to compare the site's own view
 * of the folder against the folder itself, so both views have to be produced independently.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readContentFiles } from "../src/plugins/emit-route-shells";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the authored content directory. */
export const CONTENT_DIR = path.resolve(here, "../content");

/** `content-relative path -> markdown source` for every authored page, read from disk. */
export function readContent(): Record<string, string> {
  return readContentFiles(CONTENT_DIR);
}

/** Absolute path of a content-relative path. */
export function absoluteContentPath(contentPath: string): string {
  return path.join(CONTENT_DIR, contentPath);
}
