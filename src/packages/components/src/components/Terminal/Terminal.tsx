import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ITheme, Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";

/**
 * What a host can do to a mounted terminal.
 *
 * Output arrives as bytes, not lines: the process on the other end is writing through a pty, so its
 * stream carries ANSI escapes and bare carriage returns that only mean anything to a terminal
 * emulator. Anything that split that stream into strings per line would destroy a progress redraw.
 */
export interface TerminalHandle {
  /**
   * Writes raw bytes (or an already-decoded string) to the screen. Output written before the emulator
   * has finished loading is buffered, not dropped.
   */
  write: (data: Uint8Array | string) => void;
  /** Clears the screen and scrollback. */
  clear: () => void;
  focus: () => void;
  /** Re-measures and reflows to the container, which also reports the new size via `onResize`. */
  fit: () => void;
}

/** `Ivy.Widgets.Xterm`'s `CursorStyle`, spelled the way xterm's own option is. */
export type TerminalCursorStyle = "block" | "underline" | "bar";

export interface TerminalProps {
  /** Keystrokes, exactly as the emulator produced them — control sequences included. */
  onInput?: (data: string) => void;
  /**
   * The size the emulator settled on, in cells. The host is expected to forward this to whatever is
   * on the other end: a process that is never told its window size wraps its output to a guess.
   */
  onResize?: (rows: number, cols: number) => void;
  /** Overrides for the default dark theme. */
  theme?: ITheme;
  fontSize?: number;
  lineHeight?: number;
  /** Lines of scrollback retained above the viewport. */
  scrollback?: number;
  cursorStyle?: TerminalCursorStyle;
  cursorBlink?: boolean;
  /** Written once, before any streamed output — a snapshot the host already had. */
  initialContent?: string;
  /** Read-only terminals ignore keystrokes rather than sending them nowhere. */
  readOnly?: boolean;
  /**
   * The process on the other end has exited. Read-only like `readOnly`, and additionally hides the
   * cursor: a blinking caret on a dead pty invites typing that goes nowhere.
   */
  closed?: boolean;
  /** Copy on Ctrl/Cmd+C with a selection, paste on Ctrl/Cmd+V and on the browser's paste event. */
  allowClipboard?: boolean;
  /** Takes keyboard focus on mount, unless read-only. */
  autoFocus?: boolean;
  /**
   * Shows a spinner over the terminal until the process prints something. A pty emits escape
   * sequences within milliseconds of spawning, long before the process itself writes, so the overlay
   * waits for visible output rather than for any output at all.
   */
  loading?: boolean;
  loadingText?: string;
  className?: string;
  ref?: React.Ref<TerminalHandle>;
}

/**
 * `Ivy.Widgets.Xterm`'s stack, in its order: Cascadia Mono first, then Geist Mono, then the platform
 * monos, with the emoji fonts last so a glyph the monos lack still renders. xterm measures a real
 * font, so a CSS variable cannot be used here.
 */
const FONT_FAMILY =
  "'Cascadia Mono', Geist Mono, Menlo, Monaco, 'Courier New', monospace, 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji'";

const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT = 1.0;
const DEFAULT_SCROLLBACK = 1000;

/** Mirrors `.ivy-terminal`'s padding in terminal.css, which `fit` has to account for. */
const PAD_TOP = 10;
const PAD_BOTTOM = 10;

/**
 * A dark terminal regardless of the app theme, because the content is a process's own coloured
 * output: ANSI palettes assume a dark background, and re-mapping them for a light one turns
 * bright-white-on-black into invisible.
 *
 * The values are `Ivy.Widgets.Xterm`'s `defaultTheme` — the same palette every V1 terminal draws
 * with, so a `pass`/`fail` line is the same green and red here as it is there. Hex rather than
 * semantic tokens because these are the 16 ANSI slots a process addresses by index, not app chrome.
 */
const DEFAULT_THEME: ITheme = {
  background: "#000000",
  foreground: "#d4d4d4",
  cursor: "#aeafad",
  cursorAccent: "#000000",
  // V1 spells this `selection`, which xterm has not read since v5; `selectionBackground` is the same
  // decision under the name that still takes effect.
  selectionBackground: "rgba(255, 255, 255, 0.3)",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
};

/**
 * Everything a pty emits before the process itself prints: window-title sets, cursor homing, mode
 * sets. Stripped so the loading overlay is not dismissed by a preamble nobody can see.
 */
function visibleText(text: string): string {
  return (
    text
      .replace(/\x1b\][\s\S]*?(\x07|\x1b\\|$)/g, "") // OSC (e.g. title set)
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI
      .replace(/\x1b[\s\S]/g, "") // other ESC sequences
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, "") // remaining control chars
      .trim()
  );
}

/**
 * An xterm.js terminal as a React component.
 *
 * Deliberately thin: it owns the emulator's lifecycle and its two directions of traffic, and nothing
 * else. What the bytes mean, where they come from and what a resize should be forwarded to are the
 * host's business — which is what lets the same component serve a review action, a job session, and
 * later anything else that speaks to a pty.
 *
 * xterm.js itself is imported on mount rather than at module scope, so it is fetched only by the
 * screens that actually show a terminal. Writes that land during that fetch are buffered.
 */
export function Terminal({
  onInput,
  onResize,
  theme,
  fontSize = DEFAULT_FONT_SIZE,
  lineHeight = DEFAULT_LINE_HEIGHT,
  scrollback = DEFAULT_SCROLLBACK,
  cursorStyle = "block",
  cursorBlink = true,
  initialContent,
  readOnly = false,
  closed = false,
  allowClipboard = true,
  autoFocus = true,
  loading = false,
  loadingText = "Loading...",
  className,
  ref,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  /** Output that arrived before the emulator finished loading. Dropping it would lose the boot log. */
  const pendingRef = useRef<(Uint8Array | string)[]>([]);
  /** Set once the process has printed something a person could see; see {@link visibleText}. */
  const sawOutputRef = useRef(false);
  const [sawOutput, setSawOutput] = useState(false);

  /** A dead pty is read-only too, and additionally loses its cursor. */
  const isReadOnly = readOnly || closed;

  /**
   * Written to on every render so the emulator's own listeners always call the current callback, and
   * so the emulator is built with the props it has now rather than the ones it had when its module
   * started loading. The listeners are registered once, at mount: re-registering them per render would
   * tear the emulator down every time the host re-rendered.
   */
  const handlers = useRef({
    onInput,
    onResize,
    isReadOnly,
    fontSize,
    lineHeight,
    scrollback,
    cursorStyle,
    cursorBlink,
    theme,
    initialContent,
    allowClipboard,
    autoFocus,
  });
  handlers.current = {
    onInput,
    onResize,
    isReadOnly,
    fontSize,
    lineHeight,
    scrollback,
    cursorStyle,
    cursorBlink,
    theme,
    initialContent,
    allowClipboard,
    autoFocus,
  };

  const markVisibleOutput = useCallback((data: Uint8Array | string) => {
    if (sawOutputRef.current) {
      return;
    }
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    if (visibleText(text).length === 0) {
      return;
    }
    sawOutputRef.current = true;
    setSawOutput(true);
  }, []);

  const fit = useCallback(() => {
    // Fitting a container with no layout yet throws inside the addon's measurement; there is nothing
    // to fit to until the browser has given it a box.
    const container = containerRef.current;
    if (!container || container.clientWidth === 0 || container.clientHeight === 0) {
      return;
    }
    try {
      fitRef.current?.fit();
      // The addon computes rows from the fractional cell height, but a renderer rounds each row up to
      // whole pixels. Over many rows that excess can exceed the bottom padding and clip the last
      // line, so drop a row when the rendered terminal no longer fits its box.
      const term = termRef.current;
      const rendered = term?.element?.offsetHeight ?? 0;
      const available = container.clientHeight - PAD_TOP - PAD_BOTTOM;
      if (term && rendered > available + 1 && term.rows > 1) {
        term.resize(term.cols, term.rows - 1);
      }
    } catch {
      // A transient measurement failure is not worth surfacing: the next resize will fit again.
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;
    let teardown: (() => void) | undefined;

    void (async () => {
      // Loaded on demand rather than imported: a terminal emulator is several hundred kilobytes, and
      // an app that has one screen with a terminal on it should not pay for it on every other screen.
      const [{ Terminal: XTermCtor }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (cancelled) {
        return;
      }

      const readOnlyNow = handlers.current.isReadOnly;
      const term = new XTermCtor({
        fontFamily: FONT_FAMILY,
        fontSize: handlers.current.fontSize,
        lineHeight: handlers.current.lineHeight,
        theme: { ...DEFAULT_THEME, ...handlers.current.theme },
        scrollback: handlers.current.scrollback,
        cursorStyle: handlers.current.cursorStyle,
        // A caret that blinks on a stream nobody is listening to is a lie about who has the keyboard.
        cursorBlink: readOnlyNow ? false : handlers.current.cursorBlink,
        disableStdin: readOnlyNow,
        convertEol: false,
        allowProposedApi: true,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);

      termRef.current = term;
      fitRef.current = fitAddon;

      const dataListener = term.onData((data) => {
        if (handlers.current.isReadOnly) {
          return;
        }
        handlers.current.onInput?.(data);
      });
      // The emulator's own resize event rather than the observer's: it fires with the cell dimensions
      // that were actually applied, and only when they changed.
      const resizeListener = term.onResize(({ rows, cols }) => {
        handlers.current.onResize?.(rows, cols);
      });

      // xterm owns the keyboard through a hidden textarea, so a listener on the container never sees
      // a keystroke; the custom handler runs before xterm consumes the key, which is the only place
      // clipboard shortcuts can be intercepted.
      term.attachCustomKeyEventHandler?.((event: KeyboardEvent) => {
        if (!handlers.current.allowClipboard || term.options.disableStdin) {
          return true;
        }
        if (event.type !== "keydown" || !(event.ctrlKey || event.metaKey)) {
          return true;
        }
        if (event.key === "v") {
          event.preventDefault();
          void navigator.clipboard
            ?.readText()
            .then((text) => {
              if (text) term.paste(text);
            })
            .catch(() => {
              // Clipboard API unavailable — the browser's own paste event still reaches the textarea.
            });
          return false;
        }
        // Only with a selection: Ctrl+C on an idle prompt has to reach the process as SIGINT.
        if (event.key === "c" && term.hasSelection?.()) {
          event.preventDefault();
          void navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
          return false;
        }
        return true;
      });

      const onPaste = (event: ClipboardEvent) => {
        if (!handlers.current.allowClipboard || term.options.disableStdin) {
          return;
        }
        event.preventDefault();
        const text = event.clipboardData?.getData("text");
        if (text) {
          term.paste(text);
        }
      };
      term.textarea?.addEventListener("paste", onPaste);

      if (handlers.current.initialContent) {
        term.write(handlers.current.initialContent);
      }
      for (const chunk of pendingRef.current) {
        term.write(chunk);
      }
      pendingRef.current = [];

      fit();
      // fit() only raises onResize when the grid actually changed, so a terminal that happened to
      // open at its default size would never tell the host what size to give the pty.
      handlers.current.onResize?.(term.rows, term.cols);

      if (handlers.current.autoFocus && !handlers.current.isReadOnly) {
        term.focus();
      }

      let observer: ResizeObserver | undefined;
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => fit());
        observer.observe(container);
      }

      teardown = () => {
        observer?.disconnect();
        term.textarea?.removeEventListener("paste", onPaste);
        dataListener.dispose();
        resizeListener.dispose();
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    })();

    return () => {
      cancelled = true;
      teardown?.();
    };
    // Mount-only: `fontSize` and `theme` are applied to a live terminal below rather than by
    // rebuilding it, so a theme change never clears the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) {
      return;
    }
    term.options.fontSize = fontSize;
    term.options.lineHeight = lineHeight;
    term.options.theme = { ...DEFAULT_THEME, ...theme };
    // A different font size means different cell metrics, so the fit is now stale.
    fit();
  }, [fontSize, lineHeight, theme, fit]);

  // Applied to the live terminal rather than at construction, because a pty that exits mid-session
  // has to take the keyboard away from a terminal that is already on screen. The emulator is null
  // until its module has loaded, at which point it was built with these values already.
  useEffect(() => {
    const term = termRef.current;
    if (!term) {
      return;
    }
    term.options.disableStdin = isReadOnly;
    term.options.cursorBlink = isReadOnly ? false : cursorBlink;
    term.write(isReadOnly ? "\x1b[?25l" : "\x1b[?25h");
  }, [isReadOnly, cursorBlink]);

  useImperativeHandle(
    ref,
    (): TerminalHandle => ({
      write: (data) => {
        markVisibleOutput(data);
        const term = termRef.current;
        if (term) {
          term.write(data);
        } else {
          pendingRef.current.push(data);
        }
      },
      clear: () => termRef.current?.clear(),
      focus: () => termRef.current?.focus(),
      fit,
    }),
    [fit, markVisibleOutput],
  );

  // A closed terminal is never still starting: whatever it was waiting for is not coming.
  const showLoading = loading && !sawOutput && !closed;

  return (
    <div className={`ivy-terminal-host${className ? ` ${className}` : ""}`}>
      <div ref={containerRef} className="ivy-terminal" data-testid="terminal" />
      {showLoading && (
        <div className="ivy-terminal-loading" data-testid="terminal-loading">
          <span className="ivy-terminal-spinner" aria-hidden="true" />
          <span>{loadingText}</span>
        </div>
      )}
    </div>
  );
}
