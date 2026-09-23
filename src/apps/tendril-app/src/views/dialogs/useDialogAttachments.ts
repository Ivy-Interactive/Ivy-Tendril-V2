import * as React from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { DialogAttachment } from "@ivy-interactive/components/dialogs";
import { bridge } from "../../api/bridge";
import { describeBridgeError } from "../../types/api";

/**
 * A fresh upload session id: V1's `Guid.NewGuid().ToString("N")` for `uploadSessionId`, which names
 * the `Attachments/<id>/` directory a dialog's files are staged into. 32 hex characters, a single
 * path segment, so the daemon's `attachment_session_dir` accepts it.
 */
export function newUploadSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * V1's upload handler appends ` [file: <path>]` to the text for every staged file; the request the
 * agent reads is the text, so the references go into it here, at submit, rather than being carried
 * beside it.
 */
export function withFileRefs(text: string, attachments: DialogAttachment[]): string {
  return text + attachments.map((file) => ` [file: ${file.path}]`).join("");
}

/**
 * The connected half of `DialogAttachments` for a request dialog (Update Plan, Request Changes): the
 * picker, the staging, and the chips' state, scoped to one opening of the dialog.
 *
 * Files are picked through the native dialog, which hands over real paths, and staged with
 * `bridge.uploadChatAttachment(path, sessionId)` into `Attachments/<sessionId>/` - exactly where V1's
 * `UseUpload` handlers write. A staged file that is removed again, or belongs to a dialog that is
 * cancelled, is left for the daemon's 24-hour sweep (`clean_stale_attachment_sessions`) rather than
 * deleted: there is no delete route, and V1's best-effort delete is what that sweep backs up.
 */
export function useDialogAttachments(isOpen: boolean, pickerTitle: string) {
  const [sessionId, setSessionId] = React.useState(newUploadSessionId);
  const [attachments, setAttachments] = React.useState<DialogAttachment[]>([]);
  const [isAttaching, setIsAttaching] = React.useState(false);
  const [attachError, setAttachError] = React.useState<string | null>(null);

  // One session per opening, as V1's `UseState(() => Guid.NewGuid())` gets with each new dialog.
  React.useEffect(() => {
    if (!isOpen) return;
    setSessionId(newUploadSessionId());
    setAttachments([]);
    setAttachError(null);
    setIsAttaching(false);
  }, [isOpen]);

  const onAttachFiles = React.useCallback(async () => {
    let picked: string | string[] | null;
    try {
      picked = await open({ multiple: true, title: pickerTitle });
    } catch (err) {
      setAttachError(describeBridgeError(err));
      return;
    }
    if (picked === null) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    if (paths.length === 0) return;

    setIsAttaching(true);
    setAttachError(null);
    try {
      for (const path of paths) {
        const staged = await bridge.uploadChatAttachment(path, sessionId);
        setAttachments((current) =>
          current.some((file) => file.path === staged.path)
            ? current
            : [...current, { name: staged.name, path: staged.path }],
        );
      }
    } catch (err) {
      setAttachError(describeBridgeError(err));
    } finally {
      setIsAttaching(false);
    }
  }, [pickerTitle, sessionId]);

  const onRemoveAttachment = React.useCallback((path: string) => {
    setAttachments((current) => current.filter((file) => file.path !== path));
  }, []);

  return {
    sessionId,
    attachments,
    /** The props `UpdatePlanDialog` / `SuggestChangesDialog` spread into their attachment slot. */
    props: {
      attachments,
      onAttachFiles: () => void onAttachFiles(),
      onRemoveAttachment,
      isAttaching,
      attachError,
    },
  };
}
