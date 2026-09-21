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

  it("floors a negative span to zero", () => {
    expect(formatTimeSpan(-5)).toBe("0s");
  });
});
