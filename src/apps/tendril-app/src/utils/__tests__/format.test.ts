import { describe, expect, it } from "vitest";
import { NO_VALUE, formatTokensCompact } from "../format";

/**
 * `formatTokensCompact` is the one formatter this app owns; `NO_VALUE`, `formatTimeSpan`,
 * `formatTokens` and `formatCost` are `@ivy-interactive/components`' and are covered by
 * `lib/formatters.test.ts`.
 *
 * These formatters existed four times over — `views/jobs/format.ts`, `JobSessionView`,
 * `PullRequestsView` and `utils/dashboardMetrics` — and the copies had drifted rather than merely
 * repeated. What is pinned here is the input where the copies disagreed, because a passing suite
 * that never evaluates the disputed input is what let them drift in the first place: the Jobs suite
 * tested 450, 45_000 and 1_400_000, all of which every copy already agreed on.
 */

describe("formatTokensCompact", () => {
  /**
   * The Dashboard's ladder, and the one the Pull Requests table meant to use. Its own copy had no
   * millions branch at all, so a 1.4M-token plan read `1400.0k` in that column while the Dashboard
   * card it was copied from read `1.4M` for the same number. **This is the one user-visible change
   * in this consolidation.**
   */
  it("carries into millions instead of running the thousands ladder forever", () => {
    expect(formatTokensCompact(160_000)).toBe("160.0k");
    expect(formatTokensCompact(1_400_000)).toBe("1.4M");
    expect(formatTokensCompact(1_400_000_000)).toBe("1400.0M");
  });

  // Same off-by-one as above: the copy this replaces printed `1000` for exactly one thousand.
  it("enters the thousands ladder at exactly one thousand", () => {
    expect(formatTokensCompact(900)).toBe("900");
    expect(formatTokensCompact(999)).toBe("999");
    expect(formatTokensCompact(1_000)).toBe("1.0k");
  });

  // The guard the Jobs copies had and this one did not.
  it("reports a non-finite or negative count as absent", () => {
    expect(formatTokensCompact(Number.NaN)).toBe(NO_VALUE);
    expect(formatTokensCompact(-1)).toBe(NO_VALUE);
  });

  /**
   * Zero is a *number*, and this returns it. The old Pull Requests copy folded "no tokens" into the
   * formatter with a `tokens <= 0` guard returning `""`; that decision belongs to the table with the
   * empty cell (`tokensCell`), not to the ladder, because the Dashboard KPI wants to say "0" out
   * loud where the table wants to say nothing.
   */
  it("spells zero rather than deciding the cell should be empty", () => {
    expect(formatTokensCompact(0)).toBe("0");
  });
});
