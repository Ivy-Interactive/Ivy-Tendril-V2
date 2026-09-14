/**
 * Navigation tree derived from the on-disk shape of `content/`.
 *
 * {@link buildNavTree} is a pure function over a `content-relative path -> raw markdown` record.
 * That is what lets `tests/nav-structure.test.ts` feed it a record read with `node:fs` and compare
 * the result against the record `import.meta.glob` produces at build time — the navigation tree and
 * the file system can never silently disagree.
 */
import { parsePage, type DocPage } from "./page";
import { SECTION_INDEX, orderOf, routeForPath, segmentsOf, titleFromName } from "./slug";

export interface NavPage {
  title: string;
  route: string;
  contentPath: string;
  icon?: string;
}

export interface NavSection {
  /** Folder name including its order prefix, e.g. `01_GettingStarted`. */
  name: string;
  title: string;
  /** Route of the section's own `_Index.md` page. */
  route: string;
  contentPath: string;
  icon?: string;
  groupExpanded: boolean;
  /** Leaf pages directly inside this folder, in `NN_` order. */
  pages: NavPage[];
  /** Nested sub-sections, in `NN_` order. Empty for a flat section. */
  sections: NavSection[];
}

interface FolderNode {
  name: string;
  path: string[];
  files: Map<string, string>;
  folders: Map<string, FolderNode>;
}

/** Thrown when `content/` violates the authoring convention documented in the package README. */
export class NavStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NavStructureError";
  }
}

function emptyFolder(name: string, path: string[]): FolderNode {
  return { name, path, files: new Map(), folders: new Map() };
}

function buildFolderTree(files: Record<string, string>): FolderNode {
  const root = emptyFolder("", []);
  for (const [contentPath, raw] of Object.entries(files)) {
    const segments = segmentsOf(contentPath);
    if (segments.length === 0 || !/\.md$/i.test(segments[segments.length - 1])) continue;

    let node = root;
    for (const folder of segments.slice(0, -1)) {
      let child = node.folders.get(folder);
      if (!child) {
        child = emptyFolder(folder, [...node.path, folder]);
        node.folders.set(folder, child);
      }
      node = child;
    }
    node.files.set(segments[segments.length - 1], raw);
  }
  return root;
}

function byOrderThenName<T extends { name: string }>(a: T, b: T): number {
  const delta = orderOf(a.name) - orderOf(b.name);
  return delta !== 0 ? delta : a.name.localeCompare(b.name);
}

function toSection(folder: FolderNode): NavSection {
  const indexFile = `${SECTION_INDEX}.md`;
  const indexRaw = folder.files.get(indexFile);
  const folderPath = folder.path.join("/");
  if (indexRaw === undefined) {
    throw new NavStructureError(
      `Section folder "content/${folderPath}" has no ${indexFile}. Every section folder needs one — ` +
        `it is the section's own page at ${routeForPath(`${folderPath}/${indexFile}`)}.`,
    );
  }

  const index = parsePage(`${folderPath}/${indexFile}`, indexRaw);

  const pages: NavPage[] = [...folder.files.entries()]
    .filter(([fileName]) => fileName !== indexFile)
    .map(([fileName, raw]) => {
      const page = parsePage(`${folderPath}/${fileName}`, raw);
      return { name: fileName, page };
    })
    .sort(byOrderThenName)
    .map(({ page }) => navPageOf(page));

  const sections = [...folder.folders.values()].sort(byOrderThenName).map(toSection);

  return {
    name: folder.name,
    title: index.title || titleFromName(folder.name),
    route: index.route,
    contentPath: index.contentPath,
    icon: index.icon,
    groupExpanded: index.frontmatter.groupExpanded ?? false,
    pages,
    sections,
  };
}

function navPageOf(page: DocPage): NavPage {
  return { title: page.title, route: page.route, contentPath: page.contentPath, icon: page.icon };
}

/**
 * Builds the ordered section list for the sidebar.
 *
 * Throws {@link NavStructureError} for a section folder without `_Index.md` or for a markdown file
 * sitting directly in `content/` — both break the contract the follow-up content plans rely on, so
 * they fail the build rather than rendering a half-navigable site.
 */
export function buildNavTree(files: Record<string, string>): NavSection[] {
  const root = buildFolderTree(files);

  if (root.files.size > 0) {
    const stray = [...root.files.keys()].sort().join(", ");
    throw new NavStructureError(
      `Markdown file(s) directly in content/: ${stray}. Every page belongs to a numbered section ` +
        `folder, e.g. content/01_GettingStarted/01_Introduction.md.`,
    );
  }

  return [...root.folders.values()].sort(byOrderThenName).map(toSection);
}

/** Flattens a nav tree into every route it offers, in sidebar order (section index first). */
export function flattenNavRoutes(sections: NavSection[]): string[] {
  const routes: string[] = [];
  const walk = (section: NavSection) => {
    routes.push(section.route);
    for (const page of section.pages) routes.push(page.route);
    for (const child of section.sections) walk(child);
  };
  for (const section of sections) walk(section);
  return routes;
}

/** Every content path referenced by the tree, in the same order as {@link flattenNavRoutes}. */
export function flattenNavContentPaths(sections: NavSection[]): string[] {
  const paths: string[] = [];
  const walk = (section: NavSection) => {
    paths.push(section.contentPath);
    for (const page of section.pages) paths.push(page.contentPath);
    for (const child of section.sections) walk(child);
  };
  for (const section of sections) walk(section);
  return paths;
}
