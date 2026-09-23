import React from "react";
import { Copy, ExternalLink, FolderOpen } from "lucide-react";
import { copyToClipboard } from "../../lib/clipboard";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { IconButton } from "../ui/IconButton";
import { SheetPanel } from "../ui/sheet-panel";
import { useTranslation } from "@/i18n/uiReview";
import { FilePreview, type FilePreviewImage, type FilePreviewRead } from "./FilePreview";
import { artifactFileName } from "./filePaths";

export interface FileSheetProps {
  /** The file's absolute path, or null when the sheet is closed. */
  path: string | null;
  onClose: () => void;
  /** The text read for a markdown or code file. Absent is the same as loading. */
  read?: FilePreviewRead;
  /** The image read for an image file. Absent is the same as loading. */
  image?: FilePreviewImage;
  /**
   * The editor V1 names on its button (`config.Editor.Label`: "VS Code", "Cursor", …). The button
   * shows only when this and {@link onOpenInEditor} are both given.
   */
  editorLabel?: string;
  /** V1's `config.OpenInEditor(filePath)`. */
  onOpenInEditor?: () => void;
  /** Shows the file in the OS file manager. Without it the header has no folder button. */
  onReveal?: () => void;
  /** Opens another local file in this sheet: a markdown file's relative link. */
  onOpenFile?: (path: string) => void;
  /** Opens a web or mail link outside the app. */
  onOpenExternal?: (url: string) => void;
  /** A refused editor launch, reveal or link: shown above the file, never swallowed. */
  actionError?: string | null;
  /** Passed to a markdown file's renderer. */
  wireframeBaseUrl?: string;
}

/**
 * V1's `Apps/Views/Sheets/FileSheet.cs`: a local file a plan's markdown links to, opened beside the
 * plan instead of handed to the OS.
 *
 * V1 routes every link in plan, review, inbox, PR and recommendation markdown through
 * `FileSheet.CreateLinkClickHandler`: a `file://` URL opens this sheet, `plan://N` navigates to the
 * plan, and a web link goes to the browser. The sheet is titled with the file name, shows an image as
 * an image and anything else in a highlighted code block, and when the file exists heads the body with
 * an **Open in {editor}** button and the full path (`HeaderLayout(Button | Text.Muted(path), content)`).
 *
 * Here the path moves into the header's description, where every V2 sheet keeps it, the body is
 * {@link FilePreview} (so markdown renders as markdown), and the header carries Copy Path and Show in
 * Folder beside the close button, as the artifact sheet does.
 *
 * Presentational: the host reads the file (`read` / `image`) and owns every opener.
 */
export const FileSheet: React.FC<FileSheetProps> = ({
  path,
  onClose,
  read,
  image,
  editorLabel,
  onOpenInEditor,
  onReveal,
  onOpenFile,
  onOpenExternal,
  actionError,
  wireframeBaseUrl,
}) => {
  const { t } = useTranslation("uiReview");
  const fileName = path ? artifactFileName(path) : t("fileSheet.fallbackTitle");
  // V1 offers the editor only once the file is known to exist (`fileExists ? HeaderLayout(...)`).
  const exists = read?.status !== "failed" && !image?.failed;

  return (
    <SheetPanel
      open={path !== null}
      onClose={onClose}
      data-testid="file-sheet"
      title={fileName}
      description={
        path ? (
          <span className="font-mono" title={path}>
            {path}
          </span>
        ) : undefined
      }
      actions={
        path && (
          <>
            <IconButton
              label={t("fileSheet.copyPath")}
              size="md"
              tone="muted"
              data-testid="file-sheet-copy-path"
              onClick={() => void copyToClipboard(path)}
            >
              <Copy className="size-4" aria-hidden="true" />
            </IconButton>
            {onReveal && (
              <IconButton
                label={t("fileSheet.revealLabel")}
                size="md"
                tone="muted"
                data-testid="file-sheet-reveal"
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
          onOpenFile={onOpenFile}
          onOpenExternal={onOpenExternal}
          wireframeBaseUrl={wireframeBaseUrl}
          testIdPrefix="file-sheet"
          lead={
            <>
              {exists && editorLabel && onOpenInEditor && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="file-sheet-open-in-editor"
                  onClick={onOpenInEditor}
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  {t("fileSheet.openInEditor", { editor: editorLabel })}
                </Button>
              )}
              {actionError && (
                <Callout.Error data-testid="file-sheet-action-error">{actionError}</Callout.Error>
              )}
            </>
          }
        />
      )}
    </SheetPanel>
  );
};
