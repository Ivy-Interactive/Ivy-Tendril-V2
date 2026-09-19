/**
 * `Helpers/UsageWindowCalculator.cs` and `FormatHelper.FormatPercent`, the four pure functions the
 * usage strip is written in.
 *
 * They are a second copy of `agents::usage`'s Rust formatters rather than a route that returns
 * pre-formatted strings, deliberately: "resets in 2h 05m" is a countdown, and a snapshot the daemon
 * caches for sixty seconds would be up to a minute wrong the moment it arrived. The daemon reports
 * instants; only the pane knows what time it is when it draws them.
 */

/** `UsageWindowCalculator.FormatWindow`: 10080 -> "7d", 300 -> "5h", 45 -> "45m". */
export function formatWindow(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/**
 * `UsageWindowCalculator.FormatCountdown`: "now", "30m", "2h 05m".
 *
 * An unparseable or absent instant is the empty string, which the caller drops rather than renders -
 * a window whose provider did not say when it rolls over has nothing to count down to.
 */
export function formatCountdown(resetsAt: string, now: Date): string {
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return "";
  // Truncated toward zero, matching chrono's `num_minutes`, so a reset thirty seconds away reads
  // "now" rather than rounding up to a minute that has already passed.
  const totalMinutes = Math.trunc((target - now.getTime()) / 60_000);
  if (totalMinutes <= 0) return "now";
  if (totalMinutes >= 60) {
    return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
  }
  return `${totalMinutes}m`;
}

/** `UsageWindowCalculator.FormatRelative`: "just now", "15m ago", "3h ago", "2d ago". */
export function formatRelative(capturedAt: string, now: Date): string {
  const captured = Date.parse(capturedAt);
  if (Number.isNaN(captured)) return "";
  const minutes = Math.trunc((now.getTime() - captured) / 60_000);
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d ago`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes >= 1) return `${minutes}m ago`;
  return "just now";
}

/** `FormatHelper.FormatPercent`: `"0.#"`, so at most one decimal and no trailing zero. */
export function formatPercent(percent: number): string {
  return `${Math.round(percent * 10) / 10}%`;
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
