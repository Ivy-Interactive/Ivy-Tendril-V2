import React, { useEffect, useRef, useState } from "react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Copy, FolderOpen } from "lucide-react";
import { copyToClipboard, formatBytes } from "@ivy-interactive/components";
import { Button, Callout, IconButton, SheetPanel, Spinner } from "@ivy-interactive/components/ui";
import {
  CodeBlock,
  PlanMarkdown,
  getLanguageFromFilePath,
} from "@ivy-interactive/components/tendril";
import { bridge } from "../api/bridge";
import { describeBridgeError, type PlanArtifactContent } from "../types/api";
import { useAttachmentPreview } from "../hooks/useAttachmentPreview";

export interface ArtifactFileSheetProps {
  /** The plan whose `Artifacts/` folder holds the file. */
  planId: string | null | undefined;
  /** The artifact's absolute path, exactly as `getPlanArtifacts` listed it, or null when closed. */
  path: string | null;
  onClose: () => void;
  /**
   * The plan's own folder, so the header can name the file by where it sits in the plan
   * (`Artifacts/screenshots/home.png`) rather than by an absolute path whose visible part is the
   * same for every artifact.
   */
  planFolderPath?: string | null;
  /**
   * Opens another file in this sheet: where a markdown artifact's relative link to a sibling goes.
   * Without it such a link does nothing, which beats the webview navigating away from the app.
   */
  onOpenArtifact?: (path: string) => void;
  /** Passed to a markdown artifact's renderer, as the plan's own markdown gets it. */
  wireframeBaseUrl?: string;
}

/**
 * The images the daemon's `/ivy/local-file` guard will serve (`ALLOWED_FILE_EXTENSIONS` in
 * `tendril-server/src/local_file_guard.rs`, less `pdf`). Anything else is read as text.
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
 * The largest artifact the sheet highlights, or renders as markdown. Past it the text shows plain.
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

/** How the sheet shows a file, from its extension alone. */
export type ArtifactPreviewKind = "image" | "markdown" | "text";

export const artifactPreviewKind = (path: string): ArtifactPreviewKind => {
  const extension = artifactExtension(path);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  return "text";
};

/** Lower-cased extension of the file name — never of a dotted directory above it — or "". */
const artifactExtension = (path: string): string => {
  const name = artifactFileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/**
 * The highlighter language for a text artifact, or undefined for plain text. Taken from the file
 * name only: `getLanguageFromFilePath` falls back to everything after the last dot, which for an
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
 * Where a link inside a markdown artifact points, as an absolute path, or null when it names no file.
 *
 * A relative link is resolved against the artifact's own folder, as a browser resolves one against
 * the page, and in the artifact's own separator style. `file://` URLs and absolute paths are taken
 * as they are. The query and fragment are dropped: the sheet shows whole files.
 *
 * Nothing is refused here. The daemon's read decides whether the result is inside the plan's
 * `Artifacts` folder, so a link that climbs out of it opens the sheet on that refusal.
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

export interface ArtifactThumbnailProps {
  /** The screenshot's absolute path, as `getPlanArtifacts` listed it. */
  path: string;
  /** Opens the screenshot in {@link ArtifactFileSheet}. */
  onOpen: () => void;
}

/**
 * A screenshot tile in the Artifacts tab — V1's `RenderArtifactScreenshots` image, which loads from
 * `/ivy/local-file`. Read through the same guarded route as the sheet (`useAttachmentPreview`), so
 * opening a tile costs no second read. `convertFileSrc` is not an option: the asset protocol is not
 * enabled and the CSP's `img-src` allows only `'self'` and `data:`, so its URLs never loaded.
 */
export const ArtifactThumbnail: React.FC<ArtifactThumbnailProps> = ({ path, onOpen }) => {
  const { url, failed } = useAttachmentPreview(path, true);
  const fileName = artifactFileName(path);
  return (
    <button
      type="button"
      aria-label={`Open ${fileName}`}
      onClick={onOpen}
      className="relative flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden rounded bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {url ? (
        <img
          src={url}
          alt={fileName}
          className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
        />
      ) : failed ? (
        <span className="text-xs text-muted-foreground">No preview</span>
      ) : (
        <Spinner size="md" aria-label={`Loading ${fileName}`} />
      )}
    </button>
  );
};

/** A text read's outcome, keyed by the path it is for so a reopened sheet never shows the last file. */
type TextRead =
  | { path: string; status: "loaded"; content: PlanArtifactContent }
  | { path: string; status: "failed"; error: string };

/**
 * An artifact the Review app lists, opened in a right-hand sheet instead of handed to the OS.
 *
 * V1's `Review/ContentView.cs` does the same: `openArtifact` holds the path, `artifactContentQuery`
 * reads it (refusing anything outside the plan's `Artifacts` folder), and a `Sheet` titled with the
 * file name shows it in a `CodeBlock` with the language taken from the extension, at
 * `UxHelper.SheetWidth`. This keeps that and renders by type where V2 has a better renderer: markdown
 * through `PlanMarkdown`, as the Summary tab renders `summary.md`, and images through the same guarded
 * `/ivy/local-file` read the thumbnails use. A file with nothing to show inline — binary, or over the
 * daemon's preview cap — says so and offers its folder.
 *
 * The chrome is the shared `SheetPanel`, the same as `VerificationReportSheet`'s.
 *
 * The folder is also always one click away in the header. That is `revealItemInDir`, not the
 * `openPath` the list used to call: the app's capability grants `opener:default`, which allows the
 * former and not the latter, so the old Open button was refused by Tauri and did nothing.
 */
export const ArtifactFileSheet: React.FC<ArtifactFileSheetProps> = ({
  planId,
  path,
  onClose,
  planFolderPath,
  onOpenArtifact,
  wireframeBaseUrl,
}) => {
  const kind = path ? artifactPreviewKind(path) : null;
  const image = useAttachmentPreview(path ?? "", kind === "image");
  const [read, setRead] = useState<TextRead | null>(null);
  /** A refused reveal or external link: surfaced, never swallowed. */
  const [actionError, setActionError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActionError(null);
    if (!planId || !path || kind === "image") return;

    let cancelled = false;
    bridge.getPlanArtifactContent(planId, path).then(
      (content) => {
        if (!cancelled) setRead({ path, status: "loaded", content });
      },
      (err: unknown) => {
        if (!cancelled) setRead({ path, status: "failed", error: describeBridgeError(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [planId, path, kind]);

  const reveal = () => {
    if (!path) return;
    setActionError(null);
    revealItemInDir(path).catch((err: unknown) => setActionError(describeBridgeError(err)));
  };

  /**
   * Every link in a markdown artifact lands here — `PlanMarkdown` hands local ones to `onFileClick`
   * and the rest to `onLinkClick`, and either way stops the default. The default is the bug: a
   * relative `href` is a live `<a>`, and following it navigates the whole webview off the app.
   */
  const followLink = (href: string) => {
    setActionError(null);
    if (/^(https?|mailto|tel):/i.test(href)) {
      openUrl(href).catch((err: unknown) => setActionError(describeBridgeError(err)));
      return;
    }
    if (href.startsWith("#")) {
      // An in-page anchor: scrolled to here, because following it would rewrite the app's route.
      let id = href.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // Not an escape sequence; the id is what was written.
      }
      const anchor = id ? document.getElementById(id) : null;
      if (anchor && bodyRef.current?.contains(anchor)) anchor.scrollIntoView({ block: "start" });
      return;
    }
    const target = path ? resolveArtifactLink(path, href) : null;
    if (target && onOpenArtifact) onOpenArtifact(target);
  };

  const fileName = path ? artifactFileName(path) : "Artifact";

  const noPreview = (reason: string) => (
    <Callout.Info data-testid="artifact-sheet-no-preview" title="No preview">
      <p>{reason}</p>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={reveal}>
        <FolderOpen className="size-3.5" aria-hidden="true" />
        Show in folder
      </Button>
    </Callout.Info>
  );

  const loading = (
    <div
      data-testid="artifact-sheet-loading"
      className="flex h-32 items-center justify-center text-muted-foreground"
    >
      <Spinner size="lg" aria-label={`Loading ${fileName}`} />
    </div>
  );

  let body: React.ReactNode = null;
  if (path && kind === "image") {
    body = image.failed ? (
      noPreview(
        image.error
          ? `Tendril could not load this image: ${image.error}`
          : "Tendril could not load this image.",
      )
    ) : image.url ? (
      <img
        data-testid="artifact-sheet-image"
        src={image.url}
        alt={fileName}
        className="mx-auto h-auto max-w-full rounded border border-border"
      />
    ) : (
      loading
    );
  } else if (path) {
    const text = read?.path === path ? read : null;
    if (!text) body = loading;
    else if (text.status === "failed")
      body = <Callout.Error data-testid="artifact-sheet-error">{text.error}</Callout.Error>;
    else if (text.content.kind === "binary")
      body = noPreview(
        `${fileName} is not a text file (${formatBytes(text.content.size)}), so it has no preview here.`,
      );
    else if (text.content.kind === "tooLarge")
      body = noPreview(
        `${fileName} is ${formatBytes(text.content.size)}, too large to preview here.`,
      );
    else {
      const rich = text.content.size <= ARTIFACT_RICH_PREVIEW_LIMIT_BYTES;
      const language = artifactCodeLanguage(path);
      if (kind === "markdown" && rich)
        body = (
          <PlanMarkdown
            id={`artifact-${fileName}`}
            content={text.content.text}
            article
            dangerouslyAllowLocalFiles
            wireframeBaseUrl={wireframeBaseUrl}
            onFileClick={followLink}
            onLinkClick={followLink}
          />
        );
      else
        body = (
          <>
            {!rich && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="artifact-sheet-plain-notice"
              >
                Shown as plain text: at {formatBytes(text.content.size)}, {fileName} is too large to{" "}
                {kind === "markdown" ? "render as markdown" : "highlight"}.
              </p>
            )}
            {/* `WrapLines()` for prose and logs, which have no columns to preserve; code keeps its
                indentation and scrolls sideways, as in the Changes tab. */}
            <CodeBlock
              content={text.content.text}
              language={rich ? language : undefined}
              wrapLines={kind === "markdown" || language === undefined || language === "log"}
            />
          </>
        );
    }
  }

  return (
    <SheetPanel
      open={path !== null}
      onClose={onClose}
      data-testid="artifact-file-sheet"
      title={fileName}
      description={
        path ? (
          <span className="font-mono" title={path}>
            {artifactDisplayPath(path, planFolderPath)}
          </span>
        ) : undefined
      }
      actions={
        path && (
          <>
            <IconButton
              label="Copy path"
              size="md"
              tone="muted"
              data-testid="artifact-sheet-copy-path"
              onClick={() => void copyToClipboard(path)}
            >
              <Copy className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label="Show in folder"
              size="md"
              tone="muted"
              data-testid="artifact-sheet-reveal"
              onClick={reveal}
            >
              <FolderOpen className="size-4" aria-hidden="true" />
            </IconButton>
          </>
        )
      }
    >
      <div ref={bodyRef} data-testid="artifact-sheet-body" className="space-y-3">
        {actionError && (
          <Callout.Error data-testid="artifact-sheet-action-error">{actionError}</Callout.Error>
        )}
        {body}
      </div>
    </SheetPanel>
  );
};
