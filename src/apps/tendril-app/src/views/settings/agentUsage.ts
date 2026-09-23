import {
  formatNumber,
  formatPercent as formatPercentIntl,
  formatRelativeTime,
} from "@ivy-interactive/components/i18n";

import { i18n } from "../../i18n";

/**
 * `Helpers/UsageWindowCalculator.cs` and `FormatHelper.FormatPercent`, the four pure functions the
 * usage strip is written in.
 *
 * They are a second copy of `agents::usage`'s Rust formatters rather than a route that returns
 * pre-formatted strings, deliberately: "resets in 2h 05m" is a countdown, and a snapshot the daemon
 * caches for sixty seconds would be up to a minute wrong the moment it arrived. The daemon reports
 * instants; only the pane knows what time it is when it draws them.
 *
 * They format in the language current when they are called, through `Intl`: a unit in its narrow
 * form is exactly V1's "7d" / "5h" / "45m" in English, and the language's own abbreviation elsewhere.
 */

/** Follows the language at every call, so it is safe to create here. */
const t = i18n.getFixedT(null, "settingsAgents");

/**
 * A number of one unit in its narrow form: `(7, "day")` → "7d" in English.
 *
 * Ungrouped, as V1 printed it: a 1000-minute window is "1000m", not "1,000m".
 */
const narrowUnit = (value: number, unit: "day" | "hour" | "minute", minimumIntegerDigits = 1) =>
  formatNumber(value, {
    style: "unit",
    unit,
    unitDisplay: "narrow",
    minimumIntegerDigits,
    useGrouping: false,
  });

/** `UsageWindowCalculator.FormatWindow`: 10080 -> "7d", 300 -> "5h", 45 -> "45m". */
export function formatWindow(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) return narrowUnit(minutes / 1440, "day");
  if (minutes >= 60 && minutes % 60 === 0) return narrowUnit(minutes / 60, "hour");
  return narrowUnit(minutes, "minute");
}

/**
 * `UsageWindowCalculator.FormatCountdown`: "now", "30m", "2h 05m".
 *
 * An unparseable or absent instant is the empty string, which the caller drops rather than renders -
 * a window whose provider did not say when it rolls over has nothing to count down to.
 */
export function formatCountdown(resetsAt: string, now: Date): string {
  const totalMinutes = minutesUntil(resetsAt, now);
  if (totalMinutes === null) return "";
  if (totalMinutes <= 0) return t("usage.countdown.now");
  if (totalMinutes >= 60) {
    return t("usage.countdown.hoursMinutes", {
      hours: narrowUnit(Math.floor(totalMinutes / 60), "hour"),
      minutes: narrowUnit(totalMinutes % 60, "minute", 2),
    });
  }
  return narrowUnit(totalMinutes, "minute");
}

/**
 * Whole minutes until `resetsAt`, or `null` for an instant that does not parse.
 *
 * Truncated toward zero, matching chrono's `num_minutes`, so a reset thirty seconds away reads
 * "now" rather than rounding up to a minute that has already passed. Zero or less is a window that
 * has rolled over, which the strip words as a sentence of its own.
 */
export function minutesUntil(resetsAt: string, now: Date): number | null {
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return null;
  return Math.trunc((target - now.getTime()) / 60_000);
}

/** `UsageWindowCalculator.FormatRelative`: "just now", "15m ago", "3h ago", "2d ago". */
export function formatRelative(capturedAt: string, now: Date): string {
  const captured = Date.parse(capturedAt);
  if (Number.isNaN(captured)) return "";
  const minutes = Math.trunc((now.getTime() - captured) / 60_000);
  if (minutes < 1) return t("usage.justNow");
  // Whole minutes, hours or days and never weeks, as V1 counts them: `numeric: "always"` keeps
  // "1d ago" rather than "yesterday", and `maxUnit` keeps "45d ago" rather than "1mo ago".
  return formatRelativeTime(captured, {
    now,
    style: "narrow",
    numeric: "always",
    minUnit: "minute",
    maxUnit: "day",
  });
}

/**
 * `FormatHelper.FormatPercent`: `"0.#"`, so at most one decimal and no trailing zero.
 *
 * Rounded here, as V1 rounds it, and only then handed to `Intl` for the language's separator and
 * sign placement. Letting `Intl` round `percent / 100` itself would round the division's binary
 * error rather than the value: 0.35 would be "0.3%" where V1 shows "0.4%". `+ 0` turns a `-0` back
 * into `0`, which `Intl` would otherwise print as "-0%".
 */
export function formatPercent(percent: number): string {
  return formatPercentIntl(Math.round(percent * 10) / 1000 + 0, {
    maximumFractionDigits: 1,
    useGrouping: false,
  });
}

/**
 * How much of a window is left, as V1's `Colors` on both the value text and the bar.
 *
 * The thresholds are V1's exactly: at a tenth left the account is about to stop working, and a
 * quarter is the point at which a long fleet run will not finish inside the window.
 */
export type UsageSeverity = "critical" | "low" | "ok";

export function usageSeverity(remainingPercent: number): UsageSeverity {
  if (remainingPercent <= 10) return "critical";
  if (remainingPercent <= 25) return "low";
  return "ok";
}

/** `DateTimeOffset.UtcNow - cap > TimeSpan.FromMinutes(10)`, the point the strip admits its age. */
export const USAGE_STALE_AFTER_MS = 10 * 60 * 1000;

export function isUsageStale(capturedAt: string, now: Date): boolean {
  const captured = Date.parse(capturedAt);
  if (Number.isNaN(captured)) return false;
  return now.getTime() - captured > USAGE_STALE_AFTER_MS;
}
