import * as React from "react";
import { getFormatters, type Formatters } from "./intl";
import { LOCALES, type SiteLocale } from "./locales";
import { parseMarkup, type MarkupNode, type ParsedMarkup } from "./markup";
import { i18nStore, type I18nSnapshot, type TOptions } from "./runtime";
import type { I18n, TFunction, Translation, UseTranslationResponse } from "./types";

/**
 * The React side of the runtime. There is no provider: the store is a module singleton, and every
 * hook here subscribes to it with `useSyncExternalStore`, so a component renders English with no
 * setup at all - in the docs site, in a test, in a Storybook story - and follows `changeLanguage`
 * wherever it is mounted.
 */

const useSnapshot = (): I18nSnapshot =>
  React.useSyncExternalStore(i18nStore.subscribe, i18nStore.getSnapshot, i18nStore.getSnapshot);

export interface LocaleInfo {
  language: SiteLocale;
  /** BCP 47, for `lang` attributes and `Intl`: `pt-BR`, `zh-CN`. */
  hreflang: string;
  dir: "ltr" | "rtl";
}

/** The current language, with the two facts markup needs about it. */
export function useLocale(): LocaleInfo {
  const { language } = useSnapshot();
  return React.useMemo(
    () => ({ language, hreflang: LOCALES[language].hreflang, dir: LOCALES[language].dir }),
    [language],
  );
}

/** Number, date, list and relative-time formatters for the current language. */
export function useFormatters(): Formatters {
  return getFormatters(useSnapshot().language);
}

/** The tags `<Trans>` renders as themselves when no component is given, as react-i18next does. */
const BASIC_ELEMENTS = new Set(["br", "strong", "i", "p"]);
/** Elements React refuses children for. */
const VOID_ELEMENTS = new Set(["br"]);

const NOTHING_PARSED: ParsedMarkup = { nodes: [], unpaired: [] };

interface UntypedTransProps {
  ns: string;
  i18nKey: string;
  values?: Readonly<Record<string, unknown>>;
  components?: Readonly<Record<string, React.ReactElement>>;
  count?: number;
  context?: string;
}

function TransImpl({
  ns,
  i18nKey,
  values,
  components,
  count,
  context,
}: UntypedTransProps): React.ReactElement {
  const { language } = useSnapshot();
  const colon = i18nKey.indexOf(":");
  const namespace = colon > 0 ? i18nKey.slice(0, colon) : ns;
  const key = colon > 0 ? i18nKey.slice(colon + 1) : i18nKey;

  // `count` and `context` join the variables only when given: a present-but-undefined `count` would
  // interpolate as nothing instead of being reported as missing.
  const options: TOptions = { ...values };
  if (count !== undefined) options.count = count;
  if (context !== undefined) options.context = context;

  const template = i18nStore.resolve(namespace, key, language, options);
  const { nodes, unpaired } = React.useMemo(
    () => (template === undefined ? NOTHING_PARSED : parseMarkup(template)),
    [template],
  );

  if (template === undefined) {
    i18nStore.reportMissing({ kind: "key", language, namespace, key });
    return <>{key}</>;
  }
  if (unpaired.length > 0) {
    i18nStore.reportMissing({ kind: "markup", language, namespace, key, name: unpaired.join(" ") });
  }

  // Each text node is interpolated on its own, after the markup is parsed, so a value can never
  // introduce a tag: a plan titled "<link>" renders as those six characters.
  const render = (children: readonly MarkupNode[]): React.ReactNode[] =>
    children.map((node, index) => {
      if (node.type === "text") {
        return i18nStore.interpolate(node.text, options, language, namespace, key);
      }
      const inner = render(node.children);
      const component = components?.[node.name];
      if (component) return React.cloneElement(component, { key: index }, ...inner);
      if (BASIC_ELEMENTS.has(node.name)) {
        return VOID_ELEMENTS.has(node.name)
          ? React.createElement(node.name, { key: index })
          : React.createElement(node.name, { key: index }, ...inner);
      }
      i18nStore.reportMissing({ kind: "tag", language, namespace, key, name: node.name });
      return React.createElement(React.Fragment, { key: index }, ...inner);
    });

  return React.createElement(React.Fragment, null, ...render(nodes));
}
TransImpl.displayName = "Trans";

/**
 * Binds the store and the React bindings to one set of namespaces, so every key is checked against
 * the English catalogs at compile time. Call it beside the code that registers those catalogs - the
 * app once, for all of its namespaces; this package once per namespace module (`bindNamespace`):
 *
 * ```ts
 * export type AppResources = { common: typeof common; chat: typeof chat };
 * export const { i18n, useTranslation, Trans } = createTranslation<AppResources>();
 * ```
 *
 * Every binding shares the one store; the type parameter is the only thing that differs.
 */
export function createTranslation<R extends object>(): Translation<R> {
  const i18n = i18nStore as unknown as I18n<R>;

  function useTranslation<N extends keyof R & string>(namespace: N): UseTranslationResponse<R, N> {
    const snapshot = useSnapshot();
    // A new `t` per snapshot, not per render: stable while nothing changes, and a new identity the
    // moment the language (or a catalog on screen) does, so memoized output depending on it
    // recomputes. Bound to the current language rather than the snapshot's, as react-i18next's `t`
    // is, so a handler that fires after a change still speaks the new language.
    return React.useMemo(
      () => ({ t: i18nStore.getFixedT(null, namespace) as TFunction<R, N>, i18n }),
      [namespace, snapshot],
    );
  }

  return { i18n, useTranslation, Trans: TransImpl as Translation<R>["Trans"] };
}
