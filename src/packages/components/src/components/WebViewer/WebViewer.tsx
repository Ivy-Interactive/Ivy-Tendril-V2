import React, { useCallback, useEffect, useRef, useState } from "react";
import "../ui/ui.css";
import "./web-viewer.css";
import { getHeight, getWidth } from "@/lib/styles";
import { canonicalPageUrl } from "./pageUrl";
import { Toolbar, type ToolbarAction } from "./Toolbar";
import { DEVICE_LABELS, DEVICE_VIEWPORTS, toDeviceKey, type DeviceKey } from "./devices";
import { TuiBadge } from "../ui/TuiBadge";
import { useProxyOrigin } from "@/contexts/webviewer-context";

// ---------------------------------------------------------------------------
// Types

type EventHandler = (eventName: string, id: string, args: unknown[]) => void;
type StreamSubscriber = (streamId: string, onData: (data: unknown) => void) => () => void;

export interface WebViewerProps {
  id: string;
  width?: string;
  height?: string;
  url?: string;
  device?: string; // "Desktop" | "Mobile" | "Tablet" (omitted when Desktop)
  /**
   * Origin serving the proxy routes, overriding {@link WebViewerProvider}. `""` is same-origin.
   *
   * An escape hatch for stories and tests; an application should mount the provider once in its
   * shell rather than answer this at every call site, since a caller that omits it gets a viewer
   * that works in the browser build and quietly fails under Tauri.
   */
  proxyOrigin?: string;
  toolbar?: boolean;
  actions?: ToolbarAction[];
  commands?: { id: string };
  subscribeToStream?: StreamSubscriber;
  eventHandler?: EventHandler;
  events?: string[];
}

interface DebugPayload {
  source?: { file?: string; line?: number; col?: number; codeFrame?: string };
  codeFrame?: string;
  frames?: Array<{ file: string; line: number; col: number }>;
  candidates?: unknown[];
  resolvedFrames?: unknown[];
  ownerChain?: Array<{ name: string }>;
  provenance?: string;
  confidence?: string;
}

interface PendingComment {
  seq?: number;
  mode: "create" | "edit";
  markerId?: string;
  xpath: string;
  selector: string;
  meta: { tag?: string; text?: string; attrs?: Record<string, string> } | null;
  debug: DebugPayload | null;
  resolving: boolean;
}

interface CommentMarker {
  id: string;
  number: number;
  xpath: string;
  selector: string;
  tag: string;
  text: string | null;
  // Attributes that identify the element in the SOURCE rather than in the rendered tree:
  // data-testid, id, aria-label. A positional selector is a puzzle for whoever has to find this
  // again; a testid is a grep.
  attrs: Record<string, string> | null;
  // Which viewport it was left at. "This is cut off" means nothing without it.
  device: string;
  comment: string;
  debug: DebugPayload | null;
  // The page it was left on, canonical (see pageUrl.ts). Pins are pushed to the frame filtered
  // by this, so a comment about one screen never marks up another.
  page: string;
}

let markerSeq = 0;
function nextMarkerId(): string {
  markerSeq += 1;
  return `m_${Date.now()}_${markerSeq}`;
}

function renumber(markers: CommentMarker[]): CommentMarker[] {
  return markers.map((m, i) => ({ ...m, number: i + 1 }));
}

function quote(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  const truncated = oneLine.length > 60 ? oneLine.slice(0, 57) + "..." : oneLine;
  return `"${truncated}"`;
}

function sourceLabel(debug: DebugPayload | null): string | null {
  const source = debug?.source;
  if (!source?.file) return null;
  if (source.line == null) return source.file;
  return source.col == null
    ? `${source.file}:${source.line}`
    : `${source.file}:${source.line}:${source.col}`;
}

// ---------------------------------------------------------------------------
// Helpers (ported from the original WebViewer2 App.jsx)

function normalizeUrl(input: string): string {
  const trimmed = (input || "").trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return "http://" + trimmed;
}

function sameUrl(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).toString() === new URL(b).toString();
  } catch {
    return a === b;
  }
}

// ---------------------------------------------------------------------------
// View-space URL builder and parser
//
// The service worker intercepts requests under /__view/@<viewerId>/... and
// routes them to the upstream target URL encoded after the viewer id.
//
// Form: /__view/@<viewerId>[/<deviceKey>]/<encodedTargetUrl>
//
// The optional deviceKey segment (desktop, mobile, tablet) tells the proxy which
// User-Agent and client hints to send to the upstream server, so responsive sites
// that vary HTML server-side render the right variant for the current viewport.

const VIEW_PREFIX = "/__view/";

/**
 * How long after a load the agent has to report before the frame is judged to have escaped the
 * proxy. The agent reports synchronously as the document parses, so this only has to cover the trip
 * back across the frame boundary; long enough not to misfire on a slow machine, short enough that a
 * real escape is corrected before the reviewer has read the page they landed on.
 */
const ESCAPE_GRACE_MS = 750;

/**
 * `proxyOrigin` is prefixed so the frame loads from whichever origin serves the proxy, which is not
 * necessarily the one this component is rendered on. Empty means same-origin, which is the browser
 * build, where the app is served by the daemon itself.
 */
function toViewUrl(
  rawUrl: string,
  viewerId: string,
  device: string | undefined,
  proxyOrigin: string,
): string {
  if (!rawUrl) return "";
  const dev = device ? "/" + encodeURIComponent(device) : "";
  return `${proxyOrigin}${VIEW_PREFIX}@${encodeURIComponent(viewerId)}${dev}/${rawUrl}`;
}

// ---------------------------------------------------------------------------
// The service worker is NOT registered here.
//
// It used to be, from this page, back when the app and the proxy shared an origin. They no longer
// do: under Tauri the shell is on `tauri://localhost`, which serves no `/sw.js`, and a page cannot
// register a worker for an origin that is not its own. Registering from here therefore failed in the
// packaged app, took the 8-second timeout, and dropped the viewer into an unproxied iframe with no
// element picker — the whole point of the feature, gone, with a banner in place of an explanation.
//
// So the proxied document registers it instead. That document IS same-origin with the proxy however
// this shell is served, so the registration works identically in Tauri, in a browser and in
// Storybook. See `agent.js`, which does it before it hides `navigator.serviceWorker` from the page.
//
// Nothing is lost by the move. The bootstrap load never had a controller anyway — `/__view/<abs>`
// carries its target in the path precisely so the first document needs no worker — and the rewriter
// resolves every static subresource into view-space, so the first paint is correct either way. The
// ref-counting that used to live here existed only to share one registration between viewers; a
// worker owned by each proxied document has nothing to share and nothing to tear down.

// ---------------------------------------------------------------------------
// Component

export const WebViewer: React.FC<WebViewerProps> = ({
  id,
  width,
  height,
  url,
  device,
  proxyOrigin,
  toolbar = false,
  actions = [],
  commands,
  subscribeToStream,
  eventHandler,
  events = [],
}) => {
  const propDevice = toDeviceKey(device);
  const [devKey, setDevKey] = useState<DeviceKey>(propDevice);
  useEffect(() => {
    setDevKey(propDevice);
  }, [propDevice]);
  const dev = DEVICE_VIEWPORTS[devKey];

  const initialUrl = url ? normalizeUrl(url) : null;
  const [history, setHistory] = useState<string[]>(initialUrl ? [initialUrl] : []);
  const [index, setIndex] = useState(initialUrl ? 0 : -1);
  const [reloadKey, setReloadKey] = useState(0);
  // Separate from currentUrl so in-page navigations reported by the agent can update the
  // address bar and history without re-pointing the iframe: re-pointing would remount it
  // and reload the whole document, throwing away the very navigation being reported.
  const [frameSrc, setFrameSrc] = useState<string | null>(initialUrl);
  const contextOrigin = useProxyOrigin();
  const origin = (proxyOrigin ?? contextOrigin).replace(/\/+$/, "");
  const [pending, setPending] = useState<PendingComment | null>(null);
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState<CommentMarker[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Fixed for the life of this mount, and part of every URL this viewer's frame loads.
  const viewerIdRef = useRef("");
  if (!viewerIdRef.current) viewerIdRef.current = Math.random().toString(36).slice(2, 10);
  const viewerId = viewerIdRef.current;

  const frameRef = useRef<HTMLIFrameElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const selectionSeq = useRef(0);
  const codeRef = useRef<HTMLPreElement>(null);

  const currentUrl = index >= 0 ? history[index] : null;
  // Derived from the history entry rather than stored, so it follows client-side route changes
  // for free. The ref is what the mount-once frame handlers read.
  const currentPage = currentUrl ? canonicalPageUrl(currentUrl) : null;
  const currentPageRef = useRef<string | null>(currentPage);
  currentPageRef.current = currentPage;
  const canGoBack = index > 0;
  const canGoForward = index < history.length - 1;

  // Track nav state in a ref so frame postMessage handlers can read the latest without
  // re-registering their listeners on every change.
  const navRef = useRef({ history, index });
  navRef.current = { history, index };

  // Keep eventHandler in a ref so callback dependencies stay stable.
  const cbRef = useRef({ eventHandler, events, id });
  cbRef.current = { eventHandler, events, id };

  const emit = useCallback((kind: string, fields: Record<string, unknown>) => {
    const { eventHandler: eh, events: ev, id: wid } = cbRef.current;
    if (!eh) return;
    if (ev.length && !ev.includes("OnEvent")) return;
    // `kind` first so System.Text.Json reads the polymorphic discriminator before
    // materializing the derived type.
    eh("OnEvent", wid, [{ kind, ...fields }]);
  }, []);

  // ---- navigation ---------------------------------------------------------
  const applyNav = useCallback((nextHistory: string[], nextIndex: number, loadFrame = true) => {
    navRef.current = { history: nextHistory, index: nextIndex };
    setHistory(nextHistory);
    setIndex(nextIndex);
    if (loadFrame) setFrameSrc(nextIndex >= 0 ? nextHistory[nextIndex] : null);
  }, []);

  const navigate = useCallback(
    (raw: string) => {
      const next = normalizeUrl(raw);
      if (!next) return;
      const { history: h, index: i } = navRef.current;
      const cur = i >= 0 ? h[i] : null;
      if (sameUrl(next, cur)) return;
      applyNav(h.slice(0, i + 1).concat(next), i + 1);
    },
    [applyNav],
  );

  // Both bump the frame key as well as moving the index, and that bump is what actually
  // navigates. A client-side route change reports its new URL without re-pointing the frame
  // (applyNav's loadFrame: false), so frameSrc still holds whatever was last hard-loaded:
  // usually the very first page. Setting it back to that same string is a no-op React
  // discards, so without this, Back moved the index and the address bar while the page sat
  // exactly where it was. reload() already needed the same trick.
  const goBack = useCallback(() => {
    const { history: h, index: i } = navRef.current;
    if (i <= 0) return;
    applyNav(h, i - 1);
    setReloadKey((k) => k + 1);
  }, [applyNav]);

  const goForward = useCallback(() => {
    const { history: h, index: i } = navRef.current;
    if (i >= h.length - 1) return;
    applyNav(h, i + 1);
    setReloadKey((k) => k + 1);
  }, [applyNav]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const navigateFromBar = useCallback(
    (raw: string) => {
      const { history: h, index: i } = navRef.current;
      const cur = i >= 0 ? h[i] : null;
      if (sameUrl(normalizeUrl(raw), cur)) reload();
      else navigate(raw);
    },
    [navigate, reload],
  );

  const chooseDevice = useCallback(
    (key: DeviceKey) => {
      setDevKey(key);
      emit("device", { device: DEVICE_LABELS[key] });
    },
    [emit],
  );

  const postToFrame = useCallback((msg: unknown) => {
    frameRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  const selectingRef = useRef(false);
  const setSelectMode = useCallback(
    (enabled: boolean, announce: boolean) => {
      selectingRef.current = enabled;
      setSelecting(enabled);
      postToFrame({ __proxyCmd: enabled ? "select-start" : "select-stop" });
      if (announce) emit("select-mode", { enabled });
    },
    [postToFrame, emit],
  );

  // ---- comment pins -------------------------------------------------------
  // The page is told the whole set, never a delta: the agent that renders the pins is
  // re-injected on every load with no memory of what it drew last time.
  const commentsRef = useRef<CommentMarker[]>([]);
  commentsRef.current = comments;

  const pushMarkers = useCallback(
    (forPage?: string | null) => {
      const page = forPage === undefined ? currentPageRef.current : forPage;
      postToFrame({
        __proxyCmd: "markers-set",
        // Only this page's pins. `tag` rides along so the page can sanity-check what it
        // re-anchors to; see resolveMarkerNode in agent.js.
        markers: commentsRef.current
          .filter((m) => m.page === page)
          .map(({ id, number, xpath, selector, tag, comment: text }) => ({
            id,
            number,
            xpath,
            selector,
            tag,
            comment: text,
          })),
      });
    },
    [postToFrame],
  );

  // currentPage is in here because a client-side route change fires no load event: without it
  // nothing would re-pin, and the last page's pins would stay on screen over the new one.
  useEffect(() => {
    pushMarkers();
  }, [comments, currentPage, pushMarkers]);

  // A hydrated page can navigate itself with script: a nav button calling location.assign, a router
  // falling back to a hard navigation, to a path outside view-space. The worker is registered on
  // /__view/, so any request outside that scope goes straight to the origin of the site and the
  // frame leaves the proxy behind.
  //
  // This used to be answered by reading `contentWindow.location`. The frame is no longer same-origin
  // with this page, so that read throws before it can say anything, and the whole check collapses
  // into its own catch branch. The agent answers it instead, by its silence: it is injected into
  // every proxied document and reports its location on first paint, so a load that produces no such
  // message within a beat is a document the proxy never served. That is the escape, and there is no
  // second case to distinguish — a page that rewrote its own address to look un-proxied still has
  // the agent, and still reports.
  const agentReportsRef = useRef(0);
  const healEscapedFrame = useCallback(() => {
    const seenBefore = agentReportsRef.current;
    window.setTimeout(() => {
      if (agentReportsRef.current !== seenBefore) return; // the agent spoke: this is ours
      const { history: h, index: i } = navRef.current;
      const current = i >= 0 ? h[i] : null;
      if (current) navigate(current);
    }, ESCAPE_GRACE_MS);
  }, [navigate]);

  // Sync external url prop changes into history when it changes from the outside.
  useEffect(() => {
    if (!url) return;
    const next = normalizeUrl(url);
    const { history: h, index: i } = navRef.current;
    const current = i >= 0 ? h[i] : null;
    if (!sameUrl(next, current)) {
      navigate(next);
    }
  }, [url, navigate]);

  // Report url changes back to Ivy so bindings update.
  useEffect(() => {
    if (currentUrl) {
      emit("navigated", {
        url: currentUrl,
        canGoBack,
        canGoForward,
      });
    }
  }, [currentUrl, canGoBack, canGoForward, emit]);

  // Autofocus the comment textarea whenever the dialog opens.
  useEffect(() => {
    if (pending) commentRef.current?.focus();
  }, [pending]);

  // Scroll the highlighted source line into view when the code frame renders.
  useEffect(() => {
    const hit = codeRef.current?.querySelector(".wvr-code-hit") as HTMLElement | null;
    if (hit) hit.scrollIntoView({ block: "center" });
  }, [pending?.debug?.source?.codeFrame]);

  // ---- screenshot save ----------------------------------------------------
  const saveCapture = useCallback(
    async (dataUrl: string, mode: string, w: number, h: number) => {
      try {
        const res = await fetch("/__capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl, mode, w, h }),
        });
        if (res.ok) {
          const body = (await res.json()) as { filename?: string };
          emit("capture-saved", {
            filename: body.filename,
            mode,
            w,
            h,
          });
        }
      } catch (err) {
        emit("console", {
          level: "error",
          text: "Screenshot save failed: " + (err instanceof Error ? err.message : String(err)),
          stack: null,
        });
      }
    },
    [emit],
  );

  // ---- messages from the iframe agent ------------------------------------
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data;
      if (!data || typeof data !== "object" || !data.__proxy) return;

      switch (data.type) {
        case "console":
          emit("console", {
            level: data.level || "log",
            text: data.text || "",
            stack: data.stack || null,
          });
          return;
        case "selected": {
          const { xpath, selector, meta, debug } = data as {
            xpath: string;
            selector: string;
            meta: { tag?: string; text?: string; attrs?: Record<string, string> } | null;
            debug: DebugPayload | null;
          };
          if (!xpath) return;
          const selectionId = ++selectionSeq.current;
          const picked = debug || null;
          const needsResolve = !!picked?.frames?.length && !picked.source;
          setPending({
            seq: selectionId,
            mode: "create",
            xpath,
            selector,
            meta,
            debug: picked,
            resolving: needsResolve,
          });
          setComment("");
          if (needsResolve) {
            void resolveSource(picked).then((enriched) =>
              setPending((prev) =>
                prev && prev.seq === selectionId
                  ? { ...prev, debug: enriched, resolving: false }
                  : prev,
              ),
            );
          }
          return;
        }
        case "marker-click": {
          const marker = commentsRef.current.find((m) => m.id === data.id);
          if (!marker) return;
          setPending({
            seq: ++selectionSeq.current,
            mode: "edit",
            markerId: marker.id,
            xpath: marker.xpath,
            selector: marker.selector,
            meta: {
              tag: marker.tag,
              text: marker.text ?? undefined,
              attrs: marker.attrs ?? undefined,
            },
            debug: marker.debug,
            resolving: false,
          });
          setComment(marker.comment);
          return;
        }
        case "cancel-select":
          setSelectMode(false, true);
          setPending(null);
          return;
        case "capture-result":
          void saveCapture(data.dataUrl, data.mode, data.w, data.h);
          return;
        case "capture-error":
          emit("console", {
            level: "error",
            text: "Screenshot capture failed: " + (data.error || "unknown error"),
            stack: null,
          });
          return;
        // The agent's own name for this, and the one it has always sent (`send({ type:
        // 'location' })` on first paint, on DOMContentLoaded and on every pushState /
        // replaceState). Not to be confused with the *outbound* "navigated" event this
        // component emits to its host: naming this arm after that one is what silently dropped
        // every page change, leaving the address bar stale and the pins scoped to the page the
        // reviewer had already left.
        case "location": {
          const reported = data.url;
          if (typeof reported !== "string" || !reported) return;
          const { history: h, index: i } = navRef.current;
          const current = i >= 0 ? h[i] : null;
          if (sameUrl(reported, current)) return;

          const newHistory = h.slice(0, i + 1).concat(reported);
          // The page is already showing this; only record it.
          applyNav(newHistory, newHistory.length - 1, false);
          // Re-pin for the page now on screen without waiting for that state to land. The
          // repositioning loop in the frame runs every 500ms and would otherwise re-anchor the
          // old page's pins onto whatever the new DOM has at the same xpath.
          pushMarkers(canonicalPageUrl(reported));
          return;
        }
        default:
          return;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [emit, saveCapture, applyNav, pushMarkers, setSelectMode]);

  // ---- HAR network entries broadcast by the service worker ----------------
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const data = e.data;
      if (!data || data.__proxyHar !== true) return;
      if (data.viewerId && data.viewerId !== viewerId) return;
      const entry = data.entry;
      if (!entry) return;
      emit("network-entry", {
        url: entry.request?.url ?? "",
        method: entry.request?.method ?? "GET",
        status: entry.response?.status ?? 0,
        statusText: entry.response?.statusText ?? "",
        mimeType: entry.response?.content?.mimeType ?? "",
        time: entry.time ?? 0,
      });
    }
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("message", onMsg);
    }
    return () => {
      if (navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener("message", onMsg);
      }
    };
  }, [emit, viewerId]);

  // ---- imperative command stream (Ivy -> widget) --------------------------
  const clearComments = useCallback(() => {
    setPending((prev) => (prev?.mode === "edit" ? null : prev));
    setComments([]);
  }, []);

  const actionsRef = useRef({
    reload,
    goBack,
    goForward,
    postToFrame,
    clearComments,
    setSelectMode,
  });
  actionsRef.current = { reload, goBack, goForward, postToFrame, clearComments, setSelectMode };

  useEffect(() => {
    if (!commands?.id || !subscribeToStream) return;
    const unsubscribe = subscribeToStream(commands.id, (raw) => {
      const cmd = raw as { command?: string; mode?: string; enabled?: boolean } | null;
      if (!cmd?.command) return;
      const a = actionsRef.current;
      switch (cmd.command) {
        case "reload":
          a.reload();
          break;
        case "back":
          a.goBack();
          break;
        case "forward":
          a.goForward();
          break;
        case "capture":
          a.postToFrame({ __proxyCmd: "capture", mode: cmd.mode || "page" });
          break;
        case "select":
          a.setSelectMode(!!cmd.enabled, false);
          break;
        case "draw":
          a.postToFrame({ __proxyCmd: cmd.enabled ? "draw-start" : "draw-stop" });
          break;
        case "clear-comments":
          // Host-initiated, so no delete events go back out: it already knows.
          a.clearComments();
          break;
      }
    });
    return unsubscribe;
  }, [commands?.id, subscribeToStream]);

  // ---- comment submission -------------------------------------------------
  const submitComment = useCallback(() => {
    if (!pending) return;
    const text = comment.trim();
    if (!text) return;
    const { xpath, selector, meta, debug, mode, markerId } = pending;

    if (mode === "edit" && markerId) {
      setComments((prev) => prev.map((m) => (m.id === markerId ? { ...m, comment: text } : m)));
      emit("comment-edit", { id: markerId, comment: text });
      setPending(null);
      setComment("");
      return;
    }

    // Resolving source maps (via source-map.js in the frame or sourcemap-codec on our side)
    // waits for the answer, so what Ivy is handed already names the file behind the element.
    const id = nextMarkerId();
    const number = commentsRef.current.length + 1;
    const page = currentPageRef.current || "";
    const marker: CommentMarker = {
      id,
      number,
      xpath,
      selector,
      tag: meta?.tag || "",
      text: meta?.text ?? null,
      attrs: meta?.attrs && Object.keys(meta.attrs).length > 0 ? meta.attrs : null,
      device: DEVICE_LABELS[devKey],
      comment: text,
      debug,
      page,
    };
    setComments((prev) => renumber([...prev, marker]));

    void resolveSource(debug).then((enriched) => {
      emit("comment", {
        // The marker's id, which is what `comment-edit` and `comment-delete` name. Without it a host
        // collecting these events has nothing to apply either of them to.
        id,
        number,
        // The element's own tag, so a host can say which element a comment is about without holding
        // a selector.
        tag: marker.tag,
        xpath,
        selector,
        comment: text,
        // Where it was left. Numbers stay global across the session, so a change request can
        // group by this and still read 1, 2, 3 down the page.
        url: page,
        // The page already collects these; they were being dropped at this boundary.
        text: marker.text,
        attrsJson: marker.attrs ? JSON.stringify(marker.attrs) : null,
        device: marker.device,
        debugJson: enriched ? JSON.stringify(enriched) : null,
      });
    });

    setPending(null);
    setComment("");
  }, [comment, pending, emit, devKey]);

  const deleteComment = useCallback(() => {
    if (!pending?.markerId) return;
    const id = pending.markerId;
    setComments((prev) => renumber(prev.filter((m) => m.id !== id)));
    emit("comment-delete", { id });
    setPending(null);
    setComment("");
  }, [pending, emit]);

  const cancelComment = useCallback(() => {
    setPending(null);
    setComment("");
  }, []);

  // ---- render -------------------------------------------------------------
  const shellStyle: React.CSSProperties = {
    position: "relative",
    boxSizing: "border-box",
    overflow: "hidden",
    ...getWidth(width),
    ...getHeight(height),
  };

  const iframeStyle: React.CSSProperties =
    dev.w && dev.h ? { width: dev.w, height: dev.h } : { width: "100%", height: "100%" };

  const frameKey = `${frameSrc}#${devKey}#${reloadKey}`;
  // Nothing to wait for any more: the frame is mounted as soon as there is a URL, because the
  // registration it used to wait on now happens inside the document it is about to load.
  const loading = !!frameSrc && loadedKey !== frameKey;

  return (
    <div className="wvr-shell" style={shellStyle}>
      {toolbar && (
        <Toolbar
          url={currentUrl}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          loading={loading}
          device={devKey}
          selecting={selecting}
          actions={actions}
          onBack={goBack}
          onForward={goForward}
          onReload={reload}
          onNavigate={navigateFromBar}
          onDevice={chooseDevice}
          onToggleSelect={() => setSelectMode(!selectingRef.current, true)}
          onAction={(actionId) => emit("action", { id: actionId })}
        />
      )}
      <div className={"wvr-stage" + (dev.w ? " wvr-device" : "")}>
        {!currentUrl ? (
          <div className="wvr-empty">
            {toolbar
              ? "Enter a URL in the address bar to load a page."
              : "No URL -- set the Url prop to load a page."}
          </div>
        ) : frameSrc ? (
          <iframe
            ref={frameRef}
            key={frameKey}
            className="wvr-frame"
            src={toViewUrl(frameSrc, viewerId, devKey, origin)}
            title="Web content"
            style={iframeStyle}
            onLoad={() => {
              setLoadedKey(frameKey);
              healEscapedFrame();
              // The document that just loaded has no pins yet: the agent is injected fresh
              // on every load and knows nothing of what the last one drew.
              pushMarkers();
              if (selectingRef.current) postToFrame({ __proxyCmd: "select-start" });
            }}
          />
        ) : null}
      </div>

      {pending && (
        <div className="wvr-overlay" onMouseDown={cancelComment}>
          <div
            className="tui-popover-shell wvr-comment-box"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="wvr-comment-title">
              {pending.mode === "edit" && (
                <span className="wvr-comment-pin">
                  {comments.find((m) => m.id === pending.markerId)?.number}
                </span>
              )}
              Comment on
              {pending.meta?.tag && (
                <TuiBadge className="wvr-comment-tag" size="md" mono>
                  {pending.meta.tag}
                </TuiBadge>
              )}
              {pending.meta?.text && (
                <span className="wvr-comment-snippet">{quote(pending.meta.text)}</span>
              )}
            </div>
            {pending.resolving && (
              <div className="wvr-comment-field">
                <div className="wvr-comment-label">source</div>
                <div className="wvr-comment-value wvr-comment-muted">resolving source map…</div>
              </div>
            )}
            {!pending.resolving && sourceLabel(pending.debug) && (
              <div className="wvr-comment-field">
                <div className="wvr-comment-label">source</div>
                <div className="wvr-comment-value wvr-comment-source">
                  {sourceLabel(pending.debug)}
                </div>
                <div className="wvr-comment-note">
                  {[pending.debug?.provenance, pending.debug?.confidence]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            )}
            {(pending.debug?.ownerChain?.length ?? 0) > 0 && (
              <div className="wvr-comment-field">
                <div className="wvr-comment-label">components</div>
                <div className="wvr-comment-value">
                  {(pending.debug?.ownerChain ?? [])
                    .map((owner) => owner.name)
                    .filter(Boolean)
                    .join(" › ")}
                </div>
              </div>
            )}
            {!pending.resolving &&
              (pending.debug?.codeFrame || pending.debug?.source?.codeFrame) && (
                <pre className="wvr-comment-code" ref={codeRef}>
                  {(pending.debug.codeFrame || pending.debug.source?.codeFrame || "")
                    .trimEnd()
                    .split("\n")
                    .map((line, i) => (
                      <div key={i} className={line.startsWith(">") ? "wvr-code-hit" : undefined}>
                        {line}
                      </div>
                    ))}
                </pre>
              )}
            {pending.xpath && (
              <div className="wvr-comment-field">
                <div className="wvr-comment-label">xpath</div>
                <div className="wvr-comment-value">{pending.xpath}</div>
              </div>
            )}
            {pending.selector && (
              <div className="wvr-comment-field">
                <div className="wvr-comment-label">selector</div>
                <div className="wvr-comment-value">{pending.selector}</div>
              </div>
            )}
            <textarea
              ref={commentRef}
              className="wvr-comment-input tui-comment-textarea"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelComment();
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitComment();
              }}
              placeholder="Type a comment… (Ctrl+Enter to submit)"
              rows={4}
            />
            <div className="wvr-comment-actions">
              {pending.mode === "edit" && (
                // Left of the gap, away from Save: this one cannot be undone.
                <button
                  type="button"
                  className="tui-btn tui-btn--danger wvr-comment-delete"
                  onClick={deleteComment}
                >
                  Delete
                </button>
              )}
              <button type="button" className="tui-btn tui-btn--ghost" onClick={cancelComment}>
                Cancel
              </button>
              <button type="button" className="tui-btn tui-btn--primary" onClick={submitComment}>
                {pending.mode === "edit" ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Source Map Resolution (client-side fallback when the frame didn't resolve)

async function resolveSource(debug: DebugPayload | null): Promise<DebugPayload | null> {
  if (!debug?.frames?.length || debug.source) return debug;
  try {
    const response = await fetch("/__resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ frames: debug.frames }),
    });
    if (!response.ok) return debug;
    const resolved = await response.json();
    if (!resolved?.source) return debug;
    return {
      ...debug,
      source: resolved.source,
      codeFrame: resolved.codeFrame,
      candidates: resolved.candidates,
      resolvedFrames: resolved.frames,
      confidence: resolved.confidence ?? debug.confidence,
    };
  } catch {
    return debug;
  }
}
