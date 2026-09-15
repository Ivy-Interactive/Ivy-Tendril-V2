import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { Terminal, type TerminalHandle } from "./Terminal.tsx";

/**
 * xterm.js is mocked, not exercised: it measures a real font against a real layout, neither of which
 * jsdom provides. What is worth testing here is the wiring — that bytes reach the emulator untouched,
 * that its two event directions are connected to the right props, and that a live terminal is
 * reconfigured rather than rebuilt. Rendering is xterm's own test suite's problem.
 */

// Declared inside `vi.hoisted` because `vi.mock`'s factory is hoisted above the file's own
// declarations: a class defined at the top level would not exist yet when the factory runs.
const { FakeTerminal, FakeFitAddon } = vi.hoisted(() => {
  class FakeTerminal {
    static instances: FakeTerminal[] = [];

    options: Record<string, unknown>;
    written: (Uint8Array | string)[] = [];
    opened: HTMLElement | null = null;
    addons: unknown[] = [];
    disposed = false;
    cleared = false;
    focused = false;
    /** The grid a real emulator reports once it has measured its container. */
    cols = 120;
    rows = 40;
    pasted: string[] = [];
    keyHandler: ((event: KeyboardEvent) => boolean) | undefined;
    selection = "";

    private dataHandlers: ((data: string) => void)[] = [];
    private resizeHandlers: ((size: { rows: number; cols: number }) => void)[] = [];

    constructor(options: Record<string, unknown>) {
      this.options = options;
      FakeTerminal.instances.push(this);
    }

    open(parent: HTMLElement) {
      this.opened = parent;
    }
    loadAddon(addon: unknown) {
      this.addons.push(addon);
    }
    write(data: Uint8Array | string) {
      this.written.push(data);
    }
    clear() {
      this.cleared = true;
    }
    focus() {
      this.focused = true;
    }
    dispose() {
      this.disposed = true;
    }

    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      this.keyHandler = handler;
    }
    hasSelection() {
      return this.selection.length > 0;
    }
    getSelection() {
      return this.selection;
    }
    paste(text: string) {
      this.pasted.push(text);
    }

    onData(handler: (data: string) => void): { dispose: () => void } {
      this.dataHandlers.push(handler);
      return { dispose: () => (this.dataHandlers = []) };
    }
    onResize(handler: (size: { rows: number; cols: number }) => void): { dispose: () => void } {
      this.resizeHandlers.push(handler);
      return { dispose: () => (this.resizeHandlers = []) };
    }

    /** Pretends the user typed. */
    emitData(data: string) {
      for (const handler of this.dataHandlers) handler(data);
    }
    /** Pretends the emulator settled on a new cell grid. */
    emitResize(rows: number, cols: number) {
      for (const handler of this.resizeHandlers) handler({ rows, cols });
    }
    get hasListeners() {
      return this.dataHandlers.length > 0 && this.resizeHandlers.length > 0;
    }
  }

  class FakeFitAddon {
    static fits = 0;
    fit() {
      FakeFitAddon.fits += 1;
    }
  }

  return { FakeTerminal, FakeFitAddon };
});

vi.mock("@xterm/xterm", () => ({ Terminal: FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: FakeFitAddon }));

/** jsdom lays nothing out, so the container has to be given a box for `fit()` to run at all. */
function giveContainersASize(width = 800, height = 600) {
  const widthSpy = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(width) as unknown;
  const heightSpy = vi
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockReturnValue(height) as unknown;
  return [widthSpy, heightSpy];
}

const latest = () => FakeTerminal.instances[FakeTerminal.instances.length - 1];

describe("Terminal", () => {
  let observed: HTMLElement[] = [];
  let disconnects = 0;

  beforeEach(() => {
    FakeTerminal.instances = [];
    FakeFitAddon.fits = 0;
    observed = [];
    disconnects = 0;

    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private callback: () => void) {}
        observe(element: HTMLElement) {
          observed.push(element);
          // Report a box immediately, the way a real observer does on first observation.
          this.callback();
        }
        disconnect() {
          disconnects += 1;
        }
        unobserve() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens the emulator on its own container", async () => {
    await act(async () => {
      render(<Terminal />);
    });

    const container = screen.getByTestId("terminal");
    expect(latest().opened).toBe(container);
    expect(latest().addons).toHaveLength(1);
    expect(latest().hasListeners).toBe(true);
  });

  it("writes bytes through untouched", async () => {
    const ref = React.createRef<TerminalHandle>();
    await act(async () => {
      render(<Terminal ref={ref} />);
    });

    // The payload is a pty chunk: an escape sequence and a bare carriage return, which is exactly
    // what must not be normalised on the way in.
    const chunk = new TextEncoder().encode("\x1b[32mbuilding\x1b[0m\r50%");
    act(() => ref.current?.write(chunk));

    expect(latest().written).toEqual([chunk]);
  });

  it("buffers output written before the emulator has loaded", async () => {
    const ref = React.createRef<TerminalHandle>();
    // Not awaited: xterm.js is imported on mount, so at this point there is no emulator yet — which
    // is exactly when a process that starts fast writes its first line.
    act(() => {
      render(<Terminal ref={ref} />);
    });
    act(() => ref.current?.write("vite v7 ready\r\n"));
    expect(FakeTerminal.instances).toHaveLength(0);

    await act(async () => {});

    expect(latest().written).toEqual(["vite v7 ready\r\n"]);
  });

  it("reports keystrokes, including control sequences", async () => {
    const onInput = vi.fn();
    await act(async () => {
      render(<Terminal onInput={onInput} />);
    });

    act(() => latest().emitData("y"));
    act(() => latest().emitData("\r"));
    act(() => latest().emitData("\x03"));

    expect(onInput.mock.calls).toEqual([["y"], ["\r"], ["\x03"]]);
  });

  it("drops keystrokes when read-only", async () => {
    const onInput = vi.fn();
    await act(async () => {
      render(<Terminal readOnly onInput={onInput} />);
    });

    act(() => latest().emitData("y"));

    expect(onInput).not.toHaveBeenCalled();
  });

  it("reports the size the emulator settled on", async () => {
    const onResize = vi.fn();
    await act(async () => {
      render(<Terminal onResize={onResize} />);
    });

    act(() => latest().emitResize(40, 120));

    expect(onResize).toHaveBeenCalledWith(40, 120);
  });

  it("reports the grid it opened at, not only later changes", async () => {
    giveContainersASize();
    const onResize = vi.fn();
    await act(async () => {
      render(<Terminal onResize={onResize} />);
    });

    // `fit()` raises the emulator's own resize event only when the grid changed, so a terminal that
    // opened at the size it wanted would otherwise never tell the host what to size the pty to.
    expect(onResize).toHaveBeenCalledWith(40, 120);
  });

  it("opens with Ivy.Widgets.Xterm's defaults", async () => {
    await act(async () => {
      render(<Terminal />);
    });

    const options = latest().options;
    expect(options.fontSize).toBe(14);
    expect(options.lineHeight).toBe(1);
    expect(options.scrollback).toBe(1000);
    expect(options.cursorStyle).toBe("block");
    expect(options.cursorBlink).toBe(true);
    expect(options.disableStdin).toBe(false);
    expect((options.theme as { background: string }).background).toBe("#000000");
  });

  it("writes the snapshot the host already had before any streamed output", async () => {
    const ref = React.createRef<TerminalHandle>();
    act(() => {
      render(<Terminal ref={ref} initialContent={"restored scrollback\r\n"} />);
    });
    act(() => ref.current?.write("live output\r\n"));

    await act(async () => {});

    expect(latest().written).toEqual(["restored scrollback\r\n", "live output\r\n"]);
  });

  it("takes the keyboard away from a pty that has exited, and hides its cursor", async () => {
    let rerender: (ui: React.ReactElement) => void = () => {};
    await act(async () => {
      ({ rerender } = render(<Terminal />));
    });
    const instance = latest();

    await act(async () => {
      rerender(<Terminal closed />);
    });

    expect(instance.options.disableStdin).toBe(true);
    expect(instance.options.cursorBlink).toBe(false);
    // A caret left blinking on a dead pty invites typing that goes nowhere.
    expect(instance.written).toContain("\x1b[?25l");
    // Still the same emulator: the log the process left behind has to stay readable.
    expect(instance.disposed).toBe(false);
  });

  it("drops keystrokes once closed, without being told it is read-only", async () => {
    const onInput = vi.fn();
    let rerender: (ui: React.ReactElement) => void = () => {};
    await act(async () => {
      ({ rerender } = render(<Terminal onInput={onInput} />));
    });
    await act(async () => {
      rerender(<Terminal onInput={onInput} closed />);
    });

    act(() => latest().emitData("y"));

    expect(onInput).not.toHaveBeenCalled();
  });

  it("copies a selection on Ctrl+C but leaves an empty one to the process as SIGINT", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // Defined rather than stubbed whole: jsdom's navigator carries things testing-library reads.
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await act(async () => {
      render(<Terminal />);
    });
    const instance = latest();

    // No selection: Ctrl+C has to reach the pty.
    expect(
      instance.keyHandler?.({
        type: "keydown",
        key: "c",
        ctrlKey: true,
        preventDefault: () => {},
      } as unknown as KeyboardEvent),
    ).toBe(true);
    expect(writeText).not.toHaveBeenCalled();

    instance.selection = "pass: 35 files";
    expect(
      instance.keyHandler?.({
        type: "keydown",
        key: "c",
        ctrlKey: true,
        preventDefault: () => {},
      } as unknown as KeyboardEvent),
    ).toBe(false);
    expect(writeText).toHaveBeenCalledWith("pass: 35 files");
  });

  it("shows the loading overlay until the process prints something visible", async () => {
    const ref = React.createRef<TerminalHandle>();
    await act(async () => {
      render(<Terminal ref={ref} loading loadingText="Starting Claude..." />);
    });

    expect(screen.getByTestId("terminal-loading").textContent).toContain("Starting Claude...");

    // A pty emits a title set and cursor homing within milliseconds of spawning, long before the
    // process itself writes: dismissing on that would flash the overlay away over an empty screen.
    await act(async () => ref.current?.write("\x1b]0;zsh\x07\x1b[2J\x1b[H"));
    expect(screen.queryByTestId("terminal-loading")).not.toBeNull();

    await act(async () => ref.current?.write("Welcome to Claude Code"));
    expect(screen.queryByTestId("terminal-loading")).toBeNull();
  });

  it("never shows the overlay for a pty that has already exited", async () => {
    await act(async () => {
      render(<Terminal loading closed />);
    });

    expect(screen.queryByTestId("terminal-loading")).toBeNull();
  });

  it("keeps calling the current callbacks after a re-render", async () => {
    const first = vi.fn();
    const second = vi.fn();
    let rerender: (ui: React.ReactElement) => void = () => {};

    await act(async () => {
      ({ rerender } = render(<Terminal onInput={first} />));
    });
    const instance = latest();

    await act(async () => {
      rerender(<Terminal onInput={second} />);
    });

    act(() => latest().emitData("x"));

    expect(second).toHaveBeenCalledWith("x");
    expect(first).not.toHaveBeenCalled();
    expect(latest()).toBe(instance);
    expect(FakeTerminal.instances).toHaveLength(1);
  });

  it("applies a theme or font change to the live terminal instead of rebuilding it", async () => {
    let rerender: (ui: React.ReactElement) => void = () => {};
    await act(async () => {
      ({ rerender } = render(<Terminal fontSize={13} />));
    });
    const instance = latest();
    act(() => instance.write("output that must survive"));

    await act(async () => {
      rerender(<Terminal fontSize={18} theme={{ background: "#123456" }} />);
    });

    // Rebuilding would clear the screen, which for a long-running review action means losing the log.
    expect(FakeTerminal.instances).toHaveLength(1);
    expect(instance.disposed).toBe(false);
    expect(instance.options.fontSize).toBe(18);
    expect((instance.options.theme as { background: string }).background).toBe("#123456");
    expect((instance.options.theme as { foreground: string }).foreground).toBe("#d4d4d4");
  });

  it("does not fit a container that has not been laid out yet", async () => {
    await act(async () => {
      render(<Terminal />);
    });

    // jsdom reports 0x0, and the fit addon throws when it measures that.
    expect(FakeFitAddon.fits).toBe(0);
  });

  it("fits once the container has a box, and on every observed resize", async () => {
    giveContainersASize();

    await act(async () => {
      render(<Terminal />);
    });

    // Once on mount, once from the observer's initial callback.
    expect(FakeFitAddon.fits).toBeGreaterThanOrEqual(2);
    expect(observed).toContain(screen.getByTestId("terminal"));
  });

  it("survives a fit that throws mid-measurement", async () => {
    giveContainersASize();
    vi.spyOn(FakeFitAddon.prototype, "fit").mockImplementation(() => {
      throw new Error("could not measure");
    });

    await act(async () => {
      render(<Terminal />);
    });

    expect(screen.getByTestId("terminal")).toBeTruthy();
  });

  it("tears the emulator down on unmount", async () => {
    let unmount: () => void = () => {};
    await act(async () => {
      ({ unmount } = render(<Terminal />));
    });
    const instance = latest();

    await act(async () => {
      unmount();
    });

    expect(instance.disposed).toBe(true);
    expect(instance.hasListeners).toBe(false);
    expect(disconnects).toBe(1);
  });

  it("exposes clear and focus, and ignores them once unmounted", async () => {
    const ref = React.createRef<TerminalHandle>();
    let unmount: () => void = () => {};
    await act(async () => {
      ({ unmount } = render(<Terminal ref={ref} />));
    });
    const instance = latest();
    const handle = ref.current!;

    act(() => handle.clear());
    act(() => handle.focus());
    expect(instance.cleared).toBe(true);
    expect(instance.focused).toBe(true);

    await act(async () => {
      unmount();
    });

    // A host holding the handle across an unmount must not crash on a late call.
    expect(() => {
      handle.clear();
      handle.write("late");
      handle.fit();
    }).not.toThrow();
  });
});
