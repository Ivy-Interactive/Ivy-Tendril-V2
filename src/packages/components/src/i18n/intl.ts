import { LOCALES, type SiteLocale } from "./locales";

/**
 * Number, date, list and relative-time formatting for one language, through `Intl` and nothing else.
 *
 * Every formatter is built for the locale's `hreflang` (`pt-BR`, `zh-CN`), never for its short code
 * and never for the platform default. `toLocaleString()` with no argument formats in the operating
 * system's language, which is not the language the user picked in Tendril, and a hard-coded
 * `"en-US"` formats in English for everyone. Both are what this module replaces.
 *
 * `Intl` constructors are slow enough to matter inside a table cell, so each one is built once per
 * locale and option set and then reused. The cache is keyed on the options' JSON, which is stable for
 * the literal option objects call sites pass.
 */

/** Anything `new Date(...)` accepts: a `Date`, epoch milliseconds, or an ISO 8601 string. */
export type DateInput = Date | number | string;

/** The units {@link selectRelativeTimeUnit} chooses between, smallest first. */
export type RelativeTimeUnit = "second" | "minute" | "hour" | "day" | "week" | "month" | "year";

export interface RelativeTimeOptions {
  /** The moment the value is relative to. Defaults to now. */
  now?: DateInput;
  /**
   * `long` reads "3 hours ago", `short` "3 hr. ago", `narrow` "3h ago". Defaults to `long`.
   *
   * Where a language's `narrow` form is a bare signed number rather than a phrase - "-3 h" in
   * French, Russian and Swedish, which reads as arithmetic in "Updated -3 h" - `narrow` is rendered
   * as `short` ("il y a 3 h") instead.
   */
  style?: Intl.RelativeTimeFormatStyle;
  /**
   * `auto` (the default) allows the idiomatic phrases - "now", "yesterday", "next week" - where the
   * language has one; `always` keeps the number ("0 seconds ago", "1 day ago").
   */
  numeric?: Intl.RelativeTimeFormatNumeric;
  /** The smallest unit to report. A shorter span reads as zero of it. Defaults to `second`. */
  minUnit?: RelativeTimeUnit;
  /** The largest unit to report, e.g. `day` for "45 days ago" rather than "1 month ago". */
  maxUnit?: RelativeTimeUnit;
}

/** Every formatter for one language. {@link getFormatters} builds and caches them. */
export interface Formatters {
  /** `1234.5` → "1,234.5" (en), "1.234,5" (de). */
  number(value: number | bigint, options?: Intl.NumberFormatOptions): string;
  /** A fraction: `0.25` → "25%". */
  percent(value: number, options?: Intl.NumberFormatOptions): string;
  /** `3.5` → "$3.50". The currency defaults to USD, the only one Tendril reports costs in. */
  currency(value: number, currency?: string, options?: Intl.NumberFormatOptions): string;
  /** `1234` → "1.2K", `2500000` → "2.5M", in the language's own abbreviations. */
  compact(value: number, options?: Intl.NumberFormatOptions): string;
  /** A calendar date. Defaults to `dateStyle: "medium"` ("Sep 22, 2026"). */
  date(value: DateInput, options?: Intl.DateTimeFormatOptions): string;
  /** A time of day. Defaults to `timeStyle: "short"` ("3:04 PM"). */
  time(value: DateInput, options?: Intl.DateTimeFormatOptions): string;
  /** Both. Defaults to `dateStyle: "medium", timeStyle: "short"`. */
  dateTime(value: DateInput, options?: Intl.DateTimeFormatOptions): string;
  /** "3 minutes ago", "in 2 days", "yesterday" - in the best-fitting unit. */
  relativeTime(value: DateInput, options?: RelativeTimeOptions): string;
  /** `["a", "b", "c"]` → "a, b, and c" (en), "a, b und c" (de). */
  list(items: readonly string[], options?: Intl.ListFormatOptions): string;
}

const intlCache = new Map<string, unknown>();

function cached<T>(kind: string, locale: string, options: object | undefined, build: () => T): T {
  const key = `${kind}|${locale}|${options === undefined ? "" : JSON.stringify(options)}`;
  let value = intlCache.get(key) as T | undefined;
  if (value === undefined) {
    value = build();
    intlCache.set(key, value);
  }
  return value;
}

/** The `Intl` locale for a Tendril language. */
export const intlLocale = (language: SiteLocale): string => LOCALES[language].hreflang;

export function pluralRules(language: SiteLocale): Intl.PluralRules {
  const locale = intlLocale(language);
  return cached("plural", locale, undefined, () => new Intl.PluralRules(locale));
}

const numberFormat = (language: SiteLocale, options?: Intl.NumberFormatOptions) => {
  const locale = intlLocale(language);
  return cached("number", locale, options, () => new Intl.NumberFormat(locale, options));
};

const dateTimeFormat = (language: SiteLocale, options: Intl.DateTimeFormatOptions) => {
  const locale = intlLocale(language);
  return cached("date", locale, options, () => new Intl.DateTimeFormat(locale, options));
};

/**
 * The fields that pick which parts of a date to show. `Intl` refuses to combine any of them with
 * `dateStyle`/`timeStyle`, so a caller naming one gets exactly the parts it named and none of the
 * defaults.
 */
const DATE_COMPONENTS = [
  "dateStyle",
  "timeStyle",
  "weekday",
  "era",
  "year",
  "month",
  "day",
  "dayPeriod",
  "hour",
  "minute",
  "second",
  "fractionalSecondDigits",
  "timeZoneName",
] as const;

/** The defaults, unless the caller chose the parts itself; its other options (`timeZone`, …) stay. */
function withDateDefaults(
  options: Intl.DateTimeFormatOptions | undefined,
  defaults: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions {
  if (!options) return defaults;
  const choosesParts = DATE_COMPONENTS.some((field) => options[field] !== undefined);
  return choosesParts ? options : { ...defaults, ...options };
}

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `Intl.RelativeTimeFormatUnit`'s singular units, each with its length in seconds. */
const UNIT_SECONDS: ReadonlyArray<readonly [RelativeTimeUnit, number]> = [
  ["second", 1],
  ["minute", 60],
  ["hour", 3600],
  ["day", 86_400],
  ["week", 604_800],
  // The average Gregorian month and year, so "1 month ago" starts at 30.4 days, not at 30 or 31.
  ["month", 2_629_800],
  ["year", 31_557_600],
];

const unitIndex = (unit: RelativeTimeUnit) => UNIT_SECONDS.findIndex(([name]) => name === unit);

/**
 * The largest unit that fits a span, and how many whole units of it the span holds.
 *
 * Whole units, truncated toward zero: 59 minutes is "59 minutes ago" and 119 minutes is "1 hour
 * ago", never "2 hours ago". That is how every hand-rolled "Nm ago" in Tendril counted, and rounding
 * up would claim time that has not passed yet. The sign follows `deltaMs`: negative is the past. A
 * span shorter than one unit is a plain `0` either way, since `-0` is a trap for whoever compares it
 * (`Object.is`, `toEqual`); the formatter below puts the sign back.
 */
export function selectRelativeTimeUnit(
  deltaMs: number,
  options: Pick<RelativeTimeOptions, "minUnit" | "maxUnit"> = {},
): { value: number; unit: RelativeTimeUnit } {
  const min = unitIndex(options.minUnit ?? "second");
  const max = unitIndex(options.maxUnit ?? "year");
  const seconds = Math.abs(deltaMs) / 1000;

  let chosen = min;
  for (let index = min; index <= max; index += 1) {
    if (seconds >= UNIT_SECONDS[index][1]) chosen = index;
  }

  const [unit, size] = UNIT_SECONDS[chosen];
  return { value: Math.trunc(deltaMs / 1000 / size) + 0, unit };
}

/**
 * Whether a language's `narrow` relative time is a bare signed number - "-3 h", or "−3 h" with a
 * minus sign - rather than a phrase ("3h ago", "vor 3 Std."). Asked of `Intl` rather than listed,
 * because it is CLDR data, and the webviews Tendril runs in ship different ICU versions.
 */
const narrowIsSigned = (locale: string): boolean =>
  cached("narrowSigned", locale, undefined, () =>
    /^[-\u2212+]/.test(
      new Intl.RelativeTimeFormat(locale, { style: "narrow", numeric: "always" })
        .format(-1, "hour")
        .trim(),
    ),
  );

const formattersByLanguage = new Map<SiteLocale, Formatters>();

/**
 * The formatters for one language. Prefer the current-language forms - `useFormatters()` in a
 * component, `formatNumber` and its siblings elsewhere - and reach for this only when the language is
 * not the UI's, e.g. in a test.
 */
export function getFormatters(language: SiteLocale): Formatters {
  const existing = formattersByLanguage.get(language);
  if (existing) return existing;

  const formatDate = (
    value: DateInput,
    options: Intl.DateTimeFormatOptions | undefined,
    defaults: Intl.DateTimeFormatOptions,
  ) => {
    const date = toDate(value);
    return date ? dateTimeFormat(language, withDateDefaults(options, defaults)).format(date) : "";
  };

  const formatters: Formatters = {
    number: (value, options) => numberFormat(language, options).format(value),
    percent: (value, options) =>
      numberFormat(language, { style: "percent", ...options }).format(value),
    currency: (value, currency = "USD", options) =>
      numberFormat(language, { style: "currency", currency, ...options }).format(value),
    compact: (value, options) =>
      numberFormat(language, {
        notation: "compact",
        maximumFractionDigits: 1,
        ...options,
      }).format(value),
    date: (value, options) => formatDate(value, options, { dateStyle: "medium" }),
    time: (value, options) => formatDate(value, options, { timeStyle: "short" }),
    dateTime: (value, options) =>
      formatDate(value, options, { dateStyle: "medium", timeStyle: "short" }),
    relativeTime: (value, options = {}) => {
      const date = toDate(value);
      const now = toDate(options.now ?? Date.now());
      if (!date || !now) return "";
      const deltaMs = date.getTime() - now.getTime();
      const { value: amount, unit } = selectRelativeTimeUnit(deltaMs, options);
      const locale = intlLocale(language);
      const style = options.style ?? "long";
      const formatOptions: Intl.RelativeTimeFormatOptions = {
        style: style === "narrow" && narrowIsSigned(locale) ? "short" : style,
        numeric: options.numeric ?? "auto",
      };
      // A span in the past shorter than one unit goes to `Intl` as `-0`: with `numeric: "always"`
      // that reads "0 minutes ago", where `0` reads "in 0 minutes". (`auto` makes both "now".)
      const signed = amount === 0 && deltaMs < 0 ? -0 : amount;
      return cached(
        "relative",
        locale,
        formatOptions,
        () => new Intl.RelativeTimeFormat(locale, formatOptions),
      ).format(signed, unit);
    },
    list: (items, options) => {
      const locale = intlLocale(language);
      const formatOptions: Intl.ListFormatOptions = {
        style: "long",
        type: "conjunction",
        ...options,
      };
      return cached(
        "list",
        locale,
        formatOptions,
        () => new Intl.ListFormat(locale, formatOptions),
      ).format(items);
    },
  };

  formattersByLanguage.set(language, formatters);
  return formatters;
}

/**
 * Splits an interpolation format the way i18next writes one: a name, optionally followed by options
 * in parentheses - `number(maximumFractionDigits: 1)`, `currency(EUR)`,
 * `datetime(dateStyle: long; timeStyle: short)`. Options are `;`-separated `key: value` pairs, and
 * numbers and booleans are parsed as such. A bare value is the currency code for `currency`.
 */
export function parseFormat(format: string): { name: string; options: Record<string, unknown> } {
  const open = format.indexOf("(");
  const name = (open === -1 ? format : format.slice(0, open)).trim().toLowerCase();
  const options: Record<string, unknown> = {};
  if (open === -1) return { name, options };

  const close = format.lastIndexOf(")");
  const body = format.slice(open + 1, close > open ? close : undefined);
  if (name === "currency" && !body.includes(":")) {
    if (body.trim()) options.currency = body.trim();
    return { name, options };
  }

  for (const pair of body.split(";")) {
    const colon = pair.indexOf(":");
    if (colon === -1) continue;
    const key = pair.slice(0, colon).trim();
    const raw = pair
      .slice(colon + 1)
      .trim()
      .replace(/^'+|'+$/g, "");
    if (!key) continue;
    options[key] = parseOptionValue(raw);
  }
  return { name, options };
}

/**
 * Formats one interpolated value by format name - `{{n, number}}`, `{{d, date}}` - or returns
 * `undefined` for a name this runtime does not know, so the caller can report it.
 */
export function formatNamed(
  value: unknown,
  format: string,
  language: SiteLocale,
): string | undefined {
  const { name, options } = parseFormat(format);
  const formatters = getFormatters(language);
  switch (name) {
    case "number":
      return formatters.number(value as number, options);
    case "percent":
      return formatters.percent(value as number, options);
    case "currency": {
      const { currency, ...rest } = options;
      return formatters.currency(value as number, (currency as string | undefined) ?? "USD", rest);
    }
    case "compact":
      return formatters.compact(value as number, options);
    case "date":
      return formatters.date(value as DateInput, hasOptions(options) ? options : undefined);
    case "time":
      return formatters.time(value as DateInput, hasOptions(options) ? options : undefined);
    case "datetime":
      return formatters.dateTime(value as DateInput, hasOptions(options) ? options : undefined);
    case "list":
      return formatters.list(Array.isArray(value) ? value.map(String) : [String(value)], options);
    default:
      return undefined;
  }
}

const hasOptions = (options: Record<string, unknown>) => Object.keys(options).length > 0;

/** `true`/`false` and numbers are typed, as i18next types them; anything else stays a string. */
function parseOptionValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
}
