import { getFormatters, type Formatters } from "./intl";
import { i18nStore } from "./runtime";

/**
 * The formatters for code outside React - stores, controllers, table-cell helpers - in the language
 * that is current *when they are called*. A component should use `useFormatters()` instead, which
 * also re-renders it when the language changes.
 *
 * Call them where the string is needed, never at module load: a value formatted into a module-level
 * constant is frozen in whatever language the app started in.
 */

const current = (): Formatters => getFormatters(i18nStore.language);

export const formatNumber: Formatters["number"] = (value, options) =>
  current().number(value, options);

export const formatPercent: Formatters["percent"] = (value, options) =>
  current().percent(value, options);

export const formatCurrency: Formatters["currency"] = (value, currency, options) =>
  current().currency(value, currency, options);

export const formatCompact: Formatters["compact"] = (value, options) =>
  current().compact(value, options);

export const formatDate: Formatters["date"] = (value, options) => current().date(value, options);

export const formatTime: Formatters["time"] = (value, options) => current().time(value, options);

export const formatDateTime: Formatters["dateTime"] = (value, options) =>
  current().dateTime(value, options);

export const formatRelativeTime: Formatters["relativeTime"] = (value, options) =>
  current().relativeTime(value, options);

export const formatList: Formatters["list"] = (items, options) => current().list(items, options);
