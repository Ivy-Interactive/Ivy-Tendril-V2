import { describe, it, expect } from "vitest";
import { NO_VALUE, formatCost, formatTimeSpan, formatTokens } from "./formatters";

describe("formatTokens", () => {
  // `FormatHelper.FormatTokens` keeps scaling past a million rather than saturating — pinned by
  // `tendril-app`'s `jobs-view.test.tsx` against V1's own output.
  it("formats tokens the way V1 does", () => {
    expect(formatTokens(450)).toBe("450");
    expect(formatTokens(45_000)).toBe("45K");
    expect(formatTokens(1_400_000)).toBe("1.4M");
    expect(formatTokens(1_400_000_000)).toBe("1400.0M");
  });

  it("returns the placeholder for non-finite or negative values", () => {
    expect(formatTokens(-1)).toBe(NO_VALUE);
    expect(formatTokens(NaN)).toBe(NO_VALUE);
    expect(formatTokens(Infinity)).toBe(NO_VALUE);
  });

  it("formats zero as the bare number", () => {
    expect(formatTokens(0)).toBe("0");
  });

  /**
   * The boundary a since-removed `tendril-app` copy of this ladder got wrong: it tested `> 1000`
   * where this one tests `>= 1000`, so exactly one thousand tokens fell through the ladder and
   * printed the bare `1000`. Pinned here because a suite that only ever evaluates 450 and 45_000 —
   * values every copy already agreed on — is what let that copy drift unnoticed.
   */
  it("enters the thousands ladder at exactly one thousand", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_000)).toBe("1K");
  });
});

describe("formatCost", () => {
  it("formats a cost to two decimals", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(1.234)).toBe("$1.23");
  });
});

describe("formatTimeSpan", () => {
  it("drops seconds once the span reaches an hour", () => {
    expect(formatTimeSpan(3723)).toBe("1h 02m");
  });

  it("shows seconds alone under a minute", () => {
    expect(formatTimeSpan(7)).toBe("7s");
  });

  it("shows minutes and seconds between a minute and an hour", () => {
    expect(formatTimeSpan(184)).toBe("3m 04s");
  });

  // The `Math.max(0, ...)` guard. Callers feed this a difference between two clocks, and a job whose
  // `startedAt` is milliseconds ahead of the local clock would otherwise render "-1s" — a count
  // *down* in a column that only ever counts up.
  it("floors a negative span to zero", () => {
    expect(formatTimeSpan(-5)).toBe("0s");
    expect(formatTimeSpan(-0.4)).toBe("0s");
  });

  // Truncation, not rounding: a span is seconds elapsed, and 59.9s has not been a minute yet.
  it("truncates a fractional second", () => {
    expect(formatTimeSpan(59.9)).toBe("59s");
  });
});
