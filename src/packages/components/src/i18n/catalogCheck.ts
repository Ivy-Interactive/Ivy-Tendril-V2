import { pluralRules } from "./intl";
import { DEFAULT_LOCALE, LOCALE_CODES, isSiteLocale, type SiteLocale } from "./locales";

/**
 * Structural checks over a set of catalogs, for both packages' tests. A translation is data nothing
 * type-checks - the key types come from English alone - so these are what stop a broken one from
 * shipping. Adapted from Ivy-Web's `scripts/check-translations.mjs`, with i18next's plural and
 * placeholder rules added. Everything here is pure; the tests read the files and pass them in.
 *
 * {@link checkCatalogs} is the always-on parity check. A catalog may be *incomplete* - an untranslated
 * key renders in English - but everything it does contain must be right:
 *
 * - every locale has a file for every namespace, and no file English does not have;
 * - no key that English does not have (a plural form counts as its base key: Russian's `items_few`
 *   is valid when English has `items_one`/`items_other`);
 * - no shape mismatch (an object where English has a string, or the reverse), and every value is a
 *   non-empty string of plain text, with no HTML entities - in English too;
 * - each translated string has exactly the `{{variables}}` and the `<tags>` its English string has
 *   (for a plural form, its English counterpart: see {@link englishCounterpart});
 * - a plural key that is translated at all has every form the language needs
 *   ({@link requiredPluralCategories}), and no form it never uses.
 *
 * {@link findUntranslatedKeys} is the completeness check: every English key, in every locale. It
 * fails until a locale is fully translated, so its test only asserts when `I18N_REQUIRE_COMPLETE=1`.
 */

/** One package's catalogs: language code → namespace → the parsed JSON file. */
export type CatalogSet = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/**
 * Groups catalog files by language and namespace, from their paths: `…/locales/de/chat.json` is the
 * `chat` namespace of `de`. Made for the record an eager `import.meta.glob` over
 * `locales/<language>/<namespace>.json` returns (with `import: "default"`).
 */
export function catalogSetFromFiles(files: Readonly<Record<string, unknown>>): CatalogSet {
  const catalogs: Record<string, Record<string, unknown>> = {};
  for (const [path, content] of Object.entries(files)) {
    const match = /([^/\\]+)[/\\]([^/\\]+)\.json$/.exec(path);
    if (!match) continue;
    const [, language, namespace] = match;
    catalogs[language] ??= {};
    catalogs[language][namespace] = content;
  }
  return catalogs;
}

const PLURAL_SUFFIX = /^(.*)_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{\s*(?:-\s*)?([^{},]+?)\s*(?:,[^{}]*)?\}\}/g;
/** `<Trans>`'s tag syntax (see `markup.ts`), plus react-i18next's numbered tags, which must match too. */
const TAG = /<\/?([A-Za-z0-9][\w-]*)\s*\/?>/g;
/**
 * `&apos;`, `&#39;`, `&#x2019;`: the escapes JSX text is written with. Nothing decodes them at
 * runtime - `t` returns the string as it is and React escapes what it renders - so one moved into a
 * catalog verbatim would show on screen as `&apos;`.
 */
const HTML_ENTITY = /&(?:[A-Za-z][A-Za-z\d]*|#\d+|#x[\dA-Fa-f]+);/;
const CATEGORY_ORDER: readonly Intl.LDMLPluralRule[] = [
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
];

/**
 * Every integer 0-1000, plus the large round numbers some rules single out (French, Spanish and
 * Portuguese use `many` for exact millions). Enough to reach every category any CLDR rule assigns to
 * a whole number. Built on use, not at module load, so an app that imports this entry for its runtime
 * does not pay for a test helper.
 */
const integerSamples = () => [
  ...Array.from({ length: 1001 }, (_, index) => index),
  10_000,
  100_000,
  1_000_000,
  2_000_000,
  10_000_000,
  1_000_000_000,
];

const requiredCache = new Map<SiteLocale, readonly Intl.LDMLPluralRule[]>();

/**
 * The plural forms a language's catalog must supply for every plural key: `other`, which is every
 * lookup's last resort, plus each category the language's rules give a *whole* number. So English,
 * German, Swedish and Hindi need `one`/`other`; Russian `one`/`few`/`many`/`other`; Spanish, French and
 * Portuguese `one`/`many`/`other` (`many` is their form for exact millions, "1 000 000 de …"); and
 * Japanese and Chinese `other` alone. Categories only fractions reach are not required, since counts
 * are whole numbers. `_zero` is never required.
 */
export function requiredPluralCategories(language: SiteLocale): readonly Intl.LDMLPluralRule[] {
  let required = requiredCache.get(language);
  if (!required) {
    const rules = pluralRules(language);
    const categories = new Set<Intl.LDMLPluralRule>(["other"]);
    for (const sample of integerSamples()) categories.add(rules.select(sample));
    required = CATEGORY_ORDER.filter((category) => categories.has(category));
    requiredCache.set(language, required);
  }
  return required;
}

interface Leaf {
  path: string;
  value: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every leaf under `node` (anything that is not a plain object), with its dotted path. */
function leaves(node: Record<string, unknown>, prefix = ""): Leaf[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return isRecord(value) ? leaves(value, path) : [{ path, value }];
  });
}

function nodeAt(root: Record<string, unknown>, path: string): unknown {
  let node: unknown = root;
  for (const segment of path.split(".")) {
    if (!isRecord(node) || !Object.hasOwn(node, segment)) return undefined;
    node = node[segment];
  }
  return node;
}

const namesIn = (text: string, pattern: RegExp): Set<string> =>
  new Set([...text.matchAll(pattern)].map((match) => match[1].trim()));

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((item) => b.has(item));

const describeSet = (set: ReadonlySet<string>, wrap: (name: string) => string) =>
  set.size === 0 ? "none" : [...set].sort().map(wrap).join(" ");

const describeForms = (categories: readonly string[]) =>
  `${categories.map((category) => `_${category}`).join(", ")} form${categories.length === 1 ? "" : "s"}`;

/** One namespace's English catalog, indexed for the comparisons below. */
interface EnglishIndex {
  /** Every English string, by path. */
  strings: Map<string, string>;
  /** Plural keys: base path → the English strings of its forms, by category. */
  plurals: Map<string, Map<string, string>>;
}

function indexEnglish(catalog: Record<string, unknown>): EnglishIndex {
  const strings = new Map<string, string>();
  const plurals = new Map<string, Map<string, string>>();
  for (const { path, value } of leaves(catalog)) {
    if (typeof value !== "string") continue;
    strings.set(path, value);
    const plural = PLURAL_SUFFIX.exec(path);
    if (plural) {
      const forms = plurals.get(plural[1]) ?? new Map<string, string>();
      forms.set(plural[2], value);
      plurals.set(plural[1], forms);
    }
  }
  return { strings, plurals };
}

/** Problems with a value itself, whichever locale it is in. */
function valueProblems(value: unknown): string | null {
  if (typeof value !== "string") {
    return Array.isArray(value)
      ? "is an array; catalogs hold strings and objects only"
      : `is ${value === null ? "null" : `a ${typeof value}`}, not a string`;
  }
  if (value.trim() === "") return "is empty";
  const entity = HTML_ENTITY.exec(value);
  return entity
    ? `contains the HTML entity ${entity[0]}; a catalog is plain text, so write the character itself`
    : null;
}

interface PluralForm {
  base: string;
  category: string;
}

/**
 * The English string a translated one is held to, and whether its `{{variables}}` and `<tags>` must
 * be the same set or may be a `subset` of it.
 *
 * A plain key is held to its English string. A plural form is held to the English form of its own
 * category - German's `_one` to English's `_one` - because the forms of one key can differ ("Delete
 * {{name}}?" beside "Delete {{count}} items?"). A category English lacks is held to English's
 * `_other`: Russian's `_few` and `_many`, like `_other`, count more than one. `{{count}}` is optional
 * in every form ("One file"), and a `_zero` English does not have may say less than `_other`
 * ("No files" beside "{{count}} files in {{folder}}"), so it need only use nothing English does not.
 */
function englishCounterpart(
  english: EnglishIndex,
  path: string,
  plural: PluralForm | undefined,
): { path: string; text: string; subset: boolean } {
  if (!plural) return { path, text: english.strings.get(path) ?? "", subset: false };
  const forms = english.plurals.get(plural.base) ?? new Map<string, string>();
  const category = forms.has(plural.category) ? plural.category : "other";
  return {
    path: `${plural.base}_${category}`,
    text: forms.get(category) ?? "",
    subset: category !== plural.category && plural.category === "zero",
  };
}

/** A string's `{{variables}}`, less `{{count}}` in a plural form, where it is always optional. */
function variablesIn(text: string, plural: boolean): Set<string> {
  const names = namesIn(text, PLACEHOLDER);
  if (plural) names.delete("count");
  return names;
}

const isSubset = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  [...a].every((item) => b.has(item));

function checkTranslation(
  language: SiteLocale,
  namespace: string,
  english: EnglishIndex,
  englishCatalog: Record<string, unknown>,
  catalog: Record<string, unknown>,
  errors: string[],
): void {
  const at = (path: string) => `${language}/${namespace}.json: "${path}"`;
  const pluralForms = new Map<string, Set<string>>();
  const allowed = new Set<string>([...requiredPluralCategories(language), "zero"]);

  for (const { path, value } of leaves(catalog)) {
    const problem = valueProblems(value);
    if (problem) {
      errors.push(`${at(path)} ${problem}`);
      continue;
    }

    const suffix = PLURAL_SUFFIX.exec(path);
    const plural =
      suffix && english.plurals.has(suffix[1])
        ? { base: suffix[1], category: suffix[2] }
        : undefined;
    if (plural) {
      if (!allowed.has(plural.category)) {
        errors.push(
          `${at(path)} is a "${plural.category}" form, which ${language} never uses ` +
            `(its forms are ${requiredPluralCategories(language).join(", ")})`,
        );
        continue;
      }
      const forms = pluralForms.get(plural.base) ?? new Set<string>();
      forms.add(plural.category);
      pluralForms.set(plural.base, forms);
    } else if (!english.strings.has(path)) {
      errors.push(
        isRecord(nodeAt(englishCatalog, path))
          ? `${at(path)} is a string, but English has an object there`
          : `${at(path)} is not a key in the English catalog`,
      );
      continue;
    }

    const counterpart = englishCounterpart(english, path, plural);
    const matches = counterpart.subset ? isSubset : sameSet;
    // Names the English string when it is another key's: `English "items_other" has`.
    const yardstick =
      (counterpart.path === path ? "English" : `English "${counterpart.path}"`) +
      (counterpart.subset ? " only has" : " has");

    const variables = variablesIn(value as string, plural !== undefined);
    const englishVariables = variablesIn(counterpart.text, plural !== undefined);
    if (!matches(variables, englishVariables)) {
      errors.push(
        `${at(path)} interpolates ${describeSet(variables, (name) => `{{${name}}}`)}, ` +
          `but ${yardstick} ${describeSet(englishVariables, (name) => `{{${name}}}`)}`,
      );
    }
    const tags = namesIn(value as string, TAG);
    const englishTags = namesIn(counterpart.text, TAG);
    if (!matches(tags, englishTags)) {
      errors.push(
        `${at(path)} has the tags ${describeSet(tags, (name) => `<${name}>`)}, ` +
          `but ${yardstick} ${describeSet(englishTags, (name) => `<${name}>`)}`,
      );
    }
  }

  // An object where English has a string never reaches the loop above as a leaf of its own.
  for (const path of english.strings.keys()) {
    if (isRecord(nodeAt(catalog, path))) {
      errors.push(`${at(path)} is an object, but English has a string there`);
    }
  }

  for (const [base, forms] of pluralForms) {
    const missing = requiredPluralCategories(language).filter((category) => !forms.has(category));
    if (missing.length > 0) {
      errors.push(
        `${at(base)} is missing the plural ${describeForms(missing)} ` +
          `(${language} needs ${requiredPluralCategories(language).join(", ")})`,
      );
    }
  }
}

/**
 * The always-on parity check. Returns one message per problem, so a test can assert the list is
 * empty and a failure reads as the list of what to fix.
 *
 * `namespaces` is the package's registry of namespaces, when it has one: English must have exactly
 * those files, so a namespace cannot be added on one side and forgotten on the other.
 */
export function checkCatalogs(catalogs: CatalogSet, namespaces?: readonly string[]): string[] {
  const errors: string[] = [];
  const englishCatalogs = catalogs[DEFAULT_LOCALE] ?? {};
  const englishNamespaces = Object.keys(englishCatalogs).sort();

  for (const language of Object.keys(catalogs)) {
    if (!isSiteLocale(language)) {
      errors.push(`${language}/ is not a Tendril locale (${LOCALE_CODES.join(", ")})`);
    }
  }

  if (namespaces) {
    for (const namespace of namespaces) {
      if (!englishNamespaces.includes(namespace)) {
        errors.push(
          `en/${namespace}.json is missing, but "${namespace}" is a registered namespace`,
        );
      }
    }
    for (const namespace of englishNamespaces) {
      if (!namespaces.includes(namespace)) {
        errors.push(
          `en/${namespace}.json exists, but "${namespace}" is not a registered namespace`,
        );
      }
    }
  }

  const english = new Map<string, EnglishIndex>();
  for (const namespace of englishNamespaces) {
    const catalog = englishCatalogs[namespace];
    if (!isRecord(catalog)) {
      errors.push(`en/${namespace}.json is not a JSON object`);
      continue;
    }
    for (const { path, value } of leaves(catalog)) {
      const problem = valueProblems(value);
      if (problem) errors.push(`en/${namespace}.json: "${path}" ${problem}`);
    }
    const index = indexEnglish(catalog);
    for (const [base, forms] of index.plurals) {
      const needed = requiredPluralCategories(DEFAULT_LOCALE);
      const missing = needed.filter((category) => !forms.has(category));
      if (missing.length > 0) {
        errors.push(
          `en/${namespace}.json: "${base}" is missing the plural ${describeForms(missing)} ` +
            `(English needs ${needed.join(", ")})`,
        );
      }
      for (const category of forms.keys()) {
        if (category !== "zero" && !needed.includes(category as Intl.LDMLPluralRule)) {
          errors.push(`en/${namespace}.json: "${base}_${category}" is a form English never uses`);
        }
      }
    }
    english.set(namespace, index);
  }

  for (const language of LOCALE_CODES) {
    if (language === DEFAULT_LOCALE) continue;
    const translated = catalogs[language] ?? {};
    for (const namespace of englishNamespaces) {
      if (!Object.hasOwn(translated, namespace)) {
        errors.push(
          `${language}/${namespace}.json is missing (create it as {} if it is untranslated)`,
        );
      }
    }
    for (const [namespace, catalog] of Object.entries(translated)) {
      if (!englishNamespaces.includes(namespace)) {
        errors.push(`${language}/${namespace}.json has no English counterpart`);
      } else if (!isRecord(catalog)) {
        errors.push(`${language}/${namespace}.json is not a JSON object`);
      } else {
        const index = english.get(namespace);
        // No index means English's own file is broken, which is reported above.
        if (index) {
          const englishCatalog = englishCatalogs[namespace] as Record<string, unknown>;
          checkTranslation(language, namespace, index, englishCatalog, catalog, errors);
        }
      }
    }
  }

  return errors;
}

/**
 * Every English key a locale does not translate yet, as `namespace:key` (a plural key is listed once
 * per form the locale needs and lacks, as `namespace:key_form`). Empty for every locale once the
 * translation phase is done.
 */
export function findUntranslatedKeys(catalogs: CatalogSet): Record<string, string[]> {
  const englishCatalogs = catalogs[DEFAULT_LOCALE] ?? {};
  const untranslated: Record<string, string[]> = {};

  for (const language of LOCALE_CODES) {
    if (language === DEFAULT_LOCALE) continue;
    const missing: string[] = [];
    for (const [namespace, englishCatalog] of Object.entries(englishCatalogs)) {
      if (!isRecord(englishCatalog)) continue;
      const catalog = catalogs[language]?.[namespace];
      const translated = isRecord(catalog) ? catalog : {};
      const { strings, plurals } = indexEnglish(englishCatalog);
      for (const path of strings.keys()) {
        if (PLURAL_SUFFIX.test(path) && plurals.has(PLURAL_SUFFIX.exec(path)![1])) continue;
        if (typeof nodeAt(translated, path) !== "string") missing.push(`${namespace}:${path}`);
      }
      for (const base of plurals.keys()) {
        for (const category of requiredPluralCategories(language)) {
          if (typeof nodeAt(translated, `${base}_${category}`) !== "string") {
            missing.push(`${namespace}:${base}_${category}`);
          }
        }
      }
    }
    if (missing.length > 0) untranslated[language] = missing;
  }

  return untranslated;
}
