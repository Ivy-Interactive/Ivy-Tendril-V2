/**
 * i18n entry point: `@ivy-interactive/components/i18n`.
 *
 * The one translation runtime Tendril has. This package translates its own strings through it, and
 * the desktop app binds its own catalogs to the same store (`createTranslation`), so a single
 * `changeLanguage` switches both. The docs site takes the shared locale table from here too.
 *
 * Like `./theme`, it is kept small enough for an application's entry module to import: the runtime
 * and the locale table. This package's English travels with the components that use it, and every
 * other language is a chunk of its own. `docs/i18n.md` in the app is the guide to using it.
 *
 * Code inside this package never imports it: here the specifier resolves to the built copy in
 * `dist/`, with a store of its own. Components import from their namespace's module
 * (`@/i18n/uiDialogs`, …) instead.
 */

// Registers this package's locale loaders, so an app that loads a language through this entry loads
// the components' strings in that language along with its own.
import "./i18n/register";

export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_CODES,
  SITE_LOCALES,
  findLocale,
  getLocale,
  isSiteLocale,
  matchLocale,
  type LocaleConfig,
  type SiteLocale,
} from "./i18n/locales";
export { createTranslation, useFormatters, useLocale, type LocaleInfo } from "./i18n/react";
export {
  describeMissing,
  type BundleLoader,
  type I18nSnapshot,
  type Messages,
  type MissingTranslation,
  type MissingTranslationHandler,
  type MissingTranslationKind,
  type MissingTranslationMode,
  type ResourceBundle,
  type TOptions,
} from "./i18n/runtime";
export type {
  I18n,
  KeyPath,
  QualifiedKey,
  TFunction,
  TransProps,
  Translation,
  TranslationKey,
  UseTranslationResponse,
} from "./i18n/types";
export {
  getFormatters,
  selectRelativeTimeUnit,
  type DateInput,
  type Formatters,
  type RelativeTimeOptions,
  type RelativeTimeUnit,
} from "./i18n/intl";
export {
  formatCompact,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatList,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTime,
} from "./i18n/format";
export { COMPONENT_NAMESPACES, type ComponentNamespace } from "./i18n/namespaces";
export {
  catalogSetFromFiles,
  checkCatalogs,
  findUntranslatedKeys,
  requiredPluralCategories,
  type CatalogSet,
} from "./i18n/catalogCheck";
