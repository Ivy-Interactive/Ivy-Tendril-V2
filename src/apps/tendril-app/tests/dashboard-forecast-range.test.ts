import { describe, expect, it } from "vitest";
import {
  COMPACT_CURRENCY_MAX_CHARS,
  NO_VALUE,
  RANGE_SEPARATOR,
  buildKpis,
  formatCurrencyCompact,
} from "../src/utils/dashboardMetrics";
import type { DashboardActivity, CostForecast } from "../src/types/api";

/**
 * The Forecast This Month card reports both projection bases as a range (`$350k – $1.3M`), and a range
 * is about twice as wide as any other KPI figure while the card it sits in is the same size.
 *
 * The bug: `$1,234,567 – $2,345,678` is nineteen characters, roughly 300px at the value's 30px
 * semibold, against a KPI card whose content box shrinks to about 137px — four cards across, 24px
 * gutters, 24px of card padding each side, in a main column that is the full dashboard width at a
 * ~870px container (`dashboard.css`, `.tdb-kpis`; the same figure recurs just above the 1260px fold).
 * `.tdb-root` sets `overflow-x: hidden`, so this never showed as a figure sticking out of the card. It
 * showed as a shorter number, which is misinformation rather than a blemish.
 *
 * The range stays — it is the point of the card, and V1 had no range at all (`DashboardApp
 * .BuildForecastKpi` prints the calendar basis alone, at `$12345.67`, unseparated and no narrower), so
 * there is nothing to port and this is a V2 design decision. What changes is the width of the numbers,
 * not the presence of the second one.
 *
 * jsdom computes no layout, so what is pinned here is the mechanism: the formatter's character budget,
 * and the separator that decides where the line may break. The CSS half of it — `min-w-0`,
 * `white-space: normal`, no `overflow: hidden` — is pinned in the components package, in
 * `TendrilDashboard/dashboard.css.test.ts`.
 */

const forecast = (overrides: Partial<CostForecast> = {}): CostForecast => ({
  calendarProjection: 100,
  calendarDays: 30,
  activityProjection: 200,
  activityDays: 15,
  totalSpend: 100,
  daysInMonth: 30,
  apiCalendarProjection: 100,
  apiActivityProjection: 200,
  totalApiSpend: 100,
  totalSubsidizedSpend: 0,
  totalApiTokens: 0,
  totalSubsidizedTokens: 0,
  subsidizedTokenPercent: 0,
  subsidizedCostPercent: 0,
  ...overrides,
});

const activity = (overrides: Partial<CostForecast> = {}): DashboardActivity => ({
  months: [],
  prevWeekAvgCost: 0,
  dailyCosts: [],
  dailyPlans: [],
  dailyDataStart: null,
  forecast: forecast(overrides),
});

const forecastValue = (overrides: Partial<CostForecast> = {}): string => {
  const kpi = buildKpis({
    activity: activity(overrides),
    shippedFeatures: [],
    planCosts: [],
  }).find((k) => k.id === "forecastMonth");
  expect(kpi, "the forecast KPI must exist").toBeDefined();
  return kpi!.value;
};

/**
 * The widest the card can ever be asked to render: both bounds at the formatter's ceiling, plus the
 * separator. `$999k – $1.2M` — thirteen characters, about 210px, which fits one line in the two-column
 * band (~304px) and wraps to two lines of at most seven characters (~112px) in the 137px worst case.
 */
const WIDEST = COMPACT_CURRENCY_MAX_CHARS * 2 + RANGE_SEPARATOR.length;

/**
 * The runs of text the line breaker cannot split, i.e. what has to fit on a line. It splits on an
 * ordinary space and *not* on U+00A0, exactly as a browser does.
 */
const unbreakableRuns = (value: string): string[] => value.split(" ");

describe("formatCurrencyCompact", () => {
  it.each<[number, string]>([
    // Under ten dollars the cents are the whole figure, and cost nothing to keep.
    [0, "$0.00"],
    [0.004, "$0.00"],
    [4.2, "$4.20"],
    [9.994, "$9.99"],
    // Rounding up out of a format must move to the next one, never widen the current one.
    [9.995, "$10"],
    [10, "$10"],
    [10.05, "$10.1"],
    [99.94, "$99.9"],
    [99.95, "$100"],
    [123.4, "$123"],
    [999, "$999"],
    [999.4, "$999"],
    // 999.5 is a thousand dollars, and "$1000" would be the fifth digit this format does not have.
    [999.5, "$1k"],
    [1000, "$1k"],
    [1049, "$1k"],
    [1050, "$1.1k"],
    [1234, "$1.2k"],
    [9949, "$9.9k"],
    // Deliberately clear of 9950, whose tenth of a thousand is the binary halfway case `toFixed`
    // resolves downwards. The budget is what matters and holds either way; the exact digit there does
    // not, so pinning it would be pinning IEEE 754 rather than this format.
    [9960, "$10k"],
    [47_312, "$47k"],
    [123_456, "$123k"],
    [999_499, "$999k"],
    // ...and the same carry one unit up: never "$1000k".
    [999_500, "$1M"],
    [1_234_567, "$1.2M"],
    [999_500_000, "$1B"],
    [1_500_000_000_000, "$1.5T"],
  ])("formats %d as %s", (value, expected) => {
    expect(formatCurrencyCompact(value)).toBe(expected);
  });

  /**
   * The character budget is the fix, so it is asserted over a sweep rather than at the handful of
   * boundaries above: a format that is one character wider at some magnitude nobody thought of puts
   * the range back outside the card.
   */
  it("never exceeds its stated width, at any magnitude", () => {
    const seen = new Set<string>();
    for (let exponent = -2; exponent <= 13; exponent += 1) {
      for (const mantissa of [1, 1.005, 1.05, 2.5, 4.999, 5, 9.994, 9.995, 9.999]) {
        const value = mantissa * 10 ** exponent;
        const formatted = formatCurrencyCompact(value);
        seen.add(formatted);
        expect(formatted.length, `${value} formatted as ${formatted}`).toBeLessThanOrEqual(
          COMPACT_CURRENCY_MAX_CHARS,
        );
        // Whatever the rounding, it must still be a currency figure and not scientific notation.
        expect(formatted).toMatch(/^\$\d+(\.\d{1,2})?[kMBT]?$/);
      }
    }
    // A guard on the sweep itself: if the loop stopped producing distinct figures the bound above
    // would pass vacuously.
    expect(seen.size).toBeGreaterThan(20);
  });

  it("returns the no-value dash rather than a bogus figure for a non-finite cost", () => {
    expect(formatCurrencyCompact(Number.NaN)).toBe(NO_VALUE);
    expect(formatCurrencyCompact(Number.POSITIVE_INFINITY)).toBe(NO_VALUE);
  });
});

describe("the forecast range at its widest", () => {
  /** A month of heavy, bursty use: about $350k projected per calendar day basis, $1.3M per active day. */
  const WORST = { calendarProjection: 349_812.44, activityProjection: 1_311_797.06 };

  it("keeps both bounds, because the range is the information the card exists to give", () => {
    const value = forecastValue(WORST);
    expect(value).toBe(`$350k${RANGE_SEPARATOR}$1.3M`);
  });

  it("fits the budget the card was designed against", () => {
    const value = forecastValue(WORST);
    expect(value.length).toBeLessThanOrEqual(WIDEST);
    // Thirteen characters, i.e. about 210px. Stated so a future format change that stays under the
    // computed bound but doubles the figure widths still trips something.
    expect(value.length).toBe(13);
  });

  it("offers exactly one break, after the dash, so a wrapped line never starts with a minus", () => {
    const value = forecastValue(WORST);
    const runs = unbreakableRuns(value);
    expect(runs).toHaveLength(2);
    // The dash travels with the lower bound: `$350k –` then `$1.3M`, never `$350k` then `– $1.3M`,
    // which reads as a negative amount.
    expect(runs[0]).toBe("$350k\u00a0\u2013");
    expect(runs[1]).toBe("$1.3M");
    // Each line is at most the ceiling plus the glued dash: about 112px against a 137px content box.
    for (const run of runs) {
      expect(run.length).toBeLessThanOrEqual(COMPACT_CURRENCY_MAX_CHARS + 2);
    }
  });

  it("glues the dash with a non-breaking space and separates it with an ordinary one", () => {
    // Both halves matter and neither is decoration: symmetrical ordinary spaces give the breaker two
    // choices, symmetrical non-breaking ones give it none and the range can only overflow.
    expect(RANGE_SEPARATOR).toBe("\u00a0\u2013 ");
  });
});

describe("the forecast card's other states", () => {
  it("shows one figure when rounding brings the two bases together", () => {
    // `$1.2k – $1.2k` claims a band it cannot show. The bases also coincide exactly whenever every day
    // in the window had spend, which is the common case for a busy month.
    expect(forecastValue({ calendarProjection: 1201, activityProjection: 1249 })).toBe("$1.2k");
    expect(forecastValue({ calendarProjection: 500, activityProjection: 500 })).toBe("$500");
  });

  it("still reports a range when the two bases round apart by one step", () => {
    expect(forecastValue({ calendarProjection: 1201, activityProjection: 1251 })).toBe(
      `$1.2k${RANGE_SEPARATOR}$1.3k`,
    );
  });

  it("shows the no-data dash rather than a projection of nothing", () => {
    expect(forecastValue({ calendarProjection: null, activityProjection: null })).toBe(NO_VALUE);
    // One basis without the other is not half a range: it is no range.
    expect(forecastValue({ calendarProjection: 100, activityProjection: null })).toBe(NO_VALUE);
  });
});
