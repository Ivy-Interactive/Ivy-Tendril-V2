import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { describe, expect, it } from "vite-plus/test";
import type { NamespaceResources } from "../src/i18n/bindings";
import { COMPONENT_NAMESPACES } from "../src/i18n/namespaces";
import { createTranslation } from "../src/i18n/react";
import type { KeyPath, QualifiedKey } from "../src/i18n/types";
import {
  i18n as shellI18n,
  useTranslation as useShellTranslation,
  type TFunction as ShellTFunction,
} from "../src/i18n/uiShell";

/**
 * Keys are checked at compile time, against the English catalogs' types. This file is mostly for
 * `tsc` (the package's `typecheck` and `check` scripts): every `@ts-expect-error` below is a key that
 * must *not* compile, and the directive itself fails the build if it ever does. Only the last test
 * runs anything.
 */

const english = {
  title: "Title",
  nested: { deep: { key: "Deep" } },
  items_one: "{{count}} item",
  items_other: "{{count}} items",
  friend: "Friend",
  friend_male: "Boyfriend",
};
type Resources = { demo: typeof english; other: { label: string } };

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>(): T | undefined => undefined;

assertType<
  Equal<
    KeyPath<typeof english>,
    "title" | "nested.deep.key" | "items_one" | "items_other" | "items" | "friend" | "friend_male"
  >
>();
assertType<Equal<QualifiedKey<{ a: { x: string }; b: { y: { z: string } } }>, "a:x" | "b:y.z">>();
assertType<Equal<KeyPath<{}>, never>>();

const { i18n, useTranslation, Trans } = createTranslation<Resources>();

export function keysCompile(): unknown[] {
  const t = i18n.getFixedT(null, "demo");
  return [
    t("title"),
    t("nested.deep.key"),
    // A plural or context variant is reached through its base key.
    t("items", { count: 2 }),
    t("friend", { context: "male" }),
    // Another namespace's key, qualified.
    t("other:label"),
    i18n.t("demo:title"),
    <Trans key="trans" ns="demo" i18nKey="nested.deep.key" />,
  ];
}

export function keysDoNotCompile(): unknown[] {
  const t = i18n.getFixedT(null, "demo");
  return [
    // @ts-expect-error - not a key
    t("missing.key"),
    // @ts-expect-error - an object in the catalog, not a string
    t("nested.deep"),
    // @ts-expect-error - another namespace's key is only reachable qualified
    t("label"),
    // @ts-expect-error - no such namespace
    i18n.getFixedT(null, "nope"),
    // @ts-expect-error - no such namespace
    i18n.t("nope:title"),
    // @ts-expect-error - the store's own `t` needs the namespace in the key
    i18n.t("title"),
    // @ts-expect-error - not a key of `demo`
    <Trans key="trans" ns="demo" i18nKey="label" />,
  ];
}

export function HooksCompile(): React.ReactElement {
  const { t } = useTranslation("demo");
  // @ts-expect-error - not a key
  const missing = t("nope");
  // @ts-expect-error - no such namespace
  useTranslation("nope");
  return <p>{[t("title"), missing].join()}</p>;
}

/** A binding to a subset of namespaces - what `bindNamespace` makes - reaches that subset only. */
type Fixture = { own: { title: string }; shared: { close: string }; other: { label: string } };
const picked = createTranslation<Pick<Fixture, "own" | "shared">>();

export function pickedKeys(): unknown[] {
  const t = picked.i18n.getFixedT(null, "own");
  return [
    t("title"),
    t("shared:close"),
    picked.i18n.t("shared:close"),
    // @ts-expect-error - a namespace left out of the binding is unreachable, even qualified
    t("other:label"),
    // @ts-expect-error - and cannot be bound
    picked.i18n.getFixedT(null, "other"),
  ];
}

/**
 * This package's own bindings. A namespace module reaches its own namespace and `uiCommon` - the two
 * catalogs importing it registers - and nothing else, each empty until a key is added.
 */
assertType<Equal<keyof NamespaceResources<"uiShell">, "uiShell" | "uiCommon">>();
assertType<Equal<keyof NamespaceResources<"uiCommon">, "uiCommon">>();
assertType<Equal<Parameters<typeof useShellTranslation>[0], "uiShell" | "uiCommon">>();

export function ComponentKeysDoNotCompile(): React.ReactElement {
  useShellTranslation("uiCommon");
  // @ts-expect-error - another namespace's module registers that namespace, not this one
  useShellTranslation("uiDialogs");
  // @ts-expect-error - an app namespace, not one of this package's
  useShellTranslation("common");
  const { t } = useShellTranslation("uiShell");
  return (
    <p>
      {
        // @ts-expect-error - no key exists until it is added to en/uiShell.json
        t("anything.at.all")
      }
      {
        // @ts-expect-error - not a namespace this module registers
        shellI18n.t("uiVault:title")
      }
    </p>
  );
}

/** A namespace module's `TFunction` is the `t` its `useTranslation` returns, for helpers to take. */
export function shellHelper(t: ShellTFunction): ShellTFunction {
  return t;
}
export function ShellHelperCompiles(): React.ReactElement {
  const { t } = useShellTranslation("uiShell");
  return <p>{typeof shellHelper(t)}</p>;
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("translation key types", () => {
  it("are checked by tsc, not at runtime", () => {
    expect(typeof keysCompile).toBe("function");
    expect(typeof keysDoNotCompile).toBe("function");
  });

  // The published declarations are written by tsgo, which emits no declaration for a JSON module, so
  // a declaration that refers to one fails `vp pack` - and any exported signature naming a `t` or a
  // key refers, through these types, to the catalogs. `src/i18n/resources.ts` infers them from a
  // value instead, whose declaration spells the catalogs out. This emits that declaration the way
  // the build does and holds it to that.
  it("are declared without referring to a JSON file", () => {
    const tsc = join(
      dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
      "bin/tsc",
    );
    const outDir = mkdtempSync(join(tmpdir(), "tendril-i18n-resources-"));
    try {
      // The declaration emit `vp pack` asks tsgo for, for this one file (so without the tsconfig).
      const options = [
        "--declaration --emitDeclarationOnly --noCheck --removeComments --skipLibCheck",
        "--module esnext --moduleResolution bundler --target esnext --types node",
        "--resolveJsonModule --allowImportingTsExtensions",
      ]
        .join(" ")
        .split(" ");
      execFileSync(process.execPath, [
        tsc,
        "--ignoreConfig",
        join(packageRoot, "src/i18n/resources.ts"),
        ...options,
        "--outDir",
        outDir,
        "--rootDir",
        join(packageRoot, "src"),
      ]);
      const declaration = readFileSync(join(outDir, "i18n/resources.d.ts"), "utf8");
      expect(declaration).not.toMatch(/\.json\b/);
      for (const namespace of COMPONENT_NAMESPACES) {
        expect(declaration).toMatch(new RegExp(`\\b${namespace}: \\{`));
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
