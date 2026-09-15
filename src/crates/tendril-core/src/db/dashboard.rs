//! Dashboard aggregation queries, ported from the original app's `DashboardRepository`.
//!
//! A module of its own rather than more of [`crate::db::costs`]: these queries join `Plans`,
//! `PullRequests` and `Repos`, so they are not costs queries even where they read `Costs`.
//!
//! There is no `ReaderWriterLockSlim` equivalent here. The original held a process-wide read lock
//! because it shared one long-lived `SqliteConnection`; V2 opens a connection per request via
//! [`crate::db::open_database`], which sets WAL and `busy_timeout = 5000`, so SQLite does the
//! locking.

use crate::error::Result;
use chrono::{Datelike, Months, NaiveDate, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// How far back the daily series go: 365 days the trend chart plots, six leading days so its
/// first plotted point has a full 7 day rolling window, and 365 more for the prior-year
/// comparison the long range draws against.
pub const DAILY_TREND_WINDOW_DAYS: i64 = 736;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardMonthStats {
    pub year: i32,
    pub month: u32,
    pub plans_created: i64,
    pub prs_merged: i64,
    pub cost: f64,
    pub tokens: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardDailyCost {
    /// `YYYY-MM-DD`, as SQLite's `DATE()` returns it.
    pub date: String,
    pub cost: f64,
    pub tokens: i64,
    pub api_cost: f64,
    pub api_tokens: i64,
    pub subsidized_cost: f64,
    pub subsidized_tokens: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardDailyPlans {
    pub date: String,
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardActivityStats {
    pub months: Vec<DashboardMonthStats>,
    pub prev_week_avg_cost: f64,
    pub daily_costs: Vec<DashboardDailyCost>,
    pub daily_plans: Vec<DashboardDailyPlans>,
    /// The earliest day records exist for, clamped up to the window start. `None` on an empty
    /// database, which is what makes the rolling average render a gap instead of a false zero.
    pub daily_data_start: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShippedFeatureDay {
    pub date: String,
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentMergedPr {
    pub pr_url: String,
    pub plan_id: i32,
    pub title: String,
    pub repo: Option<String>,
    pub updated: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentPlanCost {
    pub plan_id: i32,
    pub title: String,
    pub state: String,
    pub created: String,
    /// `None` when the plan has no priced cost row at all — distinct from `Some(0.0)`, which is a
    /// plan that genuinely cost nothing.
    pub cost: Option<f64>,
    pub tokens: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCostBreakdown {
    pub agent: String,
    pub cost: f64,
    pub tokens: i64,
    pub plan_count: i64,
}

/// First day of the month `months_back - 1` months before the month containing `today`.
fn first_month_start(today: NaiveDate, months_back: i32) -> NaiveDate {
    let month_start = NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap_or(today);
    let back = u32::try_from(months_back.saturating_sub(1)).unwrap_or(0);
    month_start
        .checked_sub_months(Months::new(back))
        .unwrap_or(month_start)
}

fn window_start(today: NaiveDate) -> NaiveDate {
    today - chrono::Duration::days(DAILY_TREND_WINDOW_DAYS - 1)
}

/// Monthly rollups plus the daily series the trend chart and the forecast are built from.
///
/// `months_back` has no default in Rust; the call sites pass the original's 24.
pub fn get_activity_stats(conn: &Connection, months_back: i32) -> Result<DashboardActivityStats> {
    let today = Utc::now().date_naive();
    let first_month = first_month_start(today, months_back);
    let cutoff = first_month.format("%Y-%m-%d").to_string();

    let mut created: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            r#"
            SELECT strftime('%Y-%m', Created) AS ym, COUNT(*)
            FROM Plans WHERE Created >= ?1 GROUP BY ym
            "#,
        )?;
        let rows = stmt.query_map(params![cutoff], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        for r in rows {
            let (ym, count) = r?;
            created.insert(ym, count);
        }
    }

    let mut prs: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            r#"
            SELECT strftime('%Y-%m', p.Updated) AS ym, COUNT(*)
            FROM PullRequests pr JOIN Plans p ON p.Id = pr.PlanId
            WHERE p.Updated >= ?1 AND p.State = 'Completed'
            GROUP BY ym
            "#,
        )?;
        let rows = stmt.query_map(params![cutoff], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        for r in rows {
            let (ym, count) = r?;
            prs.insert(ym, count);
        }
    }

    let mut monthly_cost: HashMap<String, (f64, i64)> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            r#"
            SELECT strftime('%Y-%m', p.Updated) AS ym,
                   COALESCE(SUM(c.Cost), 0),
                   COALESCE(SUM(c.Tokens), 0)
            FROM Costs c JOIN Plans p ON p.Id = c.PlanId
            WHERE p.Updated >= ?1 AND p.State IN ('Completed', 'Failed', 'Review')
            GROUP BY ym
            "#,
        )?;
        let rows = stmt.query_map(params![cutoff], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        for r in rows {
            let (ym, cost, tokens) = r?;
            monthly_cost.insert(ym, (cost, tokens));
        }
    }

    // Averaged over the plans that could be priced, not over every plan with a Costs row: a
    // subscription run stores NULL, and counting it in the divisor would report an average nobody
    // spent. COUNT(column) skips NULL for us.
    let prev_week_avg_cost: f64 = conn.query_row(
        r#"
        SELECT CASE WHEN COUNT(DISTINCT CASE WHEN c.Cost IS NOT NULL THEN p.Id END) > 0
            THEN COALESCE(SUM(c.Cost), 0)
                 / COUNT(DISTINCT CASE WHEN c.Cost IS NOT NULL THEN p.Id END) ELSE 0 END
        FROM Costs c JOIN Plans p ON p.Id = c.PlanId
        WHERE p.Created >= ?1 AND p.Created < ?2
          AND p.State IN ('Completed', 'Failed', 'Review')
        "#,
        params![
            (today - chrono::Duration::days(13))
                .format("%Y-%m-%d")
                .to_string(),
            (today - chrono::Duration::days(6))
                .format("%Y-%m-%d")
                .to_string(),
        ],
        |row| row.get(0),
    )?;

    let daily_cutoff = window_start(today).format("%Y-%m-%d").to_string();

    // Deliberately unfiltered by p.State: money an Executing plan has spent is already spent, and
    // dropping it is a large part of why the monthly figures above read low. Bucketed on the cost
    // row's own timestamp where it has one, so spend lands on the day it happened rather than the
    // day the plan was last touched.
    let mut daily_costs = Vec::new();
    {
        let mut stmt = conn.prepare(
            r#"
            SELECT DATE(COALESCE(c.LogTimestamp, p.Updated)) AS d,
                   COALESCE(SUM(c.Cost), 0),
                   COALESCE(SUM(c.Tokens), 0),
                   COALESCE(SUM(CASE WHEN c.CostSource IN ('agent', 'computed') OR (c.CostSource IS NULL AND c.Cost > 0) THEN c.Cost ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN c.CostSource IN ('agent', 'computed') OR (c.CostSource IS NULL AND c.Cost > 0) THEN c.Tokens ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN c.CostSource = 'estimated' THEN c.Cost ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN c.CostSource = 'estimated' OR (c.CostSource IS NULL AND (c.Cost IS NULL OR c.Cost = 0)) THEN c.Tokens ELSE 0 END), 0)
            FROM Costs c JOIN Plans p ON p.Id = c.PlanId
            WHERE COALESCE(c.LogTimestamp, p.Updated) >= ?1
            GROUP BY d ORDER BY d
            "#,
        )?;
        let rows = stmt.query_map(params![daily_cutoff], |row| {
            Ok(DashboardDailyCost {
                date: row.get(0)?,
                cost: row.get(1)?,
                tokens: row.get(2)?,
                api_cost: row.get(3)?,
                api_tokens: row.get(4)?,
                subsidized_cost: row.get(5)?,
                subsidized_tokens: row.get(6)?,
            })
        })?;
        for r in rows {
            daily_costs.push(r?);
        }
    }

    let mut daily_plans = Vec::new();
    {
        let mut stmt = conn.prepare(
            r#"
            SELECT DATE(Created) AS d, COUNT(*)
            FROM Plans
            WHERE Created >= ?1
            GROUP BY d ORDER BY d
            "#,
        )?;
        let rows = stmt.query_map(params![daily_cutoff], |row| {
            Ok(DashboardDailyPlans {
                date: row.get(0)?,
                count: row.get(1)?,
            })
        })?;
        for r in rows {
            daily_plans.push(r?);
        }
    }

    // Where the daily series stop being silent about a gap and start meaning it. Clamped up to the
    // retrieval window, because a record older than the window is not in the series either.
    let earliest: Option<String> = conn.query_row(
        r#"
        SELECT MIN(d) FROM (
            SELECT DATE(Created) AS d FROM Plans
            UNION ALL
            SELECT DATE(COALESCE(c.LogTimestamp, p.Updated)) AS d
            FROM Costs c JOIN Plans p ON p.Id = c.PlanId
        )
        "#,
        [],
        |row| row.get(0),
    )?;
    let daily_data_start = earliest.map(|earliest| {
        if earliest.as_str() > daily_cutoff.as_str() {
            earliest
        } else {
            daily_cutoff.clone()
        }
    });

    // Dense: `months_back` entries from the first month, zero-filled from the maps, newest last.
    let mut months = Vec::with_capacity(months_back.max(0) as usize);
    for i in 0..months_back.max(0) {
        let month = first_month
            .checked_add_months(Months::new(i as u32))
            .unwrap_or(first_month);
        let key = month.format("%Y-%m").to_string();
        let (cost, tokens) = monthly_cost.get(&key).copied().unwrap_or((0.0, 0));
        months.push(DashboardMonthStats {
            year: month.year(),
            month: month.month(),
            plans_created: created.get(&key).copied().unwrap_or(0),
            prs_merged: prs.get(&key).copied().unwrap_or(0),
            cost,
            tokens,
        });
    }

    Ok(DashboardActivityStats {
        months,
        prev_week_avg_cost,
        daily_costs,
        daily_plans,
        daily_data_start,
    })
}

/// Features shipped per day, where a feature is a merged pull request or a solved issue.
///
/// A completed plan with three PRs shipped three features; a completed plan that closed an issue
/// without opening a PR shipped one. The `NOT EXISTS` clause keeps the two arms disjoint, so a plan
/// with both a PR and an issue source is counted once per PR and not again.
pub fn get_shipped_features_by_day(conn: &Connection, days: i64) -> Result<Vec<ShippedFeatureDay>> {
    let cutoff = (Utc::now().date_naive() - chrono::Duration::days(days - 1))
        .format("%Y-%m-%d")
        .to_string();

    let mut stmt = conn.prepare(
        r#"
        SELECT d, COUNT(*) AS cnt FROM (
            SELECT DISTINCT DATE(p.Updated) AS d, pr.PrUrl AS k
            FROM PullRequests pr
            JOIN Plans p ON p.Id = pr.PlanId
            WHERE p.Updated >= ?1 AND p.State = 'Completed'
            UNION ALL
            SELECT DATE(p.Updated) AS d, 'plan:' || p.Id AS k
            FROM Plans p
            WHERE p.Updated >= ?1
              AND p.State = 'Completed'
              AND p.SourceUrl LIKE '%/issues/%'
              AND NOT EXISTS (SELECT 1 FROM PullRequests x WHERE x.PlanId = p.Id)
        )
        GROUP BY d
        ORDER BY d
        "#,
    )?;
    let rows = stmt.query_map(params![cutoff], |row| {
        Ok(ShippedFeatureDay {
            date: row.get(0)?,
            count: row.get(1)?,
        })
    })?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r?);
    }
    Ok(results)
}

pub fn get_recent_merged_prs(conn: &Connection, limit: i64) -> Result<Vec<RecentMergedPr>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT pr.PrUrl, p.Id, p.Title,
               (SELECT r.RepoPath FROM Repos r WHERE r.PlanId = p.Id LIMIT 1) AS Repo,
               p.Updated
        FROM PullRequests pr
        JOIN Plans p ON p.Id = pr.PlanId
        WHERE p.State = 'Completed'
        ORDER BY p.Updated DESC
        LIMIT ?1
        "#,
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        Ok(RecentMergedPr {
            pr_url: row.get(0)?,
            plan_id: row.get(1)?,
            title: row.get(2)?,
            repo: row.get(3)?,
            updated: row.get(4)?,
        })
    })?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r?);
    }
    Ok(results)
}

pub fn get_recent_plan_costs(conn: &Connection, days: i64) -> Result<Vec<RecentPlanCost>> {
    let cutoff = (Utc::now().date_naive() - chrono::Duration::days(days - 1))
        .format("%Y-%m-%d")
        .to_string();

    let mut stmt = conn.prepare(
        r#"
        SELECT p.Id, p.Title, p.State, p.Created,
               SUM(c.Cost) AS TotalCost,
               COUNT(CASE WHEN c.Cost IS NOT NULL THEN 1 END) AS PricedRows,
               COALESCE(SUM(c.Tokens), 0) AS TotalTokens
        FROM Plans p
        LEFT JOIN Costs c ON c.PlanId = p.Id
        WHERE p.Created >= ?1 AND p.State IN ('Completed', 'Failed', 'Review')
        GROUP BY p.Id, p.Title, p.State, p.Created
        ORDER BY p.Created DESC
        "#,
    )?;
    let rows = stmt.query_map(params![cutoff], |row| {
        let total_cost: Option<f64> = row.get(4)?;
        let priced_rows: i64 = row.get(5)?;
        Ok(RecentPlanCost {
            plan_id: row.get(0)?,
            title: row.get(1)?,
            state: row.get(2)?,
            created: row.get(3)?,
            // The PricedRows guard: "no priced rows" is `None`, not `Some(0.0)`. A plan whose only
            // cost rows are subscription runs did not cost nothing, it cost an unknown amount.
            cost: if priced_rows > 0 { total_cost } else { None },
            tokens: row.get(6)?,
        })
    })?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r?);
    }
    Ok(results)
}

pub fn get_agent_cost_breakdown(conn: &Connection, days: i64) -> Result<Vec<AgentCostBreakdown>> {
    let cutoff = (Utc::now().date_naive() - chrono::Duration::days(days - 1))
        .format("%Y-%m-%d")
        .to_string();

    let mut stmt = conn.prepare(
        r#"
        SELECT COALESCE(NULLIF(c.Agent, ''), 'Unknown') AS AgentGroup,
               SUM(c.Cost) AS TotalCost,
               COUNT(CASE WHEN c.Cost IS NOT NULL THEN 1 END) AS PricedRows,
               COALESCE(SUM(c.Tokens), 0) AS TotalTokens,
               COUNT(DISTINCT c.PlanId) AS PlanCount
        FROM Costs c
        INNER JOIN Plans p ON p.Id = c.PlanId
        WHERE p.Created >= ?1
        GROUP BY AgentGroup
        ORDER BY TotalCost DESC
        "#,
    )?;
    let rows = stmt.query_map(params![cutoff], |row| {
        let total_cost: Option<f64> = row.get(1)?;
        let priced_rows: i64 = row.get(2)?;
        Ok(AgentCostBreakdown {
            agent: row.get(0)?,
            // Unlike `get_recent_plan_costs`, the original collapses an unpriced group to 0 here
            // rather than to null, because the breakdown's shares have to add up.
            cost: if priced_rows > 0 {
                total_cost.unwrap_or(0.0)
            } else {
                0.0
            },
            tokens: row.get(3)?,
            plan_count: row.get(4)?,
        })
    })?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r?);
    }
    Ok(results)
}
