import type { Locale } from "date-fns";
import { de } from "date-fns/locale/de";
import { enUS } from "date-fns/locale/en-US";
import { es } from "date-fns/locale/es";
import { fr } from "date-fns/locale/fr";
import { hi } from "date-fns/locale/hi";
import { ja } from "date-fns/locale/ja";
import { ptBR } from "date-fns/locale/pt-BR";
import { ru } from "date-fns/locale/ru";
import { sv } from "date-fns/locale/sv";
import { zhCN } from "date-fns/locale/zh-CN";
import { formatCurrency, formatNumber, i18n } from "@/i18n/uiCommon";

/**
 * The shared, V1-parity formatters. Each keeps V1's shape - its thresholds, its precision and its
 * unit suffixes - and spells the number and the suffix in the UI's language at call time: the digits
 * through `Intl`, the suffix from the `uiCommon` catalog. None of them groups digits, because the V1
 * strings they reproduce never did ("1400.0M", "$12345.67").
 */

const DATE_FNS_LOCALES: Readonly<Record<string, Locale>> = {
  en: enUS,
  de,
  ja,
  es,
  fr,
  pt: ptBR,
  zh: zhCN,
  ru,
  sv,
  hi,
};

/**
 * The date-fns locale for a UI language (default: the current one), for code that formats dates
 * through date-fns patterns - the calendar (react-day-picker) and the charts' date ticks. English
 * is date-fns's own default, `enUS`, so English output is unchanged ("Su", "September 22nd, 2026").
 */
export function dateFnsLocale(language: string = i18n.language): Locale {
  return DATE_FNS_LOCALES[language] ?? enUS;
}

const BYTE_UNIT_KEYS = ["b", "kb", "mb", "gb", "tb", "pb"] as const;

/**
 * A fixed number of decimals, as `toFixed` writes them, in the current language.
 *
 * Rounded by `toFixed` first and only then spelled by `Intl`, because the two round differently:
 * `toFixed` rounds the binary value (`1.005` is `1.00499…`, so "1.00") where `Intl` rounds its
 * shortest decimal form ("1.01"). Rounding first keeps every figure V1 printed.
 */
const fixedOptions = (digits: number): Intl.NumberFormatOptions => ({
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
  useGrouping: false,
});
const fixed = (value: number, digits: number): string =>
  formatNumber(Number(value.toFixed(digits)), fixedOptions(digits));

/** Formats a byte count into a human-readable string (e.g. 1536 → "1.50 KB").
 *  Non-positive and non-finite values return "0 B". */
export const formatBytes = (bytes: number, precision?: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return i18n.t("uiCommon:format.bytes.b", { value: formatNumber(0) });
  }

  const base = 1024;
  const exponent = Math.floor(Math.log(bytes) / Math.log(base));
  const unitIndex = Math.min(Math.max(exponent, 0), BYTE_UNIT_KEYS.length - 1);
  const value = bytes / Math.pow(base, unitIndex);

  const effectivePrecision = precision ?? (value >= 10 ? 0 : 2);
  return i18n.t(`uiCommon:format.bytes.${BYTE_UNIT_KEYS[unitIndex]}`, {
    value: fixed(value, effectivePrecision),
  });
};

/** V1-parity placeholder for "nothing recorded here" — see {@link formatTokens} and {@link formatCost}. */
export const NO_VALUE = "—";

/** `JobsApp.Helpers.cs` `FormatTimeSpan`: hours drop the seconds, a sub-minute span is seconds only. */
export function formatTimeSpan(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours >= 1) {
    return i18n.t("uiCommon:format.duration.hoursMinutes", {
      hours,
      minutes: String(minutes).padStart(2, "0"),
    });
  }
  if (minutes === 0) return i18n.t("uiCommon:format.duration.seconds", { seconds: secs });
  return i18n.t("uiCommon:format.duration.minutesSeconds", {
    minutes,
    seconds: String(secs).padStart(2, "0"),
  });
}

/**
 * `FormatHelper.FormatTokens`: millions to one decimal, thousands to none, and it keeps scaling.
 * Non-finite or negative values return {@link NO_VALUE} rather than "NaN".
 */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return NO_VALUE;
  if (tokens >= 1_000_000) {
    return i18n.t("uiCommon:format.tokens.millions", { value: fixed(tokens / 1_000_000, 1) });
  }
  if (tokens >= 1_000) {
    return i18n.t("uiCommon:format.tokens.thousands", { value: fixed(tokens / 1_000, 0) });
  }
  // `maximumFractionDigits: 20`, so a (never expected) fractional count reads as `String` wrote it;
  // `+ 0` turns -0 into 0, which `Intl` would write as "-0" where `String` wrote "0".
  return formatNumber(tokens + 0, { useGrouping: false, maximumFractionDigits: 20 });
}

/**
 * `FormatHelper.FormatCost`: two decimals, dollars, in the current language ("$0.12", de "0,12 $").
 * The sign of a (never expected) negative or infinite cost is placed the way `Intl` places it -
 * "-$1.00", "$∞" - where V1 wrote "$-1.00" and "$Infinity".
 */
export function formatCost(cost: number): string {
  return formatCurrency(Number(cost.toFixed(2)), "USD", fixedOptions(2));
}
