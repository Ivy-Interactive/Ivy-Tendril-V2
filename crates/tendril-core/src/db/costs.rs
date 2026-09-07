use crate::error::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostsSummary {
    pub total_spend: f64,
    pub thirty_day_spend: f64,
    pub seven_day_spend: f64,
    pub daily_run_rate: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostSeriesPoint {
    pub period: String,
    pub cost: f64,
    pub tokens: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostRecord {
    pub id: i64,
    pub plan_id: i32,
    pub promptware: String,
    pub tokens: i64,
    pub cost: f64,
    pub log_timestamp: Option<String>,
}

pub fn insert_cost(
    conn: &Connection,
    plan_id: i32,
    promptware: &str,
    tokens: i64,
    cost: f64,
    log_timestamp: Option<&str>,
) -> Result<i64> {
    conn.execute(
        r#"
        INSERT INTO Costs (PlanId, Promptware, Tokens, Cost, LogTimestamp)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
        params![plan_id, promptware, tokens, cost, log_timestamp],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_costs_summary(conn: &Connection) -> Result<CostsSummary> {
    let total_spend: f64 =
        conn.query_row("SELECT COALESCE(SUM(Cost), 0.0) FROM Costs", [], |row| {
            row.get(0)
        })?;

    let thirty_day_spend: f64 = conn.query_row(
        "SELECT COALESCE(SUM(Cost), 0.0) FROM Costs WHERE datetime(COALESCE(LogTimestamp, datetime('now'))) >= datetime('now', '-30 days')",
        [],
        |row| row.get(0),
    )?;

    let seven_day_spend: f64 = conn.query_row(
        "SELECT COALESCE(SUM(Cost), 0.0) FROM Costs WHERE datetime(COALESCE(LogTimestamp, datetime('now'))) >= datetime('now', '-7 days')",
        [],
        |row| row.get(0),
    )?;

    let daily_run_rate = if seven_day_spend > 0.0 {
        seven_day_spend / 7.0
    } else if thirty_day_spend > 0.0 {
        thirty_day_spend / 30.0
    } else {
        0.0
    };

    Ok(CostsSummary {
        total_spend,
        thirty_day_spend,
        seven_day_spend,
        daily_run_rate,
    })
}

pub fn get_costs_series(conn: &Connection, period: &str) -> Result<Vec<CostSeriesPoint>> {
    let sql = if period.eq_ignore_ascii_case("weekly") {
        r#"
        SELECT
            strftime('%Y-W%W', COALESCE(LogTimestamp, datetime('now'))) AS period,
            COALESCE(SUM(Cost), 0.0) AS cost,
            COALESCE(SUM(Tokens), 0) AS tokens
        FROM Costs
        GROUP BY period
        ORDER BY period ASC
        "#
    } else {
        r#"
        SELECT
            DATE(COALESCE(LogTimestamp, datetime('now'))) AS period,
            COALESCE(SUM(Cost), 0.0) AS cost,
            COALESCE(SUM(Tokens), 0) AS tokens
        FROM Costs
        GROUP BY period
        ORDER BY period ASC
        "#
    };

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(CostSeriesPoint {
            period: row.get(0)?,
            cost: row.get(1)?,
            tokens: row.get(2)?,
        })
    })?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r?);
    }
    Ok(results)
}

pub fn list_costs_by_plan(conn: &Connection, plan_id: i32) -> Result<Vec<CostRecord>> {
    let mut stmt = conn.prepare(
        "SELECT Id, PlanId, Promptware, Tokens, Cost, LogTimestamp FROM Costs WHERE PlanId = ?1 ORDER BY Id ASC",
    )?;
    let rows = stmt.query_map(params![plan_id], |row| {
        Ok(CostRecord {
            id: row.get(0)?,
            plan_id: row.get(1)?,
            promptware: row.get(2)?,
            tokens: row.get(3)?,
            cost: row.get(4)?,
            log_timestamp: row.get(5)?,
        })
    })?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r?);
    }
    Ok(results)
}
