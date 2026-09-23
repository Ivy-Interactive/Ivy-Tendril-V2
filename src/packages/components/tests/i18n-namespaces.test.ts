import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { COMPONENT_NAMESPACES } from "../src/i18n/namespaces";
import { i18nStore } from "../src/i18n/runtime";

/**
 * Each namespace's English is registered by the module named after it (`src/i18n/uiDialogs.ts`, …),
 * which is also where its components import everything they translate and format with. That keeps a
 * lazily loaded component's English in its own chunk, and it means a component can never render
 * before its strings exist - importing the hook is what registers them.
 */

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** What every namespace module exports at runtime: the binding, the hooks and the formatters. */
const NAMESPACE_MODULE_EXPORTS = [
  "Trans",
  "formatCompact",
  "formatCurrency",
  "formatDate",
  "formatDateTime",
  "formatList",
  "formatNumber",
  "formatPercent",
  "formatRelativeTime",
  "formatTime",
  "i18n",
  "useFormatters",
  "useLocale",
  "useTranslation",
];

describe("namespace modules", () => {
  it("leave English unregistered until a component imports its namespace", () => {
    for (const namespace of COMPONENT_NAMESPACES) {
      expect(i18nStore.hasResourceBundle("en", namespace), namespace).toBe(false);
    }
  });

  it.each(COMPONENT_NAMESPACES)(
    "%s registers its English, and the shared uiCommon, as it loads",
    async (namespace) => {
      const module = (await import(`../src/i18n/${namespace}.ts`)) as Record<string, unknown>;
      expect(Object.keys(module).sort()).toEqual(NAMESPACE_MODULE_EXPORTS);
      expect(i18nStore.hasResourceBundle("en", namespace)).toBe(true);
      expect(i18nStore.hasResourceBundle("en", "uiCommon")).toBe(true);
    },
  );
});

describe("the package's own source", () => {
  // Inside this package `@ivy-interactive/components/i18n` resolves to the *built* entry in `dist/`,
  // which has a store of its own: formatters imported from it would ignore `changeLanguage`, and a
  // test's throwing missing-key handler would never reach it. Nothing type-checks this, so it is
  // checked here.
  it("never imports the package by its published name", () => {
    const selfImports = (readdirSync(srcDir, { recursive: true }) as string[])
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) =>
        /(?:from|import)\s*\(?\s*["']@ivy-interactive\/components(?:\/|["'])/.test(
          readFileSync(join(srcDir, file), "utf8"),
        ),
      );
    expect(selfImports).toEqual([]);
  });
});
