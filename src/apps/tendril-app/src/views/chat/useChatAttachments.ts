import React, { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { bridge } from "../../api/bridge";
import { useWebviewFileDrop } from "../../hooks/useWebviewFileDrop";
import type { ChatAttachment } from "../../types/chat";
import { i18n } from "../../i18n";

/**
 * Everything the composer does with a file: the chips, the staging copies, and the four drag
 * handlers the thread is wrapped in. It is one concern with its own state, and nothing outside it
 * reads that state except through what is returned here.
 */

/**
 * Whether an attachment's path is a real path on the machine, POSIX or Windows.
 *
 * A `File` from an `<input>` or a paste reports only its base name, and staging a base name would ask
 * the app to read a file relative to a working directory nothing here can reason about.
 */
const isAbsolutePath = (path: string): boolean => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path);

export interface ChatAttachmentsOptions {
  activeSessionId: string | undefined;
  embedded?: boolean;
  targetRef?: React.RefObject<HTMLElement | null>;
}

export function useChatAttachments({
  activeSessionId,
  embedded: _embedded = false,
  targetRef,
}: ChatAttachmentsOptions) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** The copy being made of each attached file, keyed by the path the user attached it by. */
  const stagingRef = useRef(new Map<string, Promise<string>>());
  /**
   * The attached paths whose copy has not landed yet, as state rather than as the ref above, because
   * the composer's thumbnails have to re-render when one settles.
   *
   * Asking for a preview of a path that is still being staged can only answer `NOT_FOUND` — that is
   * the whole reason staging exists — and the refusal would be cached against the picked path, so
   * the thumbnail would never appear even after the copy landed.
   */
  const [stagingPaths, setStagingPaths] = useState<string[]>([]);

  const addAttachments = (incoming: ChatAttachment[]) => {
    setAttachments((prev) => {
      const existingPaths = new Set(prev.map((a) => a.path));
      return [...prev, ...incoming.filter((a) => !existingPaths.has(a.path))];
    });
  };

  /**
   * Swaps the path of the chip added for `source` for the path the file was staged at.
   *
   * If a chip already carries the staged path — the same file attached twice — the second row is
   * dropped rather than duplicated: `addAttachments` de-duplicates on the path it was given, which is
   * the source path, and by the time this runs the first row no longer carries it.
   */
  const applyStagedPath = (source: string, staged: string) => {
    setAttachments((prev) => {
      if (prev.some((a) => a.path === staged)) {
        return prev.filter((a) => a.path !== source);
      }
      return prev.map((a) => (a.path === source ? { ...a, path: staged } : a));
    });
  };

  /**
   * Copies each picked file into Tendril's attachment directory and re-points its chip at the copy.
   *
   * This is what makes an attachment previewable. The daemon only serves a file inside a configured
   * local-file root — the Tendril home, the plans folder, the project repos — and a screenshot picked
   * from `~/Desktop` is in none of them, so a message that referenced the original path could never
   * render more than a paperclip chip. V1 has the same constraint and answers it the same way: its
   * composer uploads every attachment into `<TendrilHome>/Attachments/<sessionId>/` and references the
   * copy. The staged path is also what the turn's `[Attached Files]:` block carries, so the agent reads
   * the same bytes the thumbnail shows.
   *
   * A staging failure is not fatal and not reported: the chip keeps the path the user picked, so the
   * agent is still told about a file that exists and only the thumbnail falls back to a chip.
   *
   * In-flight uploads are keyed by source path so that two drops of one file — or a drop of a file
   * already attached — settle on a single copy instead of racing into `shot.png` and `shot_1.png`.
   */
  const stageAttachments = async (paths: string[]) => {
    const sessionId = activeSessionId;
    await Promise.all(
      paths.map(async (source) => {
        let pending = stagingRef.current.get(source);
        if (!pending) {
          pending = bridge.uploadChatAttachment(source, sessionId).then((staged) => staged.path);
          stagingRef.current.set(source, pending);
        }
        setStagingPaths((prev) => (prev.includes(source) ? prev : [...prev, source]));
        try {
          applyStagedPath(source, await pending);
        } catch {
          // Retried if the file is attached again.
          stagingRef.current.delete(source);
        } finally {
          setStagingPaths((prev) => prev.filter((path) => path !== source));
        }
      }),
    );
  };

  const addAttachmentPaths = (paths: string[]) => {
    addAttachments(paths.map((path) => ({ name: path.split(/[/\\]/).pop() || path, path })));
    void stageAttachments(paths);
  };

  const processFiles = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).map((file) => ({
      name: file.name,
      path: (file as unknown as { path?: string }).path || file.name,
      mimeType: file.type || undefined,
    }));
    addAttachments(incoming);
    // A `File` from an `<input>` or a paste is bytes without a path in a Tauri webview, and there is
    // nothing on disk to stage; only the ones that did arrive with a real path are copied.
    void stageAttachments(incoming.map((a) => a.path).filter(isAbsolutePath));
  };

  // Scoped via targetRef so drops within the chat area are accepted while drops outside are ignored.
  const nativeDropActive = useWebviewFileDrop({
    onPaths: addAttachmentPaths,
    onDragStateChange: setIsDraggingOver,
    targetRef,
    enabled: true,
  });

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handleAttachClick = async () => {
    try {
      const selected = await open({
        multiple: true,
        // Read when the picker opens, so it is in the language current then.
        title: i18n.t("chat:attachments.pickerTitle"),
      });
      if (selected === null) {
        return;
      }
      const paths = Array.isArray(selected) ? selected : [selected];
      addAttachmentPaths(paths);
    } catch {
      fileInputRef.current?.click();
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (nativeDropActive) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  return {
    attachments,
    setAttachments,
    isDraggingOver,
    stagingPaths,
    stagingRef,
    fileInputRef,
    processFiles,
    handleFileInputChange,
    handleAttachClick,
    handleRemoveAttachment,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
  };
}
