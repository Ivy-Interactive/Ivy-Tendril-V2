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
import { formatNumber } from "@ivy-interactive/components/i18n";
import { i18n } from "../i18n";

const t = i18n.getFixedT(null, "dashboard");

/** `toFixed(1)`'s shape - one decimal, always, no grouping - in the current language's separator. */
const ONE_DECIMAL: Intl.NumberFormatOptions = {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  useGrouping: false,
};

/**
 * `value` to one decimal, rounded the way `toFixed(1)` rounds it and written the way the current
 * language writes a decimal. The rounding stays `toFixed`'s because `Intl` rounds the *shortest
 * decimal* rather than the binary value (`1.45` → `1.5`, where `toFixed` says `1.4`), and the
 * ladder's figures are pinned in English; only the separator is the language's.
 */
const oneDecimal = (value: number): string => formatNumber(Number(value.toFixed(1)), ONE_DECIMAL);

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
  // The unit is the catalog's (`160.0k` in English), so a language can spell it its own way.
  if (tokens >= 1_000_000) {
    return t("format.tokensCompact.million", { value: oneDecimal(tokens / 1_000_000) });
  }
  if (tokens >= 1_000) {
    return t("format.tokensCompact.thousand", { value: oneDecimal(tokens / 1_000) });
  }
  // `+ 0` so a -0 still reads "0", as `String` wrote it, and not `Intl`'s "-0".
  return formatNumber(tokens + 0);
}
