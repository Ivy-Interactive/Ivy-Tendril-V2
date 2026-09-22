import { describe, expect, it } from "vite-plus/test";
import {
  catalogSetFromFiles,
  checkCatalogs,
  findUntranslatedKeys,
  requiredPluralCategories,
} from "../src/i18n/catalogCheck";
import { LOCALE_CODES } from "../src/i18n/locales";
import { COMPONENT_NAMESPACES } from "../src/i18n/namespaces";

/**
 * Parity over this package's catalogs, and the rules the check enforces. A translation may be
 * incomplete - an untranslated key renders in English - but what it contains must be well-formed.
 * `i18n-completeness.test.ts` is the separate, opt-in check that nothing is left untranslated.
 */

const catalogs = catalogSetFromFiles(
  import.meta.glob("../src/i18n/locales/*/*.json", { eager: true, import: "default" }),
);
const localeModules = import.meta.glob<Record<string, unknown>>("../src/i18n/locales/*/index.ts", {
  eager: true,
});

describe("this package's catalogs", () => {
  it("pass the parity check", () => {
    expect(checkCatalogs(catalogs, COMPONENT_NAMESPACES)).toEqual([]);
  });

  it("have a directory for every locale and nothing else", () => {
    expect(Object.keys(catalogs).sort()).toEqual([...LOCALE_CODES].sort());
  });

  it("have a module per locale exporting every namespace, which is what the loader map loads", () => {
    const languages = Object.keys(localeModules).map((path) => path.split("/").at(-2)!);
    expect(languages.sort()).toEqual([...LOCALE_CODES].sort());
    for (const [path, module] of Object.entries(localeModules)) {
      const language = path.split("/").at(-2)!;
      expect(Object.keys(module).sort(), path).toEqual([...COMPONENT_NAMESPACES].sort());
      for (const namespace of COMPONENT_NAMESPACES) {
        expect(module[namespace], `${path} → ${namespace}`).toEqual(catalogs[language][namespace]);
      }
    }
  });
});

describe("requiredPluralCategories", () => {
  it.each([
    ["en", ["one", "other"]],
    ["de", ["one", "other"]],
    ["sv", ["one", "other"]],
    ["hi", ["one", "other"]],
    ["es", ["one", "many", "other"]],
    ["fr", ["one", "many", "other"]],
    ["pt", ["one", "many", "other"]],
    ["ru", ["one", "few", "many", "other"]],
    ["ja", ["other"]],
    ["zh", ["other"]],
  ] as const)("requires %s to supply %j", (language, categories) => {
    expect(requiredPluralCategories(language)).toEqual(categories);
  });
});

/** A full set of empty catalogs with one namespace, `demo`, for the rule tests below to fill in. */
function withDemo(en: Record<string, unknown>, translations: Record<string, unknown> = {}) {
  const set: Record<string, Record<string, unknown>> = {};
  for (const language of LOCALE_CODES) set[language] = { demo: {} };
  set.en.demo = en;
  for (const [language, catalog] of Object.entries(translations)) set[language].demo = catalog;
  return set;
}

describe("checkCatalogs", () => {
  const english = {
    title: "Settings",
    greeting: "Hello, {{name}}!",
    link: "Read the <link>docs</link>.",
    items_one: "{{count}} item",
    items_other: "{{count}} items",
    owner_one: "One owner: {{name}}",
    owner_other: "{{count}} owners: {{name}}",
    nested: { label: "Label" },
  };

  it("accepts a partial translation that is right as far as it goes", () => {
    expect(checkCatalogs(withDemo(english, { de: { title: "Einstellungen" } }))).toEqual([]);
  });

  it("accepts every plural form a language needs, with or without {{count}}", () => {
    const ru = {
      items_one: "{{count}} элемент",
      items_few: "{{count}} элемента",
      items_many: "{{count}} элементов",
      items_other: "{{count}} элемента",
      // Russian's "one" also covers 21, 31, …, so it may show the count where English's does not.
      owner_one: "{{count}} владелец: {{name}}",
      owner_few: "{{count}} владельца: {{name}}",
      owner_many: "{{count}} владельцев: {{name}}",
      owner_other: "владельцы: {{name}}",
    };
    expect(checkCatalogs(withDemo(english, { ru, ja: { items_other: "{{count}} 個" } }))).toEqual(
      [],
    );
  });

  it("rejects a key English does not have", () => {
    expect(checkCatalogs(withDemo(english, { de: { titel: "Einstellungen" } }))).toEqual([
      'de/demo.json: "titel" is not a key in the English catalog',
    ]);
  });

  it("rejects a shape mismatch either way", () => {
    expect(
      checkCatalogs(withDemo(english, { de: { nested: "Etikett", title: { x: "y" } } })),
    ).toEqual([
      'de/demo.json: "nested" is a string, but English has an object there',
      'de/demo.json: "title.x" is not a key in the English catalog',
      'de/demo.json: "title" is an object, but English has a string there',
    ]);
  });

  it("rejects empty strings and values that are not strings, in any language", () => {
    expect(
      checkCatalogs(
        withDemo(
          { ...english, blank: " ", list: ["a"], flag: true },
          { de: { title: "", greeting: null } },
        ),
      ),
    ).toEqual([
      'en/demo.json: "blank" is empty',
      'en/demo.json: "list" is an array; catalogs hold strings and objects only',
      'en/demo.json: "flag" is a boolean, not a string',
      'de/demo.json: "title" is empty',
      'de/demo.json: "greeting" is null, not a string',
    ]);
  });

  it("rejects HTML entities, which nothing decodes, in any language", () => {
    expect(
      checkCatalogs(
        withDemo(
          { ...english, quote: "Don&apos;t" },
          { de: { title: "Ein&shy;stellungen", greeting: "Hallo&#x2026; {{name}}!" } },
        ),
      ),
    ).toEqual([
      'en/demo.json: "quote" contains the HTML entity &apos;; a catalog is plain text, so write the character itself',
      'de/demo.json: "title" contains the HTML entity &shy;; a catalog is plain text, so write the character itself',
      'de/demo.json: "greeting" contains the HTML entity &#x2026;; a catalog is plain text, so write the character itself',
    ]);
    // An ampersand that is not an entity is just text.
    expect(checkCatalogs(withDemo({ label: "Q&A, R & D; fish & chips" }))).toEqual([]);
  });

  it("requires the same {{variables}} as English", () => {
    expect(
      checkCatalogs(withDemo(english, { de: { greeting: "Hallo, {{nom}}!", title: "{{x}}" } })),
    ).toEqual([
      'de/demo.json: "greeting" interpolates {{nom}}, but English has {{name}}',
      'de/demo.json: "title" interpolates {{x}}, but English has none',
    ]);
  });

  it("ignores the format when comparing variables", () => {
    const en = { total: "Total: {{n, number}}" };
    expect(checkCatalogs(withDemo(en, { de: { total: "Summe: {{n}}" } }))).toEqual([]);
  });

  it("requires the same <tags> as English", () => {
    expect(checkCatalogs(withDemo(english, { de: { link: "Lies die <a>Doku</a>." } }))).toEqual([
      'de/demo.json: "link" has the tags <a>, but English has <link>',
    ]);
  });

  it("holds each plural form to the English form of its own category", () => {
    const en = {
      delete_one: "Delete {{name}}?",
      delete_other: "Delete {{count}} items?",
      files_zero: "No files",
      files_one: "{{count}} file in {{folder}}",
      files_other: "{{count}} files in {{folder}}",
    };
    const de = {
      delete_one: "{{name}} löschen?",
      delete_other: "{{count}} Elemente löschen?",
      files_zero: "Keine Dateien",
      files_one: "{{count}} Datei in {{folder}}",
      files_other: "{{count}} Dateien in {{folder}}",
    };
    // Japanese has only `_other`, which is held to English's `_other`.
    const ja = { delete_other: "{{count}} 件を削除しますか?" };
    expect(checkCatalogs(withDemo(en, { de, ja }))).toEqual([]);
    expect(
      checkCatalogs(withDemo(en, { de: { ...de, delete_other: "{{name}} löschen?" } })),
    ).toEqual(['de/demo.json: "delete_other" interpolates {{name}}, but English has none']);
  });

  it("holds a form English lacks to English's _other, and an extra _zero only to a subset", () => {
    const en = {
      files_one: "{{count}} file in <b>{{folder}}</b>",
      files_other: "{{count}} files in <b>{{folder}}</b>",
    };
    const ru = {
      files_one: "{{count}} файл в <b>{{folder}}</b>",
      files_few: "{{count}} файла",
      files_many: "{{count}} файлов в <b>{{folder}}</b>",
      files_other: "{{count}} файла в <b>{{folder}}</b>",
    };
    const de = {
      // A zero form may say less than English's `_other` does, but nothing it does not say.
      files_zero: "Keine Dateien",
      files_one: "{{count}} Datei in <b>{{folder}}</b>",
      files_other: "{{count}} Dateien in <b>{{folder}}</b>",
    };
    const sv = { ...de, files_zero: "Inga filer i {{mapp}}" };
    expect(checkCatalogs(withDemo(en, { ru, de, sv }))).toEqual([
      'ru/demo.json: "files_few" interpolates none, but English "files_other" has {{folder}}',
      'ru/demo.json: "files_few" has the tags none, but English "files_other" has <b>',
      'sv/demo.json: "files_zero" interpolates {{mapp}}, but English "files_other" only has {{folder}}',
    ]);
  });

  it("requires every form of a plural key the language translates, and no form it never uses", () => {
    expect(
      checkCatalogs(
        withDemo(english, {
          ru: { items_one: "{{count}} элемент", items_other: "{{count}} элемента" },
          de: { items_one: "{{count}} Element", items_few: "{{count}} Elemente" },
        }),
      ),
    ).toEqual([
      'de/demo.json: "items_few" is a "few" form, which de never uses (its forms are one, other)',
      'de/demo.json: "items" is missing the plural _other form (de needs one, other)',
      'ru/demo.json: "items" is missing the plural _few, _many forms (ru needs one, few, many, other)',
    ]);
  });

  it("allows an optional _zero form", () => {
    expect(checkCatalogs(withDemo(english, { de: { items_zero: "Keine Elemente" } }))).toEqual([
      'de/demo.json: "items" is missing the plural _one, _other forms (de needs one, other)',
    ]);
  });

  it("requires English's own plural keys to have one and other", () => {
    expect(checkCatalogs(withDemo({ files_other: "{{count}} files", runs_few: "x" }))).toEqual([
      'en/demo.json: "files" is missing the plural _one form (English needs one, other)',
      'en/demo.json: "runs" is missing the plural _one, _other forms (English needs one, other)',
      'en/demo.json: "runs_few" is a form English never uses',
    ]);
  });

  it("requires every namespace file in every locale, and no extra ones", () => {
    const set = withDemo(english);
    delete set.de.demo;
    set.sv.extra = {};
    expect(checkCatalogs(set)).toEqual([
      "de/demo.json is missing (create it as {} if it is untranslated)",
      "sv/extra.json has no English counterpart",
    ]);
  });

  it("holds English to the package's namespace registry, both ways", () => {
    expect(checkCatalogs(withDemo(english), ["demo", "other"])).toEqual([
      'en/other.json is missing, but "other" is a registered namespace',
    ]);
    expect(checkCatalogs(withDemo(english), [])).toEqual([
      'en/demo.json exists, but "demo" is not a registered namespace',
    ]);
  });

  it("rejects a directory that is not a Tendril locale", () => {
    const set = { ...withDemo(english), it: { demo: {} } };
    expect(checkCatalogs(set)).toEqual([
      "it/ is not a Tendril locale (en, de, ja, es, fr, pt, zh, ru, sv, hi)",
    ]);
  });
});

describe("findUntranslatedKeys", () => {
  it("lists every English key a locale lacks, with the plural forms that locale needs", () => {
    const en = { title: "Settings", items_one: "{{count}} item", items_other: "{{count}} items" };
    const untranslated = findUntranslatedKeys(
      withDemo(en, { de: { title: "Einstellungen", items_one: "x", items_other: "y" } }),
    );
    expect(untranslated.de).toBeUndefined();
    expect(untranslated.ja).toEqual(["demo:title", "demo:items_other"]);
    expect(untranslated.ru).toEqual([
      "demo:title",
      "demo:items_one",
      "demo:items_few",
      "demo:items_many",
      "demo:items_other",
    ]);
  });

  it("is empty when every locale is complete", () => {
    const en = { title: "Settings" };
    const translations = Object.fromEntries(
      LOCALE_CODES.filter((language) => language !== "en").map((language) => [
        language,
        { title: `Settings (${language})` },
      ]),
    );
    expect(findUntranslatedKeys(withDemo(en, translations))).toEqual({});
  });
});
