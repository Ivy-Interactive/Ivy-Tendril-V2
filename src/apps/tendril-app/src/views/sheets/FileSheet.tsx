import React, { useEffect, useState } from "react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  FileSheet as FileSheetView,
  artifactPreviewKind,
  type FilePreviewRead,
} from "@ivy-interactive/components/dialogs";
import { bridge } from "../../api/bridge";
import { describeBridgeError } from "../../types/api";
import { useAttachmentPreview } from "../../hooks/useAttachmentPreview";

export interface FileSheetProps {
  /**
   * The plan whose markdown linked the file: its folder and repos bound what may be read. Without one
   * (an Inbox issue) the read may reach the configured projects' repos.
   */
  planId: string | null | undefined;
  /** The file's absolute path, or null when the sheet is closed. */
  path: string | null;
  onClose: () => void;
  /** Opens another file in this sheet: where a markdown file's relative link goes. */
  onOpenFile?: (path: string) => void;
  wireframeBaseUrl?: string;
}

/** A text read's outcome, keyed by its path so a reopened sheet never shows the last file. */
type TextRead = { path: string; read: FilePreviewRead };

/**
 * The connected half of V1's `FileSheet` (`Apps/Views/Sheets/FileSheet.cs`); the sheet itself is the
 * library's `FileSheet`.
 *
 * The text read is `getPlanFileContent`, confined to the plan's folder and the repos it targets, or
 * with no plan to the configured projects' repos (see
 * `commands::plan_files`); an image goes through the guarded `/ivy/local-file` route the artifact
 * thumbnails use.
 *
 * V1's **Open in {editor}** button is not wired: V2 has no editor setting (`config.Editor`) and no
 * command to launch one, so the library button stays hidden and Show in Folder is the way out.
 */
export const FileSheet: React.FC<FileSheetProps> = ({
  planId,
  path,
  onClose,
  onOpenFile,
  wireframeBaseUrl,
}) => {
  const kind = path ? artifactPreviewKind(path) : null;
  const image = useAttachmentPreview(path ?? "", kind === "image");
  const [text, setText] = useState<TextRead | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setActionError(null);
    if (!path || kind === "image") return;

    let cancelled = false;
    bridge.getPlanFileContent(planId, path).then(
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
    <FileSheetView
      path={path}
      onClose={onClose}
      read={text && text.path === path ? text.read : { status: "loading" }}
      image={image}
      onReveal={reveal}
      onOpenFile={onOpenFile}
      onOpenExternal={openExternal}
      actionError={actionError}
      wireframeBaseUrl={wireframeBaseUrl}
    />
  );
};
