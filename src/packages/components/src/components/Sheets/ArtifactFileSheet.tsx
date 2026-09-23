import React from "react";
import { Copy, FolderOpen } from "lucide-react";
import { copyToClipboard } from "../../lib/clipboard";
import { Callout } from "../ui/callout";
import { IconButton } from "../ui/IconButton";
import { SheetPanel } from "../ui/sheet-panel";
import { useTranslation } from "@/i18n/uiReview";
import { FilePreview, type FilePreviewImage, type FilePreviewRead } from "./FilePreview";
import { artifactDisplayPath, artifactFileName } from "./filePaths";

export interface ArtifactFileSheetProps {
  /** The artifact's absolute path, exactly as the listing gave it, or null when closed. */
  path: string | null;
  onClose: () => void;
  /** The text read for a markdown or text artifact. Absent is the same as loading. */
  read?: FilePreviewRead;
  /** The image read for a screenshot. Absent is the same as loading. */
  image?: FilePreviewImage;
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
  /** Opens a web or mail link outside the app. */
  onOpenExternal?: (url: string) => void;
  /** Shows the artifact in the OS file manager. Without it the header has no folder button. */
  onReveal?: () => void;
  /** A refused reveal or external link: shown above the file, never swallowed. */
  actionError?: string | null;
  /** Passed to a markdown artifact's renderer, as the plan's own markdown gets it. */
  wireframeBaseUrl?: string;
}

/**
 * An artifact the Review app lists, opened in a right-hand sheet instead of handed to the OS.
 *
 * V1's `Review/ContentView.cs:464` does the same inline: `openArtifact` holds the path,
 * `artifactContentQuery` reads it (refusing anything outside the plan's `Artifacts` folder), and a
 * `Sheet` titled with the file name shows it in a `CodeBlock` with the language taken from the
 * extension, at `UxHelper.SheetWidth`. The body is {@link FilePreview}, which renders by type where
 * V2 has a better renderer than V1's code block.
 *
 * Presentational: the host reads the file and passes the outcome in (`read` / `image`), and owns the
 * opener. The app's connected wrapper is `components/ArtifactFileSheet.tsx`.
 */
export const ArtifactFileSheet: React.FC<ArtifactFileSheetProps> = ({
  path,
  onClose,
  read,
  image,
  planFolderPath,
  onOpenArtifact,
  onOpenExternal,
  onReveal,
  actionError,
  wireframeBaseUrl,
}) => {
  const { t } = useTranslation("uiReview");
  const fileName = path ? artifactFileName(path) : t("artifactSheet.fallbackTitle");

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
              label={t("artifactSheet.copyPath")}
              size="md"
              tone="muted"
              data-testid="artifact-sheet-copy-path"
              onClick={() => void copyToClipboard(path)}
            >
              <Copy className="size-4" aria-hidden="true" />
            </IconButton>
            {onReveal && (
              <IconButton
                label={t("artifactSheet.revealLabel")}
                size="md"
                tone="muted"
                data-testid="artifact-sheet-reveal"
                onClick={onReveal}
              >
                <FolderOpen className="size-4" aria-hidden="true" />
              </IconButton>
            )}
          </>
        )
      }
    >
      {path && (
        <FilePreview
          path={path}
          read={read}
          image={image}
          onReveal={onReveal}
          onOpenFile={onOpenArtifact}
          onOpenExternal={onOpenExternal}
          wireframeBaseUrl={wireframeBaseUrl}
          testIdPrefix="artifact-sheet"
          lead={
            actionError ? (
              <Callout.Error data-testid="artifact-sheet-action-error">{actionError}</Callout.Error>
            ) : null
          }
        />
      )}
    </SheetPanel>
  );
};
