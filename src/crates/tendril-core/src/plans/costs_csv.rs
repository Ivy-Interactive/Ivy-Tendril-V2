//! A plan folder's `costs.csv` is the durable, append-only record of what a plan spent, shared with
//! the original Tendril app. That app's `SyncPlanCosts`/`UpsertCosts` pair deletes every `Costs` row
//! for a plan and reinserts from the file, so the table is a projection rather than a store: V2 has
//! to append to the same file and reconcile the same way, or the two apps wipe each other's rows.

use crate::db::costs::{replace_plan_costs, CostEntry};
use crate::error::Result;
use rusqlite::Connection;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};

/// The v4 header. An existing file keeps whatever header it was created with, including the
/// three-column one: the parser reads by position and tolerates a short header with long rows
/// appended under it.
const CSV_HEADER: &str = "Promptware,Tokens,Cost,Model,CostSource,Agent\n";

fn csv_path(plan_folder: &Path) -> PathBuf {
    plan_folder.join("costs.csv")
}

/// Appends one row, creating the file with the v4 header when absent. Byte-identical to the
/// original's `LogCostToCsv`, including writing an **empty** Cost field rather than `0.0000` for an
/// unpriceable run.
///
/// Never add a seventh column: the original's `RewriteCostsCsv` rewrites the file with exactly six
/// whenever it back-fills a `CostSource`/`Agent`, so anything extra is silently dropped.
pub fn append_cost(plan_folder: &Path, entry: &CostEntry) -> std::io::Result<()> {
    use std::io::Write;

    let path = csv_path(plan_folder);
    if !path.exists() {
        std::fs::write(&path, CSV_HEADER)?;
    }

    let cost_field = entry
        .cost
        .map(|c| format!("{:.4}", c))
        .unwrap_or_default();
    let line = format!(
        "{},{},{},{},{},{}\n",
        entry.promptware,
        entry.tokens,
        cost_field,
        entry.model.as_deref().unwrap_or(""),
        entry.cost_source.as_deref().unwrap_or(""),
        entry.agent.as_deref().unwrap_or(""),
    );

    let mut file = std::fs::OpenOptions::new().append(true).open(&path)?;
    file.write_all(line.as_bytes())
}

/// Parses `costs.csv` positionally, mirroring the original's `SyncPlanCosts`: the header line is
/// skipped, a row needs at least three fields, an unparseable `Tokens` field skips the row, and an
/// unparseable or empty `Cost` becomes `None` — the tokens were still spent, and NULL is what every
/// aggregate needs to skip the row rather than average a zero in.
///
/// `log_timestamp` is always `None` here; [`reconcile_plan_costs`] supplies it.
pub fn read_costs(plan_folder: &Path) -> std::io::Result<Vec<CostEntry>> {
    let path = csv_path(plan_folder);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&path)?;
    let mut entries = Vec::new();

    for line in content.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() < 3 {
            continue;
        }

        let tokens = match parts[1].trim().parse::<i64>() {
            Ok(t) => t,
            Err(_) => continue,
        };

        entries.push(CostEntry {
            promptware: parts[0].trim().to_string(),
            tokens,
            cost: parts[2].trim().parse::<f64>().ok(),
            // Fourth column since costs.csv v2, fifth since v3, sixth since v4; files written before
            // each have fewer.
            model: optional_field(&parts, 3),
            cost_source: optional_field(&parts, 4),
            agent: optional_field(&parts, 5),
            log_timestamp: None,
        });
    }

    Ok(entries)
}

fn optional_field(parts: &[&str], index: usize) -> Option<String> {
    parts
        .get(index)
        .map(|f| f.trim())
        .filter(|f| !f.is_empty())
        .map(str::to_string)
}

/// Rebuilds a plan's `Costs` rows from its `costs.csv`, preserving the `LogTimestamp` already
/// recorded for each row.
///
/// Timestamps are matched rather than re-derived: rows are keyed by promptware into a FIFO queue and
/// popped in file order, which is what keeps the precise timestamps V2 records (the original can only
/// approximate them from job logs) and what makes reconciling twice with no new CSV row reproduce the
/// identical row set. `new_timestamp` is used for a row whose queue has run dry — the one just
/// appended.
///
/// A missing `costs.csv` is a no-op rather than a wipe: rows appended by an older V2 build are not
/// discarded just because no CSV exists yet. The original short-circuits the same way.
pub fn reconcile_plan_costs(
    conn: &Connection,
    plan_folder: &Path,
    plan_id: i32,
    new_timestamp: Option<&str>,
) -> Result<()> {
    if !csv_path(plan_folder).exists() {
        return Ok(());
    }

    let mut timestamps_by_promptware: HashMap<String, VecDeque<Option<String>>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT Promptware, LogTimestamp FROM Costs WHERE PlanId = ?1 ORDER BY Id ASC",
        )?;
        let mut rows = stmt.query(rusqlite::params![plan_id])?;
        while let Some(row) = rows.next()? {
            let promptware: String = row.get(0)?;
            let timestamp: Option<String> = row.get(1)?;
            timestamps_by_promptware
                .entry(promptware)
                .or_default()
                .push_back(timestamp);
        }
    }

    let mut entries = read_costs(plan_folder)?;
    for entry in &mut entries {
        entry.log_timestamp = timestamps_by_promptware
            .get_mut(&entry.promptware)
            .and_then(|queue| queue.pop_front())
            .unwrap_or_else(|| new_timestamp.map(str::to_string));
    }

    replace_plan_costs(conn, plan_id, &entries)
}
