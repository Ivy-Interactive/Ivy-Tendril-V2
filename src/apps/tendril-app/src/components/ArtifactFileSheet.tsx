import React, { useEffect, useState } from "react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Spinner } from "@ivy-interactive/components/ui";
import {
  ArtifactFileSheet as ArtifactFileSheetView,
  artifactFileName,
  artifactPreviewKind,
  type FilePreviewRead,
} from "@ivy-interactive/components/dialogs";
import { bridge } from "../api/bridge";
import { describeBridgeError } from "../types/api";
import { useAttachmentPreview } from "../hooks/useAttachmentPreview";
import { useTranslation } from "../i18n";

/*
 * The pure path helpers moved into the library with the sheet (`Sheets/filePaths.ts`); they are
 * re-exported under their old names so callers and tests keep one import.
 */
export {
  ARTIFACT_RICH_PREVIEW_LIMIT_BYTES,
  artifactCodeLanguage,
  artifactDisplayPath,
  artifactFileName,
  artifactPreviewKind,
  resolveArtifactLink,
  type ArtifactPreviewKind,
} from "@ivy-interactive/components/dialogs";

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
  const { t } = useTranslation("plans");
  const { url, failed } = useAttachmentPreview(path, true);
  const fileName = artifactFileName(path);
  return (
    <button
      type="button"
      aria-label={t("artifactSheet.thumbnail.openLabel", { fileName })}
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
        <span className="text-xs text-muted-foreground">
          {t("artifactSheet.thumbnail.noPreview")}
        </span>
      ) : (
        <Spinner size="md" aria-label={t("artifactSheet.thumbnail.loadingLabel", { fileName })} />
      )}
    </button>
  );
};

/** A text read's outcome, keyed by the path it is for so a reopened sheet never shows the last file. */
type TextRead = { path: string; read: FilePreviewRead };

/**
 * The connected half of the Review app's artifact sheet (V1 `Review/ContentView.cs:464`; the sheet
 * itself is the library's `ArtifactFileSheet`).
 *
 * Three things live here because the library cannot reach them: the plan-scoped text read
 * (`getPlanArtifactContent`, which refuses anything outside the plan's `Artifacts` folder), the image
 * read through the guarded `/ivy/local-file` route the thumbnails share, and the opener.
 *
 * The folder is always one click away in the header. That is `revealItemInDir`, not the `openPath`
 * the list used to call: the app's capability grants `opener:default`, which allows the former and
 * not the latter, so the old Open button was refused by Tauri and did nothing.
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
  const [text, setText] = useState<TextRead | null>(null);
  /** A refused reveal or external link: surfaced, never swallowed. */
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setActionError(null);
    if (!planId || !path || kind === "image") return;

    let cancelled = false;
    bridge.getPlanArtifactContent(planId, path).then(
      (content) => {
        if (!cancelled) setText({ path, read: { status: "loaded", content } });
      },
      (err: unknown) => {
        if (!cancelled)
          setText({ path, read: { status: "failed", error: describeBridgeError(err) } });
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

  const openExternal = (url: string) => {
    setActionError(null);
    openUrl(url).catch((err: unknown) => setActionError(describeBridgeError(err)));
  };

  return (
    <ArtifactFileSheetView
      path={path}
      onClose={onClose}
      read={text && text.path === path ? text.read : { status: "loading" }}
      image={image}
      planFolderPath={planFolderPath}
      onOpenArtifact={onOpenArtifact}
      onOpenExternal={openExternal}
      onReveal={reveal}
      actionError={actionError}
      wireframeBaseUrl={wireframeBaseUrl}
    />
  );
};
