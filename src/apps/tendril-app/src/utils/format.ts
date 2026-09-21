/**
 * The app-only scalar formatter, and the shared ones it sits beside.
 *
 * `NO_VALUE`, `formatTimeSpan`, `formatTokens` and `formatCost` live in
 * `@ivy-interactive/components` (`lib/formatters.ts`) and are re-exported here rather than
 * reimplemented: an app-level copy of a shared primitive is exactly the drift this module exists to
 * end. Import them from here or from the library — both reach the same function.
 *
 * What is genuinely app-level is {@link formatTokensCompact}, because the Dashboard's typography is
 * a V2 design decision and not a V1 parity constraint. See its own note.
 *
 * Nothing here knows what a `Job` or a `PrStatus` is: these take numbers and return strings. A
 * formatter that reads a DTO field — `formatJobCost`, `formatTimer` — stays with the surface that
 * owns that DTO and calls through to these.
 */
export { NO_VALUE, formatCost, formatTimeSpan, formatTokens } from "@ivy-interactive/components";

import { NO_VALUE } from "@ivy-interactive/components";

/**
 * The Dashboard's token ladder: millions to one decimal, thousands to one, lower-case units.
 *
 * The counterpart to `dashboardMetrics.formatCurrencyCompact`, and it renders in the two places that
 * sit beside a compact currency figure — the Tokens Consumed KPI and the Pull Requests table's
 * Tokens column, whose own copy said it was "the Dashboard's format, so the app has one token format
 * rather than two" and then was not. That copy had drifted in three ways, all fixed by routing it
 * here: it tested `> 1000` rather than `>= 1000`, so exactly one thousand tokens printed the bare
 * `1000` and skipped the ladder entirely; it had **no millions branch at all**, so a 1.4M-token plan
 * read `1400.0k`; and it was the only one with no guard against a non-finite input.
 *
 * Deliberately *not* merged into the shared `formatTokens`, which spells the same magnitudes with an
 * uppercase `K` and no decimal. The Jobs surfaces are a V1 parity port whose cells are pinned
 * against V1's own strings; the Dashboard's KPI card is a V2 design with a character budget.
 * Collapsing the two would silently restyle whichever surface lost, so what is shared is the
 * implementation, not the typography.
 *
 * A caller that wants a blank rather than a dash below some floor (the Pull Requests table wants
 * exactly that, matching its cost column's `costValue > 0`) guards at its own call site: that is a
 * decision about an empty cell, not about how a number is spelled.
 */
export function formatTokensCompact(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return NO_VALUE;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}
