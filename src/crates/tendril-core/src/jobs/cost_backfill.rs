//! Repairs jobs whose cost was recorded as nothing when it should have been an estimate.
//!
//! A job that finished before pricing data was available recorded `Cost` as NULL or `0`, while its
//! token counts survived — enough to reconstruct the figure once a price list exists. V2 has the same
//! hole as the original: `AppState` fetches models.dev pricing asynchronously *after* startup, so a
//! job that finishes in the first seconds of a daemon's life, or on an offline run, is costed against
//! the hardcoded fallback in [`crate::agents::pricing`] or not at all, and nothing revisits it.
//!
//! Works off the database rather than the in-memory job map: most of the rows worth repairing are
//! only on disk.

use crate::agents::{model_specs, pricing};
use crate::db::{insert_job, jobs::list_jobs, open_database};
use crate::models::JobItem;
use std::path::Path;

/// Matches the bound on how many job rows exist at all, so a pass sees every repairable row without
/// walking history that has already been purged.
pub const JOB_LIMIT: usize = 500;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BackfillReport {
    pub filled: usize,
    /// Rows left alone because the model has no price list entry. Counted, never guessed at.
    pub unpriced: usize,
    pub failed: usize,
}

impl BackfillReport {
    pub fn is_empty(&self) -> bool {
        self.filled == 0 && self.unpriced == 0 && self.failed == 0
    }
}

/// One pass.
///
/// Never returns an error: a background failure is a far worse outcome than a cost that stays blank,
/// and every step here is best effort by nature.
///
/// Idempotent. A filled row is no longer a candidate, so a second pass skips it; a row that stays
/// unpriced is re-examined next pass, which is the point — pricing may have arrived since. The
/// `Costs` table is never inserted into here, so repeated runs cannot double-count: this only updates
/// a `Jobs` row and edits one existing `costs.csv` row in place, and `Costs` follows from
/// [`crate::plans::costs_csv::reconcile_plan_costs`] on the next sync.
pub fn run_pass(tendril_home: &Path) -> BackfillReport {
    let mut report = BackfillReport::default();

    let db_path = crate::config::get_database_path(tendril_home);
    let conn = match open_database(&db_path) {
        Ok(conn) => conn,
        Err(e) => {
            tracing::warn!("Cost backfill skipped, database unavailable: {}", e);
            return report;
        }
    };

    let jobs = match list_jobs(&conn, None, JOB_LIMIT) {
        Ok(jobs) => jobs,
        Err(e) => {
            tracing::warn!("Cost backfill pass failed; costs left as they are: {}", e);
            return report;
        }
    };

    for mut job in jobs.into_iter().filter(is_candidate) {
        let model = job.model.clone().unwrap_or_default();

        // `model_specs::find` is what `pricing::get_model_price` consults before falling back to its
        // hardcoded 3.00/15.00 rates, so a `None` here is precisely "no price list entry" — the
        // original's unpriced case. Going straight to `calculate_cost` would invent a figure for a
        // model nobody has prices for and stamp it `estimated`, which is the corruption this service
        // exists to undo.
        if model_specs::find(&model).is_none() {
            report.unpriced += 1;
            continue;
        }

        // The same path `extract_and_record_usage` uses, so a backfilled figure and a freshly
        // estimated one agree to the last cent.
        let cost = pricing::calculate_cost(
            &model,
            job.input_tokens.unwrap_or(0),
            job.output_tokens.unwrap_or(0),
            job.cache_read_tokens.unwrap_or(0),
            job.cache_write_tokens.unwrap_or(0),
        );

        job.cost = Some(cost);
        job.cost_source = Some("estimated".to_string());

        if let Err(e) = insert_job(&conn, &job) {
            report.failed += 1;
            tracing::debug!("Failed to backfill cost for job {}: {}", job.id, e);
            continue;
        }

        update_costs_csv(Path::new(&job.plan_file), &job.job_type, cost, &model);
        report.filled += 1;
    }

    if !report.is_empty() {
        tracing::info!(
            "Cost backfill: {} estimated, {} skipped for unknown model, {} failed",
            report.filled,
            report.unpriced,
            report.failed,
        );
    }

    report
}

/// A job worth repairing: no cost anyone charged, a model to price against, and tokens to price.
///
/// The `0.0` case is deliberate. It is what the pre-fix writer stored for an unpriceable run, and
/// telling it apart from a genuine free run is not possible from the row — a genuine zero re-derives
/// to zero anyway. An `agent` cost source is never touched whatever its value: that figure came from
/// a bill.
pub fn is_candidate(job: &JobItem) -> bool {
    let unpriced = job.cost.is_none_or(|c| c == 0.0);
    let tokens = job.input_tokens.unwrap_or(0) > 0
        || job.output_tokens.unwrap_or(0) > 0
        || job.cache_read_tokens.unwrap_or(0) > 0
        || job.cache_write_tokens.unwrap_or(0) > 0;

    unpriced
        && job.cost_source.as_deref() != Some("agent")
        && job.model.as_deref().is_some_and(|m| !m.trim().is_empty())
        && tokens
}

/// Writes the estimate into the plan folder's `costs.csv` as well.
///
/// Not optional and not cosmetic: [`crate::plans::costs_csv::reconcile_plan_costs`] deletes and
/// re-inserts every `Costs` row for a plan from that file on each sync, so a database-only repair is
/// undone by the next one.
///
/// Rewrites a row only when **exactly one** row in the file is both unpriced and this job's
/// promptware. Several candidates means the file cannot say which run was this job, and guessing
/// moves money onto the wrong row.
///
/// The column count is left exactly as found. The original widens a pre-v2 three-column row to carry
/// the model; V2's writer always emits six and its reader is positional, so this — the only other
/// writer — changing a row's arity would be a shape change made by a repair pass, which is not what a
/// repair pass is for.
fn update_costs_csv(plan_folder: &Path, promptware: &str, cost: f64, model: &str) {
    if plan_folder.as_os_str().is_empty() {
        return;
    }
    let csv_path = plan_folder.join("costs.csv");
    let Ok(content) = std::fs::read_to_string(&csv_path) else {
        return;
    };

    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let mut matches = Vec::new();
    for (i, line) in lines.iter().enumerate().skip(1) {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() < 3 {
            continue;
        }
        if !parts[0].trim().eq_ignore_ascii_case(promptware) {
            continue;
        }
        if !is_unpriced_field(parts[2]) {
            continue;
        }
        matches.push(i);
    }

    if matches.len() != 1 {
        return;
    }

    let index = matches[0];
    let mut row: Vec<String> = lines[index].split(',').map(str::to_string).collect();
    row[2] = format!("{:.4}", cost);
    if row.len() > 3 && row[3].trim().is_empty() {
        row[3] = model.to_string();
    }
    lines[index] = row.join(",");

    let _ = std::fs::write(&csv_path, format!("{}\n", lines.join("\n")));
}

/// A cost field nothing was ever charged against: empty (the unknown case) or a zero however it was
/// formatted. A row carrying any other figure is left alone.
fn is_unpriced_field(field: &str) -> bool {
    let trimmed = field.trim();
    trimmed.is_empty() || trimmed.parse::<f64>().map(|v| v == 0.0).unwrap_or(false)
}
