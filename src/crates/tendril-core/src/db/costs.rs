use crate::error::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostsFilter {
    pub project: Option<String>,
    pub promptware: Option<String>,
}

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
    /// `None` when the run was unpriceable — a subscription plan reports tokens and no charge. The
    /// original's schema permits NULL here, so this cannot be a bare `f64`.
    pub cost: Option<f64>,
    pub model: Option<String>,
    pub log_timestamp: Option<String>,
    pub cost_source: Option<String>,
    pub agent: Option<String>,
}

/// One row of a plan's `costs.csv`, which is the durable record both apps append to. A plan's
/// `Costs` rows are a projection of that file — see [`crate::plans::costs_csv`].
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostEntry {
    pub promptware: String,
    pub tokens: i64,
    pub cost: Option<f64>,
    pub model: Option<String>,
    pub cost_source: Option<String>,
    pub agent: Option<String>,
    pub log_timestamp: Option<String>,
}

fn build_filter_sql(filter: &CostsFilter) -> (String, Vec<String>, Vec<String>) {
    let mut joins = Vec::new();
    let mut where_clauses: Vec<String> = Vec::new();
    let mut params = Vec::new();

    if let Some(project) = &filter.project {
        if !project.trim().is_empty() {
            joins.push("JOIN Plans ON Costs.PlanId = Plans.Id");
            where_clauses.push("LOWER(Plans.Project) = LOWER(?)".to_string());
            params.push(project.clone());
        }
    }

    if let Some(promptware) = &filter.promptware {
        if !promptware.trim().is_empty() {
            where_clauses.push("LOWER(Costs.Promptware) = LOWER(?)".to_string());
            params.push(promptware.clone());
        }
    }

    let join_str = if joins.is_empty() {
        String::new()
    } else {
        format!(" {}", joins.join(" "))
    };

    (join_str, where_clauses, params)
}

/// Inserts a bare cost row, leaving `Model`, `CostSource` and `Agent` NULL. The low-level primitive;
/// [`insert_cost_entry`] is what production code wants.
pub fn insert_cost(
    conn: &Connection,
    plan_id: i32,
    promptware: &str,
    tokens: i64,
    cost: Option<f64>,
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

/// Inserts a full cost row. Column list and order match the original's `UpsertCosts`.
pub fn insert_cost_entry(conn: &Connection, plan_id: i32, entry: &CostEntry) -> Result<i64> {
    conn.execute(
        r#"
        INSERT INTO Costs (PlanId, Promptware, Tokens, Cost, Model, LogTimestamp, CostSource, Agent)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            plan_id,
            entry.promptware,
            entry.tokens,
            entry.cost,
            entry.model,
            entry.log_timestamp,
            entry.cost_source,
            entry.agent,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Replaces every `Costs` row for a plan with `entries`, in one transaction. The Rust twin of the
/// original's `UpsertCosts`: it is what makes the table a pure function of the plan's `costs.csv`,
/// so both apps converge on the same rows whoever synced last.
pub fn replace_plan_costs(conn: &Connection, plan_id: i32, entries: &[CostEntry]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM Costs WHERE PlanId = ?1", params![plan_id])?;
    for entry in entries {
        insert_cost_entry(&tx, plan_id, entry)?;
    }
    tx.commit()?;
    Ok(())
}

pub fn get_costs_summary(conn: &Connection, filter: &CostsFilter) -> Result<CostsSummary> {
    let (join_sql, where_clauses, params) = build_filter_sql(filter);

    let total_where = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };
    let total_sql = format!(
        "SELECT COALESCE(SUM(Costs.Cost), 0.0) FROM Costs{}{}",
        join_sql, total_where
    );
    let total_spend: f64 = conn.query_row(
        &total_sql,
        rusqlite::params_from_iter(params.iter()),
        |row| row.get(0),
    )?;

    let mut thirty_day_clauses = where_clauses.clone();
    thirty_day_clauses.push(
        "datetime(COALESCE(Costs.LogTimestamp, datetime('now'))) >= datetime('now', '-30 days')"
            .to_string(),
    );
    let thirty_day_sql = format!(
        "SELECT COALESCE(SUM(Costs.Cost), 0.0) FROM Costs{} WHERE {}",
        join_sql,
        thirty_day_clauses.join(" AND ")
    );
    let thirty_day_spend: f64 = conn.query_row(
        &thirty_day_sql,
        rusqlite::params_from_iter(params.iter()),
        |row| row.get(0),
    )?;

    let mut seven_day_clauses = where_clauses.clone();
    seven_day_clauses.push(
        "datetime(COALESCE(Costs.LogTimestamp, datetime('now'))) >= datetime('now', '-7 days')"
            .to_string(),
    );
    let seven_day_sql = format!(
        "SELECT COALESCE(SUM(Costs.Cost), 0.0) FROM Costs{} WHERE {}",
        join_sql,
        seven_day_clauses.join(" AND ")
    );
    let seven_day_spend: f64 = conn.query_row(
        &seven_day_sql,
        rusqlite::params_from_iter(params.iter()),
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

pub fn get_costs_series(
    conn: &Connection,
    period: &str,
    filter: &CostsFilter,
) -> Result<Vec<CostSeriesPoint>> {
    let (join_sql, where_clauses, params) = build_filter_sql(filter);
    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };

    let period_expr = if period.eq_ignore_ascii_case("weekly") {
        "strftime('%Y-W%W', COALESCE(Costs.LogTimestamp, datetime('now')))"
    } else {
        "DATE(COALESCE(Costs.LogTimestamp, datetime('now')))"
    };

    let sql = format!(
        r#"
        SELECT
            {} AS period,
            COALESCE(SUM(Costs.Cost), 0.0) AS cost,
            COALESCE(SUM(Costs.Tokens), 0) AS tokens
        FROM Costs{}{}
        GROUP BY period
        ORDER BY period ASC
        "#,
        period_expr, join_sql, where_sql
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |row| {
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

/// `SUM(Cost)` and `SUM(Tokens)` per plan, keyed by `Costs.PlanId`. One query for the whole table:
/// the Pull Requests view needs a total for every plan it lists, and a per-plan query would be N
/// round trips. A plan with no `Costs` rows is absent from the map rather than present as a zero.
///
/// `Cost` is nullable — a subscription run reports tokens and no charge — so the `COALESCE` is over
/// the sum, not each row: a plan whose every row is NULL totals `0.0` with its tokens intact.
pub fn get_plan_cost_totals(conn: &Connection) -> Result<HashMap<i32, (f64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT PlanId, COALESCE(SUM(Cost), 0.0), COALESCE(SUM(Tokens), 0) FROM Costs GROUP BY PlanId",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, i32>(0)?, (row.get(1)?, row.get(2)?)))
    })?;

    let mut totals = HashMap::new();
    for r in rows {
        let (plan_id, total) = r?;
        totals.insert(plan_id, total);
    }
    Ok(totals)
}

pub fn list_costs_by_plan(conn: &Connection, plan_id: i32) -> Result<Vec<CostRecord>> {
    let mut stmt = conn.prepare(
        "SELECT Id, PlanId, Promptware, Tokens, Cost, Model, LogTimestamp, CostSource, Agent FROM Costs WHERE PlanId = ?1 ORDER BY Id ASC",
    )?;
    let rows = stmt.query_map(params![plan_id], |row| {
        Ok(CostRecord {
            id: row.get(0)?,
            plan_id: row.get(1)?,
            promptware: row.get(2)?,
            tokens: row.get(3)?,
            cost: row.get(4)?,
            model: row.get(5)?,
            log_timestamp: row.get(6)?,
            cost_source: row.get(7)?,
            agent: row.get(8)?,
        })
    })?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r?);
    }
    Ok(results)
}
