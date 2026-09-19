import { describe, expect, it } from "vitest";

import {
  formatCountdown,
  formatPercent,
  formatRelative,
  formatWindow,
  isUsageStale,
  usageSeverity,
} from "../agentUsage";

/**
 * The TS half of the formatters `agents::usage`'s Rust tests already pin. Two copies of the same
 * rules is two places to get them wrong, so both are tested against the same examples.
 */

const NOW = new Date("2026-09-19T12:00:00Z");

describe("formatWindow", () => {
  it("names whole days and whole hours, and falls back to minutes", () => {
    expect(formatWindow(10080)).toBe("7d");
    expect(formatWindow(1440)).toBe("1d");
    expect(formatWindow(300)).toBe("5h");
    expect(formatWindow(60)).toBe("1h");
    expect(formatWindow(45)).toBe("45m");
    // 90 minutes is neither a whole day nor a whole hour, so it stays in minutes rather than
    // rounding to "1h" and losing half of itself.
    expect(formatWindow(90)).toBe("90m");
  });
});

describe("formatCountdown", () => {
  it("zero-pads the minutes past an hour", () => {
    expect(formatCountdown("2026-09-19T14:05:00Z", NOW)).toBe("2h 05m");
    expect(formatCountdown("2026-09-19T12:30:00Z", NOW)).toBe("30m");
  });

  it("reads an elapsed or nearly elapsed window as now", () => {
    expect(formatCountdown("2026-09-19T11:00:00Z", NOW)).toBe("now");
    // Thirty seconds truncates to zero minutes, which is "now" rather than a minute that has passed.
    expect(formatCountdown("2026-09-19T12:00:30Z", NOW)).toBe("now");
  });

  it("is empty for an instant it cannot parse, so the caller drops the line", () => {
    expect(formatCountdown("not a date", NOW)).toBe("");
  });
});

describe("formatRelative", () => {
  it("scales from just now to days", () => {
    expect(formatRelative("2026-09-19T11:59:30Z", NOW)).toBe("just now");
    expect(formatRelative("2026-09-19T11:45:00Z", NOW)).toBe("15m ago");
    expect(formatRelative("2026-09-19T09:00:00Z", NOW)).toBe("3h ago");
    expect(formatRelative("2026-09-17T12:00:00Z", NOW)).toBe("2d ago");
  });
});

describe("formatPercent", () => {
  it("keeps at most one decimal and never a trailing zero", () => {
    expect(formatPercent(83.33)).toBe("83.3%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent(12.04)).toBe("12%");
  });
});

describe("usageSeverity", () => {
  it("uses V1's two thresholds, inclusively", () => {
    expect(usageSeverity(10)).toBe("critical");
    expect(usageSeverity(10.1)).toBe("low");
    expect(usageSeverity(25)).toBe("low");
    expect(usageSeverity(25.1)).toBe("ok");
  });
});

describe("isUsageStale", () => {
  it("turns over at ten minutes", () => {
    expect(isUsageStale("2026-09-19T11:51:00Z", NOW)).toBe(false);
    expect(isUsageStale("2026-09-19T11:49:00Z", NOW)).toBe(true);
  });

  it("treats an unparseable capture as fresh rather than shouting about it", () => {
    expect(isUsageStale("", NOW)).toBe(false);
  });
});
