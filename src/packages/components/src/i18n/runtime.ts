import { formatNamed, pluralRules } from "./intl";
import { DEFAULT_LOCALE, isSiteLocale, type SiteLocale } from "./locales";

/**
 * The translation runtime: one store of catalogs, one current language, and the lookup that turns a
 * key into a string. Both this package and the desktop app translate through the single instance at
 * the bottom of this file, so a language change reaches every string on screen at once.
 *
 * It is a deliberately small reimplementation of the parts of i18next Tendril uses, not a wrapper
 * around it: i18next plus react-i18next would cost ~58 kB of the app's eager bundle, which has ~77 kB
 * of headroom, and react-i18next cannot be installed here (TypeScript 7, and this package's own React
 * copy). What it keeps is i18next's *file format*, exactly, so the catalogs stay readable by
 * i18next-aware tooling (i18n-ally, translation platforms) and a later swap is a change of import:
 *
 * - catalogs are nested JSON objects with camelCase keys, addressed as `"namespace:key.path"`;
 * - `{{name}}` interpolation, with i18next's `{{value, format}}` and `{{value, format(option: x)}}`;
 * - plural suffixes `_zero` `_one` `_two` `_few` `_many` `_other`, chosen by `Intl.PluralRules`;
 * - context suffixes, `key_<context>` and `key_<context>_<plural>`;
 * - English as the fallback for anything a language does not translate.
 *
 * Two behaviours differ from i18next, both on the forgiving side. A missing plural category falls
 * back to `_other` in the same language before falling back to English, so a Russian catalog that
 * has `_one` and `_other` but not yet `_few` still renders Russian. And a variable that was never
 * passed interpolates as an empty string rather than as its literal `{{name}}`.
 */

/** One namespace's catalog, as its JSON file holds it: nested objects whose leaves are strings. */
export interface Messages {
  readonly [key: string]: string | Messages;
}

/** One language's catalogs, keyed by namespace. */
export type ResourceBundle = Readonly<Record<string, Messages>>;

/** Fetches one language's catalogs. In practice a dynamic `import()`, so each language is a chunk. */
export type BundleLoader = () => Promise<ResourceBundle>;

/**
 * What a translation call can be given besides its key. `count` selects the plural form, `context`
 * the context variant and `lng` renders in a language other than the current one; every property is
 * also a variable the string can interpolate, `count` included.
 */
export interface TOptions {
  count?: number;
  context?: string;
  lng?: SiteLocale;
  [variable: string]: unknown;
}

/**
 * - `key`: the key is in neither the current language's catalog nor the English one.
 * - `variable`: the string interpolates `{{name}}` and no value called `name` was passed.
 * - `format`: `{{value, name}}` names a format this runtime does not have.
 * - `tag`: a `<Trans>` string contains `<name>` and no component was supplied for it.
 * - `markup`: a `<Trans>` string has a tag that pairs with nothing - an opening tag never closed, or
 *   a closing tag with nothing open - so it rendered as literal text. Usually text that only looks
 *   like a tag (`<hash>`, `<TENDRIL_HOME>`), which belongs in a `{{variable}}`.
 */
export type MissingTranslationKind = "key" | "variable" | "format" | "tag" | "markup";

export interface MissingTranslation {
  kind: MissingTranslationKind;
  /** The language being rendered. */
  language: SiteLocale;
  namespace: string;
  key: string;
  /**
   * The variable, format or tag the problem is about, for the kinds that have one - for `markup`,
   * every unpaired tag as written, space-separated: `</code> <hash>`.
   */
  name?: string;
}

export type MissingTranslationHandler = (missing: MissingTranslation) => void;

/**
 * `throw` is what both packages' test setups install, so a mistyped key fails the test that renders
 * it. `warn` logs each distinct problem once. The default warns in development and says nothing in a
 * production build, where the key itself is rendered in place of the missing string.
 */
export type MissingTranslationMode = "warn" | "throw" | "ignore";

export function describeMissing(missing: MissingTranslation): string {
  const where = `"${missing.namespace}:${missing.key}"`;
  switch (missing.kind) {
    case "key":
      if (missing.namespace === "") {
        return `[i18n] "${missing.key}" names no namespace: write it as "namespace:${missing.key}"`;
      }
      return missing.language === DEFAULT_LOCALE
        ? `[i18n] ${where} is not in the English catalog`
        : `[i18n] ${where} is in neither the "${missing.language}" catalog nor the English one`;
    case "variable":
      return `[i18n] ${where} interpolates {{${missing.name}}}, but no value of that name was passed`;
    case "format":
      return `[i18n] ${where} uses "${missing.name}", which is not a format this runtime knows`;
    case "tag":
      return `[i18n] ${where} contains <${missing.name}>, but no component was passed for it`;
    case "markup":
      return (
        `[i18n] ${where} has unpaired tags, which render as text: ${missing.name}. ` +
        `Pass text that only looks like a tag as a {{variable}}`
      );
  }
}

const warned = new Set<string>();

function warnOnce(missing: MissingTranslation): void {
  const message = describeMissing(missing);
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/**
 * Vite's `import.meta.env.DEV`, read defensively: the built module is also imported by plain Node -
 * the docs build loads the locale table from its Vite plugins - where `import.meta.env` does not
 * exist. Read per report rather than at module load for the same reason.
 */
function isDevelopment(): boolean {
  const env = (import.meta as { env?: { DEV?: boolean } }).env;
  return env?.DEV === true;
}

const MISSING_HANDLERS: Record<MissingTranslationMode, MissingTranslationHandler> = {
  warn: warnOnce,
  throw: (missing) => {
    throw new Error(describeMissing(missing));
  },
  ignore: () => {},
};

/** What `useSyncExternalStore` compares: replaced, never mutated, on every change worth a render. */
export interface I18nSnapshot {
  readonly language: SiteLocale;
  /** Bumped whenever a catalog that can affect what is on screen is replaced. */
  readonly revision: number;
}

interface LoaderState {
  readonly load: BundleLoader;
  done: boolean;
  pending?: Promise<void>;
}

/** `ns:key` names its namespace; a bare key belongs to the caller's default one, if it has one. */
function splitKey(key: string, defaultNamespace: string | undefined) {
  const colon = key.indexOf(":");
  return colon > 0
    ? { namespace: key.slice(0, colon), path: key.slice(colon + 1) }
    : { namespace: defaultNamespace, path: key };
}

/** A dotted path into a catalog, or `undefined` unless it ends on a string. */
function getMessage(messages: Messages, path: string): string | undefined {
  let node: string | Messages | undefined = messages;
  for (const segment of path.split(".")) {
    // `hasOwn`, so a key can never resolve to something inherited, such as `constructor`.
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, segment)) {
      return undefined;
    }
    node = node[segment];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * The i18next lookup order within one language, most specific first:
 * `key_<context>_zero`, `key_<context>_<category>`, `key_<context>_other`, `key_<context>`, then the
 * same four without the context. `_zero` is only tried for a count of exactly 0, and is optional in
 * every language - it is i18next's extension, not a CLDR category.
 */
function lookupVariant(
  messages: Messages,
  key: string,
  language: SiteLocale,
  options: TOptions | undefined,
): string | undefined {
  const count = typeof options?.count === "number" ? options.count : undefined;
  const context = options?.context;
  const bases = typeof context === "string" && context !== "" ? [`${key}_${context}`, key] : [key];
  const category = count === undefined ? undefined : pluralRules(language).select(count);

  for (const base of bases) {
    if (category !== undefined) {
      const zero = count === 0 ? getMessage(messages, `${base}_zero`) : undefined;
      const plural =
        zero ??
        getMessage(messages, `${base}_${category}`) ??
        (category === "other" ? undefined : getMessage(messages, `${base}_other`));
      if (plural !== undefined) return plural;
    }
    const found = getMessage(messages, base);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** `{{name}}`, `{{name, format}}`, and i18next's `{{- name}}`, which is the same thing here. */
const PLACEHOLDER = /\{\{\s*(?:-\s*)?([^{}]+?)\s*\}\}/g;

/** A variable by name, following dots into nested values: `{{plan.title}}`. */
function lookupValue(
  values: TOptions | undefined,
  name: string,
): { found: boolean; value?: unknown } {
  if (!values) return { found: false };
  if (Object.hasOwn(values, name)) return { found: true, value: values[name] };
  let node: unknown = values;
  for (const segment of name.split(".")) {
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, segment)) {
      return { found: false };
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return { found: true, value: node };
}

class I18nStore {
  private snapshot: I18nSnapshot = { language: DEFAULT_LOCALE, revision: 0 };
  /** The language the latest `changeLanguage` asked for, so an earlier, slower load cannot win. */
  private requested: SiteLocale = DEFAULT_LOCALE;
  private readonly resources = new Map<string, Map<SiteLocale, Messages>>();
  private readonly loaders = new Map<SiteLocale, LoaderState[]>();
  private readonly listeners = new Set<() => void>();
  private missingHandler: MissingTranslationHandler = (missing) => {
    if (isDevelopment()) warnOnce(missing);
  };

  /** The language every translation is currently rendered in. */
  get language(): SiteLocale {
    return this.snapshot.language;
  }

  readonly getSnapshot = (): I18nSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Installs one namespace's catalog for one language, replacing any earlier one. i18next's name and
   * argument order; its `deep`/`overwrite` flags are not needed, because a catalog is always a whole
   * file.
   *
   * Only *replacing* a catalog re-renders, and only one on screen or behind it as the fallback. A
   * namespace registered for the first time cannot have rendered anything yet - a component imports
   * its strings before it renders them - and a lazily loaded component registers its English as it
   * arrives, which must not re-render the whole UI.
   */
  readonly addResourceBundle = (
    language: SiteLocale,
    namespace: string,
    messages: Messages,
  ): void => {
    let byLanguage = this.resources.get(namespace);
    if (!byLanguage) {
      byLanguage = new Map();
      this.resources.set(namespace, byLanguage);
    }
    const replacing = byLanguage.has(language);
    byLanguage.set(language, messages);
    if (replacing && (language === this.snapshot.language || language === DEFAULT_LOCALE)) {
      this.publish({ language: this.snapshot.language, revision: this.snapshot.revision + 1 });
    }
  };

  readonly hasResourceBundle = (language: SiteLocale, namespace: string): boolean =>
    this.resources.get(namespace)?.has(language) ?? false;

  /**
   * Registers a loader for one language's catalogs. It runs the first time that language - or
   * English, as everyone's fallback - is loaded, and never again once it has succeeded. A loader that
   * fails is retried by the next load.
   */
  readonly registerLoader = (language: SiteLocale, load: BundleLoader): void => {
    const registered = this.loaders.get(language) ?? [];
    if (registered.some((entry) => entry.load === load)) return;
    registered.push({ load, done: false });
    this.loaders.set(language, registered);
  };

  /** Runs every registered loader for `languages` that has not run yet. */
  readonly loadLanguages = (languages: readonly SiteLocale[]): Promise<void> =>
    this.load(languages) ?? Promise.resolve();

  /**
   * Loads a language's catalogs, and English's, then switches to it and re-renders everything that
   * translates. When both are already loaded the switch happens before this returns, so a caller
   * never renders a frame in the old language.
   *
   * Rejects, leaving the language as it was, if a catalog fails to load. When two changes overlap,
   * the later request wins however the loads finish.
   */
  readonly changeLanguage = (language: SiteLocale): Promise<void> => {
    if (!isSiteLocale(language)) {
      return Promise.reject(new Error(`[i18n] "${String(language)}" is not a Tendril locale`));
    }
    this.requested = language;
    const loading = this.load([language, DEFAULT_LOCALE]);
    if (!loading) {
      this.switchTo(language);
      return Promise.resolve();
    }
    return loading.then(
      () => {
        if (this.requested === language) this.switchTo(language);
      },
      (error: unknown) => {
        if (this.requested === language) this.requested = this.snapshot.language;
        throw error;
      },
    );
  };

  /** Translates a namespaced key, `"namespace:key.path"`, in the current language. */
  readonly t = (key: string, options?: TOptions): string => this.translate(undefined, key, options);

  /** Whether a namespaced key resolves - in the current language or in English - without reporting it. */
  readonly exists = (key: string, options?: TOptions): boolean => {
    const { namespace, path } = splitKey(key, undefined);
    const language = options?.lng ?? this.snapshot.language;
    return (
      namespace !== undefined && this.resolve(namespace, path, language, options) !== undefined
    );
  };

  /**
   * i18next's `getFixedT(lng, ns)`: a `t` bound to one namespace, and to one language unless `lng` is
   * `null`, in which case it translates into whatever the language is *when it is called*. A bound
   * function can therefore be created once, at module level, and still follow language changes.
   */
  readonly getFixedT =
    (language: SiteLocale | null | undefined, namespace: string) =>
    (key: string, options?: TOptions): string =>
      this.translate(
        namespace,
        key,
        language && options?.lng === undefined ? { ...options, lng: language } : options,
      );

  readonly setMissingKeyHandler = (
    handler: MissingTranslationHandler | MissingTranslationMode,
  ): void => {
    this.missingHandler = typeof handler === "function" ? handler : MISSING_HANDLERS[handler];
  };

  /** @internal Hands a problem to the missing-translation handler; `<Trans>` reports tags through this. */
  reportMissing(missing: MissingTranslation): void {
    this.missingHandler(missing);
  }

  /** @internal The raw, uninterpolated string for a key, after plural, context and English fallback. */
  resolve(
    namespace: string,
    key: string,
    language: SiteLocale,
    options?: TOptions,
  ): string | undefined {
    const byLanguage = this.resources.get(namespace);
    if (!byLanguage) return undefined;
    const chain = language === DEFAULT_LOCALE ? [language] : [language, DEFAULT_LOCALE];
    for (const candidate of chain) {
      const messages = byLanguage.get(candidate);
      const found = messages && lookupVariant(messages, key, candidate, options);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  /**
   * @internal Fills a string's placeholders. A plain `{{value}}` is `String(value)` and nothing more:
   * numbers are only localised when the string asks for a format, which keeps every English string
   * byte-for-byte what it was before extraction. `null`, and a variable passed as `undefined`, render
   * as nothing, as i18next renders them. Values are never HTML-escaped - React escapes what it
   * renders.
   */
  interpolate(
    template: string,
    values: TOptions | undefined,
    language: SiteLocale,
    namespace: string,
    key: string,
  ): string {
    if (!template.includes("{{")) return template;
    return template.replace(PLACEHOLDER, (_match, expression: string) => {
      const comma = expression.indexOf(",");
      const name = (comma === -1 ? expression : expression.slice(0, comma)).trim();
      const format = comma === -1 ? "" : expression.slice(comma + 1).trim();

      const { found, value } = lookupValue(values, name);
      if (!found) {
        this.reportMissing({ kind: "variable", language, namespace, key, name });
        return "";
      }
      if (value === undefined || value === null) return "";
      if (format) {
        const formatted = this.format(value, format, language);
        if (formatted !== undefined) return formatted;
        this.reportMissing({ kind: "format", language, namespace, key, name: format });
      }
      // `String(value)`, exactly what the template literal it replaced produced - an object renders
      // as it would have there. Passing one is the caller's bug, not something to format around.
      // oxlint-disable-next-line typescript/no-base-to-string
      return String(value);
    });
  }

  /** `undefined` for an unknown format, or for a value its formatter rejects (an unknown currency). */
  private format(value: unknown, format: string, language: SiteLocale): string | undefined {
    try {
      return formatNamed(value, format, language);
    } catch {
      return undefined;
    }
  }

  private translate(defaultNamespace: string | undefined, key: string, options?: TOptions): string {
    const { namespace, path } = splitKey(key, defaultNamespace);
    const language = options?.lng ?? this.snapshot.language;
    const template =
      namespace === undefined ? undefined : this.resolve(namespace, path, language, options);
    if (namespace === undefined || template === undefined) {
      this.reportMissing({ kind: "key", language, namespace: namespace ?? "", key: path });
      // i18next's answer too: the key, which is at least greppable, rather than an empty string.
      return path;
    }
    return this.interpolate(template, options, language, namespace, path);
  }

  /** Runs every loader not yet run for `languages`, or returns `null` when none needs to run. */
  private load(languages: readonly SiteLocale[]): Promise<void> | null {
    const pending: Promise<void>[] = [];
    for (const language of new Set(languages)) {
      for (const entry of this.loaders.get(language) ?? []) {
        if (entry.done) continue;
        entry.pending ??= entry.load().then(
          (bundle) => {
            for (const [namespace, messages] of Object.entries(bundle)) {
              if (messages && typeof messages === "object") {
                this.addResourceBundle(language, namespace, messages);
              }
            }
            entry.done = true;
            entry.pending = undefined;
          },
          (error: unknown) => {
            entry.pending = undefined;
            throw error;
          },
        );
        pending.push(entry.pending);
      }
    }
    return pending.length === 0 ? null : Promise.all(pending).then(() => undefined);
  }

  private switchTo(language: SiteLocale): void {
    if (language === this.snapshot.language) return;
    this.publish({ language, revision: this.snapshot.revision + 1 });
  }

  private publish(snapshot: I18nSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

export type { I18nStore };

/** The one store. Everything translates through it - never construct another. */
export const i18nStore = new I18nStore();
