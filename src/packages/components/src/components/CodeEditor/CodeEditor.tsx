import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { cn } from "@/lib/utils";
import type { CodeMirrorInstance } from "./codemirror.lazy.ts";
import { loadCodeMirror } from "./codemirror.lazy.ts";
import "./code-editor.css";

export interface CodeEditorProps {
  /**
   * The document. Treated as controlled-ish: a `value` that differs from what the editor currently
   * holds is pushed in as a transaction, but the editor is the source of truth between renders. See
   * the sync effect below for why replacing the document on every render would be wrong.
   */
  value: string;
  onChange: (next: string) => void;
  /**
   * The only language the contract defines, and the only one the lazy chunk carries a grammar for.
   * Declared as a prop anyway because the signature is frozen and because a second language is a
   * one-line addition to `codemirror.lazy.ts` rather than a change here.
   */
  language?: "yaml";
  readOnly?: boolean;
  className?: string;
  "data-testid"?: string;
}

/**
 * A YAML source editor, ported from V1's `RawConfigEditorView.cs`
 * (`ToCodeInput(language: Languages.Yaml)`).
 *
 * **CodeMirror 6, deliberately not Monaco.** Monaco runs its language services in a web worker and
 * loads them from a `blob:` URL; the Tauri CSP in `src/apps/tendril-app/src-tauri/tauri.conf.json`
 * declares neither `worker-src` nor `blob:`, so Monaco would need a CSP relaxation to render at all.
 * CodeMirror ships no worker. V1 used CodeMirror too, so this is also the smaller behavioural jump.
 *
 * **CodeMirror is loaded behind a dynamic `import()`, and that is load-bearing.** See the comment on
 * `loadCodeMirror` in `codemirror.lazy.ts`: `tendril-app`'s eager closure is at 94.5% of its 1.6 MB
 * budget, so ~350 kB arriving statically through the `/ui` barrel would fail
 * `tests/code-splitting.test.tsx`. Until the import resolves this renders the document as read-only
 * monospaced text at the editor's own metrics, so the swap is a highlight appearing rather than a
 * reflow.
 *
 * The host carries `data-editor-ready="true"` once CodeMirror has mounted. That attribute is not
 * decoration: the Storybook visual runner would otherwise screenshot the fallback, and
 * `CodeEditor.stories.tsx` points `parameters.visual.waitForSelector` at it. See
 * `.storybook/test-runner.ts`.
 */
export function CodeEditor({
  value,
  onChange,
  language = "yaml",
  readOnly = false,
  className,
  "data-testid": dataTestId,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** This editor's own compartment handle. Per instance, not per module — see `createInstance`. */
  const instanceRef = useRef<CodeMirrorInstance | null>(null);
  const [ready, setReady] = useState(false);

  /**
   * Written on every render so the editor's own listener always calls the current `onChange`, and so
   * the editor is built with the props it has now rather than the ones it had when the dynamic import
   * started. The listener is registered once, at mount: re-registering it per render would tear the
   * editor down — and with it the undo history, the selection and the scroll position — every time
   * the host re-rendered. Same pattern, and the same reason, as `Terminal.tsx`.
   */
  const handlers = useRef({ onChange, readOnly, value });
  handlers.current = { onChange, readOnly, value };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let teardown: (() => void) | undefined;

    void (async () => {
      const cm = await loadCodeMirror();
      // The host unmounted (or Strict Mode ran the effect twice) while the chunk was in flight.
      // Opening an editor into a detached node leaks a ResizeObserver and a document listener.
      if (cancelled) return;

      const instance = cm.createInstance({
        readOnly: handlers.current.readOnly,
        // Not `handlers.current.onChange` captured here: the indirection through the ref is what
        // keeps a re-rendered host's newest callback connected to an editor built once.
        onDocChange: (next) => handlers.current.onChange(next),
      });

      const view = new cm.EditorView({
        state: cm.EditorState.create({
          doc: handlers.current.value,
          extensions: instance.extensions,
        }),
        parent: container,
      });

      viewRef.current = view;
      instanceRef.current = instance;
      setReady(true);

      teardown = () => {
        view.destroy();
        viewRef.current = null;
        instanceRef.current = null;
      };
    })();

    return () => {
      cancelled = true;
      teardown?.();
      setReady(false);
    };
    // Mount-only. `value` and `readOnly` are applied to the live editor by the two effects below
    // rather than by rebuilding it, because a rebuild would drop the undo history and the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Pushes a `value` the host changed underneath the editor — a reload from disk, a reset after save
   * — into the live document.
   *
   * Gated on the document actually differing, and that guard is the whole point. Every keystroke
   * calls `onChange`, the host stores it and re-renders with it, and this effect then sees the same
   * string the editor already holds. Dispatching it anyway would replace the document on every
   * keystroke, which collapses the selection to the start and makes typing anywhere but the end of
   * the file impossible.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const current = view.state.doc.toString();
    if (current === value) return;

    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value, ready]);

  /**
   * Applied to the live editor through its compartment, for the same no-rebuild reason: a rebuild
   * here would clear the undo history every time a save flipped the editor read-only and back.
   */
  useEffect(() => {
    const view = viewRef.current;
    const instance = instanceRef.current;
    if (!view || !instance) return;

    view.dispatch({
      effects: instance.reconfigure({
        readOnly,
        onDocChange: (next) => handlers.current.onChange(next),
      }),
    });
  }, [readOnly, ready]);

  return (
    <div
      className={cn("ivy-code-editor-host", className)}
      data-testid={dataTestId}
      data-language={language}
      // The Storybook visual runner's gate, and the one signal a test has that the real editor is on
      // screen rather than the fallback.
      data-editor-ready={ready ? "true" : undefined}
    >
      <div ref={containerRef} className="ivy-code-editor" data-read-only={String(readOnly)} />
      {!ready && (
        // `aria-hidden` because this is a transient stand-in for the editor that is about to replace
        // it: announcing the document twice, once as static text and once as a textbox, is worse for
        // a screen reader than announcing it once a beat later.
        <pre className="ivy-code-editor-fallback" data-testid="code-editor-fallback" aria-hidden>
          {value}
        </pre>
      )}
    </div>
  );
}
