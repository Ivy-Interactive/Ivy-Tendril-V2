import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { CodeEditor } from "./CodeEditor.tsx";
import {
  _resetCodeMirrorCacheForTests,
  getLoadedCodeMirror,
  loadCodeMirror,
} from "./codemirror.lazy.ts";

/**
 * CodeMirror is exercised for real rather than mocked. Unlike xterm (see `Terminal.test.tsx`, which
 * mocks it because it measures a real font against a real layout), CodeMirror's document model,
 * transactions and contenteditable wiring all work in jsdom — and those are exactly the parts worth
 * pinning here. What jsdom cannot do is measure, so nothing below asserts on pixels, scroll position
 * or viewport ranges.
 *
 * The one thing these tests cannot see is the bundle consequence that shaped the component, so the
 * last block asserts it at the source level, the way `tests/diagram-lazy-imports.test.ts` guards
 * Mermaid and Graphviz.
 */

const thisDir = dirname(fileURLToPath(import.meta.url));

/**
 * Renders and waits until the editor is actually on screen.
 *
 * The extra `await loadCodeMirror()` inside a second `act` is not belt-and-braces. The mount effect
 * awaits the dynamic import and only then calls `setReady`, so a single flushed `act` returns with
 * the import resolved but the state update it schedules still pending — the component is one React
 * commit short of having replaced the fallback. Awaiting the (now cached) promise gives that commit
 * its turn. `Terminal.test.tsx` gets away with one `act` only because it mocks its imports away.
 */
async function mountEditor(ui: React.ReactElement) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(ui);
  });
  await act(async () => {
    await loadCodeMirror();
  });
  return result;
}

/** Re-renders through the same two-phase flush, for a prop change that reconfigures the editor. */
async function rerenderEditor(rerender: (ui: React.ReactElement) => void, ui: React.ReactElement) {
  await act(async () => {
    rerender(ui);
  });
  await act(async () => {
    await loadCodeMirror();
  });
}

/** Reads back the document the mounted editor holds, through the DOM rather than a view handle. */
function editorText(): string {
  const content = document.querySelector(".cm-content");
  if (!content) throw new Error("no mounted editor: the fallback is still on screen");
  // CodeMirror renders one `.cm-line` per line and inserts no newline text nodes between them.
  return [...content.querySelectorAll(".cm-line")].map((line) => line.textContent).join("\n");
}

describe("CodeEditor", () => {
  afterEach(() => {
    cleanup();
    _resetCodeMirrorCacheForTests();
  });

  it("shows the document as plain text before CodeMirror resolves", () => {
    // Not awaited: this is the frame between mount and the dynamic import landing, which on a cold
    // cache is a network round trip rather than a microtask.
    act(() => {
      render(<CodeEditor value={"llm:\n  provider: anthropic\n"} onChange={() => {}} />);
    });

    expect(screen.getByTestId("code-editor-fallback").textContent).toBe(
      "llm:\n  provider: anthropic\n",
    );
    expect(document.querySelector(".cm-content")).toBeNull();
  });

  it("does not claim to be ready while the fallback is what is on screen", () => {
    act(() => {
      render(<CodeEditor value="a: 1" onChange={() => {}} data-testid="editor" />);
    });

    // The Storybook visual runner gates its screenshot on this attribute. If it appeared before the
    // editor did, every baseline would be a picture of the fallback.
    expect(screen.getByTestId("editor").getAttribute("data-editor-ready")).toBeNull();
  });

  it("replaces the fallback with a mounted editor and marks itself ready", async () => {
    await mountEditor(
      <CodeEditor
        value={"llm:\n  provider: anthropic\n"}
        onChange={() => {}}
        data-testid="editor"
      />,
    );

    expect(screen.getByTestId("editor").getAttribute("data-editor-ready")).toBe("true");
    expect(screen.queryByTestId("code-editor-fallback")).toBeNull();
    expect(editorText()).toBe("llm:\n  provider: anthropic\n");
  });

  it("reports edits made in the editor", async () => {
    const onChange = vi.fn();
    await mountEditor(<CodeEditor value="port: 8765" onChange={onChange} data-testid="editor" />);

    // Dispatched as a transaction rather than as synthetic keystrokes: jsdom has no
    // `beforeinput`/composition pipeline, so a keystroke never reaches CodeMirror's input handler.
    // The update listener this pins runs the same way for either source.
    act(() => {
      const cm = getLoadedCodeMirror()!;
      const editorView = cm.EditorView.findFromDOM(screen.getByTestId("editor"))!;
      editorView.dispatch({ changes: { from: 10, insert: "4" } });
    });

    expect(onChange).toHaveBeenCalledWith("port: 87654");
  });

  it("calls the host's newest onChange after a re-render, without rebuilding the editor", async () => {
    const first = vi.fn();
    const second = vi.fn();
    let rerender: (ui: React.ReactElement) => void = () => {};

    ({ rerender } = await mountEditor(
      <CodeEditor value="a: 1" onChange={first} data-testid="editor" />,
    ));
    const contentBefore = document.querySelector(".cm-content");

    await rerenderEditor(
      rerender,
      <CodeEditor value="a: 1" onChange={second} data-testid="editor" />,
    );

    act(() => {
      const cm = getLoadedCodeMirror()!;
      cm.EditorView.findFromDOM(screen.getByTestId("editor"))!.dispatch({
        changes: { from: 4, insert: "2" },
      });
    });

    expect(second).toHaveBeenCalledWith("a: 12");
    expect(first).not.toHaveBeenCalled();
    // A rebuild would have dropped the undo history, the selection and the scroll position.
    expect(document.querySelector(".cm-content")).toBe(contentBefore);
  });

  it("leaves the document and the selection alone when the host echoes back what was typed", async () => {
    let rerender: (ui: React.ReactElement) => void = () => {};
    ({ rerender } = await mountEditor(
      <CodeEditor value="a: 1" onChange={() => {}} data-testid="editor" />,
    ));

    const cm = getLoadedCodeMirror()!;
    const view = cm.EditorView.findFromDOM(screen.getByTestId("editor"))!;
    act(() => view.dispatch({ selection: { anchor: 1 } }));

    // The controlled-component round trip: the editor reported "a: 1", the host stored it and
    // re-rendered with the identical string. Re-inserting it would collapse the caret to the start
    // and make typing anywhere but the end of the file impossible.
    await rerenderEditor(
      rerender,
      <CodeEditor value="a: 1" onChange={() => {}} data-testid="editor" />,
    );

    expect(view.state.selection.main.anchor).toBe(1);
  });

  it("pushes a value the host changed underneath it into the live document", async () => {
    let rerender: (ui: React.ReactElement) => void = () => {};
    ({ rerender } = await mountEditor(
      <CodeEditor value="port: 8765" onChange={() => {}} data-testid="editor" />,
    ));

    // What a reload-from-disk does: the document on screen is replaced wholesale.
    await rerenderEditor(
      rerender,
      <CodeEditor value="port: 9000" onChange={() => {}} data-testid="editor" />,
    );

    expect(editorText()).toBe("port: 9000");
  });

  it("makes a read-only editor uneditable rather than merely ignoring input", async () => {
    await mountEditor(
      <CodeEditor value="a: 1" onChange={() => {}} readOnly data-testid="editor" />,
    );

    const content = document.querySelector(".cm-content")!;
    expect(content.getAttribute("contenteditable")).toBe("false");
    const cm = getLoadedCodeMirror()!;
    expect(cm.EditorView.findFromDOM(screen.getByTestId("editor"))!.state.readOnly).toBe(true);
  });

  it("takes editing away from a live editor without rebuilding it", async () => {
    let rerender: (ui: React.ReactElement) => void = () => {};
    ({ rerender } = await mountEditor(
      <CodeEditor value="a: 1" onChange={() => {}} data-testid="editor" />,
    ));
    const contentBefore = document.querySelector(".cm-content");
    expect(contentBefore!.getAttribute("contenteditable")).toBe("true");

    await rerenderEditor(
      rerender,
      <CodeEditor value="a: 1" onChange={() => {}} readOnly data-testid="editor" />,
    );

    // Reconfigured through the compartment: same editor, same document, no longer editable.
    expect(document.querySelector(".cm-content")).toBe(contentBefore);
    expect(contentBefore!.getAttribute("contenteditable")).toBe("false");
  });

  it("tears the editor down on unmount", async () => {
    const onChange = vi.fn();
    let unmount: () => void = () => {};
    ({ unmount } = await mountEditor(
      <CodeEditor value="a: 1" onChange={onChange} data-testid="editor" />,
    ));
    const cm = getLoadedCodeMirror()!;
    const view = cm.EditorView.findFromDOM(screen.getByTestId("editor"))!;

    await act(async () => {
      unmount();
    });

    // Neither `isConnected` nor a `document` query would prove anything here: React detaches the host
    // on unmount, so both go false whether or not the editor was destroyed. `destroy()` is what
    // removes the view's own DOM from the container React left behind, so the parent link is the one
    // observable that distinguishes a torn-down editor from an abandoned one.
    expect(view.dom.parentNode).toBeNull();

    // And the reason it matters. An abandoned view keeps its ResizeObserver, its document-level
    // listeners and its update listener, so a late transaction still calls back into a host that is
    // gone. A destroyed one absorbs the transaction silently.
    act(() => view.dispatch({ changes: { from: 0, insert: "x" } }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens no editor when the host unmounts while the chunk is still in flight", async () => {
    let unmount: () => void = () => {};
    // Deliberately not awaited before unmounting: this is the tab-away-during-load case, and opening
    // an editor into a detached node afterwards leaks everything the teardown would have released.
    act(() => {
      ({ unmount } = render(<CodeEditor value="a: 1" onChange={() => {}} data-testid="editor" />));
    });
    // Held across the unmount: after it, `host` is detached, so a `document` query would report no
    // editor even if the resolved import had gone ahead and opened one into this very node. The
    // detached subtree is the only place the leak would be visible.
    const host = screen.getByTestId("editor");
    act(() => unmount());

    await act(async () => {
      await loadCodeMirror();
    });

    expect(host.querySelector(".cm-content")).toBeNull();
  });

  it("carries the language on the host so a stylesheet or a test can see it", async () => {
    await mountEditor(<CodeEditor value="a: 1" onChange={() => {}} data-testid="editor" />);

    expect(screen.getByTestId("editor").getAttribute("data-language")).toBe("yaml");
  });
});

describe("loadCodeMirror", () => {
  afterEach(() => {
    _resetCodeMirrorCacheForTests();
  });

  it("resolves one module for every caller", async () => {
    expect(getLoadedCodeMirror()).toBeNull();

    // A split pane with two editors, or a remount, must join the in-flight import rather than start
    // a second one.
    const [a, b] = await Promise.all([loadCodeMirror(), loadCodeMirror()]);

    expect(a).toBe(b);
    expect(getLoadedCodeMirror()).toBe(a);
    expect(await loadCodeMirror()).toBe(a);
  });
});

describe("CodeEditor bundle discipline", () => {
  /**
   * The eager-closure budget in `src/apps/tendril-app/tests/code-splitting.test.tsx` is the real
   * guard, but it only fails after a full production build. This catches the same mistake in the
   * package's own suite, in the second it takes to read two files — the pattern
   * `tests/diagram-lazy-imports.test.ts` uses for Mermaid and Graphviz.
   */
  const staticCodeMirrorValueImport =
    /^import\s+(?!type\b)(?:[\w*{][^;]*?from\s+)?["'](?:@codemirror\/[\w-]+|@lezer\/[\w-]+)["'];?$/m;

  it("CodeEditor.tsx imports CodeMirror for types only", () => {
    const source = readFileSync(join(thisDir, "CodeEditor.tsx"), "utf-8");
    expect(source).not.toMatch(staticCodeMirrorValueImport);
  });

  it("codemirror.lazy.ts reaches every CodeMirror package through a dynamic import", () => {
    const source = readFileSync(join(thisDir, "codemirror.lazy.ts"), "utf-8");
    expect(source).not.toMatch(staticCodeMirrorValueImport);

    for (const specifier of [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/lang-yaml",
      "@codemirror/language",
      "@codemirror/commands",
      "@lezer/highlight",
    ]) {
      expect(source).toContain(`import("${specifier}")`);
    }
  });
});
