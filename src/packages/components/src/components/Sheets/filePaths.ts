import { getLanguageFromFilePath } from "../PlanDiffView/PlanDiffView";

/**
 * The pure half of the file sheets (`ArtifactFileSheet`, `FileSheet`): how a path is shown, which
 * renderer it gets, and where a link inside a markdown file points.
 *
 * Moved here from the app's `components/ArtifactFileSheet.tsx` with the sheet itself, so the library
 * sheet and the app wrapper decide these the same way. The app re-exports them under the old names.
 */

/**
 * The images the daemon's `/ivy/local-file` guard will serve (`ALLOWED_FILE_EXTENSIONS` in
 * `tendril-server/src/local_file_guard.rs`, less `pdf`). Anything else is read as text.
 * V1's `FileHelper.IsImageExtension` is the same list.
 */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "svg",
  "webp",
  "ico",
  "avif",
]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

/**
 * The largest file a sheet highlights, or renders as markdown. Past it the text shows plain.
 *
 * Prism turns every token into its own element: a 1 MiB JSON report — the daemon's preview cap —
 * came to ~417k spans and a 4.8 s main-thread stall before the sheet painted, and 256 KiB still
 * stalled for ~0.9 s. At this limit it is one ~0.3 s task (a 60 KiB markdown file costs about the
 * same), and a plain `pre` of the full 1 MiB about 50 ms. V1 never highlights an artifact at all
 * (its sheet's `CodeBlock` is `Languages.Text`), so plain text past this size is V1's own
 * rendering rather than a degraded one.
 */
export const ARTIFACT_RICH_PREVIEW_LIMIT_BYTES = 64 * 1024;

/** The file name, split on either separator: the daemon may be on Windows. */
export const artifactFileName = (path: string): string => path.split(/[/\\]/).pop() || path;

/** How a sheet shows a file, from its extension alone. */
export type ArtifactPreviewKind = "image" | "markdown" | "text";

/** Lower-cased extension of the file name — never of a dotted directory above it — or "". */
const artifactExtension = (path: string): string => {
  const name = artifactFileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export const artifactPreviewKind = (path: string): ArtifactPreviewKind => {
  const extension = artifactExtension(path);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  return "text";
};

/**
 * The highlighter language for a text file, or undefined for plain text. Taken from the file name
 * only: `getLanguageFromFilePath` falls back to everything after the last dot, which for an
 * extensionless file under `~/.tendril/` would be a directory path.
 */
export const artifactCodeLanguage = (path: string): string | undefined => {
  if (!artifactExtension(path)) return undefined;
  const language = getLanguageFromFilePath(artifactFileName(path));
  return language === "text" || language === "txt" ? undefined : language;
};

/**
 * `path` as it sits inside the plan folder (`Artifacts/screenshots/home.png`), or the whole path
 * when it is not under `planFolderPath` or the folder is not known yet.
 */
export const artifactDisplayPath = (path: string, planFolderPath?: string | null): string => {
  const folder = planFolderPath?.replace(/[/\\]+$/, "");
  if (!folder || path.length <= folder.length + 1 || !path.startsWith(folder)) return path;
  return /[/\\]/.test(path[folder.length]) ? path.slice(folder.length + 1) : path;
};

/** A scheme such as `mailto:` — but not a Windows drive (`C:\`), which is one letter long. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/**
 * Where a link inside a markdown file points, as an absolute path, or null when it names no file.
 *
 * A relative link is resolved against the file's own folder, as a browser resolves one against
 * the page, and in the file's own separator style. `file://` URLs and absolute paths are taken
 * as they are. The query and fragment are dropped: the sheet shows whole files.
 *
 * Nothing is refused here. The daemon's read decides whether the result may be shown, so a link
 * that climbs out of what it serves opens the sheet on that refusal.
 */
export const resolveArtifactLink = (fromPath: string, href: string): string | null => {
  if (href.startsWith("file:")) {
    try {
      const pathname = decodeURIComponent(new URL(href).pathname);
      return /^\/[a-zA-Z]:/.test(pathname) ? pathname.slice(1) : pathname || null;
    } catch {
      return null;
    }
  }
  if (URL_SCHEME.test(href)) return null;

  let target = href.replace(/[?#].*$/, "");
  if (!target) return null;
  try {
    target = decodeURIComponent(target);
  } catch {
    // A stray `%` is part of the name, not an escape.
  }
  if (/^[a-zA-Z]:[\\/]/.test(target) || target.startsWith("/") || target.startsWith("\\")) {
    return target;
  }

  const separator = fromPath.includes("\\") && !fromPath.includes("/") ? "\\" : "/";
  const segments = fromPath.split(/[/\\]/);
  segments.pop();
  for (const part of target.split(/[/\\]/)) {
    if (part === "" || part === ".") continue;
    // Never above the root: the first segment is "" for `/…` and the drive for `C:\…`.
    if (part === "..") {
      if (segments.length > 1) segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join(separator);
};
