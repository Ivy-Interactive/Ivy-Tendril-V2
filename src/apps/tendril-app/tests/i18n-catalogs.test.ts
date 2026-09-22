/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { LOCALE_CODES, catalogSetFromFiles, checkCatalogs } from "@ivy-interactive/components/i18n";
import { APP_NAMESPACES } from "../src/i18n";

/**
 * Parity over the app's catalogs, `src/locales/<language>/<namespace>.json`. A translation may be
 * incomplete - an untranslated key renders in English - but what it contains must be well-formed:
 * no key English lacks, no shape mismatch, no empty string, the same `{{variables}}` and `<tags>` as
 * English, and every plural form the language needs. The rules themselves are tested in the
 * component package, which owns the checker; `i18n-completeness.test.ts` is the opt-in check that
 * nothing is left untranslated.
 */

const catalogs = catalogSetFromFiles(
  import.meta.glob("../src/locales/*/*.json", { eager: true, import: "default" }),
);
const localeModules = import.meta.glob<string>("../src/locales/*/index.ts", {
  eager: true,
  query: "?raw",
  import: "default",
});

describe("the app's catalogs", () => {
  it("pass the parity check", () => {
    expect(checkCatalogs(catalogs, APP_NAMESPACES)).toEqual([]);
  });

  it("have a directory for every locale, each with a file for every namespace", () => {
    expect(Object.keys(catalogs).sort()).toEqual([...LOCALE_CODES].sort());
    for (const language of LOCALE_CODES) {
      expect(Object.keys(catalogs[language]).sort(), language).toEqual([...APP_NAMESPACES].sort());
    }
  });

  it("have the same catalog module in every locale directory, which is what loads a language", () => {
    const english = localeModules["../src/locales/en/index.ts"];
    expect(english).toContain('import.meta.glob<Messages>("./*.json"');
    for (const language of LOCALE_CODES) {
      expect(localeModules[`../src/locales/${language}/index.ts`], language).toBe(english);
    }
  });

  it("register exactly the namespaces the plan lays out", () => {
    expect([...APP_NAMESPACES].sort()).toEqual(
      [
        "chat",
        "common",
        "dashboard",
        "inbox",
        "jobs",
        "onboarding",
        "plans",
        "review",
        "settings",
        "settingsAgents",
        "settingsProjects",
      ].sort(),
    );
  });
});
