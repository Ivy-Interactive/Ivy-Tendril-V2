//! Tests for the pure calculators in `analytics`, all at a fixed `today` — which is the whole point
//! of them taking the date as an argument rather than reading a clock.

use chrono::{Duration, NaiveDate};
use tendril_core::analytics::{forecast, rolling_average};
use tendril_core::db::dashboard::DashboardDailyCost;

fn date(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").expect("parse date")
}

/// A daily-cost row where total == api and nothing is subsidized, which is the common shape.
fn day(d: NaiveDate, cost: f64) -> DashboardDailyCost {
    DashboardDailyCost {
        date: d.format("%Y-%m-%d").to_string(),
        cost,
        tokens: 100,
        api_cost: cost,
        api_tokens: 100,
        subsidized_cost: 0.0,
        subsidized_tokens: 0,
    }
}

// --- forecast ----------------------------------------------------------------------------------

#[test]
fn calendar_projection_never_exceeds_activity_projection() {
    let today = date("2026-03-20");

    // Several series: dense, sparse, single-day, and one with interleaved zero-cost days.
    let series: Vec<Vec<DashboardDailyCost>> = vec![
        (0..10)
            .map(|i| day(today - Duration::days(i), 5.0))
            .collect(),
        (0..10)
            .map(|i| {
                day(
                    today - Duration::days(i),
                    if i % 3 == 0 { 12.0 } else { 0.0 },
                )
            })
            .collect(),
        vec![day(today, 7.0)],
        (0..29)
            .map(|i| {
                day(
                    today - Duration::days(i),
                    if i % 7 == 0 { 40.0 } else { 0.0 },
                )
            })
            .collect(),
    ];

    for (index, daily) in series.iter().enumerate() {
        let f = forecast::project(daily, today);
        let calendar = f.calendar_projection.expect("calendar projection");
        let activity = f.activity_projection.expect("activity projection");
        assert!(
            calendar <= activity + f64::EPSILON,
            "series {}: calendar {} must not exceed activity {}",
            index,
            calendar,
            activity
        );
        assert!(
            f.activity_days <= f.calendar_days,
            "series {}: activity days are a subset of calendar days",
            index
        );
    }
}

#[test]
fn window_applies_to_days_not_just_divisor() {
    let today = date("2026-03-20");

    // 60 days at $2/day. The window is the trailing 30, so the older 30 must not reach the
    // numerator either — capping only the divisor would divide 60 days of spend by 30.
    let sixty: Vec<DashboardDailyCost> = (0..60)
        .map(|i| day(today - Duration::days(i), 2.0))
        .collect();
    let trailing_thirty: Vec<DashboardDailyCost> = (0..30)
        .map(|i| day(today - Duration::days(i), 2.0))
        .collect();

    let from_sixty = forecast::project(&sixty, today);
    let from_thirty = forecast::project(&trailing_thirty, today);

    assert_eq!(from_sixty.total_spend, from_thirty.total_spend);
    assert_eq!(from_sixty.calendar_days, from_thirty.calendar_days);
    assert_eq!(
        from_sixty.calendar_projection, from_thirty.calendar_projection,
        "a 60-day series projects the same as its trailing 30 days"
    );
    assert_eq!(
        from_sixty.activity_projection,
        from_thirty.activity_projection
    );

    // $2/day over 31 days in March.
    assert_eq!(from_sixty.days_in_month, 31);
    assert_eq!(from_sixty.calendar_projection, Some(62.0));
}

#[test]
fn single_day_series_floors_calendar_days_at_one() {
    let today = date("2026-02-10");

    let f = forecast::project(&[day(today, 9.0)], today);

    assert_eq!(f.calendar_days, 1, "floored at 1, never a fraction");
    assert_eq!(f.activity_days, 1);
    assert_eq!(f.days_in_month, 28, "February 2026 is not a leap year");
    assert_eq!(f.calendar_projection, Some(9.0 * 28.0));
    assert_eq!(f.activity_projection, Some(9.0 * 28.0));
}

#[test]
fn calendar_days_measured_from_earliest_day_on_record() {
    let today = date("2026-03-20");

    // Five days on record, only the last of which cost anything. Calendar days counts all five, so
    // the calendar basis is materially lower than the activity basis.
    let mut daily: Vec<DashboardDailyCost> = (1..5)
        .map(|i| day(today - Duration::days(i), 0.0))
        .collect();
    daily.push(day(today, 10.0));

    let f = forecast::project(&daily, today);

    assert_eq!(
        f.calendar_days, 5,
        "measured from the earliest day on record, not the earliest day with spend"
    );
    assert_eq!(f.activity_days, 1);
    assert_eq!(f.calendar_projection, Some(10.0 / 5.0 * 31.0));
    assert_eq!(f.activity_projection, Some(10.0 * 31.0));
}

#[test]
fn no_spend_yields_none_projections() {
    let today = date("2026-04-15");

    // Days on record, all of them free. Both projections are None so a caller renders "no data"
    // rather than a confident $0.00 — but the totals are still reported.
    let daily: Vec<DashboardDailyCost> = (0..4)
        .map(|i| day(today - Duration::days(i), 0.0))
        .collect();

    let f = forecast::project(&daily, today);

    assert_eq!(f.calendar_projection, None);
    assert_eq!(f.activity_projection, None);
    assert_eq!(f.calendar_days, 0);
    assert_eq!(f.activity_days, 0);
    assert_eq!(f.total_spend, 0.0, "total spend is still reported");
    assert_eq!(f.days_in_month, 30);
    assert_eq!(f.total_api_tokens, 400);
}

#[test]
fn subsidized_percentages_use_the_greater_token_count() {
    let today = date("2026-03-20");

    // `tokens` under-reports here (10), so the percentage uses api + subsidized (100) instead.
    let daily = vec![DashboardDailyCost {
        date: today.format("%Y-%m-%d").to_string(),
        cost: 4.0,
        tokens: 10,
        api_cost: 3.0,
        api_tokens: 25,
        subsidized_cost: 1.0,
        subsidized_tokens: 75,
    }];

    let f = forecast::project(&daily, today);

    assert_eq!(f.subsidized_token_percent, 75.0);
    assert_eq!(f.subsidized_cost_percent, 25.0);
    assert_eq!(f.api_calendar_projection, Some(3.0 * 31.0));
    assert_eq!(f.api_activity_projection, Some(3.0 * 31.0));
}

// --- rolling average ---------------------------------------------------------------------------

#[test]
fn rolling_average_expands_below_seven_days() {
    let start = date("2026-03-01");
    let dates: Vec<NaiveDate> = (0..3).map(|i| start + Duration::days(i)).collect();

    // 3, 6, 9 on the three days; history is shorter than the window, so the mean expands.
    let averages = rolling_average::compute(
        &dates,
        |d| ((d - start).num_days() as f64 + 1.0) * 3.0,
        Some(start),
    );

    assert_eq!(averages, vec![Some(3.0), Some(4.5), Some(6.0)]);
}

#[test]
fn rolling_average_is_none_before_data_start() {
    let data_start = date("2026-03-05");
    let dates: Vec<NaiveDate> = (0..4)
        .map(|i| date("2026-03-03") + Duration::days(i))
        .collect();

    let averages = rolling_average::compute(&dates, |_| 10.0, Some(data_start));

    assert_eq!(
        averages,
        vec![None, None, Some(10.0), Some(10.0)],
        "pre-data days are None so the line breaks rather than dropping to zero"
    );

    let all_none = rolling_average::compute(&dates, |_| 10.0, None);
    assert_eq!(all_none, vec![None, None, None, None], "no data at all");
}

#[test]
fn rolling_average_zero_fills_recorded_gap_days() {
    let start = date("2026-03-01");
    let dates: Vec<NaiveDate> = (0..7).map(|i| start + Duration::days(i)).collect();

    // Only the first day has a value; the caller zero-fills the rest, so the mean decays instead of
    // holding at 7.0.
    let averages =
        rolling_average::compute(&dates, |d| if d == start { 7.0 } else { 0.0 }, Some(start));

    assert_eq!(averages[0], Some(7.0));
    assert_eq!(averages[1], Some(3.5));
    assert_eq!(
        averages[6],
        Some(1.0),
        "7.0 spread over the full 7-day window"
    );
}

#[test]
fn rolling_average_uses_the_six_leading_days_outside_dates() {
    let data_start = date("2026-02-01");
    // One displayed day, well after data_start: the window reaches six days before it, all of which
    // sit outside `dates` and must still be sampled.
    let dates = vec![date("2026-03-10")];

    // `compute` takes an `Fn`, so the recorder needs interior mutability.
    let sampled = std::cell::RefCell::new(Vec::new());
    let averages = rolling_average::compute(
        &dates,
        |d| {
            sampled.borrow_mut().push(d);
            6.0
        },
        Some(data_start),
    );

    assert_eq!(averages, vec![Some(6.0)]);
    let sampled = sampled.into_inner();
    assert_eq!(sampled.len(), 7, "the date itself plus six leading days");
    assert_eq!(sampled.first(), Some(&date("2026-03-04")));
    assert_eq!(sampled.last(), Some(&date("2026-03-10")));
}
