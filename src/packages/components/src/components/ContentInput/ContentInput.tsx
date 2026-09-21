import React, { useState, useRef, useEffect } from "react";
import { Spinner } from "../ui/spinner";
import { TuiKbd } from "../ui/TuiKbd";
import { IconButton } from "../ui/IconButton";
import { TuiBadge } from "../ui/TuiBadge";
import { VoiceRecorder, type VoiceStatus } from "./voice-recorder";
import { clipboardFiles } from "../../lib/clipboard";
import { isImageFile as isKnownImageType } from "../../lib/imageUtils";
import { useOutsideClick } from "../../hooks/use-outside-click";
import { useMenuKeyboard } from "../../hooks/use-menu-keyboard";
import "./content-input.css";

type PdfJsLib = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJsLib> | null = null;

/**
 * Hands pdf.js a worker we constructed ourselves, instead of a URL for it to construct one from.
 *
 * THE BUG. Given a `workerSrc` URL, pdf.js first asks `PDFWorker._isSameOrigin(window.location,
 * workerSrc)`, which opens with `if (!base?.origin || base.origin === "null") return false`. In the
 * packaged app on macOS and Linux the frontend is served from `tauri://localhost`, and because
 * `tauri:` is a custom (non-special) URL scheme, WHATWG origin serialisation gives the literal
 * string `"null"`. So that check fails no matter which URL we supply, and pdf.js routes the load
 * through `_createCDNWrapper` — `URL.createObjectURL(new Blob([...], { type: "text/javascript" }))`.
 * Our CSP refuses the `blob:` worker, `new Worker` throws, and pdf.js quietly falls back to
 * `#setupFakeWorker()`: every page parses on the main thread and the UI freezes while a thumbnail
 * renders, with no error surfaced. Windows and Android are served from `http(s)://tauri.localhost`
 * — a real origin — so they never took that path, and `pnpm dev` serves from
 * `http://127.0.0.1:5173`, which is why this never showed up outside a packaged macOS/Linux build.
 *
 * THE FIX. `GlobalWorkerOptions.workerPort` is read by `getDocument` and passed to
 * `PDFWorker.create`, whose constructor takes the `#initializeFromPort` branch — `_isSameOrigin` is
 * never consulted and no blob is minted. Pointing `workerSrc` at the bundled asset would NOT have
 * worked: under a null origin no URL can satisfy that check. The `worker-src 'self' blob:` widening
 * in `src-tauri/tauri.conf.json` is the belt to this braces (see `tests/tauri-csp.test.ts` in the
 * app for why both exist); `'self'` is what authorises the `new Worker` below.
 *
 * `PDFWorker.create` caches per port, so the single worker built here is shared by every
 * `PdfThumbnail` on screen. Nothing calls `loadingTask.destroy()` today; if that changes, note that
 * `PDFWorker.destroy()` terminates a port-provided worker too, so `pdfjsPromise` would have to be
 * invalidated alongside it or later thumbnails would talk to a dead worker.
 *
 * The `workerSrc` assignment is kept as a fallback for environments with no `Worker` constructor —
 * jsdom under the test runner, and SSR — where a port cannot be built at all.
 */
export const loadPdfJs = async (): Promise<PdfJsLib> => {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.mjs?url"),
    ])
      .then(([pdfjsLib, workerModule]) => {
        const lib = (pdfjsLib as any).getDocument
          ? pdfjsLib
          : ((pdfjsLib as any).default ?? pdfjsLib);
        if (typeof window !== "undefined" && lib.GlobalWorkerOptions) {
          if (typeof Worker !== "undefined") {
            lib.GlobalWorkerOptions.workerPort = new Worker(workerModule.default, {
              type: "module",
            });
          } else {
            lib.GlobalWorkerOptions.workerSrc = workerModule.default;
          }
        }
        return lib;
      })
      .catch((err) => {
        pdfjsPromise = null;
        throw err;
      });
  }
  return pdfjsPromise;
};

export const resetPdfJsCacheForTest = () => {
  pdfjsPromise = null;
};

export const PdfThumbnail: React.FC<{ url: string; onError?: () => void }> = ({ url, onError }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  // The callback is read through a ref so a caller passing an inline arrow -- a new function every
  // render, which the strip does -- cannot re-run the render effect and re-parse the document.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let active = true;

    const renderPdf = async () => {
      try {
        const pdfjsLib = await loadPdfJs();
        if (!active) return;
        const loadingTask = pdfjsLib.getDocument({ url });
        const pdf = await loadingTask.promise;
        if (!active) return;
        const page = await pdf.getPage(1);
        if (!active) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext("2d");
        if (!context) return;

        const unscaledViewport = page.getViewport({ scale: 1.0 });
        const scaleX = 140 / unscaledViewport.width;
        const scaleY = 105 / unscaledViewport.height;
        const baseScale = Math.max(scaleX, scaleY);
        const scale = baseScale * 3;
        const viewport = page.getViewport({ scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
          canvas: canvas,
        };
        await page.render(renderContext).promise;
      } catch (err) {
        console.error("PDF.js render failed:", err);
        if (active) {
          setError(true);
          // Tells the owning chip the document did not render, so it can fall back to the extension
          // pill rather than leave the glyph below standing in for a preview that will never arrive.
          onErrorRef.current?.();
        }
      }
    };

    void renderPdf();

    return () => {
      active = false;
    };
  }, [url]);

  // Only reached by a caller that passed no `onError`; one that did has already replaced this whole
  // subtree with the extension pill by the time this would render.
  if (error) {
    return <div className="civ-thumbnail-pdf-fallback" aria-hidden="true" />;
  }

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: "top",
        display: "block",
      }}
    />
  );
};

export interface AttachedFile {
  name: string;
  type: string;
  size?: string;
  /**
   * Bytes for the thumbnail, for an attachment the consumer declares rather than one the user picked.
   *
   * A picked, dropped or pasted file arrives as a `File`, so `handleFiles` mints an object URL from it
   * and the chip previews itself. A declared attachment carried a name, a MIME type and a size and
   * nothing else -- no path a webview may read and no bytes to read from -- so the strip had nothing
   * to render and every declared chip fell back to the extension pill whatever its type. This is the
   * channel for those bytes: a `File`/`Blob` (object URL minted and revoked here), or a URL the
   * webview can already load (`data:`, `blob:` or a served `http(s):`), used verbatim.
   *
   * Anything else -- a bare `file://` URL or an OS path -- is not loadable from the webview and is
   * deliberately rejected rather than attempted; such an attachment keeps the pill.
   */
  previewSource?: Blob | string;
}

export interface ContentInputProps {
  id: string;
  width?: string;
  height?: string;
  placeholder?: string;
  value?: string;
  transcriptionUrl?: string;
  uploadUrl?: string;
  /**
   * Model name echoed back in the `OnSubmit` payload as `selectedModel` / `SelectedModel`.
   * The component renders no model picker — listing and picking models is the consumer's job
   * (render your own control into `slots.LeftActions`).
   */
  selectedModel?: string;
  attachedFiles?: AttachedFile[];
  submitLabel?: string;
  menuOptions?: string[];
  autoFocus?: boolean;
  onIvyEvent?: (eventName: string, id: string, argumentsArray: unknown[]) => void;
  eventHandler?: (eventName: string, id: string, argumentsArray: unknown[]) => void;
  events?: string[];
  slots?: {
    /** Project picker rendered in the left action row. Supersedes the removed `projects` / `selectedProject` props. */
    ProjectPicker?: React.ReactNode;
    LeftActions?: React.ReactNode;
  };
}

const findScrollableParent = (el: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
};

const fileRegExp = /\s?\[file:\s*([^\]]+)\]/g;

/**
 * Whether a preview URL is one the webview may load.
 *
 * `previewSource` is consumer-supplied and a chip feeds it to `<img src>` or to pdf.js, so only the
 * three schemes that carry their own bytes are allowed through: `data:`, `blob:` and `http(s):`. A
 * `file://` URL or a bare OS path is rejected rather than attempted -- the webview cannot load either
 * under the app's CSP, and letting one through paints the broken-image glyph this change exists to
 * remove. Written as an allowlist so `javascript:` is excluded by construction rather than by a
 * blocklist someone has to keep complete.
 */
const isLoadablePreviewUrl = (url: string) => /^(data:|blob:|https?:)/i.test(url.trim());

/** True for a PDF named either by extension or by MIME type. */
const isPdfName = (nameOrType: string) => {
  const lower = nameOrType.toLowerCase();
  return lower === "application/pdf" || lower.split(".").pop() === "pdf";
};

const parseValue = (val: string) => {
  const filePaths: string[] = [];
  const cleanText = val.replace(fileRegExp, (_match, path) => {
    filePaths.push(path.trim());
    return "";
  });
  return { cleanText, filePaths };
};

export const ContentInput: React.FC<ContentInputProps> = ({
  id,
  width = "100%",
  height = "auto",
  placeholder = "How can I help you today?",
  value = "",
  transcriptionUrl = "wss://tendril-api.ivy.app/transcribe/ws",
  uploadUrl,
  selectedModel = "Build",
  attachedFiles = [],
  autoFocus = false,
  submitLabel,
  menuOptions = [],
  onIvyEvent,
  eventHandler,
  slots,
}) => {
  const dispatchEvent = onIvyEvent || eventHandler;

  const parsed = parseValue(value);
  const [text, setText] = useState(parsed.cleanText);
  const [files, setFiles] = useState<string[]>(parsed.filePaths);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const [previews, setPreviews] = useState<Record<string, string>>({});
  /**
   * Attachments whose preview URL loaded but whose bytes would not decode, keyed as `previews` is.
   *
   * A dead `<img src>` paints the browser's broken-image glyph across the whole card, which reads as
   * a bug rather than as "no preview available". Recording the failure demotes that chip back to the
   * extension pill, which is the honest rendering for content we could not show.
   */
  const [previewFailed, setPreviewFailed] = useState<Record<string, true>>({});
  const [fileMeta, setFileMeta] = useState<Record<string, { lineCount?: number; size: string }>>(
    {},
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef(files);
  const textRef = useRef(text);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  /**
   * The object URLs this component minted, so unmount can revoke every one of them.
   *
   * A ref rather than a derivation from `previews` at cleanup time: a cleanup closure captures the
   * `previews` value from the render that created it, so any URL minted after that render would leak
   * for the lifetime of the document. The ref is the same object on every render, so the unmount
   * effect below sees them all. Only our own URLs go in -- revoking a consumer's `blob:` URL would
   * break their copy of it, and a `data:`/`http(s):` URL has nothing to revoke.
   */
  const ownedObjectUrls = useRef<Set<string>>(new Set());

  const registerObjectUrl = (url: string) => {
    ownedObjectUrls.current.add(url);
    return url;
  };

  const releaseObjectUrl = (url: string) => {
    if (!ownedObjectUrls.current.delete(url)) return;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // An environment without URL support has nothing to clean up.
    }
  };

  // On unmount, not on every `previews` change: the strip re-renders constantly and a URL still
  // referenced by a mounted <img> has to outlive those renders.
  useEffect(
    () => () => {
      for (const url of ownedObjectUrls.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      ownedObjectUrls.current.clear();
    },
    [],
  );

  /**
   * The source each declared attachment's preview URL was derived from, so a re-run can tell "same
   * bytes as last time" from "new bytes for the same name". A `Blob` has no value identity to compare
   * -- two reads of one file are two unequal objects -- so the object itself is the key.
   */
  const declaredPreviews = useRef<Map<string, { source: Blob | string; url: string }>>(new Map());

  /**
   * Gives a consumer-declared attachment the preview URL a picked file already gets from `handleFiles`.
   *
   * Written to be idempotent, not merely cheap. `attachedFiles` defaults to a fresh `[]` and consumers
   * routinely pass an inline array literal, so this effect re-runs on essentially every render; a body
   * that minted a URL or returned a new `previews` object each time would set state on every render
   * and spin React until it threw "Maximum update depth exceeded". So a source already mapped is left
   * alone, and `setPreviews` returns `prev` unchanged when nothing moved -- which makes the re-run a
   * genuine no-op rather than a cheap one.
   */
  useEffect(() => {
    const seen = new Set<string>();
    const resolved: Array<[string, string]> = [];

    for (const attachment of attachedFiles) {
      const source = attachment.previewSource;
      if (!source) continue;
      seen.add(attachment.name);

      const existing = declaredPreviews.current.get(attachment.name);
      if (existing && existing.source === source) {
        resolved.push([attachment.name, existing.url]);
        continue;
      }

      let url: string | null = null;
      if (typeof source === "string") {
        if (isLoadablePreviewUrl(source)) url = source;
      } else if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        try {
          url = URL.createObjectURL(source);
          registerObjectUrl(url);
        } catch {
          url = null;
        }
      }

      // Swapping an attachment's bytes must not strand the URL minted for the previous ones.
      if (existing) releaseObjectUrl(existing.url);
      if (!url) {
        declaredPreviews.current.delete(attachment.name);
        continue;
      }
      declaredPreviews.current.set(attachment.name, { source, url });
      resolved.push([attachment.name, url]);
    }

    // An attachment the consumer dropped takes its URL with it; otherwise a long-lived composer
    // accumulates one blob per attachment it has ever been handed.
    for (const [name, entry] of declaredPreviews.current) {
      if (seen.has(name)) continue;
      releaseObjectUrl(entry.url);
      declaredPreviews.current.delete(name);
    }

    setPreviews((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [name, url] of resolved) {
        if (next[name] === url) continue;
        next[name] = url;
        changed = true;
      }
      // Returning `prev` is what stops the render loop described above.
      return changed ? next : prev;
    });
  }, [attachedFiles]);

  /**
   * `lib/imageUtils`' predicate, not a second list: the local copy had drifted (it omitted `bmp`) and
   * two lists of previewable extensions is exactly the bug that leaves one call site rendering a
   * thumbnail and another rendering a pill for the same file. `avif` is handled alongside it because
   * every webview this ships in decodes it natively while the shared list predates the format.
   */
  const isImageFile = (path: string) =>
    isKnownImageType(path) || path.split(".").pop()?.toLowerCase() === "avif";

  const isPdfFile = (path: string) => isPdfName(path);

  const getFileMetadata = (filePath: string) => {
    const fileName = filePath.split(/[/\\]/).pop() || "";
    const lowerName = fileName.toLowerCase();
    const ext = fileName.split(".").pop()?.toUpperCase() || "";

    for (const [origName, meta] of Object.entries(fileMeta)) {
      const origBase = origName.split(".")[0].toLowerCase().replace(/\s+/g, "_");
      if (lowerName.includes(origBase)) {
        return {
          name: origName,
          metaText: meta.lineCount !== undefined ? `${meta.lineCount} lines` : meta.size,
          badge: ext,
        };
      }
    }

    const cleanName = fileName.replace(/_[a-f0-9]{8}(\.[^.]+)$/i, "$1");
    return {
      name: cleanName,
      metaText: "Document",
      badge: ext,
    };
  };

  /**
   * The preview URL for a chip, together with the `previews` key it was found under.
   *
   * The key comes back because `previews` is keyed by the original file name while a chip is keyed by
   * its ` [file: ...]` ref -- the upload path may rename a file on the way through -- so `onError` has
   * no other way to record a decode failure under the key the next lookup will use. Returns nothing
   * once a URL is known not to decode, which is what demotes the chip to the extension pill.
   */
  const getPreview = (filePath: string) => {
    const fileName = filePath.split(/[/\\]/).pop() || "";
    const lowerName = fileName.toLowerCase();

    for (const [origName, url] of Object.entries(previews)) {
      const origBase = origName.split(".")[0].toLowerCase().replace(/\s+/g, "_");
      if (lowerName.includes(origBase)) {
        if (previewFailed[origName]) return null;
        return { key: origName, url };
      }
    }
    return null;
  };

  useOutsideClick(menuOpen, [menuRef], () => setMenuOpen(false));

  useMenuKeyboard(menuOpen, {
    containerRef: dropdownRef,
    triggerRef: menuTriggerRef,
    onClose: () => setMenuOpen(false),
  });

  // Sync value prop to text and files state
  useEffect(() => {
    const { cleanText, filePaths } = parseValue(value);
    setFiles(filePaths);

    if (cleanText === "") {
      setText("");
    } else if (!isFocused && cleanText !== textRef.current) {
      setText(cleanText);
    }
  }, [value, isFocused]);

  // Textarea Auto-Growing Height
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const scrollParent = findScrollableParent(textarea);
    const savedScrollTop = scrollParent?.scrollTop ?? 0;

    const maxHeight = parseFloat(getComputedStyle(textarea).maxHeight) || Infinity;
    textarea.style.height = "auto";
    const next = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${next}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";

    // Resetting height to "auto" reflows the dialog's scroll container, which can
    // yank it to the top (tab navigation) or scroll the freshly pasted text out of
    // view. Restore the position the container had before we touched the height.
    if (scrollParent && scrollParent.scrollTop !== savedScrollTop) {
      scrollParent.scrollTop = savedScrollTop;
    }
  }, [text, files]);

  // Timer logic for voice recording
  useEffect(() => {
    if (voiceStatus === "recording") {
      setDuration(0);
      timerRef.current = window.setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [voiceStatus]);
  // Stop recording when component unmounts
  useEffect(() => {
    return () => {
      if (recorderRef.current) {
        recorderRef.current.stop();
        // Prevent state updates on unmounted component
        (recorderRef.current as any).options = {
          onStatusChange: () => {},
          onResult: () => {},
          onError: () => {},
          onVolumeChange: () => {},
        };
      }
    };
  }, []);

  // Prevent dialog from closing on drag-and-drop operations
  useEffect(() => {
    let dragCounter = 0;
    let isDraggingGlobal = false;
    let dragTimeout: any = null;

    const resetDragTimeout = () => {
      if (dragTimeout) {
        clearTimeout(dragTimeout);
      }
      dragTimeout = setTimeout(() => {
        isDraggingGlobal = false;
        dragCounter = 0;
      }, 500); // 500ms watchdog
    };

    const handleDragEnterWindow = () => {
      dragCounter++;
      isDraggingGlobal = true;
      resetDragTimeout();
    };

    const handleDragOverWindow = (e: DragEvent) => {
      e.preventDefault(); // Required to allow drop events and prevent browser navigation
      isDraggingGlobal = true;
      resetDragTimeout();
    };

    const handleDragLeaveWindow = () => {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        isDraggingGlobal = false;
        if (dragTimeout) {
          clearTimeout(dragTimeout);
          dragTimeout = null;
        }
      }
    };

    const handleDropWindow = (e: DragEvent) => {
      e.preventDefault(); // Prevent browser default navigation
      dragCounter = 0;
      isDraggingGlobal = false;
      if (dragTimeout) {
        clearTimeout(dragTimeout);
        dragTimeout = null;
      }
    };

    const handleFocusInWindow = (e: FocusEvent) => {
      if (isDraggingGlobal) {
        // Stop Radix's DismissableLayer from closing the dialog when window gains focus due to drag-and-drop
        e.stopImmediatePropagation();
      }
    };

    const handlePointerDownWindow = (e: Event) => {
      if (isDraggingGlobal) {
        // Stop Radix's DismissableLayer from closing the dialog on pointer downs during a drag
        e.stopImmediatePropagation();
      }
    };

    window.addEventListener("dragenter", handleDragEnterWindow, true);
    window.addEventListener("dragover", handleDragOverWindow, true);
    window.addEventListener("dragleave", handleDragLeaveWindow, true);
    window.addEventListener("drop", handleDropWindow, true);
    window.addEventListener("focusin", handleFocusInWindow, true);
    window.addEventListener("pointerdown", handlePointerDownWindow, true);
    window.addEventListener("mousedown", handlePointerDownWindow, true);

    return () => {
      if (dragTimeout) clearTimeout(dragTimeout);
      window.removeEventListener("dragenter", handleDragEnterWindow, true);
      window.removeEventListener("dragover", handleDragOverWindow, true);
      window.removeEventListener("dragleave", handleDragLeaveWindow, true);
      window.removeEventListener("drop", handleDropWindow, true);
      window.removeEventListener("focusin", handleFocusInWindow, true);
      window.removeEventListener("pointerdown", handlePointerDownWindow, true);
      window.removeEventListener("mousedown", handlePointerDownWindow, true);
    };
  }, []);

  const canSubmit = (text.trim().length > 0 || files.length > 0) && voiceStatus === "idle";

  const handleSubmit = () => {
    if (voiceStatus !== "idle") return;
    if (!text.trim() && files.length === 0) return;
    const fullText = text + files.map((f) => ` [file: ${f}]`).join("");
    if (dispatchEvent) {
      dispatchEvent("OnSubmit", id, [
        {
          value: fullText,
          Value: fullText,
          selectedModel: selectedModel,
          SelectedModel: selectedModel,
          attachedFiles: attachedFiles,
          AttachedFiles: attachedFiles,
        },
      ]);
    }
    setText("");
    setFiles([]);
  };

  const handleTextChange = (val: string) => {
    setText(val);
    if (dispatchEvent) {
      const fullText = val + files.map((f) => ` [file: ${f}]`).join("");
      dispatchEvent("OnChange", id, [fullText]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleUploadFile = async (file: File) => {
    if (uploadUrl) {
      try {
        const formData = new FormData();
        const mimeType = file.type || "image/png";
        const ext = mimeType.split("/")[1] || "png";
        const fileName =
          file.name && file.name.trim() !== "" && file.name !== "image.png" && file.name !== "blob"
            ? file.name
            : `screenshot_${Date.now()}.${ext}`;

        formData.append("file", file, fileName);

        const response = await fetch(uploadUrl, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}`);
        }
      } catch (err) {
        console.error("[ContentInput] File upload failed:", err);
        setRecordError(
          `Failed to upload file: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    } else {
      // Fallback to base64 WebSocket transfer
      return new Promise<void>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
          const result = reader.result as string;
          const base64Data = result.split(",")[1];
          if (dispatchEvent) {
            dispatchEvent("OnUploadFile", id, [
              {
                name: file.name,
                Name: file.name,
                base64Data: base64Data,
                Base64Data: base64Data,
              },
            ]);
          }
          resolve();
        };
        reader.onerror = (err) => {
          setRecordError("Failed to read file");
          reject(err);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFiles = async (filesList: FileList | File[]) => {
    const list = Array.from(filesList);

    for (const file of list) {
      const sizeStr = formatSize(file.size);
      let lineCount: number | undefined;

      if (
        file.type.startsWith("text/") ||
        file.name.endsWith(".txt") ||
        file.name.endsWith(".log") ||
        file.name.endsWith(".json") ||
        file.name.endsWith(".csv")
      ) {
        try {
          const textContent = await file.text();
          lineCount = textContent.split("\n").length;
        } catch {
          // ignore
        }
      }

      setFileMeta((prev) => ({
        ...prev,
        [file.name]: { lineCount, size: sizeStr },
      }));

      if (isImageFile(file.type) || isImageFile(file.name) || isPdfName(file.type || file.name)) {
        const objectUrl = registerObjectUrl(URL.createObjectURL(file));
        setPreviews((prev) => ({
          ...prev,
          [file.name]: objectUrl,
        }));
      }
    }

    // THE BUG (#file-upload): every attach path -- the paperclip, a drop, a paste -- ended here, and
    // this loop only ever uploaded. Nothing added the file to `files`, which is the state the
    // thumbnail strip renders, `canSubmit` consults, and `handleSubmit` turns into the ` [file: ...]`
    // refs that are the only channel the attachment has to the consumer. So a picked file produced no
    // chip, no event and no change to the disabled Send button -- indistinguishable from the control
    // being dead. Registering the name here is what makes an attachment exist at all.
    //
    // The name, not a path: a `File` from an `<input>` or a clipboard exposes no path (see the same
    // note in `ChatView.processFiles`), and the name is what `getPreview`/`getFileMetadata` key the
    // object URL and the size badge by.
    const names = list.map((file) => file.name);
    const nextFiles = [...filesRef.current, ...names.filter((n) => !filesRef.current.includes(n))];
    setFiles(nextFiles);
    filesRef.current = nextFiles;
    if (dispatchEvent) {
      const fullText = textRef.current + nextFiles.map((f) => ` [file: ${f}]`).join("");
      dispatchEvent("OnChange", id, [fullText]);
    }

    for (const file of list) {
      await handleUploadFile(file);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFiles = clipboardFiles(e.clipboardData);
    if (pastedFiles.length === 0) return;
    // Only once there is a file to take: a paste carrying just text must still reach the textarea.
    e.preventDefault();
    await handleFiles(pastedFiles);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleFiles(e.dataTransfer.files);
    }
  };

  const handleRemoveFile = (filePath: string) => {
    const fileName = filePath.split(/[/\\]/).pop() || "";
    const lowerName = fileName.toLowerCase();

    for (const [origName, url] of Object.entries(previews)) {
      const origBase = origName.split(".")[0].toLowerCase().replace(/\s+/g, "_");
      if (lowerName.includes(origBase)) {
        releaseObjectUrl(url);
        const newPreviews = { ...previews };
        delete newPreviews[origName];
        setPreviews(newPreviews);
        // Clearing the failure alongside the URL keeps a re-attached file from inheriting the verdict
        // reached about the bytes it no longer has.
        setPreviewFailed((prev) => {
          if (!(origName in prev)) return prev;
          const next = { ...prev };
          delete next[origName];
          return next;
        });
        break;
      }
    }

    const newFiles = files.filter((f) => f !== filePath);
    setFiles(newFiles);
    if (dispatchEvent) {
      dispatchEvent("OnRemoveAttachment", id, [filePath]);
    }
    const fullText = text + newFiles.map((f) => ` [file: ${f}]`).join("");
    if (dispatchEvent) {
      dispatchEvent("OnChange", id, [fullText]);
    }
  };

  // Recording management
  const toggleRecording = async () => {
    if (voiceStatus === "idle") {
      setRecordError(null);
      setVolume(0);
      const recorder = new VoiceRecorder({
        endpoint: transcriptionUrl,
        onStatusChange: (status) => setVoiceStatus(status),
        onResult: (transcription) => {
          console.log("[ContentInput] Transcription result received:", transcription);
          if (transcription.trim() === "") {
            setRecordError(
              "The transcription did not contain enough information to generate a prompt. Please try again and speak clearly.",
            );
            return;
          }
          setText((prev) => {
            const next = prev ? `${prev} ${transcription}` : transcription;
            console.log("[ContentInput] Next text state:", next);
            if (dispatchEvent) {
              const fullText = next + filesRef.current.map((f) => ` [file: ${f}]`).join("");
              dispatchEvent("OnChange", id, [fullText]);
            }
            return next;
          });
        },
        onError: (err) => setRecordError(err),
        onVolumeChange: (vol) => setVolume(vol),
      });
      recorderRef.current = recorder;
      await recorder.start();
    } else {
      recorderRef.current?.stop();
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remaining = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
  };

  // Generate real audio level height modifications
  const barCount = 10;
  const bars = Array.from({ length: barCount }, (_, i) => {
    const baseHeight = 4 + (i % 3) * 6; // base height between 4px and 16px
    const dynamicScale = 1 + volume * 18; // scale based on volume
    return Math.min(28, baseHeight * dynamicScale);
  });

  return (
    <div className="civ-shell" style={{ width, height }}>
      {recordError && (
        <div className="civ-error-banner">
          <svg className="civ-icon-error" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>{recordError}</span>
          <IconButton
            className="civ-error-close"
            label="Dismiss error"
            size="2xs"
            onClick={() => setRecordError(null)}
          >
            ×
          </IconButton>
        </div>
      )}

      <div
        className={`civ-input-card ${isDragging ? "dragging" : ""}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Render Attached Files as Thumbnails */}
        {files.length > 0 && (
          <div className="civ-attachments-list thin-scrollbar">
            {files.map((filePath, idx) => {
              const isImage = isImageFile(filePath);
              const isPdf = isPdfFile(filePath);
              // Only a type we can actually decode reaches `getPreview`; everything else -- and
              // anything that decoded to nothing -- keeps the extension pill, which stays the
              // correct rendering for content we cannot show.
              const preview = isImage || isPdf ? getPreview(filePath) : null;
              const meta = getFileMetadata(filePath);
              // `onError` fires during the paint that shows the broken glyph, so the demotion has to
              // be keyed by the `previews` entry rather than the chip index: the strip re-orders as
              // files are removed and an index would follow the wrong card.
              const markFailed = (key: string) =>
                setPreviewFailed((prev) => ({ ...prev, [key]: true }));

              return (
                <div
                  key={idx}
                  className={`civ-thumbnail-card${preview ? " civ-thumbnail-card-previewed" : ""}`}
                >
                  {/* Background Preview for images/PDFs */}
                  {preview && (
                    <div className="civ-thumbnail-preview-container">
                      {isImage ? (
                        // An `<img>` even for SVG, never inlined markup: the image context refuses
                        // to run script, so a hostile `<svg onload=...>` an attachment smuggles in
                        // is inert here and would not be if the source were dropped into the DOM.
                        <img
                          className="civ-thumbnail-image-preview"
                          src={preview.url}
                          alt=""
                          onError={() => markFailed(preview.key)}
                        />
                      ) : (
                        <PdfThumbnail url={preview.url} onError={() => markFailed(preview.key)} />
                      )}
                      {/* Scrim: the card's own text sits on top of arbitrary pixels, so this is what
                          keeps it readable. See `.civ-thumbnail-preview-overlay` for why it is a
                          two-ended gradient rather than a flat wash. */}
                      <div className="civ-thumbnail-preview-overlay" />
                    </div>
                  )}

                  {/* Overlaid Close Button */}
                  <IconButton
                    className="civ-thumbnail-card-remove"
                    label="Remove file"
                    size="2xs"
                    shape="round"
                    variant="outline"
                    onClick={() => handleRemoveFile(filePath)}
                  >
                    ×
                  </IconButton>

                  {/* Overlaid File Metadata & Badge */}
                  <div className="civ-thumbnail-content">
                    <div style={{ minWidth: 0 }}>
                      <div className="civ-thumbnail-doc-name">{meta.name}</div>
                      {/* The thumbnail is the better answer to "what is this", so the "Document" /
                          size line only earns its space on a card with nothing to show. */}
                      {!preview && <div className="civ-thumbnail-doc-meta">{meta.metaText}</div>}
                    </div>
                    <TuiBadge className="civ-thumbnail-doc-badge" caps>
                      {meta.badge}
                    </TuiBadge>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Text Area Input */}
        <textarea
          ref={textareaRef}
          className="civ-textarea"
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => {
            setIsFocused(true);
            if (dispatchEvent) {
              dispatchEvent("OnFocus", id, []);
            }
          }}
          onBlur={() => {
            setIsFocused(false);
            if (dispatchEvent) {
              dispatchEvent("OnBlur", id, []);
            }
          }}
          placeholder={placeholder}
          rows={1}
          disabled={voiceStatus === "connecting" || voiceStatus === "processing"}
        />

        {/* Action Controls Row */}
        <div className="civ-control-bar">
          {/* Attachment upload button & project ghost select */}
          <div className="civ-attachment-row">
            <div className="civ-attachment-upload-container">
              <input
                type="file"
                multiple
                ref={fileInputRef}
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files) {
                    void handleFiles(e.target.files);
                    e.target.value = "";
                  }
                }}
              />
              <IconButton
                className="civ-plus-btn"
                label="Attach files"
                size="lg"
                shape="round"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </IconButton>
            </div>

            {slots?.ProjectPicker || slots?.LeftActions}
          </div>

          {/* Right Side Buttons */}
          <div className="civ-right-actions">
            {/* Voice Input Container */}
            <div className={`civ-voice-container ${voiceStatus !== "idle" ? "active" : ""}`}>
              {voiceStatus !== "idle" && (
                <div className="civ-recording-bar">
                  <span className="civ-dot-pulse" />
                  <span className="civ-timer">{formatTime(duration)}</span>
                  <div className="civ-equalizer">
                    {bars.map((h, i) => (
                      <div key={i} className="civ-eq-bar" style={{ height: `${h}px` }} />
                    ))}
                  </div>
                </div>
              )}
              <IconButton
                className={`civ-mic-btn civ-status-${voiceStatus}`}
                label="Voice input transcription"
                size="lg"
                shape="round"
                variant="outline"
                active={voiceStatus !== "idle"}
                onClick={toggleRecording}
              >
                {voiceStatus === "connecting" ? (
                  <Spinner
                    size={14}
                    duration="0.8s"
                    color="var(--accent)"
                    trackColor="var(--border)"
                  />
                ) : voiceStatus === "processing" ? (
                  <Spinner
                    size={14}
                    duration="0.8s"
                    color="var(--destructive)"
                    trackColor="var(--border)"
                  />
                ) : voiceStatus === "recording" ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="6" y="6" width="12" height="12" rx="2" ry="2" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v3M8 22h8" />
                  </svg>
                )}
              </IconButton>
            </div>

            {/* Submit Button or Split Button */}
            {menuOptions && menuOptions.length > 0 ? (
              <div
                className={`civ-split-btn-container ${!canSubmit ? "disabled" : ""}`}
                ref={menuRef}
              >
                <button
                  className="civ-submit-btn civ-submit-btn-labeled civ-split-btn-left"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  type="button"
                  title={submitLabel || "Send"}
                >
                  <span className="civ-submit-text">{submitLabel}</span>
                  <TuiKbd
                    keys="Ctrl+Enter"
                    platform
                    variant="outline"
                    className="civ-submit-shortcut"
                  />
                </button>
                <button
                  ref={menuTriggerRef}
                  className="civ-split-btn-arrow"
                  onClick={() => setMenuOpen(!menuOpen)}
                  disabled={!canSubmit}
                  type="button"
                  title="More options"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {menuOpen && (
                  <div ref={dropdownRef} className="civ-dropdown-menu" role="menu">
                    {menuOptions.map((option, idx) => (
                      <button
                        key={idx}
                        className="civ-dropdown-item"
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          if (dispatchEvent) {
                            dispatchEvent("OnMenuAction", id, [option]);
                          }
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button
                className={`civ-submit-btn ${submitLabel ? "civ-submit-btn-labeled" : ""}`}
                onClick={handleSubmit}
                disabled={!canSubmit}
                type="button"
                title={submitLabel || "Send"}
              >
                {submitLabel ? (
                  <>
                    <span className="civ-submit-text">{submitLabel}</span>
                    <TuiKbd
                      keys="Ctrl+Enter"
                      platform
                      variant="outline"
                      className="civ-submit-shortcut"
                    />
                  </>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
