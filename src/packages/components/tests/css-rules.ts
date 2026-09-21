export interface CssRule {
  /** Each comma-separated selector in the rule's prelude, trimmed individually. */
  selectors: string[];
  declarations: Map<string, string>;
  /** Set on a rule that came from a Tailwind v4 `@theme` (not `@theme inline`) block. */
  isTailwindTheme?: boolean;
}

const AT_RULES_THAT_WRAP_STYLE_RULES = new Set(["@media", "@layer", "@supports", "@container"]);

/**
 * Flattens a stylesheet into its style rules: selector list plus custom-property declarations.
 *
 * Descends into `@media`/`@layer`/`@supports`/`@container` (their own prelude is never a selector,
 * but the rules nested inside them are ordinary style rules). Descends into CSS nesting (`&` and
 * bare nested selectors) too, expanding a nested prelude against every selector of its parent so
 * `.card { &:hover { --a: ...; } }` yields `.card:hover`, not the bare (and meaningless) `:hover`.
 * Skips `@keyframes` bodies entirely -- `from`/`to`/`50%` are keyframe selectors, not style-rule
 * selectors, and never carry a themed custom property. A plain (non-inline) `@theme { ... }` block
 * is a Tailwind v4 directive that emits real `:root`-level custom properties in the compiled
 * output, so its declarations come back as one `CssRule` tagged `isTailwindTheme: true`; `@theme
 * inline { ... }` is Tailwind-only syntax that never emits a `:root` property (Tailwind inlines the
 * referenced value straight into each utility instead), so it is skipped.
 */
export function parseCssRules(source: string): CssRule[] {
  const css = stripCommentsAndStrings(source);
  const rules: CssRule[] = [];
  walkBlock(css, 0, css.length, [], rules);
  return rules;
}

/**
 * Comments and string contents can hold `{`, `}`, `,` or `;` that would otherwise desync the brace
 * walk below. Both are replaced character-for-character (never removed) so every other index in the
 * returned string still lines up with the original source.
 */
function stripCommentsAndStrings(source: string): string {
  let result = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      result += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    const char = source[i];
    if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== char) {
        if (source[j] === "\\") j++;
        j++;
      }
      const stop = Math.min(j + 1, source.length);
      result += "x".repeat(stop - i);
      i = stop;
      continue;
    }
    result += char;
    i++;
  }
  return result;
}

function matchingBrace(css: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return css.length;
}

function isKeyframeStep(prelude: string): boolean {
  return /^(from|to|\d+(\.\d+)?%)$/.test(prelude);
}

function declarationsOf(body: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    result.set(match[1], match[2]);
  }
  return result;
}

/** Direct (non-nested) declarations only -- stops at the first nested rule's own `{`. */
function directDeclarationsOf(body: string): string {
  let depth = 0;
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "{") {
      depth++;
      continue;
    }
    if (char === "}") {
      depth--;
      continue;
    }
    if (depth === 0) out += char;
  }
  return out;
}

/**
 * Splits a selector list on top-level commas only -- not one inside `:is(...)`, `:where(...)`,
 * `:not(...)` or `[attr="a,b"]`. Depth tracks both `()` and `[]`; string contents were already
 * blanked out by `stripCommentsAndStrings`, so a quoted comma inside an attribute value no longer
 * reads as a comma at all, but the bracket itself still needs to count toward depth.
 */
function splitTopLevelCommas(selectorList: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of selectorList) {
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Expands a nested prelude's `&` against each parent selector; no `&` means plain descent. */
function expandSelectors(parents: string[], prelude: string): string[] {
  if (parents.length === 0) return splitTopLevelCommas(prelude);
  const nestedSelectors = splitTopLevelCommas(prelude);
  const expanded: string[] = [];
  for (const parent of parents) {
    for (const nested of nestedSelectors) {
      expanded.push(nested.includes("&") ? nested.replaceAll("&", parent) : `${parent} ${nested}`);
    }
  }
  return expanded;
}

function walkBlock(
  css: string,
  start: number,
  end: number,
  parents: string[],
  rules: CssRule[],
): void {
  let preludeStart = start;
  let i = start;
  while (i < end) {
    const char = css[i];
    if (char === "{") {
      const prelude = css.slice(preludeStart, i).trim();
      const closeIndex = matchingBrace(css, i);
      const bodyStart = i + 1;

      if (prelude.startsWith("@theme")) {
        const isInline = /^@theme\s+inline\b/.test(prelude);
        if (!isInline) {
          rules.push({
            selectors: [":root"],
            declarations: declarationsOf(css.slice(bodyStart, closeIndex)),
            isTailwindTheme: true,
          });
        }
        // Neither form nests further style rules worth descending into.
      } else if (prelude.startsWith("@keyframes")) {
        // Its steps (`from`, `to`, `50%`) are not style-rule selectors; skip the whole body.
      } else if (prelude.startsWith("@")) {
        const atRuleName = prelude.match(/^@[\w-]+/)?.[0] ?? "";
        if (AT_RULES_THAT_WRAP_STYLE_RULES.has(atRuleName)) {
          walkBlock(css, bodyStart, closeIndex, parents, rules);
        }
        // An unrecognised at-rule (`@font-face`, `@property`, ...) carries no selector worth
        // walking into; its body is skipped.
      } else if (prelude.length > 0 && !isKeyframeStep(prelude)) {
        const selectors = expandSelectors(parents, prelude);
        const body = css.slice(bodyStart, closeIndex);
        const direct = directDeclarationsOf(body);
        if (direct.trim().length > 0) {
          rules.push({ selectors, declarations: declarationsOf(direct) });
        }
        // CSS nesting: descend with this rule's own (expanded) selectors as the new parents.
        walkBlock(css, bodyStart, closeIndex, selectors, rules);
      }

      i = closeIndex + 1;
      preludeStart = i;
      continue;
    }
    if (char === "}") {
      // Unbalanced relative to `start`/`end` -- matchingBrace above keeps this from firing for any
      // brace this function opened itself.
      preludeStart = i + 1;
    }
    if (char === ";") {
      // A plain declaration ending before a nested rule -- `.card { color: red; &:hover { ... } }`
      // -- must not leak into that nested rule's own prelude scan.
      preludeStart = i + 1;
    }
    i++;
  }
}

/** `:root`, `:host`, and `html`, each optionally combined with other simple/pseudo selectors. */
const ROOT_LIKE_COMPOUND = /^(:root|:host|html)([.:#[][^\s>+~]*)?$/;

/** The two dark-theme signals this codebase actually uses -- see agent-output.css. */
const DARK_TOKEN = /(\.dark\b|\[data-theme=(["'])dark\2\])/;

/**
 * A top-level `:is(...)`/`:where(...)` in `selector`, or `null` if there is none. Depth-aware, so it
 * finds the *first* one and hands back everything before and after it -- a second one further along
 * the same selector is picked up by the caller's own recursion over each expanded alternative.
 */
function topLevelFunctionalPseudo(
  selector: string,
): { before: string; alternatives: string[]; after: string } | null {
  const match = /:(?:is|where)\(/.exec(selector);
  if (!match) return null;

  const openParen = match.index + match[0].length - 1;
  let depth = 0;
  let closeParen = -1;
  for (let i = openParen; i < selector.length; i++) {
    if (selector[i] === "(") depth++;
    else if (selector[i] === ")") {
      depth--;
      if (depth === 0) {
        closeParen = i;
        break;
      }
    }
  }
  if (closeParen === -1) return null;

  return {
    before: selector.slice(0, match.index),
    alternatives: splitTopLevelCommas(selector.slice(openParen + 1, closeParen)),
    after: selector.slice(closeParen + 1),
  };
}

/**
 * Expands every top-level `:is(...)`/`:where(...)` in a selector into the cross-product of plain
 * selectors it can stand for -- `:is(:root, .dark)` becomes `[":root", ".dark"]`, and `:is(.dark,
 * [data-theme="dark"]) .aov-shell` becomes `[".dark .aov-shell", "[data-theme=\"dark\"] .aov-shell"]`.
 * A selector with no functional pseudo expands to itself. Recurses so a second occurrence, or one
 * nested inside another, is expanded too.
 */
function expandFunctionalPseudoAlternatives(selector: string): string[] {
  const found = topLevelFunctionalPseudo(selector);
  if (!found) return [selector];

  const results: string[] = [];
  for (const alternative of found.alternatives) {
    results.push(
      ...expandFunctionalPseudoAlternatives(`${found.before}${alternative}${found.after}`),
    );
  }
  return results;
}

/**
 * True for a plain (already `:is()`/`:where()`-expanded) selector whose leading compound targets the
 * document root or a shadow host -- `:root`, `html`, `:host`, or a compound combining one of those
 * with other simple selectors (`:root:not(.dark)`, `html.foo`) -- and that is not itself a dark
 * selector. `:not(...)` content is stripped before the dark check, since `:not(.dark)` excludes dark
 * rather than targeting it.
 */
function isRootAlternative(selector: string): boolean {
  if (isDarkAlternative(selector)) return false;
  const leadingCompound = selector.split(/[\s>+~]/)[0];
  return ROOT_LIKE_COMPOUND.test(leadingCompound);
}

/** True for a plain (already expanded) selector that declares inside `.dark`/`[data-theme="dark"]`. */
function isDarkAlternative(selector: string): boolean {
  const withoutNegations = selector.replace(/:not\([^)]*\)/g, "");
  return DARK_TOKEN.test(withoutNegations);
}

/**
 * True if any alternative a selector can expand to (through `:is()`/`:where()`) targets the document
 * root or a shadow host outside `.dark` -- `:is(:root, .dark) { --x: var(--background); }` matches
 * the root element in light mode through its `:root` alternative, so that alternative alone needs a
 * `.dark` companion: this is a root-level declaration, exactly as if it had been written `:root,
 * .dark { ... }`.
 */
export function isRootSelector(selector: string): boolean {
  return expandFunctionalPseudoAlternatives(selector).some(isRootAlternative);
}

/**
 * True only if *every* alternative a selector can expand to requires `.dark` (or the equivalent
 * `[data-theme="dark"]`) -- `:is(.dark, [data-theme="dark"]) .aov-shell` is dark-only this way, but
 * `:is(:root, .dark)` is not: its `:root` alternative can match outside `.dark`, so this rule alone
 * must not be trusted to also satisfy that alternative's own need for a `.dark` re-declaration.
 */
export function isDarkSelector(selector: string): boolean {
  const alternatives = expandFunctionalPseudoAlternatives(selector);
  return alternatives.length > 0 && alternatives.every(isDarkAlternative);
}
