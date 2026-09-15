//! A month's spend projected two ways, both reported rather than one picked.

use crate::db::dashboard::DashboardDailyCost;
use chrono::{Datelike, Duration, Months, NaiveDate};
use serde::{Deserialize, Serialize};

/// The month this projects, at most. Caps a longer history: the series the dashboard supplies
/// reaches back a good deal further than this, for the trend chart's benefit.
pub const FORECAST_WINDOW_DAYS: i64 = 30;

/// A month's spend projected two ways, both reported rather than one picked. Neither is right on
/// its own: the calendar basis assumes the idle days keep coming, the activity basis assumes every
/// day is a working day, and for bursty usage the gap between them is the actual uncertainty.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostForecast {
    /// Spend per calendar day, times the days in the month. The lower bound. `None` when there is
    /// no spend to project from, so a caller renders "no data" rather than a confident $0.00.
    pub calendar_projection: Option<f64>,
    /// Calendar days of history the projection divided by. 0 when there is none.
    pub calendar_days: i64,
    /// Spend per day that had spend, times the days in the month. The upper bound, and never below
    /// `calendar_projection` since it divides by a subset of the same days.
    pub activity_projection: Option<f64>,
    /// Days in the window that actually cost something. 0 when none did.
    pub activity_days: i64,
    /// Sum of the supplied days, so the projections can be sanity checked.
    pub total_spend: f64,
    /// The month's length, which is why the same daily rate projects higher in March than February.
    pub days_in_month: i64,
    pub api_calendar_projection: Option<f64>,
    pub api_activity_projection: Option<f64>,
    pub total_api_spend: f64,
    pub total_subsidized_spend: f64,
    pub total_api_tokens: i64,
    pub total_subsidized_tokens: i64,
    pub subsidized_token_percent: f64,
    pub subsidized_cost_percent: f64,
}

/// Days in the month containing `date`.
fn days_in_month(date: NaiveDate) -> i64 {
    let first = NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap_or(date);
    let next = first
        .checked_add_months(Months::new(1))
        .unwrap_or(first + Duration::days(31));
    (next - first).num_days()
}

/// Projects from `daily_costs` as of `today`. Days absent from the list are zero for the calendar
/// basis and invisible to the activity basis, which is the whole difference between the two.
pub fn project(daily_costs: &[DashboardDailyCost], today: NaiveDate) -> CostForecast {
    let days_in_month = days_in_month(today);

    // The window is applied to the days, not just to the divisor. Capping only the divisor would
    // let a longer history divide 60 days of spend by 30, and would break the guarantee that the
    // calendar projection never exceeds the activity one (which rests on the activity days being a
    // subset of the calendar days).
    let cutoff = today - Duration::days(FORECAST_WINDOW_DAYS - 1);
    let window: Vec<(NaiveDate, &DashboardDailyCost)> = daily_costs
        .iter()
        .filter_map(|d| {
            NaiveDate::parse_from_str(&d.date, "%Y-%m-%d")
                .ok()
                .map(|date| (date, d))
        })
        .filter(|(date, _)| *date >= cutoff)
        .collect();

    let total_spend: f64 = window.iter().map(|(_, d)| d.cost).sum();
    let total_api_spend: f64 = window.iter().map(|(_, d)| d.api_cost).sum();
    let total_subsidized_spend: f64 = window.iter().map(|(_, d)| d.subsidized_cost).sum();
    let total_api_tokens: i64 = window.iter().map(|(_, d)| d.api_tokens).sum();
    let total_subsidized_tokens: i64 = window.iter().map(|(_, d)| d.subsidized_tokens).sum();
    let total_tokens: i64 = window
        .iter()
        .map(|(_, d)| d.tokens.max(d.api_tokens + d.subsidized_tokens))
        .sum();

    let subsidized_token_percent = if total_tokens > 0 {
        total_subsidized_tokens as f64 / total_tokens as f64 * 100.0
    } else {
        0.0
    };
    let subsidized_cost_percent = if total_spend > 0.0 {
        total_subsidized_spend / total_spend * 100.0
    } else {
        0.0
    };

    let spend_days = window.iter().filter(|(_, d)| d.cost != 0.0).count() as i64;

    if spend_days == 0 {
        return CostForecast {
            calendar_projection: None,
            calendar_days: 0,
            activity_projection: None,
            activity_days: 0,
            total_spend,
            days_in_month,
            api_calendar_projection: None,
            api_activity_projection: None,
            total_api_spend,
            total_subsidized_spend,
            total_api_tokens,
            total_subsidized_tokens,
            subsidized_token_percent,
            subsidized_cost_percent,
        };
    }

    // Floored at 1: a series whose first record is a few hours old must divide by one day rather
    // than by a fraction, which would project an absurd month. Measured from the earliest day on
    // record, not the earliest day with spend, so a day that cost nothing still counts as observed.
    let earliest = window.iter().map(|(date, _)| *date).min().unwrap_or(today);
    let elapsed = (today - earliest).num_days() + 1;
    let calendar_days = elapsed.max(1);
    let activity_days = spend_days;

    let api_spend_days = window.iter().filter(|(_, d)| d.api_cost != 0.0).count() as i64;
    let (api_calendar_projection, api_activity_projection) = if api_spend_days > 0 {
        (
            Some(total_api_spend / calendar_days as f64 * days_in_month as f64),
            Some(total_api_spend / api_spend_days as f64 * days_in_month as f64),
        )
    } else {
        (None, None)
    };

    CostForecast {
        calendar_projection: Some(total_spend / calendar_days as f64 * days_in_month as f64),
        calendar_days,
        activity_projection: Some(total_spend / activity_days as f64 * days_in_month as f64),
        activity_days,
        total_spend,
        days_in_month,
        api_calendar_projection,
        api_activity_projection,
        total_api_spend,
        total_subsidized_spend,
        total_api_tokens,
        total_subsidized_tokens,
        subsidized_token_percent,
        subsidized_cost_percent,
    }
}
