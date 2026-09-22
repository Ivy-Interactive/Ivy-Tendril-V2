import type * as React from "react";
import type { SiteLocale } from "./locales";
import type {
  BundleLoader,
  Messages,
  MissingTranslationHandler,
  MissingTranslationMode,
  TOptions,
} from "./runtime";

/**
 * The compile-time half of the runtime: keys are checked against the English catalogs, so a typo or
 * a key nobody added fails `tsc` rather than rendering a raw key.
 *
 * The resources type `R` maps each namespace to the *type* of its English JSON file, e.g.
 * `{ common: typeof import("../locales/en/common.json") }`. Nothing here reads the JSON at runtime.
 *
 * Typing is done through the factory in `react.tsx` (`createTranslation<R>()`), not by augmenting an
 * interface in this package's type declarations. The declarations are bundled into hashed shared
 * chunks, and a module augmentation aimed at a chunk that has since been renamed fails silently -
 * every key would type-check. A type parameter cannot go stale that way.
 */

/**
 * Plural and context variants are keys in their own right (`items_one`, `role_admin`) and also
 * collapse onto the key they vary (`items`, `role`), which is the key call sites use:
 * `t("items", { count })`. Catalog keys are camelCase, so an underscore only ever starts a suffix.
 */
type BaseKey<K extends string> = K extends `${infer Base}_${string}` ? Base : never;

/** Every key of one namespace, dot-separated: `"composer.placeholder"`. Only leaves are keys. */
export type KeyPath<T> = T extends readonly unknown[]
  ? never
  : {
      [K in keyof T & string]: T[K] extends string
        ? K | BaseKey<K>
        : T[K] extends object
          ? `${K}.${KeyPath<T[K]>}`
          : never;
    }[keyof T & string];

/** A key in any namespace, qualified with it: `"common:actions.cancel"`. */
export type QualifiedKey<R> = {
  [N in keyof R & string]: `${N}:${KeyPath<R[N]>}`;
}[keyof R & string];

/** What a `t` bound to namespace `N` accepts: its own keys bare, any namespace's keys qualified. */
export type TranslationKey<R, N extends keyof R & string> = KeyPath<R[N]> | QualifiedKey<R>;

export type TFunction<R, N extends keyof R & string> = (
  key: TranslationKey<R, N>,
  options?: TOptions,
) => string;

/**
 * The shared store, typed for one set of namespaces. The subset of i18next's `i18n` instance Tendril
 * uses, under i18next's names and argument orders.
 */
export interface I18n<R> {
  /** The current language. */
  readonly language: SiteLocale;
  /** Translates a qualified key, `"namespace:key.path"`, in the current language. */
  readonly t: (key: QualifiedKey<R>, options?: TOptions) => string;
  /**
   * Whether a qualified key resolves, in the current language or in English. Takes any string, for
   * the keys built from data (an enum value the daemon may have added since).
   */
  readonly exists: (key: string, options?: TOptions) => boolean;
  /**
   * A `t` bound to one namespace, and to one language unless `language` is `null` - in which case it
   * follows the current language at every call, and is safe to create at module level.
   */
  readonly getFixedT: <N extends keyof R & string>(
    language: SiteLocale | null,
    namespace: N,
  ) => TFunction<R, N>;
  /** Loads the language's catalogs (and English's), then switches to it. */
  readonly changeLanguage: (language: SiteLocale) => Promise<void>;
  readonly loadLanguages: (languages: readonly SiteLocale[]) => Promise<void>;
  readonly registerLoader: (language: SiteLocale, load: BundleLoader) => void;
  readonly addResourceBundle: (language: SiteLocale, namespace: string, messages: Messages) => void;
  readonly hasResourceBundle: (language: SiteLocale, namespace: string) => boolean;
  readonly setMissingKeyHandler: (
    handler: MissingTranslationHandler | MissingTranslationMode,
  ) => void;
  /** Called after every language change, and whenever a catalog on screen is replaced. */
  readonly subscribe: (listener: () => void) => () => void;
}

export interface UseTranslationResponse<R, N extends keyof R & string> {
  /** Changes identity whenever the language does, so it can be a `useMemo`/`useEffect` dependency. */
  t: TFunction<R, N>;
  i18n: I18n<R>;
}

/**
 * react-i18next's `<Trans>`, with named tags only. The string carries the markup -
 * `"Press <kbd>{{key}}</kbd> or <link>open the docs</link>."` - and `components` supplies an element
 * per tag name. The element is cloned with the translated text as its children, so its own props
 * (an `href`, an `onClick`, a `className`) survive translation.
 *
 * `<br/>`, `<strong>`, `<i>` and `<p>` render as themselves when no component is given for them,
 * which is react-i18next's default too. Any other tag without a component is reported and rendered
 * as its content alone. A tag that pairs with nothing is reported too, and kept as text: text that
 * only looks like a tag (`recover/<name>`) belongs in a variable, which is never parsed as markup.
 */
export interface TransProps<R, N extends keyof R & string> {
  ns: N;
  i18nKey: TranslationKey<R, N>;
  /** The string's variables. They are interpolated into its text, never parsed as markup. */
  values?: Readonly<Record<string, unknown>>;
  components?: Readonly<Record<string, React.ReactElement>>;
  /** Selects the plural form, and is `{{count}}` in the string. */
  count?: number;
  context?: string;
}

/** What `createTranslation<R>()` returns: the store and the React bindings, typed for `R`. */
export interface Translation<R> {
  i18n: I18n<R>;
  /** react-i18next's `useTranslation(ns)`. Re-renders the component when the language changes. */
  useTranslation: <N extends keyof R & string>(namespace: N) => UseTranslationResponse<R, N>;
  Trans: <N extends keyof R & string>(props: TransProps<R, N>) => React.ReactElement;
}
