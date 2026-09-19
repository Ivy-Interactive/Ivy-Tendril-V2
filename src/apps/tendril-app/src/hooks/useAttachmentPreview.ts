import { useEffect, useState } from "react";
import { bridge } from "../api/bridge";
import type { ChatAttachment } from "../types/chat";

/**
 * Turning an attachment path into something the webview can show.
 *
 * This lives apart from any one view because both ends of a chat need it: the thread, where a sent
 * image renders as a thumbnail, and the composer, where the same image has to be visible *before*
 * it is sent. Sharing the module also shares the cache, so attaching a file and then sending it
 * fetches it once rather than twice.
 *
 * V1 keeps the same pair together in
 * `Ivy-Tendril/src/Ivy.Tendril.Widgets/frontend/src/ChatWidget/attachments.tsx`, where
 * `getAttachmentUrl` serves the composer's `ComposerAttachmentCard` and the thread's
 * `MessageAttachmentChip` alike.
 */

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i;

/** An attachment worth showing as a thumbnail rather than as a paperclip chip. */
export const isImageAttachment = (attachment: ChatAttachment): boolean =>
  attachment.mimeType?.startsWith("image/") === true || IMAGE_EXTENSIONS.test(attachment.path);

/**
 * Previews already resolved, keyed by path, so a thumbnail survives the re-render a streaming turn
 * causes and two rows showing the same file read it once.
 *
 * A rejection is remembered as well: the daemon's answer for a given path — outside the local-file
 * roots, or not an allow-listed image — does not change while the app is running, and retrying it on
 * every re-render would be a request per frame for a file that is never coming.
 */
const previewCache = new Map<string, Promise<string>>();

const loadPreview = (path: string): Promise<string> => {
  const cached = previewCache.get(path);
  if (cached) return cached;
  // `try` rather than a bare call: outside a Tauri webview `invoke` throws synchronously instead of
  // rejecting, and an effect is not a place where that can be caught.
  let pending: Promise<string>;
  try {
    pending = bridge.getLocalFilePreview(path);
  } catch (error) {
    pending = Promise.reject(error);
  }
  previewCache.set(path, pending);
  return pending;
};

/** Forgets the resolved previews. Tests use it so one case's stub cannot answer the next one's. */
export function resetAttachmentPreviewsForTesting(): void {
  previewCache.clear();
}

/**
 * The `data:` URL for an image attachment, or `failed` when the daemon will not serve it.
 *
 * The webview cannot load a bare filesystem path — `file://` is blocked from the app's own origin — so
 * the bytes come from the daemon's guarded `GET /ivy/local-file`, which is the endpoint V1 points its
 * attachment `<img>` tags at. It is fetched natively rather than linked because that route takes its
 * credential in the query string and the app's only credential is the bearer secret the webview never
 * holds; see `src-tauri/src/commands/local_file.rs`.
 */
export function useAttachmentPreview(
  path: string,
  enabled: boolean,
): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false,
  });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState({ url: null, failed: false });
    loadPreview(path).then(
      (url) => {
        if (active) setState({ url, failed: false });
      },
      () => {
        if (active) setState({ url: null, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [path, enabled]);

  return state;
}
