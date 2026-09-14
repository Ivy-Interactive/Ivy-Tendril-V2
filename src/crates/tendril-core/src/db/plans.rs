use crate::models::{
    PlanFile, PlanMetadata, PlanStatus, PlanVerificationEntry, VerificationStatus,
};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Result};
use std::path::Path;

pub fn sync_plan(conn: &Connection, plan: &PlanFile) -> Result<()> {
    conn.execute(
        r#"
        INSERT INTO Plans (
            Id, Title, Project, Level, State, FolderPath, FolderName,
            YamlRaw, RevisionCount, LatestRevisionContent, Created, Updated, InitialPrompt, SourceUrl, ChatSessionId
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        ON CONFLICT(Id) DO UPDATE SET
            Title = excluded.Title,
            Project = excluded.Project,
            Level = excluded.Level,
            State = excluded.State,
            FolderPath = excluded.FolderPath,
            FolderName = excluded.FolderName,
            YamlRaw = excluded.YamlRaw,
            RevisionCount = excluded.RevisionCount,
            LatestRevisionContent = excluded.LatestRevisionContent,
            Created = excluded.Created,
            Updated = excluded.Updated,
            InitialPrompt = excluded.InitialPrompt,
            SourceUrl = excluded.SourceUrl,
            ChatSessionId = excluded.ChatSessionId;
        "#,
        params![
            plan.metadata.id,
            plan.metadata.title,
            plan.metadata.project,
            plan.metadata.level,
            plan.metadata.state.as_str(),
            plan.folder_path,
            plan.folder_name,
            plan.yaml_raw,
            plan.revision_count,
            plan.latest_revision_content,
            plan.metadata.created.to_rfc3339(),
            plan.metadata.updated.to_rfc3339(),
            plan.metadata.initial_prompt,
            plan.metadata.source_url,
            plan.metadata.chat_session_id,
        ],
    )?;

    let plan_id = plan.metadata.id;

    // Replace child relations
    conn.execute("DELETE FROM Repos WHERE PlanId = ?1", params![plan_id])?;
    for repo in &plan.metadata.repos {
        conn.execute(
            "INSERT INTO Repos (PlanId, RepoPath) VALUES (?1, ?2)",
            params![plan_id, repo],
        )?;
    }

    conn.execute("DELETE FROM Commits WHERE PlanId = ?1", params![plan_id])?;
    for commit in &plan.metadata.commits {
        conn.execute(
            "INSERT INTO Commits (PlanId, CommitHash) VALUES (?1, ?2)",
            params![plan_id, commit],
        )?;
    }

    conn.execute(
        "DELETE FROM PullRequests WHERE PlanId = ?1",
        params![plan_id],
    )?;
    for pr in &plan.metadata.prs {
        conn.execute(
            "INSERT INTO PullRequests (PlanId, PrUrl) VALUES (?1, ?2)",
            params![plan_id, pr],
        )?;
    }

    conn.execute(
        "DELETE FROM Verifications WHERE PlanId = ?1",
        params![plan_id],
    )?;
    for v in &plan.metadata.verifications {
        conn.execute(
            "INSERT INTO Verifications (PlanId, Name, Status) VALUES (?1, ?2, ?3)",
            params![plan_id, v.name, v.status.as_str()],
        )?;
    }

    conn.execute(
        "DELETE FROM RelatedPlans WHERE PlanId = ?1",
        params![plan_id],
    )?;
    for rp in &plan.metadata.related_plans {
        conn.execute(
            "INSERT INTO RelatedPlans (PlanId, RelatedPlanPath) VALUES (?1, ?2)",
            params![plan_id, rp],
        )?;
    }

    conn.execute("DELETE FROM DependsOn WHERE PlanId = ?1", params![plan_id])?;
    for dep in &plan.metadata.depends_on {
        conn.execute(
            "INSERT INTO DependsOn (PlanId, DependsOnPlanPath) VALUES (?1, ?2)",
            params![plan_id, dep],
        )?;
    }

    // The plan folder's costs.csv is the durable record of what the plan spent, shared with the
    // original app; the Costs table is a projection of it. Reconciling here is what makes V2 pick up
    // rows the original appended, on every sync_plan call site. Errors are logged and swallowed:
    // this returns rusqlite::Result, so an I/O failure must not abort the plan sync.
    if let Err(e) = crate::plans::costs_csv::reconcile_plan_costs(
        conn,
        std::path::Path::new(&plan.folder_path),
        plan_id,
        None,
    ) {
        tracing::warn!("Failed to reconcile costs for plan {}: {}", plan_id, e);
    }

    // `sync_plan` and `delete_plan` are the only two writers of `Plans` rows, so stamping here gives
    // every one of their call sites incremental-sync bookkeeping without an edit, and stops V2
    // looking frozen to the original, which reads the same key.
    set_last_sync_time(conn, Utc::now())?;

    Ok(())
}

/// Every column a `PlanFile` needs, aliased `p` so an FTS5 join can be bolted on without touching
/// the projection.
const PLAN_SELECT: &str = "SELECT p.Id, p.Title, p.Project, p.Level, p.State, p.FolderPath, p.FolderName, p.YamlRaw, p.RevisionCount, p.LatestRevisionContent, p.Created, p.Updated, p.InitialPrompt, p.SourceUrl, p.ChatSessionId";

type BoxedParams = Vec<Box<dyn rusqlite::ToSql>>;

/// Appends the status and project filters shared by all three search paths.
fn push_plan_filters(
    sql: &mut String,
    params_vec: &mut BoxedParams,
    status_filter: Option<PlanStatus>,
    project_filter: Option<&str>,
) {
    if let Some(status) = status_filter {
        sql.push_str(" AND p.State = ?");
        params_vec.push(Box::new(status.as_str().to_string()));
    }

    if let Some(proj) = project_filter {
        sql.push_str(" AND (LOWER(p.Project) = LOWER(?) OR LOWER(p.Project) LIKE LOWER(?))");
        params_vec.push(Box::new(proj.to_string()));
        params_vec.push(Box::new(format!("%{}%", proj)));
    }
}

/// Strips the FTS5 syntax a search box produces by accident, so a pasted URL or a stray bracket is
/// a search rather than an error. Ported from the original's `SanitizeFts5Query`, plus `:` — FTS5's
/// column-filter operator, which turns any pasted URL into `no such column: https`.
///
/// This cannot make every input valid (`AND` on its own still fails, while *stepping* rather than
/// preparing), which is why [`get_plans`] also tolerates an error from the FTS statement.
pub(crate) fn sanitize_fts5_query(query: &str) -> String {
    let mut kept: Vec<char> = Vec::with_capacity(query.len());

    for ch in query.chars() {
        match ch {
            '/' | '\\' | ':' => kept.push(' '),
            '(' | ')' | '^' => {}
            // Keep a prefix wildcard (`button*`), drop a bare one — FTS5 rejects `*` that does not
            // follow a token. The original used a `(?<!\w)\*` lookbehind, which `regex` has no
            // equivalent for, so the previously kept character is inspected instead.
            '*' => {
                if kept
                    .last()
                    .is_some_and(|prev| prev.is_alphanumeric() || *prev == '_')
                {
                    kept.push('*');
                }
            }
            _ => kept.push(ch),
        }
    }

    // An unbalanced quote is an unterminated phrase, and FTS5 treats that as a syntax error.
    if kept.iter().filter(|c| **c == '"').count() % 2 != 0 {
        for ch in kept.iter_mut() {
            if *ch == '"' {
                *ch = ' ';
            }
        }
    }

    kept.iter()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn get_plans(
    conn: &Connection,
    status_filter: Option<PlanStatus>,
    project_filter: Option<&str>,
    text_filter: Option<&str>,
) -> Result<Vec<PlanFile>> {
    let Some(text) = text_filter.map(str::trim).filter(|t| !t.is_empty()) else {
        let mut sql = format!("{} FROM Plans p WHERE 1=1", PLAN_SELECT);
        let mut params_vec: BoxedParams = Vec::new();
        push_plan_filters(&mut sql, &mut params_vec, status_filter, project_filter);
        sql.push_str(" ORDER BY p.Id DESC");
        return query_plans(conn, &sql, &params_vec);
    };

    // A bare plan number is a lookup, not a search — `42` and `00042` both mean plan 42. It has to
    // be a separate statement: SQLite rejects a `MATCH` that is OR'd with anything else ("unable to
    // use function MATCH in the requested context"), and an exact id deserves the top slot anyway.
    let id_hit = match text.parse::<i32>() {
        Ok(id) if id > 0 => {
            let mut sql = format!("{} FROM Plans p WHERE p.Id = ?", PLAN_SELECT);
            let mut params_vec: BoxedParams = vec![Box::new(id)];
            push_plan_filters(&mut sql, &mut params_vec, status_filter, project_filter);
            query_plans(conn, &sql, &params_vec)?
        }
        _ => Vec::new(),
    };

    let sanitized = sanitize_fts5_query(text);
    let mut plans = if sanitized.is_empty() {
        Vec::new()
    } else {
        let mut sql = format!(
            "{} FROM Plans p INNER JOIN PlanSearch fts ON fts.rowid = p.Id WHERE PlanSearch MATCH ?",
            PLAN_SELECT
        );
        let mut params_vec: BoxedParams = vec![Box::new(sanitized.clone())];
        push_plan_filters(&mut sql, &mut params_vec, status_filter, project_filter);
        // `rank` is bm25 and negative, so ascending is best-first; ties keep V2's newest-first order.
        sql.push_str(" ORDER BY rank, p.Id DESC");

        // Anything the user typed can be invalid FTS5, and a missing `PlanSearch` table (a database
        // created before the index existed) fails here too. Either way it is "no FTS results", never
        // a 500 for the caller.
        query_plans(conn, &sql, &params_vec).unwrap_or_else(|e| {
            tracing::debug!(
                "FTS5 search for {:?} failed, falling back to LIKE: {}",
                sanitized,
                e
            );
            Vec::new()
        })
    };

    if plans.is_empty() {
        // FTS5 only matches whole tokens, but a search box is used for fragments — `worktre` has to
        // keep finding `worktree`. Same six columns the original falls back on.
        let mut sql = format!(
            "{} FROM Plans p WHERE (p.Title LIKE ? OR p.LatestRevisionContent LIKE ? OR CAST(p.Id AS TEXT) LIKE ? OR p.Project LIKE ? OR p.SourceUrl LIKE ? OR p.InitialPrompt LIKE ?)",
            PLAN_SELECT
        );
        let pattern = format!("%{}%", text);
        let mut params_vec: BoxedParams = (0..6)
            .map(|_| Box::new(pattern.clone()) as Box<dyn rusqlite::ToSql>)
            .collect();
        push_plan_filters(&mut sql, &mut params_vec, status_filter, project_filter);
        sql.push_str(" ORDER BY p.Id DESC");
        plans = query_plans(conn, &sql, &params_vec)?;
    }

    if id_hit.is_empty() {
        return Ok(plans);
    }

    let hit_ids: Vec<i32> = id_hit.iter().map(|p| p.metadata.id).collect();
    plans.retain(|p| !hit_ids.contains(&p.metadata.id));
    let mut merged = id_hit;
    merged.append(&mut plans);
    Ok(merged)
}

/// Runs a query whose projection is [`PLAN_SELECT`] and maps every row to a [`PlanFile`]. Child
/// tables (repos, commits, …) are not loaded — see [`get_plan_by_id`] for those.
fn query_plans(conn: &Connection, sql: &str, params_vec: &BoxedParams) -> Result<Vec<PlanFile>> {
    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(sql)?;

    let mut rows = stmt.query(params_slice.as_slice())?;
    let mut plans = Vec::new();

    while let Some(row) = rows.next()? {
        let id: i32 = row.get(0)?;
        let title: String = row.get(1)?;
        let project: String = row.get(2)?;
        let level: String = row.get(3)?;
        let state_str: String = row.get(4)?;
        let folder_path: String = row.get(5)?;
        let folder_name: String = row.get(6)?;
        let yaml_raw: String = row.get(7)?;
        let revision_count: i32 = row.get(8)?;
        let latest_revision_content: String = row.get(9)?;
        let created_str: String = row.get(10)?;
        let updated_str: String = row.get(11)?;
        let initial_prompt: Option<String> = row.get(12)?;
        let source_url: Option<String> = row.get(13)?;
        let chat_session_id: Option<String> = row.get(14)?;

        let state = PlanStatus::from_str_loose(&state_str).unwrap_or(PlanStatus::Draft);
        let created = DateTime::parse_from_rfc3339(&created_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());
        let updated = DateTime::parse_from_rfc3339(&updated_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());

        let metadata = PlanMetadata {
            id,
            project,
            level,
            title,
            state,
            repos: Vec::new(),
            commits: Vec::new(),
            prs: Vec::new(),
            verifications: Vec::new(),
            related_plans: Vec::new(),
            depends_on: Vec::new(),
            created,
            updated,
            initial_prompt,
            source_url,
            partial_delivery: false,
            chat_session_id,
        };

        plans.push(PlanFile {
            metadata,
            latest_revision_content,
            folder_path,
            folder_name,
            yaml_raw,
            revision_count,
        });
    }

    Ok(plans)
}

pub fn get_plan_by_id(conn: &Connection, id: i32) -> Result<Option<PlanFile>> {
    // Reached directly by primary key: routing a single-plan lookup through `get_plans` would make
    // it depend on the search path's FTS/LIKE fallback chain.
    let sql = format!("{} FROM Plans p WHERE p.Id = ?", PLAN_SELECT);
    let params_vec: BoxedParams = vec![Box::new(id)];
    let plans = query_plans(conn, &sql, &params_vec)?;

    if let Some(mut plan) = plans.into_iter().next() {
        // Load child tables
        let mut repo_stmt = conn.prepare("SELECT RepoPath FROM Repos WHERE PlanId = ?")?;
        let repos: Vec<String> = repo_stmt
            .query_map([id], |r| r.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        plan.metadata.repos = repos;

        let mut ver_stmt =
            conn.prepare("SELECT Name, Status FROM Verifications WHERE PlanId = ?")?;
        let verifications: Vec<PlanVerificationEntry> = ver_stmt
            .query_map([id], |r| {
                let name: String = r.get(0)?;
                let status_str: String = r.get(1)?;
                let status = VerificationStatus::from_str_loose(&status_str)
                    .unwrap_or(VerificationStatus::Pending);
                Ok(PlanVerificationEntry { name, status })
            })?
            .filter_map(|r| r.ok())
            .collect();
        plan.metadata.verifications = verifications;

        let mut pr_stmt = conn.prepare("SELECT PrUrl FROM PullRequests WHERE PlanId = ?")?;
        plan.metadata.prs = pr_stmt
            .query_map([id], |r| r.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        let mut commit_stmt = conn.prepare("SELECT CommitHash FROM Commits WHERE PlanId = ?")?;
        plan.metadata.commits = commit_stmt
            .query_map([id], |r| r.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        let mut dep_stmt =
            conn.prepare("SELECT DependsOnPlanPath FROM DependsOn WHERE PlanId = ?")?;
        plan.metadata.depends_on = dep_stmt
            .query_map([id], |r| r.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        let mut rel_stmt =
            conn.prepare("SELECT RelatedPlanPath FROM RelatedPlans WHERE PlanId = ?")?;
        plan.metadata.related_plans = rel_stmt
            .query_map([id], |r| r.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        return Ok(Some(plan));
    }
    Ok(None)
}

pub fn delete_plan(conn: &Connection, id: i32) -> Result<()> {
    conn.execute("DELETE FROM Plans WHERE Id = ?1", params![id])?;
    set_last_sync_time(conn, Utc::now())?;
    Ok(())
}

/// Discards and reinserts every FTS5 row from `Plans`, returning the number of plans indexed.
/// Idempotent, and the repair path for an index the triggers could not have maintained (rows written
/// while the index did not exist yet).
pub fn rebuild_search_index(conn: &Connection) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO PlanSearch(PlanSearch) VALUES('delete-all')",
        [],
    )?;
    let indexed = tx.execute(
        r#"
        INSERT INTO PlanSearch(rowid, Title, LatestRevisionContent, Project, InitialPrompt, SourceUrl)
        SELECT Id, Title, LatestRevisionContent, Project, InitialPrompt, SourceUrl FROM Plans
        "#,
        [],
    )?;
    tx.commit()?;
    Ok(indexed)
}

/// What `tendril doctor` needs to know about the plan search index. Collected in `tendril-core` so
/// the CLI can report on it without a `rusqlite` dependency of its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanSearchHealth {
    pub index_present: bool,
    /// Triggers named in the schema that are absent — an index that silently stops tracking writes.
    pub missing_triggers: Vec<String>,
    pub integrity_ok: bool,
}

/// The three triggers that keep `PlanSearch` in step with `Plans`.
pub const PLAN_SEARCH_TRIGGERS: [&str; 3] =
    ["plans_fts_insert", "plans_fts_update", "plans_fts_delete"];

pub fn check_plan_search(conn: &Connection) -> Result<PlanSearchHealth> {
    let index_present: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='PlanSearch')",
        [],
        |r| r.get(0),
    )?;

    let mut missing_triggers = Vec::new();
    for trigger in PLAN_SEARCH_TRIGGERS {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?1)",
            params![trigger],
            |r| r.get(0),
        )?;
        if !exists {
            missing_triggers.push(trigger.to_string());
        }
    }

    // A corrupt index reports itself only when asked; the check is a no-op on a healthy one.
    let integrity_ok = index_present
        && conn
            .execute(
                "INSERT INTO PlanSearch(PlanSearch) VALUES('integrity-check')",
                [],
            )
            .is_ok();

    Ok(PlanSearchHealth {
        index_present,
        missing_triggers,
        integrity_ok,
    })
}

/// Reads the `LastSyncTime` stamp. An absent or unparseable value is `None` rather than an error:
/// the only sensible response to either is a full scan.
pub fn get_last_sync_time(conn: &Connection) -> Result<Option<DateTime<Utc>>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT Value FROM SyncMetadata WHERE Key = 'LastSyncTime'",
            [],
            |r| r.get(0),
        )
        .optional()?;

    Ok(raw.and_then(|value| {
        DateTime::parse_from_rfc3339(&value)
            .map(|dt| dt.with_timezone(&Utc))
            .ok()
    }))
}

/// Stamps `LastSyncTime`. RFC 3339 with a `+00:00` offset, which the original's
/// `DateTime.TryParse(..., AdjustToUniversal)` reads, just as `parse_from_rfc3339` reads the seven
/// fractional digits the original writes.
pub fn set_last_sync_time(conn: &Connection, time: DateTime<Utc>) -> Result<()> {
    conn.execute(
        r#"
        INSERT INTO SyncMetadata (Key, Value) VALUES ('LastSyncTime', ?1)
        ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value
        "#,
        params![time.to_rfc3339()],
    )?;
    Ok(())
}

/// Syncs plan folders whose `plan.yaml` or newest revision changed since `since` (`None` = all),
/// returning the number of folders synced and stamping `LastSyncTime`.
///
/// This is V2's only disk-to-database reconciliation: without it a plan folder written outside a V2
/// write path — by the original, by hand, or by a plan migration — never reaches the `Plans` table.
pub fn sync_plans_from_disk(
    conn: &Connection,
    plans_dir: &Path,
    since: Option<DateTime<Utc>>,
) -> crate::error::Result<usize> {
    // Stamped before the scan, so a plan written while it runs is picked up by the next pass rather
    // than falling into the gap between "read" and "stamped".
    let started = Utc::now();

    // Filesystem mtime granularity is a whole second on some volumes, so a plan written in the same
    // second as the last stamp would otherwise be missed.
    let cutoff = since.map(|s| s - chrono::Duration::seconds(2));

    let mut synced = 0usize;

    for entry in std::fs::read_dir(plans_dir)? {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!(
                    "Skipping unreadable entry in {}: {}",
                    plans_dir.display(),
                    e
                );
                continue;
            }
        };

        let folder = entry.path();
        if !folder.is_dir() || !folder.join("plan.yaml").exists() {
            continue;
        }

        if let Some(cutoff) = cutoff {
            match plan_folder_modified(&folder) {
                Some(modified) if modified <= cutoff => continue,
                _ => {}
            }
        }

        match crate::plans::read_plan_file(&folder) {
            Ok(plan) => match sync_plan(conn, &plan) {
                Ok(()) => synced += 1,
                Err(e) => tracing::warn!("Failed to sync plan {}: {}", folder.display(), e),
            },
            // One unparseable plan.yaml must not abort the scan for every other plan.
            Err(e) => tracing::warn!("Skipping unreadable plan {}: {}", folder.display(), e),
        }
    }

    set_last_sync_time(conn, started)?;
    Ok(synced)
}

/// Newest mtime of `plan.yaml` and of the files directly inside `Revisions/` — the two inputs to a
/// plan's database row. Never descends into `Worktrees/`, which is a whole checkout per plan.
fn plan_folder_modified(folder: &Path) -> Option<DateTime<Utc>> {
    fn modified(path: &Path) -> Option<DateTime<Utc>> {
        std::fs::metadata(path)
            .and_then(|m| m.modified())
            .map(DateTime::<Utc>::from)
            .ok()
    }

    let mut newest = modified(&folder.join("plan.yaml"));

    if let Ok(revisions) = std::fs::read_dir(folder.join("Revisions")) {
        for revision in revisions.filter_map(|e| e.ok()) {
            let candidate = modified(&revision.path());
            if candidate > newest {
                newest = candidate;
            }
        }
    }

    newest
}

pub fn rename_verification(conn: &Connection, old_name: &str, new_name: &str) -> Result<usize> {
    let count = conn.execute(
        "UPDATE Verifications SET Name = ?1 WHERE LOWER(Name) = LOWER(?2)",
        params![new_name, old_name],
    )?;
    Ok(count)
}

pub fn rename_project(conn: &Connection, old_name: &str, new_name: &str) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let count = tx.execute(
        "UPDATE Plans SET Project = ?1 WHERE LOWER(Project) = LOWER(?2)",
        params![new_name, old_name],
    )?;
    tx.execute(
        "UPDATE Jobs SET Project = ?1 WHERE LOWER(Project) = LOWER(?2)",
        params![new_name, old_name],
    )?;
    tx.execute(
        "UPDATE Recommendations SET Project = ?1 WHERE LOWER(Project) = LOWER(?2)",
        params![new_name, old_name],
    )?;
    tx.commit()?;
    Ok(count)
}
