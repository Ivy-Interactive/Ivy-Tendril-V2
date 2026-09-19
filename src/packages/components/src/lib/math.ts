import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { Options } from "react-markdown";
import { hasRawHtml, rawHtmlSchema } from "./rawHtml";

type MarkdownPlugins = Required<Pick<Options, "remarkPlugins" | "rehypePlugins">>;
type RehypePlugin = NonNullable<MarkdownPlugins["rehypePlugins"]>[number];

/**
 * `rehype-katex` is loaded on demand rather than imported, because importing it makes all of KaTeX
 * eager: `katex` is 259 kB minified, and a static `import rehypeKatex from "rehype-katex"` anywhere
 * in this file's importer graph puts it in the initial load of every app that touches the
 * `@ivy-interactive/components/tendril` barrel — measured in `tendril-app`'s
 * `tests/code-splitting.test.tsx` as a `vendor-katex` chunk in the entry's static closure. Most
 * markdown Tendril renders (plans, notes, agent output) contains no maths at all, so that is 259 kB
 * fetched before first paint for a feature the document usually does not use.
 *
 * This mirrors how `MarkdownCodeBlock` already treats Mermaid, Graphviz and the Prism highlighter:
 * detect the feature in the content, then `import()` the renderer for it. The difference is that
 * those are React components behind `lazyWithRetry`/`Suspense`, whereas a rehype plugin has to be
 * present *synchronously* when react-markdown builds its processor. So the load is resolved into a
 * module-level cache and subscribers are notified, and `useMathReady` (see
 * `src/hooks/use-math-ready.ts`) re-renders the components that render markdown once it lands. The
 * first paint of a document with maths therefore shows the TeX source, and the paint after the
 * plugin resolves shows the typeset maths - the same one-frame trade the diagram renderers make.
 */
let rehypeKatex: RehypePlugin | null = null;
let rehypeKatexLoad: Promise<RehypePlugin> | null = null;
const rehypeKatexListeners = new Set<() => void>();

/** The loaded plugin, or `null` while it has never been needed or is still in flight. */
export const getRehypeKatex = (): RehypePlugin | null => rehypeKatex;

/**
 * Starts (or joins) the `rehype-katex` load. Idempotent - the promise is cached, so the concurrent
 * calls that a page full of maths blocks produces all await one dynamic import.
 */
export const loadRehypeKatex = (): Promise<RehypePlugin> => {
  rehypeKatexLoad ??= import("rehype-katex").then(({ default: plugin }) => {
    rehypeKatex = plugin;
    for (const notify of rehypeKatexListeners) notify();
    return plugin;
  });
  return rehypeKatexLoad;
};

/** Subscribes to the moment the plugin becomes available. Returns the unsubscribe function. */
export const subscribeToRehypeKatex = (listener: () => void): (() => void) => {
  rehypeKatexListeners.add(listener);
  return () => {
    rehypeKatexListeners.delete(listener);
  };
};

/**
 * The only delimiter that marks math in Tendril markdown: `$$...$$`.
 *
 * Single-dollar text math is deliberately not recognised (see
 * `singleDollarTextMath` below), so a lone `$` is not a math signal.
 */
const MATH_DELIMITER = /\$\$/;

/** True when the content contains a `$$` math delimiter. */
export const hasMath = (content: string): boolean => MATH_DELIMITER.test(content);

/**
 * The remark/rehype plugin lists for rendering markdown: GFM always, plus the
 * raw-HTML pair and the math pair when the content actually needs them. Gating
 * on the content keeps both extra tree walks off the render path for the
 * overwhelming majority of plan markdown, notes and agent output.
 *
 * `singleDollarTextMath: false` is required, not a preference: Tendril markdown
 * is full of prose dollar signs (`$env:PORT`, `$IsMacOS`, prices), and with
 * single-dollar math enabled remark-math pairs them up and renders the text
 * between two unrelated dollars as math. Inline math therefore also uses
 * `$$...$$`, which remark-math renders inline when it sits inside a paragraph
 * and as a centered display block when it stands on its own line. This matches
 * the Ivy framework's own Markdown widget, so math behaves the same in
 * `Text.Markdown` and in the Tendril widgets.
 *
 * KaTeX's stylesheet and web fonts are deliberately not bundled here: the Ivy
 * host page already loads them eagerly (its `vendor-markdown-*.css` carries the
 * `.katex` rules and all `KaTeX_*` `@font-face` declarations), so the widget
 * bundle inherits them and only needs the plugins.
 *
 * Note the signature stays synchronous even though `rehype-katex` is now loaded
 * on demand (see the cache above). Four components and the package's public API
 * call this during render, so making it async would ripple a long way for no
 * gain. Instead, when the content has maths and the plugin is not loaded yet,
 * this kicks off the load and returns the plugin list without it; the paint after
 * the import resolves includes it, provided the caller also uses `useMathReady`
 * to subscribe to that moment.
 */
export const getMarkdownPlugins = (content: string): MarkdownPlugins => {
  const remarkPlugins: MarkdownPlugins["remarkPlugins"] = [remarkGfm];
  const rehypePlugins: MarkdownPlugins["rehypePlugins"] = [];

  // Raw HTML first: rehype-raw reparses the raw nodes into real elements, then
  // rehype-sanitize prunes everything outside the allow-list. See `rawHtml.ts`.
  if (hasRawHtml(content)) {
    rehypePlugins.push(rehypeRaw, [rehypeSanitize, rawHtmlSchema]);
  }

  // KaTeX has to run after sanitising: its output is a large tree of classed
  // spans, inline styles and MathML that the allow-list would strip.
  if (hasMath(content)) {
    remarkPlugins.push([remarkMath, { singleDollarTextMath: false }]);
    if (rehypeKatex) rehypePlugins.push(rehypeKatex);
    else void loadRehypeKatex();
  }

  return { remarkPlugins, rehypePlugins };
};
