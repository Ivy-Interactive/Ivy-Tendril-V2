//! A trailing mean over calendar days. Pure like [`super::forecast`]: no clock of its own and no
//! formatting, so the arithmetic can be tested at fixed dates and the caller owns how it reads.

use chrono::{Duration, NaiveDate};

/// Days in one window: the date itself plus the six calendar days before it.
pub const ROLLING_WINDOW_DAYS: i64 = 7;

/// Mean of each date and up to six calendar days before it. For history under seven days, computes
/// an expanding average from `data_start`. `None` where the date is before `data_start` or when
/// `data_start` is `None`.
///
/// * `dates` — the displayed days. One entry out per entry in.
/// * `value_at` — that day's value, zero-filled by the caller so a recorded day with no activity
///   contributes 0. Called for the six leading days too, which sit outside `dates`.
/// * `data_start` — the earliest day records exist for. `None` means there are none, and every
///   entry is `None`.
pub fn compute<F>(
    dates: &[NaiveDate],
    value_at: F,
    data_start: Option<NaiveDate>,
) -> Vec<Option<f64>>
where
    F: Fn(NaiveDate) -> f64,
{
    let mut result = Vec::with_capacity(dates.len());

    for date in dates {
        let Some(start) = data_start else {
            result.push(None);
            continue;
        };
        if *date < start {
            result.push(None);
            continue;
        }

        let window_start = *date - Duration::days(ROLLING_WINDOW_DAYS - 1);
        let effective_start = if window_start < start {
            start
        } else {
            window_start
        };
        let day_count = (*date - effective_start).num_days() + 1;

        let mut sum = 0.0;
        for offset in 0..day_count {
            sum += value_at(effective_start + Duration::days(offset));
        }

        result.push(Some(sum / day_count as f64));
    }

    result
}
