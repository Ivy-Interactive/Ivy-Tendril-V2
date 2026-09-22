import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  formatCompact,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatList,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTime,
} from "../src/i18n/format";
import { getFormatters, parseFormat, selectRelativeTimeUnit } from "../src/i18n/intl";
import { i18nStore } from "../src/i18n/runtime";

/**
 * Formatting through `Intl`, in the language the UI is in rather than the operating system's. Date
 * and time expectations are computed with `Intl` itself, because the exact spacing (a narrow
 * no-break space before "PM", for one) varies between ICU versions; numbers and lists do not.
 */

afterEach(async () => {
  await i18nStore.changeLanguage("en");
});

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);

describe("selectRelativeTimeUnit", () => {
  it.each([
    [0, 0, "second"],
    [-45 * SECOND, -45, "second"],
    [-59 * SECOND, -59, "second"],
    [-60 * SECOND, -1, "minute"],
    [-59 * MINUTE, -59, "minute"],
    [-119 * MINUTE, -1, "hour"],
    [-23 * HOUR, -23, "hour"],
    [-36 * HOUR, -1, "day"],
    [-6 * DAY, -6, "day"],
    [-13 * DAY, -1, "week"],
    [-29 * DAY, -4, "week"],
    [-45 * DAY, -1, "month"],
    [-364 * DAY, -11, "month"],
    [-400 * DAY, -1, "year"],
    [-3 * 366 * DAY, -3, "year"],
    [90 * MINUTE, 1, "hour"],
    [3 * DAY, 3, "day"],
  ] as const)("reads %d ms as %d %s", (deltaMs, value, unit) => {
    expect(selectRelativeTimeUnit(deltaMs)).toEqual({ value, unit });
  });

  it("counts whole units only, truncating toward zero rather than rounding up", () => {
    expect(selectRelativeTimeUnit(-(2 * HOUR - 1))).toEqual({ value: -1, unit: "hour" });
    expect(selectRelativeTimeUnit(-(60 * SECOND - 1))).toEqual({ value: -59, unit: "second" });
  });

  it("never reports negative zero", () => {
    expect(Object.is(selectRelativeTimeUnit(-500).value, 0)).toBe(true);
  });

  it("honours minUnit and maxUnit", () => {
    expect(selectRelativeTimeUnit(-45 * DAY, { maxUnit: "day" })).toEqual({
      value: -45,
      unit: "day",
    });
    expect(selectRelativeTimeUnit(-30 * SECOND, { minUnit: "minute" })).toEqual({
      value: 0,
      unit: "minute",
    });
    expect(selectRelativeTimeUnit(-3 * HOUR, { minUnit: "minute", maxUnit: "minute" })).toEqual({
      value: -180,
      unit: "minute",
    });
  });
});

describe("relative time", () => {
  const relative = (deltaMs: number, options = {}) =>
    getFormatters("en").relativeTime(NOW + deltaMs, { now: NOW, ...options });

  it("picks the best unit, from seconds to years", () => {
    expect(relative(-10 * SECOND)).toBe("10 seconds ago");
    expect(relative(-5 * MINUTE)).toBe("5 minutes ago");
    expect(relative(-3 * HOUR)).toBe("3 hours ago");
    expect(relative(-3 * DAY)).toBe("3 days ago");
    expect(relative(-15 * DAY)).toBe("2 weeks ago");
    expect(relative(-90 * DAY)).toBe("2 months ago");
    expect(relative(-800 * DAY)).toBe("2 years ago");
    expect(relative(3 * HOUR)).toBe("in 3 hours");
  });

  it("uses the idiomatic phrase where the language has one, unless told to keep the number", () => {
    expect(relative(0)).toBe("now");
    expect(relative(-1 * DAY)).toBe("yesterday");
    expect(relative(-1 * DAY, { numeric: "always" })).toBe("1 day ago");
  });

  it("keeps a span shorter than one unit in the past, with or without the idiomatic phrase", () => {
    expect(relative(-300)).toBe("now");
    expect(relative(-300, { numeric: "always" })).toBe("0 seconds ago");
    expect(relative(-20 * SECOND, { minUnit: "minute", numeric: "always" })).toBe("0 minutes ago");
    expect(relative(20 * SECOND, { minUnit: "minute", numeric: "always" })).toBe("in 0 minutes");
    expect(relative(-20 * SECOND, { minUnit: "minute", numeric: "always", style: "narrow" })).toBe(
      "0m ago",
    );
  });

  it("offers the narrow style the hand-rolled 'Nm ago' strings used", () => {
    expect(relative(-5 * MINUTE, { style: "narrow" })).toBe("5m ago");
    expect(relative(-3 * HOUR, { style: "narrow" })).toBe("3h ago");
    expect(relative(-45 * DAY, { style: "narrow", maxUnit: "day" })).toBe("45d ago");
  });

  it("renders narrow as short where the language's narrow form is a bare signed number", () => {
    const narrow = (language: "fr" | "ru" | "sv" | "de" | "es") =>
      getFormatters(language).relativeTime(NOW - 3 * HOUR, {
        now: NOW,
        style: "narrow",
        numeric: "always",
      });
    const intl = (locale: string, style: Intl.RelativeTimeFormatStyle) =>
      new Intl.RelativeTimeFormat(locale, { style, numeric: "always" }).format(-3, "hour");

    // Intl's narrow forms here are "-3 h", "-3 ч" and "−3 h", which read as arithmetic in a
    // sentence; their short forms are phrases ("il y a 3 h").
    for (const language of ["fr", "ru", "sv"] as const) {
      expect(intl(language, "narrow")).toMatch(/^[-\u2212]/);
      expect(narrow(language)).toBe(intl(language, "short"));
    }
    // Where the narrow form is a phrase, it is kept.
    expect(narrow("de")).toBe(intl("de", "narrow"));
    expect(narrow("es")).toBe(intl("es", "narrow"));
  });

  it("speaks the language it is asked for", () => {
    expect(getFormatters("de").relativeTime(NOW - 3 * HOUR, { now: NOW })).toBe("vor 3 Stunden");
    expect(
      getFormatters("ru").relativeTime(NOW - 5 * MINUTE, { now: NOW, numeric: "always" }),
    ).toBe("5 минут назад");
    expect(getFormatters("ja").relativeTime(NOW - 3 * DAY, { now: NOW })).toBe("3 日前");
  });

  it("accepts a Date, epoch milliseconds or an ISO string, and returns nothing for an invalid one", () => {
    const iso = new Date(NOW - 5 * MINUTE).toISOString();
    expect(getFormatters("en").relativeTime(iso, { now: NOW })).toBe("5 minutes ago");
    expect(
      getFormatters("en").relativeTime(new Date(NOW - 5 * MINUTE), { now: new Date(NOW) }),
    ).toBe("5 minutes ago");
    expect(getFormatters("en").relativeTime("not a date", { now: NOW })).toBe("");
  });
});

describe("number, currency and list formatters", () => {
  it("formats in each language's conventions", () => {
    expect(getFormatters("en").number(1234.5)).toBe("1,234.5");
    expect(getFormatters("de").number(1234.5)).toBe("1.234,5");
    expect(getFormatters("hi").number(1234567.5)).toBe("12,34,567.5");
    expect(getFormatters("en").percent(0.25)).toBe("25%");
    expect(getFormatters("en").currency(3.5)).toBe("$3.50");
    expect(getFormatters("en").currency(3.5, "EUR")).toBe("€3.50");
    expect(getFormatters("en").compact(1234)).toBe("1.2K");
    expect(getFormatters("ja").compact(25_000)).toBe("2.5万");
    expect(getFormatters("en").list(["a", "b", "c"])).toBe("a, b, and c");
    expect(getFormatters("en").list(["a", "b"], { type: "disjunction" })).toBe("a or b");
    expect(getFormatters("ja").list(["a", "b", "c"])).toBe("a、b、c");
  });

  it("lets options override the defaults", () => {
    expect(getFormatters("en").number(1.2345, { maximumFractionDigits: 2 })).toBe("1.23");
    expect(getFormatters("en").currency(1234, "USD", { maximumFractionDigits: 0 })).toBe("$1,234");
    expect(getFormatters("en").compact(1234, { maximumFractionDigits: 0 })).toBe("1K");
  });

  it("builds each language's formatters once", () => {
    expect(getFormatters("de")).toBe(getFormatters("de"));
    expect(getFormatters("de")).not.toBe(getFormatters("en"));
  });
});

describe("date and time formatters", () => {
  const moment = new Date(Date.UTC(2026, 8, 22, 15, 4));
  const intl = (language: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(language, options).format(moment);

  it("defaults to a medium date, a short time, and both", () => {
    expect(getFormatters("en").date(moment)).toBe(intl("en", { dateStyle: "medium" }));
    expect(getFormatters("en").time(moment)).toBe(intl("en", { timeStyle: "short" }));
    expect(getFormatters("en").dateTime(moment)).toBe(
      intl("en", { dateStyle: "medium", timeStyle: "short" }),
    );
    expect(getFormatters("pt").date(moment)).toBe(intl("pt-BR", { dateStyle: "medium" }));
  });

  it("keeps the defaults when options only set the time zone", () => {
    expect(getFormatters("en").date(moment, { timeZone: "UTC" })).toBe("Sep 22, 2026");
    expect(getFormatters("de").date(moment, { timeZone: "UTC" })).toBe("22.09.2026");
  });

  it("uses exactly the parts the caller names, without the defaults", () => {
    expect(getFormatters("en").date(moment, { month: "long", timeZone: "UTC" })).toBe("September");
    expect(
      getFormatters("en").date(moment, { month: "short", day: "numeric", timeZone: "UTC" }),
    ).toBe("Sep 22");
  });

  it("returns nothing for a date it cannot read", () => {
    expect(getFormatters("en").date("garbage")).toBe("");
    expect(getFormatters("en").time(Number.NaN)).toBe("");
  });
});

describe("current-language formatters", () => {
  it("read the language at call time", async () => {
    expect(formatNumber(1234.5)).toBe("1,234.5");
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatCurrency(2)).toBe("$2.00");
    expect(formatCompact(2_500_000)).toBe("2.5M");
    expect(formatList(["x", "y"])).toBe("x and y");

    await i18nStore.changeLanguage("de");
    expect(formatNumber(1234.5)).toBe("1.234,5");
    expect(formatList(["x", "y"])).toBe("x und y");
    expect(formatDate(Date.UTC(2026, 8, 22), { timeZone: "UTC" })).toBe("22.09.2026");
    expect(formatTime(Date.UTC(2026, 8, 22, 15, 4), { timeZone: "UTC" })).toBe("15:04");
    expect(formatDateTime(Date.UTC(2026, 8, 22, 15, 4), { timeZone: "UTC" })).toBe(
      "22.09.2026, 15:04",
    );
    expect(formatRelativeTime(NOW - 2 * DAY, { now: NOW })).toBe("vorgestern");
  });
});

describe("parseFormat", () => {
  it("reads i18next's format syntax", () => {
    expect(parseFormat("number")).toEqual({ name: "number", options: {} });
    expect(parseFormat(" DateTime ")).toEqual({ name: "datetime", options: {} });
    expect(parseFormat("currency(EUR)")).toEqual({
      name: "currency",
      options: { currency: "EUR" },
    });
    expect(parseFormat("number(minimumFractionDigits: 2; useGrouping: false)")).toEqual({
      name: "number",
      options: { minimumFractionDigits: 2, useGrouping: false },
    });
    expect(parseFormat("date(month: 'long')")).toEqual({
      name: "date",
      options: { month: "long" },
    });
  });
});
