import type { EditorState, Extension, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** The per-editor settings that can change without rebuilding the editor. */
export interface CodeMirrorInstanceConfig {
  readOnly: boolean;
  /** Called with the whole document whenever a transaction changed it. */
  onDocChange: (next: string) => void;
}

/** One editor's extension list, plus the handle that swaps its reconfigurable half in place. */
export interface CodeMirrorInstance {
  /** Everything `EditorState.create` needs: the shared base plus this editor's own compartment. */
  extensions: Extension[];
  /**
   * The effect to dispatch when {@link CodeMirrorInstanceConfig} changed.
   *
   * It carries only the compartment's *contents*. Handing it a list that includes the compartment
   * itself puts the compartment inside itself, which CodeMirror rejects at the next transaction with
   * `RangeError: Duplicate use of compartment in extensions` — an error that surfaces as an unhandled
   * rejection from `dispatch`, so the editor keeps its old configuration and nothing looks wrong
   * until the prop that was meant to change is observed not to have.
   */
  reconfigure: (config: CodeMirrorInstanceConfig) => StateEffect<unknown>;
}

/**
 * Every CodeMirror module this component touches, resolved through one dynamic `import()`.
 *
 * **This indirection is the bundle budget, not a style preference.** `tendril-app`'s eager closure —
 * the entry chunk plus everything it reaches through a *static* import — is measured by
 * `src/apps/tendril-app/tests/code-splitting.test.tsx` against a 1.6 MB `EAGER_BUDGET_BYTES`, and it
 * sat at 1,585,762 bytes (94.5%) before this component existed. CodeMirror's packages are a few
 * hundred kilobytes together, so a single `import { EditorView } from "@codemirror/view"` anywhere in
 * a module the `/ui` barrel re-exports puts all of it in front of first paint for every screen in the
 * app, and the budget goes red by a wide margin. The imports above are type-only, which the compiler
 * erases: they cost nothing at runtime.
 *
 * The same argument already keeps xterm.js out of the eager chunk in
 * `src/components/Terminal/Terminal.tsx` and KaTeX out of it in `src/lib/math.ts`. What differs here
 * is where the import lives: xterm's sits inline in a `useEffect`, which works because that component
 * needs two symbols. This one needs a dozen across six packages, so it is resolved once into a
 * module-level cache and every mounted editor joins the same promise — a split pane with two editors,
 * or a remount, must not refetch the chunk.
 *
 * Nothing in this file may be imported at module scope by a component. `CodeEditor` calls
 * {@link loadCodeMirror} from an effect.
 */
export interface CodeMirrorModule {
  EditorView: typeof EditorView;
  EditorState: typeof EditorState;
  /**
   * Builds one editor's extensions. Called per mounted editor rather than shared, because each needs
   * its own `Compartment`: a compartment is a slot identified by object identity within a single
   * configuration, so two editors sharing one would have their reconfigurations aimed at each other.
   */
  createInstance: (config: CodeMirrorInstanceConfig) => CodeMirrorInstance;
}

let cached: CodeMirrorModule | null = null;
let inFlight: Promise<CodeMirrorModule> | null = null;
/**
 * Bumped by {@link _resetCodeMirrorCacheForTests}, so a load that was already in flight when the
 * cache was dropped cannot write its result into the new one. Without it the reset is a trap rather
 * than a seam: the stale promise resolves a tick later, repopulates `cached`, and the next test sees
 * a warm cache it never asked for — which is exactly the ordering that makes such a suite pass or
 * fail depending on how many microtasks the previous case happened to leave pending.
 */
let generation = 0;

/**
 * Starts (or joins) the CodeMirror load. Idempotent — the promise is cached, so two editors mounting
 * in the same frame await one dynamic import rather than racing two.
 *
 * The YAML grammar is loaded alongside the editor rather than behind a second import keyed on
 * `language`: `@codemirror/lang-yaml` and its Lezer parser are a fraction of the editor's own weight,
 * and YAML is the only language the contract defines. Splitting it would add a second round trip to
 * save a rounding error.
 */
export async function loadCodeMirror(): Promise<CodeMirrorModule> {
  if (cached) return cached;

  const loadGeneration = generation;
  inFlight ??= (async (): Promise<CodeMirrorModule> => {
    const [state, view, langYaml, language, commands, highlight] = await Promise.all([
      import("@codemirror/state"),
      import("@codemirror/view"),
      import("@codemirror/lang-yaml"),
      import("@codemirror/language"),
      import("@codemirror/commands"),
      import("@lezer/highlight"),
    ]);

    /**
     * Highlighting mapped onto the app's own token colours rather than `@codemirror/theme-one-dark`.
     * The contract allows either ("or the repo's own theming"), and one-dark is a fixed dark palette:
     * this editor sits inside the app's light or dark surface, not inside a terminal's black one, so
     * a hard-coded palette would be unreadable in light mode and would ignore a theme switch.
     *
     * The colours are the same CSS variables `prismTheme` (src/lib/prismTheme.ts) maps Prism's tokens
     * to, so a YAML fence in a plan and a YAML document in this editor highlight identically.
     */
    const highlightStyle = language.HighlightStyle.define([
      { tag: highlight.tags.keyword, color: "var(--purple)" },
      // YAML mapping keys arrive as `propertyName` from the Lezer grammar, not as `keyword`.
      { tag: highlight.tags.propertyName, color: "var(--cyan)" },
      { tag: highlight.tags.string, color: "var(--primary)" },
      { tag: highlight.tags.number, color: "var(--foreground)" },
      { tag: highlight.tags.bool, color: "var(--cyan)" },
      { tag: highlight.tags.null, color: "var(--violet)" },
      { tag: highlight.tags.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
      { tag: highlight.tags.punctuation, color: "var(--foreground)" },
      { tag: highlight.tags.meta, color: "var(--muted-foreground)" },
      { tag: highlight.tags.invalid, color: "var(--destructive)" },
    ]);

    /** Shared by every editor: nothing here varies per instance or is reconfigured. */
    const baseExtensions: Extension[] = [
      view.lineNumbers(),
      view.highlightActiveLine(),
      view.highlightActiveLineGutter(),
      view.drawSelection(),
      view.rectangularSelection(),
      // Two spaces, which is what config.yaml is written with. CodeMirror otherwise indents with a
      // tab, and a YAML file mixing the two is a parse error waiting to happen.
      state.EditorState.tabSize.of(2),
      language.indentUnit.of("  "),
      language.indentOnInput(),
      language.bracketMatching(),
      language.syntaxHighlighting(highlightStyle),
      langYaml.yaml(),
      view.keymap.of([...commands.defaultKeymap, ...commands.historyKeymap]),
      commands.history(),
    ];

    /** The reconfigurable half, as contents — see the warning on `CodeMirrorInstance.reconfigure`. */
    const instanceContents = ({ readOnly, onDocChange }: CodeMirrorInstanceConfig): Extension[] => [
      // `EditorState.readOnly` blocks programmatic changes too, so `EditorView.editable` is what stops
      // the *user* typing while the host can still push a new document in. Both are set: `editable`
      // alone leaves the content focusable with a live caret, and a read-only editor that looks
      // editable is the same lie a blinking caret on a dead pty tells.
      state.EditorState.readOnly.of(readOnly),
      view.EditorView.editable.of(!readOnly),
      view.EditorView.updateListener.of((update) => {
        // `docChanged` and not every update: a selection move or a scroll would otherwise call
        // `onChange` with an unchanged string on every interaction that typed nothing.
        if (update.docChanged) {
          onDocChange(update.state.doc.toString());
        }
      }),
    ];

    const module: CodeMirrorModule = {
      EditorView: view.EditorView,
      EditorState: state.EditorState,
      createInstance: (config) => {
        const compartment = new state.Compartment();
        return {
          extensions: [...baseExtensions, compartment.of(instanceContents(config))],
          reconfigure: (next) => compartment.reconfigure(instanceContents(next)),
        };
      },
    };

    if (loadGeneration === generation) cached = module;
    // Resolved either way: a caller that started this load still gets a usable module, it just does
    // not become the cached one.
    return module;
  })();

  return inFlight;
}

/** The loaded module, or `null` while it has never been needed or is still in flight. Test seam. */
export function getLoadedCodeMirror(): CodeMirrorModule | null {
  return cached;
}

/**
 * Drops the module cache. Exists for tests that need a fresh load per case; production code has no
 * reason to call it, which is why it is not re-exported from `ui.ts`.
 */
export function _resetCodeMirrorCacheForTests(): void {
  cached = null;
  inFlight = null;
  generation += 1;
}
