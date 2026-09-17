use crate::db::query::{QueryPage, TableDescriptor, TableQuery};
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
     Priority, LastOutputAt, WaitForJobIds, PermissionDenials, DedupeKey, IdempotencyKey, \
     ChatSessionId";

const INSERT_SQL: &str = r#"
    INSERT INTO Jobs (
        Id, Type, PlanFile, Project, Status, Provider, StartedAt, CompletedAt,
        DurationSeconds, Cost, Tokens, StatusMessage, Args, WorkingDirectory,
        CliCommand, Cleared, ReportedPlanId, ReportedPlanTitle, ReportedFailureReason,
        Model, InputTokens, OutputTokens, CacheReadTokens, CacheWriteTokens,
        ReasoningTokens, CostSource, ExecutionProfile, Effort, ProcessId, PreviousPlanState,
        Priority, LastOutputAt, WaitForJobIds, PermissionDenials, DedupeKey, IdempotencyKey,
        ChatSessionId
    ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
        ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30,
        ?31, ?32, ?33, ?34, ?35, ?36, ?37
    )
"#;

/// `DedupeKey` and `IdempotencyKey` are deliberately absent from the `DO UPDATE SET` list: one
/// identifies the work a job was created for and the other the submission that created it, and
/// neither ever changes, so a later write of the same row — a status change, a cost update — must not
/// be able to clear or rewrite them.
const UPSERT_TAIL: &str = r#"
    ON CONFLICT(Id) DO UPDATE SET
        -- A `CreatePlan` starts with no plan and is given one by `verify_create_plan`, so unlike every
        -- other column here this one has to be writable *and* protected: a write carrying the empty
        -- string is a record that predates the back-fill, and must not erase the folder a later one
        -- found. Without this the plan a `CreatePlan` produced was unreachable from its own job row.
        PlanFile = CASE WHEN excluded.PlanFile != '' THEN excluded.PlanFile ELSE Jobs.PlanFile END,
        Status = excluded.Status,
        CompletedAt = excluded.CompletedAt,
        DurationSeconds = excluded.DurationSeconds,
        Cost = excluded.Cost,
        Tokens = excluded.Tokens,
        StatusMessage = excluded.StatusMessage,
        -- Coalesced for the same reason as `ChatSessionId` below: these three are reported by the
        -- *running* agent — `tendril job status --plan-id/--plan-title`, `tendril job fail --message` —
        -- and only ever set, never deliberately cleared. The write that ends a job is made from the
        -- snapshot its runner took before any of them existed, so taking `excluded` here erased the plan
        -- a `CreatePlan` had just announced, at the moment it finished and the chat came to look for it.
        ReportedPlanId = COALESCE(excluded.ReportedPlanId, Jobs.ReportedPlanId),
        ReportedPlanTitle = COALESCE(excluded.ReportedPlanTitle, Jobs.ReportedPlanTitle),
        ReportedFailureReason = COALESCE(
            excluded.ReportedFailureReason, Jobs.ReportedFailureReason
        ),
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
        WaitForJobIds = excluded.WaitForJobIds,
        PermissionDenials = excluded.PermissionDenials,
        -- `COALESCE`, not `excluded`, because this one is both *set later* and *never unset*: a job
        -- can learn its chat session after it starts (a `CreatePlan` that inherits it from the plan it
        -- just produced), while every ordinary status or cost write carries `None` and must leave an
        -- established link alone.
        ChatSessionId = COALESCE(excluded.ChatSessionId, Jobs.ChatSessionId);
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
    // Stored as a JSON array so the column stays one value per job, like Args.
    let permission_denials_json = job
        .permission_denials
        .as_ref()
        .filter(|d| !d.is_empty())
        .and_then(|d| serde_json::to_string(d).ok());

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
            permission_denials_json,
            job.dedupe_key,
            job.idempotency_key,
            job.chat_session_id,
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
    let permission_denials_json: Option<String> = row.get(33)?;
    item.permission_denials = permission_denials_json
        .as_deref()
        .and_then(|json| serde_json::from_str::<Vec<String>>(json).ok())
        .filter(|d| !d.is_empty());
    item.dedupe_key = row.get(34)?;
    item.idempotency_key = row.get(35)?;
    item.chat_session_id = row.get(36)?;

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

/// The job list, unfinished work first, capped at `limit`.
///
/// The ordering is V1's (`Services/Plans/PlanDatabaseService.cs`): everything that has not completed
/// sorts ahead of everything that has, and the finished rows then run newest-first. Ordering by
/// `StartedAt DESC` instead — as this did — put exactly the wrong rows last, because SQLite sorts
/// NULLs last under `DESC` and a `Pending`, `Queued` or `Blocked` job has no `StartedAt` at all. On
/// any home with `limit` started jobs the queue became invisible: the rows a user needs in order to
/// act were the first ones the cap discarded.
///
/// `Id DESC` breaks the tie within each group, so two rows sharing a `CompletedAt` — or the whole
/// unfinished group, which has none — come back newest-first rather than in whatever order the scan
/// happened to produce.
///
/// `Cleared = 0` restores V1's other guard. V2 clears by deleting the row, so it writes no `Cleared`
/// flag of its own; a home migrated from V1 still holds rows V1 flagged, and without this they keep
/// consuming slots in the limit forever while never being shown.
pub fn list_jobs(
    conn: &Connection,
    status_filter: Option<JobStatus>,
    limit: usize,
) -> Result<Vec<JobItem>> {
    let mut sql = format!(
        "SELECT {} FROM Jobs WHERE {}",
        JOB_COLUMNS, JOBS_BASE_PREDICATE
    );

    // Bound, not interpolated. `status_filter` is a parsed `JobStatus` so its `as_str()` cannot carry
    // anything but one of the enum's literals — but a read path that formats a value into SQL is a
    // pattern the next edit copies, and the next value may not be an enum.
    let mut binds: Vec<&str> = Vec::new();
    if let Some(status) = status_filter {
        sql.push_str(" AND Status = ?1");
        binds.push(status.as_str());
    }

    sql.push_str(&format!(
        " ORDER BY {}, {} LIMIT {}",
        JOBS_DEFAULT_ORDER, JOBS_TIEBREAK_ORDER, limit
    ));

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(binds))?;
    let mut jobs = Vec::new();
    while let Some(row) = rows.next()? {
        jobs.push(row_to_job(row)?);
    }

    Ok(jobs)
}

/// The server's own visibility rule for the Jobs table: a row V1 flagged as cleared is not part of
/// any list, and is not part of any count either. Applied ahead of a caller's filter and never
/// negotiable — see [`crate::db::query::TableDescriptor::base_predicate`].
const JOBS_BASE_PREDICATE: &str = "Cleared = 0";

/// [`list_jobs`]' ordering, reused as the query API's default sort so the two agree by construction:
/// unfinished work first, then finished rows newest-first.
const JOBS_DEFAULT_ORDER: &str =
    "CASE WHEN CompletedAt IS NULL THEN 0 ELSE 1 END, CompletedAt DESC";

/// Appended after every sort — the caller's included.
///
/// Not decoration: `Status`, `Project` and `CompletedAt` all have huge ties, and two windows of a
/// result whose ties are ordered arbitrarily are not slices of one sequence. Without a total order,
/// paging a large Jobs table can show a row twice and never show its neighbour. `Id` is the primary
/// key, so this makes every sort total.
const JOBS_TIEBREAK_ORDER: &str = "Id DESC";

/// The Jobs table as the query processor sees it.
pub fn jobs_table_descriptor() -> TableDescriptor<'static> {
    TableDescriptor {
        table: "Jobs",
        columns_sql: JOB_COLUMNS,
        base_predicate: Some(JOBS_BASE_PREDICATE),
        default_order_sql: JOBS_DEFAULT_ORDER,
        tiebreak_order_sql: JOBS_TIEBREAK_ORDER,
        // Moves whenever a job is stamped — every status transition writes one of these — so a client
        // paging through a busy queue is told its offsets have shifted. Inserts and deletions are
        // caught by the row count the token is paired with.
        version_marker_sql: Some("MAX(COALESCE(LastOutputAt, CompletedAt, StartedAt, ''))"),
    }
}

/// One window of the Jobs table under a caller's sort, filter and offset, with the matching total.
///
/// This is what lets a jobs table stay responsive at any row count: the sort, the filter and the
/// window are SQLite's problem, and the client receives `limit` rows plus a number. Contrast
/// [`list_jobs`], which can only answer "the newest N in the server's order" — a client wanting page
/// four, or rows sorted by cost, had no choice but to fetch everything and do it itself.
///
/// Every identifier in `query` is validated against the live `Jobs` schema and every value is bound;
/// see [`crate::db::query`] for the injection boundary.
pub fn query_jobs(
    conn: &Connection,
    query: &TableQuery,
) -> crate::error::Result<QueryPage<JobItem>> {
    crate::db::query::query_table(conn, &jobs_table_descriptor(), query, row_to_job)
}

/// Distinct values of one Jobs column, for a filter facet. The framework's `Values` rpc.
pub fn job_column_values(
    conn: &Connection,
    column: &str,
    search: Option<&str>,
    limit: Option<i64>,
) -> crate::error::Result<crate::db::query::ValuesPage> {
    crate::db::query::distinct_values(conn, &jobs_table_descriptor(), column, search, limit)
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

/// Non-terminal job rows recorded against `plan_folder`, oldest first.
///
/// This is the persisted half of the conflict guard. Startup recovery does not rehydrate the job
/// manager's in-memory map, so a job that survived a daemon restart — or a `Queued` row recovery
/// deliberately left alone — can only be seen here.
///
/// `COLLATE NOCASE` matches the ASCII-case-insensitive comparison the in-memory check uses, so the
/// two agree on a folder spelled differently by two callers. `idx_jobs_planfile_nocase` is the index
/// that serves it; the plain `idx_jobs_planfile` cannot, having no collation of its own.
pub fn list_non_terminal_jobs_for_plan(
    conn: &Connection,
    plan_folder: &str,
) -> Result<Vec<JobItem>> {
    let sql = format!(
        "SELECT {} FROM Jobs WHERE PlanFile = ?1 COLLATE NOCASE \
         AND Status IN ('Pending', 'Queued', 'Running', 'Blocked') ORDER BY Id ASC",
        JOB_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([plan_folder])?;
    let mut jobs = Vec::new();
    while let Some(row) = rows.next()? {
        jobs.push(row_to_job(row)?);
    }

    Ok(jobs)
}

/// The job a previous submission of `key` created, whatever status it reached.
///
/// Terminal rows count, which is the whole point: a client retrying a request whose response it never
/// saw must be told about the job it already started, not handed a second one. Scoping this to
/// in-flight statuses — as [`find_inflight_job_by_dedupe_key`] does, for a key that means something
/// else — would turn a retry after completion into a second run.
///
/// Parameterised, since the key comes from a client.
/// Every job a chat session started, oldest first — the durable answer to "what has this conversation
/// set running", as against the session file's `spawned_job_ids`, which is only as complete as the
/// stream-scraping that maintains it. Served by `idx_jobs_chatsession`.
pub fn list_jobs_for_chat_session(
    conn: &Connection,
    chat_session_id: &str,
) -> Result<Vec<JobItem>> {
    let sql = format!(
        "SELECT {} FROM Jobs WHERE ChatSessionId = ?1 AND Cleared = 0 ORDER BY Id ASC",
        JOB_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([chat_session_id], row_to_job)?;
    rows.collect()
}

pub fn find_job_by_idempotency_key(conn: &Connection, key: &str) -> Result<Option<JobItem>> {
    let sql = format!(
        "SELECT {} FROM Jobs WHERE IdempotencyKey = ?1 ORDER BY Id ASC LIMIT 1",
        JOB_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([key])?;
    if let Some(row) = rows.next()? {
        return Ok(Some(row_to_job(row)?));
    }
    Ok(None)
}

/// Statuses a job holds while its work is genuinely in flight, as SQL literals.
///
/// `Blocked` is excluded on purpose: a `Blocked` row was never spawned, so it holds no worktree and
/// no agent, and [`crate::jobs::dependents`] deletes it before submitting its replacement. Including
/// it would make a queued intention block the job that is meant to replace it.
pub const INFLIGHT_STATUSES_SQL: &str = "'Pending', 'Queued', 'Running'";

/// The in-flight job holding `key`, if any. See [`INFLIGHT_STATUSES_SQL`] for what counts as
/// in-flight.
///
/// Parameterised, unlike the string-interpolated `list_jobs` above: a dedupe key is derived from
/// user text (a plan folder path, a `CreatePlan` description).
pub fn find_inflight_job_by_dedupe_key(conn: &Connection, key: &str) -> Result<Option<JobItem>> {
    let sql = format!(
        "SELECT {} FROM Jobs WHERE DedupeKey = ?1 AND Status IN ({}) ORDER BY Id ASC LIMIT 1",
        JOB_COLUMNS, INFLIGHT_STATUSES_SQL
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([key])?;
    if let Some(row) = rows.next()? {
        return Ok(Some(row_to_job(row)?));
    }
    Ok(None)
}

/// Removes a job row. Returns whether a row existed.
///
/// The return value is the caller's *claim*, not a courtesy: a `Blocked` row is replaced by a fresh
/// job, and this delete is what grants the right to start that job. `false` means another pass
/// already claimed the row, so the caller must not start anything. `Id` is the primary key, so the
/// row count can only ever be 0 or 1 and a `bool` carries the whole answer.
#[must_use = "the delete is a claim: false means another caller already took this row"]
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
