import { useEffect, useState } from "react";
import { bridge } from "../api/bridge";
import { bridgeErrorCode, describeBridgeError } from "../types/api";
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
 *
 * Nothing here is chat-specific, and the Review app's artifact screenshots use it too
 * (`ArtifactThumbnail` and `ArtifactFileSheet`), for the same reason and with the same payoff: the
 * tile and the sheet it opens read the file once between them.
 */

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i;

/** An attachment worth showing as a thumbnail rather than as a paperclip chip. */
export const isImageAttachment = (attachment: ChatAttachment): boolean =>
  attachment.mimeType?.startsWith("image/") === true || IMAGE_EXTENSIONS.test(attachment.path);

/**
 * Previews already resolved, keyed by path, so a thumbnail survives the re-render a streaming turn
 * causes and two rows showing the same file read it once.
 *
 * The guard's refusal is remembered as well: its answer for a given path — outside the local-file
 * roots or not an allow-listed image (`NOT_FOUND`), or too large to preview (`VALIDATION_ERROR`) —
 * does not change while the app is running, and asking again on every remount would be a request
 * per row for a file that is never coming. Any other failure is forgotten once it settles: a daemon
 * that was unreachable or restarting when the page first rendered is not an answer about the file,
 * and remembering it left every artifact screenshot on "No preview" until the app restarted — while
 * the artifact listing and text read beside it had already fallen back to disk.
 */
const previewCache = new Map<string, Promise<string>>();

/** The guard's own refusals, as `get_local_file_data_url` reports them. */
const DEFINITIVE_REFUSALS = new Set(["NOT_FOUND", "VALIDATION_ERROR"]);

/**
 * How many previews stay cached, least recently used first out. Each is the whole file as a base64
 * `data:` URL, and the Review app's artifact screenshots come through here too, so without a bound
 * every screenshot of every plan reviewed would be held for the life of the process.
 */
const MAX_CACHED_PREVIEWS = 64;

const loadPreview = (path: string): Promise<string> => {
  const cached = previewCache.get(path);
  if (cached) {
    // Re-inserted so the map's insertion order stays its recency order.
    previewCache.delete(path);
    previewCache.set(path, cached);
    return cached;
  }
  // `try` rather than a bare call: outside a Tauri webview `invoke` throws synchronously instead of
  // rejecting, and an effect is not a place where that can be caught.
  let pending: Promise<string>;
  try {
    pending = bridge.getLocalFilePreview(path);
  } catch (error) {
    pending = Promise.reject(error);
  }
  previewCache.set(path, pending);
  if (previewCache.size > MAX_CACHED_PREVIEWS) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
  pending.catch((error: unknown) => {
    const code = bridgeErrorCode(error);
    if (code !== undefined && DEFINITIVE_REFUSALS.has(code)) return;
    if (previewCache.get(path) === pending) previewCache.delete(path);
  });
  return pending;
};

/** Forgets the resolved previews. Tests use it so one case's stub cannot answer the next one's. */
export function resetAttachmentPreviewsForTesting(): void {
  previewCache.clear();
}

/** A preview's state: the `data:` URL once it resolves, or why it did not. */
export interface AttachmentPreviewState {
  url: string | null;
  failed: boolean;
  /** The rejection, described for a reader, while `failed`. */
  error: string | null;
}

const PENDING: AttachmentPreviewState = { url: null, failed: false, error: null };

/**
 * The `data:` URL for an image attachment, or `failed` when the daemon will not serve it.
 *
 * The webview cannot load a bare filesystem path — `file://` is blocked from the app's own origin — so
 * the bytes come from the daemon's guarded `GET /ivy/local-file`, which is the endpoint V1 points its
 * attachment `<img>` tags at. It is fetched natively rather than linked because that route takes its
 * credential in the query string and the app's only credential is the bearer secret the webview never
 * holds; see `src-tauri/src/commands/local_file.rs`.
 */
export function useAttachmentPreview(path: string, enabled: boolean): AttachmentPreviewState {
  const [state, setState] = useState<AttachmentPreviewState>(PENDING);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState(PENDING);
    loadPreview(path).then(
      (url) => {
        if (active) setState({ url, failed: false, error: null });
      },
      (error: unknown) => {
        if (active) setState({ url: null, failed: true, error: describeBridgeError(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [path, enabled]);

  return state;
}
