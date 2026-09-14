use crate::models::{JobItem, JobStatus};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, Result, Row};

/// Column list shared by every read path, so the positional `row_to_job` mapping cannot drift
/// between `get_job`, `list_jobs` and `list_non_terminal_jobs`.
const JOB_COLUMNS: &str = "Id, Type, PlanFile, Project, Status, Provider, StartedAt, CompletedAt, \
     DurationSeconds, Cost, Tokens, StatusMessage, Args, WorkingDirectory, \
     CliCommand, Cleared, ReportedPlanId, ReportedPlanTitle, ReportedFailureReason, \
     Model, InputTokens, OutputTokens, CacheReadTokens, CacheWriteTokens, \
     ReasoningTokens, CostSource, ExecutionProfile, Effort, ProcessId, PreviousPlanState, \
     Priority, LastOutputAt, WaitForJobIds";

const INSERT_SQL: &str = r#"
    INSERT INTO Jobs (
        Id, Type, PlanFile, Project, Status, Provider, StartedAt, CompletedAt,
        DurationSeconds, Cost, Tokens, StatusMessage, Args, WorkingDirectory,
        CliCommand, Cleared, ReportedPlanId, ReportedPlanTitle, ReportedFailureReason,
        Model, InputTokens, OutputTokens, CacheReadTokens, CacheWriteTokens,
        ReasoningTokens, CostSource, ExecutionProfile, Effort, ProcessId, PreviousPlanState,
        Priority, LastOutputAt, WaitForJobIds
    ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
        ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30,
        ?31, ?32, ?33
    )
"#;

const UPSERT_TAIL: &str = r#"
    ON CONFLICT(Id) DO UPDATE SET
        Status = excluded.Status,
        CompletedAt = excluded.CompletedAt,
        DurationSeconds = excluded.DurationSeconds,
        Cost = excluded.Cost,
        Tokens = excluded.Tokens,
        StatusMessage = excluded.StatusMessage,
        ReportedPlanId = excluded.ReportedPlanId,
        ReportedPlanTitle = excluded.ReportedPlanTitle,
        ReportedFailureReason = excluded.ReportedFailureReason,
        Model = excluded.Model,
        InputTokens = excluded.InputTokens,
        OutputTokens = excluded.OutputTokens,
        CacheReadTokens = excluded.CacheReadTokens,
        CacheWriteTokens = excluded.CacheWriteTokens,
        ReasoningTokens = excluded.ReasoningTokens,
        CostSource = excluded.CostSource,
        WorkingDirectory = excluded.WorkingDirectory,
        CliCommand = excluded.CliCommand,
        ProcessId = excluded.ProcessId,
        PreviousPlanState = excluded.PreviousPlanState,
        Priority = excluded.Priority,
        LastOutputAt = excluded.LastOutputAt,
        WaitForJobIds = excluded.WaitForJobIds;
"#;

fn execute_write(conn: &Connection, sql: &str, job: &JobItem) -> Result<()> {
    let started_at_str = job.started_at.map(|t| t.to_rfc3339());
    let completed_at_str = job.completed_at.map(|t| t.to_rfc3339());
    let last_output_at_str = job.last_output_at.map(|t| t.to_rfc3339());
    // Stored as a JSON array so the column stays a plain TEXT value; `None` for the common empty case
    // keeps existing rows unchanged.
    let wait_for_json = if job.wait_for_job_ids.is_empty() {
        None
    } else {
        serde_json::to_string(&job.wait_for_job_ids).ok()
    };

    conn.execute(
        sql,
        params![
            job.id,
            job.job_type,
            job.plan_file,
            job.project,
            job.status.as_str(),
            job.provider,
            started_at_str,
            completed_at_str,
            job.duration_seconds,
            job.cost,
            job.tokens,
            job.status_message,
            job.args,
            job.working_directory,
            job.cli_command,
            if job.cleared { 1 } else { 0 },
            job.reported_plan_id,
            job.reported_plan_title,
            job.reported_failure_reason,
            job.model,
            job.input_tokens,
            job.output_tokens,
            job.cache_read_tokens,
            job.cache_write_tokens,
            job.reasoning_tokens,
            job.cost_source,
            job.execution_profile,
            job.effort,
            job.process_id.map(|p| p as i64),
            job.previous_plan_state,
            job.priority,
            last_output_at_str,
            wait_for_json,
        ],
    )?;

    Ok(())
}

/// Inserts or updates a job row. Used for every state change after the job first exists.
pub fn insert_job(conn: &Connection, job: &JobItem) -> Result<()> {
    let sql = format!("{}{}", INSERT_SQL, UPSERT_TAIL);
    execute_write(conn, &sql, job)
}

/// Inserts a job that must not already exist. Unlike [`insert_job`] this is a plain `INSERT`, so an
/// ID collision surfaces as a primary-key error instead of silently overwriting a live job.
pub fn insert_new_job(conn: &Connection, job: &JobItem) -> Result<()> {
    let sql = format!("{};", INSERT_SQL);
    execute_write(conn, &sql, job)
}

fn row_to_job(row: &Row<'_>) -> Result<JobItem> {
    let id: String = row.get(0)?;
    let job_type: String = row.get(1)?;
    let plan_file: String = row.get(2)?;
    let project: String = row.get(3)?;
    let status_str: String = row.get(4)?;
    let provider: String = row.get(5)?;
    let started_at_str: Option<String> = row.get(6)?;
    let completed_at_str: Option<String> = row.get(7)?;
    let cleared_int: i32 = row.get(15)?;
    let process_id: Option<i64> = row.get(28)?;

    let parse_ts = |s: Option<String>| -> Option<DateTime<Utc>> {
        s.and_then(|s| {
            DateTime::parse_from_rfc3339(&s)
                .ok()
                .map(|dt| dt.with_timezone(&Utc))
        })
    };

    let mut item = JobItem::new(id, job_type, plan_file, project);
    item.status = JobStatus::from_str_loose(&status_str).unwrap_or(JobStatus::Pending);
    item.provider = provider;
    item.started_at = parse_ts(started_at_str);
    item.completed_at = parse_ts(completed_at_str);
    item.duration_seconds = row.get(8)?;
    item.cost = row.get(9)?;
    item.tokens = row.get(10)?;
    item.status_message = row.get(11)?;
    item.args = row.get(12)?;
    item.working_directory = row.get(13)?;
    item.cli_command = row.get(14)?;
    item.cleared = cleared_int != 0;
    item.reported_plan_id = row.get(16)?;
    item.reported_plan_title = row.get(17)?;
    item.reported_failure_reason = row.get(18)?;
    item.model = row.get(19)?;
    item.input_tokens = row.get(20)?;
    item.output_tokens = row.get(21)?;
    item.cache_read_tokens = row.get(22)?;
    item.cache_write_tokens = row.get(23)?;
    item.reasoning_tokens = row.get(24)?;
    item.cost_source = row.get(25)?;
    item.execution_profile = row.get(26)?;
    item.effort = row.get(27)?;
    item.process_id = process_id.and_then(|p| u32::try_from(p).ok());
    item.previous_plan_state = row.get(29)?;
    // Rows written before the Priority column existed read back as NULL, not as its default.
    item.priority = row.get::<_, Option<i32>>(30)?.unwrap_or(0);
    item.last_output_at = parse_ts(row.get(31)?);
    item.wait_for_job_ids = row
        .get::<_, Option<String>>(32)?
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();

    // `typed_args` has no column of its own; it is rehydrated from the Args JSON so a job loaded
    // after a daemon restart still knows what it was launched with.
    if let Some(args_json) = &item.args {
        item.typed_args = serde_json::from_str(args_json).ok();
    }

    Ok(item)
}

pub fn get_job(conn: &Connection, id: &str) -> Result<Option<JobItem>> {
    let sql = format!("SELECT {} FROM Jobs WHERE Id = ?", JOB_COLUMNS);
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([id])?;
    if let Some(row) = rows.next()? {
        return Ok(Some(row_to_job(row)?));
    }
    Ok(None)
}

pub fn list_jobs(
    conn: &Connection,
    status_filter: Option<JobStatus>,
    limit: usize,
) -> Result<Vec<JobItem>> {
    let mut sql = format!("SELECT {} FROM Jobs", JOB_COLUMNS);

    if let Some(status) = status_filter {
        sql.push_str(&format!(" WHERE Status = '{}'", status.as_str()));
    }

    sql.push_str(&format!(" ORDER BY StartedAt DESC LIMIT {}", limit));

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([])?;
    let mut jobs = Vec::new();
    while let Some(row) = rows.next()? {
        jobs.push(row_to_job(row)?);
    }

    Ok(jobs)
}

/// Every job row that has not reached a terminal status. This is the input to startup
/// reconciliation: anything listed here was mid-flight when the daemon stopped.
pub fn list_non_terminal_jobs(conn: &Connection) -> Result<Vec<JobItem>> {
    let sql = format!(
        "SELECT {} FROM Jobs WHERE Status IN ('Pending', 'Queued', 'Running', 'Blocked') \
         ORDER BY Id ASC",
        JOB_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([])?;
    let mut jobs = Vec::new();
    while let Some(row) = rows.next()? {
        jobs.push(row_to_job(row)?);
    }

    Ok(jobs)
}

/// Removes a job row. Returns whether a row existed.
pub fn delete_job(conn: &Connection, id: &str) -> Result<bool> {
    let affected = conn.execute("DELETE FROM Jobs WHERE Id = ?1", params![id])?;
    Ok(affected > 0)
}

/// Ids of jobs matching `statuses`, newest first. Used by the bulk clear paths.
pub fn list_job_ids_by_status(conn: &Connection, statuses: &[JobStatus]) -> Result<Vec<String>> {
    if statuses.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; statuses.len()].join(", ");
    let sql = format!(
        "SELECT Id FROM Jobs WHERE Status IN ({}) ORDER BY Id DESC",
        placeholders
    );
    let params: Vec<&str> = statuses.iter().map(|s| s.as_str()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(params))?;
    let mut ids = Vec::new();
    while let Some(row) = rows.next()? {
        ids.push(row.get(0)?);
    }
    Ok(ids)
}

/// Stamps a job's last-output time without rewriting the rest of the row, so the liveness heartbeat
/// cannot clobber fields a concurrent writer owns.
pub fn touch_job_last_output(conn: &Connection, id: &str, at: DateTime<Utc>) -> Result<bool> {
    let affected = conn.execute(
        "UPDATE Jobs SET LastOutputAt = ?2 WHERE Id = ?1",
        params![id, at.to_rfc3339()],
    )?;
    Ok(affected > 0)
}

/// Highest allocated 5-digit job ID, or 0 when the table holds none.
pub fn max_numeric_job_id(conn: &Connection) -> Result<i32> {
    let mut stmt = conn.prepare(
        "SELECT Id FROM Jobs WHERE Id GLOB '[0-9][0-9][0-9][0-9][0-9]' ORDER BY Id DESC LIMIT 1",
    )?;
    let mut rows = stmt.query([])?;
    if let Some(row) = rows.next()? {
        let id_str: String = row.get(0)?;
        return Ok(id_str.parse::<i32>().unwrap_or(0));
    }
    Ok(0)
}
