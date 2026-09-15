/**
 * A trailing mean over calendar days, matching `tendril_core::analytics::rolling_average` exactly.
 *
 * It is reimplemented rather than fetched because the daily series it smooths is already on the
 * client — the trend chart needs all 736 days of it — and shipping a second series alongside would
 * double the payload to say the same thing twice.
 *
 * The `null` semantics are the point. A day before `dataStart` has no average, which is not the same
 * as an average of zero: the first breaks the line, the second draws it along the axis and invents a
 * quiet week that never happened.
 */

/** Days in one window: the date itself plus the six calendar days before it. */
export const ROLLING_WINDOW_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/**
 * Days since the epoch for a `YYYY-MM-DD` date. Parsed as UTC deliberately: a bare date string goes
 * through `Date.parse` as UTC anyway, but appending the time makes that explicit rather than
 * relying on it, and keeps the round-trip through `toIsoDate` on the same footing.
 */
export const toDayNumber = (isoDate: string): number | null => {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / MS_PER_DAY);
};

export const toIsoDate = (dayNumber: number): string =>
  new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);

/** Today as a `YYYY-MM-DD` day number, in UTC to match the daemon's `Utc::now().date_naive()`. */
export const todayDayNumber = (now: Date = new Date()): number =>
  Math.floor(now.getTime() / MS_PER_DAY);

/**
 * Mean of each date and up to six calendar days before it. For history shorter than the window,
 * computes an expanding average from `dataStart`.
 *
 * @param dates Displayed days as `YYYY-MM-DD`. One entry out per entry in.
 * @param valueAt That day's value, zero-filled by the caller so a recorded day with no activity
 *   contributes 0. Called for the six leading days too, which sit outside `dates`.
 * @param dataStart Earliest day records exist for. `null` means there are none, and every entry is
 *   `null`.
 */
export function rollingAverage(
  dates: readonly string[],
  valueAt: (isoDate: string) => number,
  dataStart: string | null,
): (number | null)[] {
  const start = dataStart == null ? null : toDayNumber(dataStart);

  return dates.map((date) => {
    const day = toDayNumber(date);
    if (start == null || day == null || day < start) return null;

    const effectiveStart = Math.max(day - (ROLLING_WINDOW_DAYS - 1), start);
    const dayCount = day - effectiveStart + 1;

    let sum = 0;
    for (let offset = 0; offset < dayCount; offset++) {
      sum += valueAt(toIsoDate(effectiveStart + offset));
    }
    return sum / dayCount;
  });
}
