import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { NAMED_COLORS } from "../src/stories/colors.stories.tsx";
import { readCssInlined, readCssRaw } from "./read-css.ts";

/**
 * `globals.css` and `index.css` are both public entry points (`package.json` exports `./styles/*`)
 * and both used to declare the same custom properties with different values. They now share
 * `tokens.css`, and these tests are the guard that keeps them from drifting apart again.
 *
 * The stylesheets are parsed by scanning braces rather than with a `/\{([^}]+)\}/` regex: `index.css`
 * nests its blocks two levels deep inside `@layer base`, which a non-recursive regex cannot read at
 * all — it would silently find nothing and make every assertion below vacuously true.
 */

const STYLES_DIR = resolve(__dirname, "..", "src/styles");
const GLOBALS_CSS = resolve(STYLES_DIR, "globals.css");
const INDEX_CSS = resolve(STYLES_DIR, "index.css");
const TOKENS_CSS = resolve(STYLES_DIR, "tokens.css");

/** Declarations of a single block, keyed by custom-property name (without the leading `--`). */
type Declarations = Map<string, string>;
/** Every block of a stylesheet, keyed by normalised block path (e.g. `:root`, `@theme inline`). */
type Blocks = Map<string, Declarations>;

/** `@layer` wrappers do not change which element a custom property lands on, so a block nested in
 * one is the same block for parity purposes. Dropping the wrapper is what makes `index.css`'s
 * `@layer base > :root` comparable with `globals.css`'s top-level `:root`. */
function normaliseBlockPath(stack: readonly string[]): string {
  return stack
    .filter((selector) => !selector.startsWith("@layer"))
    .join(" > ")
    .replace(/\s+/g, " ");
}

function normaliseValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Brace-scanning parser. Records only custom properties; ordinary declarations, at-rule preludes
 * and keyframe stops are read and discarded. */
export function parseCssBlocks(css: string): Blocks {
  const blocks: Blocks = new Map();
  const stack: string[] = [];
  let buffer = "";

  const record = (declaration: string): void => {
    const match = /^--([\w-]+)\s*:\s*([\s\S]+)$/.exec(declaration.trim());
    if (match === null) {
      return;
    }
    const path = normaliseBlockPath(stack);
    if (path === "") {
      return;
    }
    let declarations = blocks.get(path);
    if (declarations === undefined) {
      declarations = new Map();
      blocks.set(path, declarations);
    }
    declarations.set(match[1], normaliseValue(match[2]));
  };

  for (const character of stripComments(css)) {
    if (character === "{") {
      stack.push(normaliseValue(buffer));
      buffer = "";
    } else if (character === "}") {
      record(buffer);
      buffer = "";
      stack.pop();
    } else if (character === ";") {
      record(buffer);
      buffer = "";
    } else {
      buffer += character;
    }
  }

  return blocks;
}

const globals = parseCssBlocks(readCssInlined(GLOBALS_CSS));
const index = parseCssBlocks(readCssInlined(INDEX_CSS));

const TOKEN_BLOCKS = [":root", ".dark", "@theme inline"] as const;

function declarationsOf(blocks: Blocks, path: string): Declarations {
  return blocks.get(path) ?? new Map();
}

function sharedPropertyNames(path: string): string[] {
  const ours = declarationsOf(globals, path);
  const theirs = declarationsOf(index, path);
  return [...ours.keys()].filter((name) => theirs.has(name)).sort();
}

/** Light-mode value, or the dark override when one exists — how a browser resolves the token. */
function resolved(blocks: Blocks, name: string, mode: "light" | "dark"): string | undefined {
  const root = declarationsOf(blocks, ":root").get(name);
  if (mode === "light") {
    return root;
  }
  return declarationsOf(blocks, ".dark").get(name) ?? root;
}

describe("shared theme tokens", () => {
  it("parses both stylesheets into the same token blocks", () => {
    // Guards every assertion below: a parser that found nothing must not pass by default.
    for (const path of TOKEN_BLOCKS) {
      expect(declarationsOf(globals, path).size, `globals.css ${path}`).toBeGreaterThan(20);
      expect(declarationsOf(index, path).size, `index.css ${path}`).toBeGreaterThan(20);
    }
  });

  it.each(TOKEN_BLOCKS)("declares a non-empty %s intersection in both files", (path) => {
    expect(sharedPropertyNames(path).length).toBeGreaterThan(20);
  });

  it("gives every property declared in both files an identical value", () => {
    const differences: string[] = [];

    for (const path of new Set([...globals.keys(), ...index.keys()])) {
      const ours = declarationsOf(globals, path);
      const theirs = declarationsOf(index, path);
      for (const [name, value] of ours) {
        const other = theirs.get(name);
        if (other !== undefined && other !== value) {
          differences.push(`${path}  --${name}: globals=${value} index=${other}`);
        }
      }
    }

    expect(differences.sort()).toEqual([]);
  });
});

describe("named palette parity", () => {
  const names = NAMED_COLORS.map((color) => color.name);

  it.each(names)("resolves --%s and its -foreground pair identically in both files", (name) => {
    for (const mode of ["light", "dark"] as const) {
      for (const token of [name, `${name}-foreground`]) {
        const ours = resolved(globals, token, mode);
        const theirs = resolved(index, token, mode);

        expect(ours, `globals.css ${mode} --${token}`).toBeDefined();
        expect(theirs, `index.css ${mode} --${token}`).toBeDefined();
        expect(theirs, `${mode} --${token}`).toBe(ours);
      }
    }
  });
});

describe("Tailwind colour bridge", () => {
  const bridge = (blocks: Blocks): string[] =>
    [...declarationsOf(blocks, "@theme inline").keys()]
      .filter((name) => name.startsWith("color-"))
      .sort();

  it("aliases the same set of --color-* names from both files", () => {
    expect(bridge(index)).toEqual(bridge(globals));
  });
});

describe("tokens.css is the single source of truth", () => {
  const tokens = parseCssBlocks(readCssRaw(TOKENS_CSS));

  it("declares the token blocks itself", () => {
    for (const path of TOKEN_BLOCKS) {
      expect(declarationsOf(tokens, path).size, path).toBeGreaterThan(20);
    }
  });

  it.each([
    ["globals.css", GLOBALS_CSS],
    ["index.css", INDEX_CSS],
  ])("has %s import it instead of declaring the tokens locally", (_name, path) => {
    const own = parseCssBlocks(readCssRaw(path));

    expect(readCssRaw(path)).toContain('@import "./tokens.css";');

    // No entry point may shadow a shared token — that is exactly how the two files drifted before.
    const shadowed: string[] = [];
    for (const [blockPath, declarations] of own) {
      for (const name of declarations.keys()) {
        if (declarationsOf(tokens, blockPath).has(name)) {
          shadowed.push(`${blockPath}  --${name}`);
        }
      }
    }
    expect(shadowed.sort()).toEqual([]);
    for (const blockPath of TOKEN_BLOCKS) {
      expect(declarationsOf(own, blockPath).size, blockPath).toBe(0);
    }
  });
});

describe("font families", () => {
  // Folded in from fonts.test.ts, which asserted this one pair across the two files by hand.
  it.each(["font-sans", "font-serif", "font-mono"])(
    "declares the same --%s in both files",
    (name) => {
      const ours = resolved(globals, name, "light");
      expect(ours).toBeDefined();
      expect(resolved(index, name, "light")).toBe(ours);
    },
  );
});
