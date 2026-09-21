/** Formats a byte count into a human-readable string (e.g. 1536 → "1.50 KB").
 *  Non-positive and non-finite values return "0 B". */
export const formatBytes = (bytes: number, precision?: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const base = 1024;
  const exponent = Math.floor(Math.log(bytes) / Math.log(base));
  const unitIndex = Math.min(Math.max(exponent, 0), units.length - 1);
  const value = bytes / Math.pow(base, unitIndex);

  const effectivePrecision = precision ?? (value >= 10 ? 0 : 2);
  return `${value.toFixed(effectivePrecision)} ${units[unitIndex]}`;
};

/** V1-parity placeholder for "nothing recorded here" — see {@link formatTokens} and {@link formatCost}. */
export const NO_VALUE = "—";

/** `JobsApp.Helpers.cs` `FormatTimeSpan`: hours drop the seconds, a sub-minute span is seconds only. */
export function formatTimeSpan(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours >= 1) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes === 0) return `${secs}s`;
  return `${minutes}m ${String(secs).padStart(2, "0")}s`;
}

/**
 * `FormatHelper.FormatTokens`: millions to one decimal, thousands to none, and it keeps scaling.
 * Non-finite or negative values return {@link NO_VALUE} rather than "NaN".
 */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return NO_VALUE;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

/** `FormatHelper.FormatCost`: two decimals, dollars. */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}
