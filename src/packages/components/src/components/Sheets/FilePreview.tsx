import React, { useRef } from "react";
import { FolderOpen } from "lucide-react";
import { formatBytes } from "../../lib/formatters";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Spinner } from "../ui/spinner";
import { CodeBlock } from "../PlanMarkdown/CodeBlock";
import { PlanMarkdown } from "../PlanMarkdown/PlanMarkdown";
import { useTranslation } from "@/i18n/uiReview";
import {
  ARTIFACT_RICH_PREVIEW_LIMIT_BYTES,
  artifactCodeLanguage,
  artifactFileName,
  artifactPreviewKind,
  resolveArtifactLink,
} from "./filePaths";

/**
 * A file's text as the daemon answers a preview read: the text itself, or why there is none.
 *
 * The shape of the app's `PlanArtifactContent` (`tendril_core::plans::PlanArtifactContent`), which
 * passes straight through. Declared here because the component that renders a shape owns it.
 */
export type FilePreviewContent =
  | { kind: "text"; text: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "tooLarge"; size: number };

/** Where a text read stands. The host owns the read; the sheet only shows its outcome. */
export type FilePreviewRead =
  | { status: "loading" }
  | { status: "loaded"; content: FilePreviewContent }
  | { status: "failed"; error: string };

/** An image read through the guarded `/ivy/local-file` route, as the host's preview hook reports it. */
export interface FilePreviewImage {
  /** The `data:` URL once it has loaded. */
  url?: string | null;
  failed?: boolean;
  /** Why it failed, when the route said. */
  error?: string | null;
}

export interface FilePreviewProps {
  /** The file's absolute path. Its extension decides the renderer. */
  path: string;
  /** The text read, for a markdown or text file. Absent is the same as loading. */
  read?: FilePreviewRead;
  /** The image read, for an image file. Absent is the same as loading. */
  image?: FilePreviewImage;
  /** Shows the file in the OS file manager: the way out when there is nothing to show inline. */
  onReveal?: () => void;
  /** Opens another local file, resolved against this one: a markdown file's relative link. */
  onOpenFile?: (path: string) => void;
  /** Opens a web or mail link outside the app. */
  onOpenExternal?: (url: string) => void;
  /** Passed to a markdown file's renderer, as the plan's own markdown gets it. */
  wireframeBaseUrl?: string;
  /** The `data-testid` prefix, so each sheet keeps the ids its tests already read. */
  testIdPrefix?: string;
  /** Above the file, inside the same body: a refused action's error, say. */
  lead?: React.ReactNode;
}

/**
 * The body both file sheets share: an image, a markdown document, highlighted code, or a callout
 * saying why the file cannot be shown.
 *
 * V1 has two sheets that do this - the Review app's inline artifact sheet (`Review/ContentView.cs:464`)
 * and `Apps/Views/Sheets/FileSheet.cs` - and both put the file in a `CodeBlock` with the language taken
 * from the extension, except that `FileSheet` shows an image as an image. This keeps that and renders
 * by type where V2 has a better renderer: markdown through `PlanMarkdown`, as the Summary tab renders
 * `summary.md`. A file with nothing to show inline — binary, or over the daemon's preview cap — says so
 * and offers its folder.
 *
 * Every link in a markdown file lands in a handler here — `PlanMarkdown` hands local ones to
 * `onFileClick` and the rest to `onLinkClick`, and either way stops the default. The default is the
 * bug: a relative `href` is a live `<a>`, and following it navigates the whole webview off the app.
 */
export const FilePreview: React.FC<FilePreviewProps> = ({
  path,
  read,
  image,
  onReveal,
  onOpenFile,
  onOpenExternal,
  wireframeBaseUrl,
  testIdPrefix = "file-sheet",
  lead,
}) => {
  const { t } = useTranslation("uiReview");
  const bodyRef = useRef<HTMLDivElement>(null);
  const kind = artifactPreviewKind(path);
  const fileName = artifactFileName(path);

  const followLink = (href: string) => {
    if (/^(https?|mailto|tel):/i.test(href)) {
      onOpenExternal?.(href);
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
    const target = resolveArtifactLink(path, href);
    if (target && onOpenFile) onOpenFile(target);
  };

  const noPreview = (reason: string) => (
    <Callout.Info
      data-testid={`${testIdPrefix}-no-preview`}
      title={t("filePreview.noPreviewTitle")}
    >
      <p>{reason}</p>
      {onReveal && (
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onReveal}>
          <FolderOpen className="size-3.5" aria-hidden="true" />
          {t("filePreview.showInFolder")}
        </Button>
      )}
    </Callout.Info>
  );

  const loading = (
    <div
      data-testid={`${testIdPrefix}-loading`}
      className="flex h-32 items-center justify-center text-muted-foreground"
    >
      <Spinner size="lg" aria-label={t("filePreview.loadingLabel", { fileName })} />
    </div>
  );

  let body: React.ReactNode;
  if (kind === "image") {
    body = image?.failed ? (
      noPreview(
        image.error
          ? t("filePreview.imageFailedWithError", { error: image.error })
          : t("filePreview.imageFailed"),
      )
    ) : image?.url ? (
      <img
        data-testid={`${testIdPrefix}-image`}
        src={image.url}
        alt={fileName}
        className="mx-auto h-auto max-w-full rounded border border-border"
      />
    ) : (
      loading
    );
  } else if (!read || read.status === "loading") {
    body = loading;
  } else if (read.status === "failed") {
    body = <Callout.Error data-testid={`${testIdPrefix}-error`}>{read.error}</Callout.Error>;
  } else if (read.content.kind === "binary") {
    body = noPreview(t("filePreview.binary", { fileName, size: formatBytes(read.content.size) }));
  } else if (read.content.kind === "tooLarge") {
    body = noPreview(t("filePreview.tooLarge", { fileName, size: formatBytes(read.content.size) }));
  } else {
    const { text, size } = read.content;
    const rich = size <= ARTIFACT_RICH_PREVIEW_LIMIT_BYTES;
    const language = artifactCodeLanguage(path);
    body =
      kind === "markdown" && rich ? (
        <PlanMarkdown
          id={`${testIdPrefix}-${fileName}`}
          content={text}
          article
          dangerouslyAllowLocalFiles
          wireframeBaseUrl={wireframeBaseUrl}
          onFileClick={followLink}
          onLinkClick={followLink}
        />
      ) : (
        <>
          {!rich && (
            <p
              className="text-xs text-muted-foreground"
              data-testid={`${testIdPrefix}-plain-notice`}
            >
              {t("filePreview.plainNotice", {
                size: formatBytes(size),
                fileName,
                context: kind === "markdown" ? "markdown" : undefined,
              })}
            </p>
          )}
          {/* `WrapLines()` for prose and logs, which have no columns to preserve; code keeps its
              indentation and scrolls sideways, as in the Changes tab. `data-language` names the
              highlighter the block was asked for, which is what a test can check without reaching
              into the lazy highlighter chunk. */}
          <div data-testid={`${testIdPrefix}-code`} data-language={rich ? (language ?? "") : ""}>
            <CodeBlock
              content={text}
              language={rich ? language : undefined}
              wrapLines={kind === "markdown" || language === undefined || language === "log"}
            />
          </div>
        </>
      );
  }

  return (
    <div ref={bodyRef} data-testid={`${testIdPrefix}-body`} className="space-y-3">
      {lead}
      {body}
    </div>
  );
};
