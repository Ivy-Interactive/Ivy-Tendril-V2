use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, Result};
use crate::models::{JobItem, JobStatus};

pub fn insert_job(conn: &Connection, job: &JobItem) -> Result<()> {
    let started_at_str = job.started_at.map(|t| t.to_rfc3339());
    let completed_at_str = job.completed_at.map(|t| t.to_rfc3339());

    conn.execute(
        r#"
        INSERT INTO Jobs (
            Id, Type, PlanFile, Project, Status, Provider, StartedAt, CompletedAt,
            DurationSeconds, Cost, Tokens, StatusMessage, Args, WorkingDirectory,
            CliCommand, Cleared, ReportedPlanId, ReportedPlanTitle, ReportedFailureReason,
            Model, InputTokens, OutputTokens, CacheReadTokens, CacheWriteTokens,
            ReasoningTokens, CostSource, ExecutionProfile, Effort
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
            ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28
        )
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
            CostSource = excluded.CostSource;
        "#,
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
        ],
    )?;

    Ok(())
}

pub fn get_job(conn: &Connection, id: &str) -> Result<Option<JobItem>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT Id, Type, PlanFile, Project, Status, Provider, StartedAt, CompletedAt,
               DurationSeconds, Cost, Tokens, StatusMessage, Args, WorkingDirectory,
               CliCommand, Cleared, ReportedPlanId, ReportedPlanTitle, ReportedFailureReason,
               Model, InputTokens, OutputTokens, CacheReadTokens, CacheWriteTokens,
               ReasoningTokens, CostSource, ExecutionProfile, Effort
        FROM Jobs WHERE Id = ?
        "#,
    )?;

    let mut rows = stmt.query([id])?;
    if let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let job_type: String = row.get(1)?;
        let plan_file: String = row.get(2)?;
        let project: String = row.get(3)?;
        let status_str: String = row.get(4)?;
        let provider: String = row.get(5)?;
        let started_at_str: Option<String> = row.get(6)?;
        let completed_at_str: Option<String> = row.get(7)?;
        let duration_seconds: Option<i64> = row.get(8)?;
        let cost: Option<f64> = row.get(9)?;
        let tokens: Option<i64> = row.get(10)?;
        let status_message: Option<String> = row.get(11)?;
        let args: Option<String> = row.get(12)?;
        let working_directory: Option<String> = row.get(13)?;
        let cli_command: Option<String> = row.get(14)?;
        let cleared_int: i32 = row.get(15)?;
        let reported_plan_id: Option<String> = row.get(16)?;
        let reported_plan_title: Option<String> = row.get(17)?;
        let reported_failure_reason: Option<String> = row.get(18)?;
        let model: Option<String> = row.get(19)?;
        let input_tokens: Option<i64> = row.get(20)?;
        let output_tokens: Option<i64> = row.get(21)?;
        let cache_read_tokens: Option<i64> = row.get(22)?;
        let cache_write_tokens: Option<i64> = row.get(23)?;
        let reasoning_tokens: Option<i64> = row.get(24)?;
        let cost_source: Option<String> = row.get(25)?;
        let execution_profile: Option<String> = row.get(26)?;
        let effort: Option<String> = row.get(27)?;

        let status = JobStatus::from_str_loose(&status_str).unwrap_or(JobStatus::Pending);
        let started_at = started_at_str.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc)));
        let completed_at = completed_at_str.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc)));

        let mut item = JobItem::new(id, job_type, plan_file, project);
        item.status = status;
        item.provider = provider;
        item.started_at = started_at;
        item.completed_at = completed_at;
        item.duration_seconds = duration_seconds;
        item.cost = cost;
        item.tokens = tokens;
        item.status_message = status_message;
        item.args = args;
        item.working_directory = working_directory;
        item.cli_command = cli_command;
        item.cleared = cleared_int != 0;
        item.reported_plan_id = reported_plan_id;
        item.reported_plan_title = reported_plan_title;
        item.reported_failure_reason = reported_failure_reason;
        item.model = model;
        item.input_tokens = input_tokens;
        item.output_tokens = output_tokens;
        item.cache_read_tokens = cache_read_tokens;
        item.cache_write_tokens = cache_write_tokens;
        item.reasoning_tokens = reasoning_tokens;
        item.cost_source = cost_source;
        item.execution_profile = execution_profile;
        item.effort = effort;

        return Ok(Some(item));
    }

    Ok(None)
}

pub fn list_jobs(conn: &Connection, status_filter: Option<JobStatus>, limit: usize) -> Result<Vec<JobItem>> {
    let mut sql = "SELECT Id, Type, PlanFile, Project, Status, Provider, StartedAt, CompletedAt, DurationSeconds, Cost, Tokens, StatusMessage, Args, WorkingDirectory, CliCommand, Cleared, ReportedPlanId, ReportedPlanTitle, ReportedFailureReason, Model, InputTokens, OutputTokens, CacheReadTokens, CacheWriteTokens, ReasoningTokens, CostSource, ExecutionProfile, Effort FROM Jobs".to_string();

    if let Some(status) = status_filter {
        sql.push_str(&format!(" WHERE Status = '{}'", status.as_str()));
    }

    sql.push_str(&format!(" ORDER BY StartedAt DESC LIMIT {}", limit));

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([])?;
    let mut jobs = Vec::new();

    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let job_type: String = row.get(1)?;
        let plan_file: String = row.get(2)?;
        let project: String = row.get(3)?;
        let status_str: String = row.get(4)?;
        let provider: String = row.get(5)?;
        let started_at_str: Option<String> = row.get(6)?;
        let completed_at_str: Option<String> = row.get(7)?;
        let duration_seconds: Option<i64> = row.get(8)?;
        let cost: Option<f64> = row.get(9)?;
        let tokens: Option<i64> = row.get(10)?;
        let status_message: Option<String> = row.get(11)?;
        let args: Option<String> = row.get(12)?;
        let working_directory: Option<String> = row.get(13)?;
        let cli_command: Option<String> = row.get(14)?;
        let cleared_int: i32 = row.get(15)?;
        let reported_plan_id: Option<String> = row.get(16)?;
        let reported_plan_title: Option<String> = row.get(17)?;
        let reported_failure_reason: Option<String> = row.get(18)?;
        let model: Option<String> = row.get(19)?;
        let input_tokens: Option<i64> = row.get(20)?;
        let output_tokens: Option<i64> = row.get(21)?;
        let cache_read_tokens: Option<i64> = row.get(22)?;
        let cache_write_tokens: Option<i64> = row.get(23)?;
        let reasoning_tokens: Option<i64> = row.get(24)?;
        let cost_source: Option<String> = row.get(25)?;
        let execution_profile: Option<String> = row.get(26)?;
        let effort: Option<String> = row.get(27)?;

        let status = JobStatus::from_str_loose(&status_str).unwrap_or(JobStatus::Pending);
        let started_at = started_at_str.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc)));
        let completed_at = completed_at_str.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc)));

        let mut item = JobItem::new(id, job_type, plan_file, project);
        item.status = status;
        item.provider = provider;
        item.started_at = started_at;
        item.completed_at = completed_at;
        item.duration_seconds = duration_seconds;
        item.cost = cost;
        item.tokens = tokens;
        item.status_message = status_message;
        item.args = args;
        item.working_directory = working_directory;
        item.cli_command = cli_command;
        item.cleared = cleared_int != 0;
        item.reported_plan_id = reported_plan_id;
        item.reported_plan_title = reported_plan_title;
        item.reported_failure_reason = reported_failure_reason;
        item.model = model;
        item.input_tokens = input_tokens;
        item.output_tokens = output_tokens;
        item.cache_read_tokens = cache_read_tokens;
        item.cache_write_tokens = cache_write_tokens;
        item.reasoning_tokens = reasoning_tokens;
        item.cost_source = cost_source;
        item.execution_profile = execution_profile;
        item.effort = effort;

        jobs.push(item);
    }

    Ok(jobs)
}
