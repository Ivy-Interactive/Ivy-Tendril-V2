/**
 * The scalar formatters more than one surface renders with.
 *
 * Each of these existed three or four times over — `views/jobs/format.ts`, `JobSessionView`,
 * `PullRequestsView` and `utils/dashboardMetrics` each carried its own copy — and the copies had
 * drifted apart rather than merely repeating each other. `views/jobs/format.ts` is not the home for
 * them: its own header scopes it to `JobsApp.Helpers.cs`' cell formatters, it is reached through
 * `views/`, and `utils/dashboardMetrics` importing out of a view would invert the one layering rule
 * this app does keep (nothing under `utils/` reaches into `views/`). So they sit here beside
 * `jobStatus`, `prStatus` and `rollingAverage`, which is where this app already puts a helper that
 * several views share, and the callers that had their own copies import from here.
 *
 * Nothing in this module knows what a `Job` or a `PrStatus` is: these take numbers and return
 * strings. The formatters that read a DTO field — `formatJobCost`, `formatTimer` — stay with the
 * surface that owns that DTO and call through to these.
 */

/**
 * The dash an unknown value renders as, from `JobsApp.Data.cs` / `JobCostSheet.cs`.
 *
 * Never `"$0.00"` and never an empty cell, because both are claims: a job that reported no cost and
 * a job that cost nothing are different facts, and a run on a subscription plan reports tokens and
 * no charge at all.
 *
 * V1's cell is literally `""`. The em dash is a deliberate deviation: V1's table draws a visible
 * grid, so an empty Cost cell under a `Cost` header is unambiguous, whereas V2's rows are separated
 * by whitespace and an empty cell reads as a figure that has not landed yet.
 */
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
 * `FormatHelper.FormatTokens`: millions to one decimal, thousands to none.
 *
 * A million-plus count keeps scaling rather than saturating, so a 1.4-billion-token run reads
 * "1400.0M" exactly as V1's `(tokens / 1_000_000.0).ToString("F1")` does. A non-finite or negative
 * count is not a token count at all and is reported as absent rather than as "NaN" or "-5".
 *
 * This is the **Jobs table's** format, uppercase `K` and all, and it is deliberately not the one
 * {@link formatTokensCompact} renders. The Jobs surfaces are a V1 parity port and their cells are
 * pinned against V1's own strings; the Dashboard's KPI card is a V2 design with a character budget.
 * Collapsing the two into one string would silently restyle whichever surface lost, so what is
 * shared here is the implementation, not the typography.
 */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return NO_VALUE;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

/**
 * The Dashboard's token ladder: millions to one decimal, thousands to one, lower-case units.
 *
 * The counterpart to `dashboardMetrics.formatCurrencyCompact`, and it renders in the two places that
 * sit beside a compact currency figure — the Tokens Consumed KPI and the Pull Requests table's
 * Tokens column, whose own copy said it was "the Dashboard's format, so the app has one token format
 * rather than two" and then was not. That copy had drifted in three ways, all fixed by routing it
 * here: it tested `> 1000` rather than `>= 1000`, so exactly one thousand tokens printed the bare
 * `1000` and skipped the ladder entirely; it had **no millions branch at all**, so a 1.4M-token plan
 * read `1400.0k`; and it was the only one of the four with no guard against a non-finite input.
 *
 * The negative and non-finite guard is {@link formatTokens}' — the one behaviour the Jobs copies had
 * and this one lacked. A caller that wants a blank rather than a dash below some floor (the Pull
 * Requests table wants exactly that, matching its cost column's `costValue > 0`) guards at its own
 * call site: that is a decision about an empty cell, not about how a number is spelled.
 */
export function formatTokensCompact(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return NO_VALUE;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

/** `FormatHelper.FormatCost`: two decimals, dollars. */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}
