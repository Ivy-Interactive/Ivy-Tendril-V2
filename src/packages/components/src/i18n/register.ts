import type { SiteLocale } from "./locales";
import type { ComponentNamespace } from "./namespaces";
import { i18nStore, type Messages } from "./runtime";

/**
 * Registers the loaders for this package's non-English catalogs, as a side effect of being imported:
 * each language is one chunk, loaded the first time that language is chosen. The loader map is
 * written out by hand because the library build (tsdown) does not expand a template-literal
 * `import()` the way Vite does.
 *
 * English is not here. Each namespace's module (`./uiDialogs.ts`, …) imports its English statically
 * and registers it as it loads, so a component renders English with no provider and no setup - in
 * the docs site, a unit test, a Storybook story - while the English of a lazily loaded component
 * (the dialogs) stays in that component's chunk instead of the app's eager bundle.
 *
 * It exports nothing on purpose: the package entry imports it for the registration, and anything it
 * exported would pull these JSON imports into the published type declarations, which the
 * declaration bundler cannot follow.
 */

/** One locale's catalogs. Every locale module must export every namespace. */
type ComponentBundle = Record<ComponentNamespace, Messages>;

const LOCALE_LOADERS = {
  de: () => import("./locales/de/index"),
  ja: () => import("./locales/ja/index"),
  es: () => import("./locales/es/index"),
  fr: () => import("./locales/fr/index"),
  pt: () => import("./locales/pt/index"),
  zh: () => import("./locales/zh/index"),
  ru: () => import("./locales/ru/index"),
  sv: () => import("./locales/sv/index"),
  hi: () => import("./locales/hi/index"),
} satisfies Record<Exclude<SiteLocale, "en">, () => Promise<ComponentBundle>>;

for (const [language, load] of Object.entries(LOCALE_LOADERS)) {
  i18nStore.registerLoader(language as SiteLocale, load);
}
