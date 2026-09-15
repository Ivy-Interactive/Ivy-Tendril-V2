import React, { useCallback, useEffect, useImperativeHandle, useRef } from "react";
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
  /** Read-only terminals ignore keystrokes rather than sending them nowhere. */
  readOnly?: boolean;
  className?: string;
  ref?: React.Ref<TerminalHandle>;
}

/** Matches the app's mono stack. xterm measures a real font, so a CSS variable cannot be used here. */
const FONT_FAMILY = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const DEFAULT_FONT_SIZE = 13;

/**
 * A dark terminal regardless of the app theme, because the content is a process's own coloured
 * output: ANSI palettes assume a dark background, and re-mapping them for a light one turns
 * bright-white-on-black into invisible.
 */
const DEFAULT_THEME: ITheme = {
  background: "#0a0a0a",
  foreground: "#e4e4e7",
  cursor: "#e4e4e7",
  cursorAccent: "#0a0a0a",
  selectionBackground: "#3f3f46",
};

/**
 * An xterm.js terminal as a React component.
 *
 * Deliberately thin: it owns the emulator's lifecycle and its two directions of traffic, and nothing
 * else. What the bytes mean, where they come from and what a resize should be forwarded to are the
 * host's business — which is what lets the same component serve a review action, and later anything
 * else that speaks to a pty.
 *
 * xterm.js itself is imported on mount rather than at module scope, so it is fetched only by the
 * screens that actually show a terminal. Writes that land during that fetch are buffered.
 */
export function Terminal({
  onInput,
  onResize,
  theme,
  fontSize = DEFAULT_FONT_SIZE,
  readOnly = false,
  className,
  ref,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  /** Output that arrived before the emulator finished loading. Dropping it would lose the boot log. */
  const pendingRef = useRef<(Uint8Array | string)[]>([]);
  /**
   * Written to on every render so the emulator's own listeners always call the current callback, and
   * so the emulator is built with the props it has now rather than the ones it had when its module
   * started loading. The listeners are registered once, at mount: re-registering them per render would
   * tear the emulator down every time the host re-rendered.
   */
  const handlers = useRef({ onInput, onResize, readOnly, fontSize, theme });
  handlers.current = { onInput, onResize, readOnly, fontSize, theme };

  const fit = useCallback(() => {
    // Fitting a container with no layout yet throws inside the addon's measurement; there is nothing
    // to fit to until the browser has given it a box.
    const container = containerRef.current;
    if (!container || container.clientWidth === 0 || container.clientHeight === 0) {
      return;
    }
    try {
      fitRef.current?.fit();
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

      const term = new XTermCtor({
        fontFamily: FONT_FAMILY,
        fontSize: handlers.current.fontSize,
        theme: { ...DEFAULT_THEME, ...handlers.current.theme },
        // A review action's log is long and worth scrolling back through.
        scrollback: 10000,
        cursorBlink: true,
        convertEol: false,
        allowProposedApi: true,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);

      termRef.current = term;
      fitRef.current = fitAddon;

      const dataListener = term.onData((data) => {
        if (handlers.current.readOnly) {
          return;
        }
        handlers.current.onInput?.(data);
      });
      // The emulator's own resize event rather than the observer's: it fires with the cell dimensions
      // that were actually applied, and only when they changed.
      const resizeListener = term.onResize(({ rows, cols }) => {
        handlers.current.onResize?.(rows, cols);
      });

      for (const chunk of pendingRef.current) {
        term.write(chunk);
      }
      pendingRef.current = [];

      fit();

      let observer: ResizeObserver | undefined;
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => fit());
        observer.observe(container);
      }

      teardown = () => {
        observer?.disconnect();
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
    term.options.theme = { ...DEFAULT_THEME, ...theme };
    // A different font size means different cell metrics, so the fit is now stale.
    fit();
  }, [fontSize, theme, fit]);

  useImperativeHandle(
    ref,
    (): TerminalHandle => ({
      write: (data) => {
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
    [fit],
  );

  return (
    <div
      ref={containerRef}
      className={`ivy-terminal${className ? ` ${className}` : ""}`}
      data-testid="terminal"
    />
  );
}
