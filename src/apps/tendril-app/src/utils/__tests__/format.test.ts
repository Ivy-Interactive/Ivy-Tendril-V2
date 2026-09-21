import { describe, expect, it } from "vitest";
import { NO_VALUE, formatCost, formatTimeSpan, formatTokens, formatTokensCompact } from "../format";

/**
 * These formatters existed four times over — `views/jobs/format.ts`, `JobSessionView`,
 * `PullRequestsView` and `utils/dashboardMetrics` — and the copies had drifted rather than merely
 * repeated. This file pins the resolved behaviour, and specifically the inputs where the copies
 * disagreed, because a passing suite that never evaluates the disputed input is what let them drift
 * in the first place: the Jobs suite tested 450, 45_000 and 1_400_000, all of which every copy
 * already agreed on.
 */

describe("formatTimeSpan", () => {
  // `JobsApp.Helpers.cs` `FormatTimeSpan`. All four copies agreed here; this pins the shape so the
  // single remaining implementation cannot drift silently.
  it("drops the seconds past an hour and the minutes below one", () => {
    expect(formatTimeSpan(45)).toBe("45s");
    expect(formatTimeSpan(90)).toBe("1m 30s");
    expect(formatTimeSpan(3600)).toBe("1h 00m");
    expect(formatTimeSpan(3_725)).toBe("1h 02m");
  });

  // The `Math.max(0, ...)` guard. `agentOutputLabel` and `formatTimer` both feed this a difference
  // between two clocks, and a job whose `startedAt` is a few milliseconds ahead of the local clock
  // would otherwise render "-1s" — a count *down* in a column that only ever counts up.
  it("floors a negative span at zero rather than rendering a negative clock", () => {
    expect(formatTimeSpan(-5)).toBe("0s");
    expect(formatTimeSpan(-0.4)).toBe("0s");
  });

  // Truncation, not rounding: a span is seconds elapsed, and 59.9s has not been a minute yet.
  it("truncates a fractional second", () => {
    expect(formatTimeSpan(59.9)).toBe("59s");
  });
});

describe("formatTokens", () => {
  // V1's `FormatHelper.FormatTokens`, which the Jobs table and the job output sheet both render.
  it("keeps V1's uppercase ladder and scales past a million rather than saturating", () => {
    expect(formatTokens(450)).toBe("450");
    expect(formatTokens(45_000)).toBe("45K");
    expect(formatTokens(1_400_000)).toBe("1.4M");
    expect(formatTokens(1_400_000_000)).toBe("1400.0M");
  });

  /**
   * The boundary the `PullRequestsView` copy got wrong. It tested `> 1000` where every other copy
   * tested `>= 1000`, so exactly one thousand tokens fell through the ladder entirely and printed
   * the bare `1000`.
   */
  it("enters the thousands ladder at exactly one thousand", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_000)).toBe("1K");
  });

  // A count that is not a count. Rendering `NaN` or a negative figure in a Tokens cell states
  // something about the run that is not true; the em dash says only that we do not know.
  it("reports a non-finite or negative count as absent", () => {
    expect(formatTokens(Number.NaN)).toBe(NO_VALUE);
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe(NO_VALUE);
    expect(formatTokens(-1)).toBe(NO_VALUE);
  });
});

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

describe("formatCost", () => {
  // `FormatHelper.FormatCost`. Zero is a figure here too: `formatJobCost` returns `null` for a job
  // with no cost at all, which is what distinguishes it from a job that was billed nothing.
  it("is always two decimals, including at zero", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatCost(1.235)).toBe("$1.24");
  });
});
