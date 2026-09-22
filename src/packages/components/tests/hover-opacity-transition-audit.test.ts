import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const ROOTS = ["src/packages/components/src", "src/apps/tendril-app/src"];

const WHY =
  "Controls that stay visible while their opacity animates on hover were seen to shift in the " +
  "Tauri webview (WebKit composites opacity transitions). Change the opacity without " +
  "transitioning it, or fade the background/colour instead.";

function filesUnder(dir: string, pattern: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__" || entry === "dist") continue;
      filesUnder(full, pattern, out);
      continue;
    }
    if (!pattern.test(entry)) continue;
    if (/\.(test|stories)\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

const rel = (file: string): string => relative(repoRoot, file).replaceAll("\\", "/");

interface FlatRule {
  file: string;
  selector: string;
  body: string;
}

function flatRules(file: string): FlatRule[] {
  const css = readFileSync(file, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@[\w-]+[^;{}]*;/g, "");
  const out: FlatRule[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of match[1].split(",")) {
      out.push({ file, selector: selector.replace(/\s+/g, " ").trim(), body: match[2] });
    }
  }
  return out;
}

const withoutNot = (selector: string): string => selector.replace(/:not\([^()]*\)/g, "");

const compounds = (selector: string): string[] =>
  withoutNot(selector)
    .split(/\s*[\s>+~]\s*/)
    .filter(Boolean);

const pseudoElementOf = (compound: string): string => /::[\w-]+/.exec(compound)?.[0] ?? "";

const keysOf = (compound: string): string[] =>
  [...compound.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(
    (match) => match[1] + pseudoElementOf(compound),
  );

const transitionsOpacity = (body: string): boolean =>
  /transition(?:-property)?\s*:[^;]*\b(?:opacity|all)\b/.test(body);

const setsVisibleOpacity = (body: string): boolean =>
  /(?:^|[;\s])opacity\s*:(?!\s*0\s*(?:;|$|!))/.test(body);

const setsZeroOpacity = (body: string): boolean =>
  /(?:^|[;\s])opacity\s*:\s*0\s*(?:;|$|!)/.test(body);

const isHoverSelector = (selector: string): boolean => withoutNot(selector).includes(":hover");

const isRestingSelector = (selector: string): boolean =>
  /^[a-z]*(?:\.[\w-]+)+(?:::[\w-]+)?$/.test(selector.trim());

const TW_HOVER_OPACITY =
  /(?:^|[\s"'`:])(?:hover|group-hover(?:\/[\w-]+)?|peer-hover(?:\/[\w-]+)?):!?opacity-(?:\[|\(|(?!0\b)\d)/;
const TW_OPACITY_TRANSITION =
  /(?:^|[\s"'`:])!?transition(?:-opacity|-all)?!?(?=[\s"'`}]|$)|(?:^|[\s"'`:])!?transition-\[[^\]]*opacity/;
const TW_HIDDEN_AT_REST = /(?:^|[\s"'`])!?opacity-0!?(?![\d.])/;

const cssFiles = ROOTS.flatMap((root) => filesUnder(resolve(repoRoot, root), /\.css$/));
const sourceFiles = ROOTS.flatMap((root) => filesUnder(resolve(repoRoot, root), /\.tsx?$/));
const rules = cssFiles.flatMap(flatRules);

const hiddenAtRest = new Set<string>();
const transitionedBy = new Map<string, FlatRule>();
for (const rule of rules) {
  const last = compounds(rule.selector).at(-1) ?? "";
  if (transitionsOpacity(rule.body)) {
    for (const key of keysOf(last)) transitionedBy.set(key, rule);
  }
  if (!isHoverSelector(rule.selector) && isRestingSelector(rule.selector)) {
    if (setsZeroOpacity(rule.body)) for (const key of keysOf(last)) hiddenAtRest.add(key);
  }
}

function iconButtonOpeningTags(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/<IconButton\b/g)) {
    let depth = 0;
    let quote = "";
    let end = match.index + match[0].length;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0) break;
    }
    tags.push(source.slice(match.index, end + 1));
  }
  return tags;
}

describe("hover opacity transition audit", () => {
  it("scans the stylesheets and sources that define the shared controls", () => {
    expect(cssFiles.map(rel)).toContain("src/packages/components/src/components/ui/ui.css");
    expect(cssFiles.map(rel)).toContain("src/packages/components/src/components/Shell/shell.css");
    expect(sourceFiles.map(rel)).toContain(
      "src/apps/tendril-app/src/components/chat/AgentPicker.tsx",
    );
  });

  it("no stylesheet transitions the opacity a visible control changes on hover", () => {
    const violations: string[] = [];
    for (const rule of rules) {
      if (!isHoverSelector(rule.selector) || !setsVisibleOpacity(rule.body)) continue;
      const last = compounds(rule.selector).at(-1) ?? "";
      for (const key of keysOf(last)) {
        const source = transitionedBy.get(key);
        if (!source || hiddenAtRest.has(key)) continue;
        violations.push(
          `${rel(rule.file)}: \`${rule.selector}\` changes opacity on hover while ` +
            `\`${source.selector}\` (${rel(source.file)}) transitions it. ${WHY}`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("the shared icon button does not transition opacity", () => {
    const base = rules.filter(
      (rule) => rule.selector === ".tui-icon-btn" && /transition/.test(rule.body),
    );
    expect(base.length).toBeGreaterThan(0);
    for (const rule of base) expect(transitionsOpacity(rule.body)).toBe(false);
  });

  it("no IconButton call site adds an opacity transition back", () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      for (const tag of iconButtonOpeningTags(readFileSync(file, "utf-8"))) {
        const className = /className=([\s\S]*?)(?:\s[\w-]+=|\/?>$)/.exec(tag)?.[1] ?? "";
        if (TW_HIDDEN_AT_REST.test(className)) continue;
        if (TW_OPACITY_TRANSITION.test(className)) {
          violations.push(`${rel(file)}: an IconButton carries an opacity transition. ${WHY}`);
        }
        const tokens = new Set(className.match(/-?[_a-zA-Z][\w-]*/g) ?? []);
        for (const name of tokens) {
          const source = transitionedBy.get(name);
          if (!source || hiddenAtRest.has(name)) continue;
          violations.push(
            `${rel(file)}: IconButton class \`${name}\` transitions opacity in ` +
              `\`${source.selector}\` (${rel(source.file)}). ${WHY}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("no className pairs a hover opacity with an opacity transition", () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      readFileSync(file, "utf-8")
        .split("\n")
        .forEach((line, index) => {
          const trimmed = line.trimStart();
          if (/^(?:\/\/|\*|\{?\/\*)/.test(trimmed)) return;
          if (TW_HIDDEN_AT_REST.test(line)) return;
          if (TW_HOVER_OPACITY.test(line) && TW_OPACITY_TRANSITION.test(line)) {
            violations.push(`${rel(file)}:${index + 1}. ${WHY}`);
          }
        });
    }

    expect(violations).toEqual([]);
  });
});
