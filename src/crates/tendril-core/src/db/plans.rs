use crate::models::{
    PlanFile, PlanMetadata, PlanStatus, PlanVerificationEntry, RecommendationStatus,
    VerificationStatus,
};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, Result};

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

    // `plan.yaml` is the source of truth for recommendations; this table is a denormalised projection
    // of it, carrying the owning plan's title, folder, project and state so "every open recommendation
    // across all plans" can be answered without opening one file. Delete-then-insert, like the six
    // relations above, is what makes the projection track the YAML for free: every add, edit, accept,
    // decline and remove ends in a `sync_plan` call. `None` and `Some(vec![])` both mean "delete the
    // rows and insert nothing", so a plan whose last recommendation was removed leaves no residue.
    conn.execute(
        "DELETE FROM Recommendations WHERE PlanId = ?1",
        params![plan_id],
    )?;
    if let Some(recs) = &plan.metadata.recommendations {
        for rec in recs {
            let state = if rec.state.trim().is_empty() {
                RecommendationStatus::PENDING
            } else {
                rec.state.as_str()
            };
            conn.execute(
                r#"
                INSERT INTO Recommendations (
                    PlanId, Title, Description, State, DeclineReason, Notes,
                    PlanTitle, PlanFolderName, Project, Date, SourcePlanStatus, Impact
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                "#,
                params![
                    plan_id,
                    rec.title,
                    rec.description,
                    state,
                    rec.decline_reason,
                    rec.notes,
                    plan.metadata.title,
                    plan.folder_name,
                    plan.metadata.project,
                    plan.metadata.updated.to_rfc3339(),
                    plan.metadata.state.as_str(),
                    rec.impact,
                ],
            )?;
        }
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

    Ok(())
}

pub fn get_plans(
    conn: &Connection,
    status_filter: Option<PlanStatus>,
    project_filter: Option<&str>,
    text_filter: Option<&str>,
) -> Result<Vec<PlanFile>> {
    let mut sql = "SELECT Id, Title, Project, Level, State, FolderPath, FolderName, YamlRaw, RevisionCount, LatestRevisionContent, Created, Updated, InitialPrompt, SourceUrl, ChatSessionId FROM Plans WHERE 1=1".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(status) = status_filter {
        sql.push_str(" AND State = ?");
        params_vec.push(Box::new(status.as_str().to_string()));
    }

    if let Some(proj) = project_filter {
        sql.push_str(" AND (LOWER(Project) = LOWER(?) OR LOWER(Project) LIKE LOWER(?))");
        params_vec.push(Box::new(proj.to_string()));
        params_vec.push(Box::new(format!("%{}%", proj)));
    }

    if let Some(text) = text_filter {
        if !text.trim().is_empty() {
            sql.push_str(
                " AND (Title LIKE ? OR LatestRevisionContent LIKE ? OR CAST(Id AS TEXT) LIKE ?)",
            );
            let pattern = format!("%{}%", text.trim());
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }

    sql.push_str(" ORDER BY Id DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;

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
            // Like the child relations above, left empty here and loaded by `get_plan_by_id`.
            recommendations: None,
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
    let plans = get_plans(conn, None, None, Some(&id.to_string()))?;
    if let Some(mut plan) = plans.into_iter().find(|p| p.metadata.id == id) {
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
    Ok(())
}

pub fn rename_verification(conn: &Connection, old_name: &str, new_name: &str) -> Result<usize> {
    let count = conn.execute(
        "UPDATE Verifications SET Name = ?1 WHERE LOWER(Name) = LOWER(?2)",
        params![new_name, old_name],
    )?;
    Ok(count)
}

/// One row of the `Recommendations` projection: a recommendation plus the denormalised details of the
/// plan it belongs to, which is what lets the cross-plan view be answered from the table alone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecommendationRow {
    pub plan_id: i32,
    pub plan_title: String,
    pub plan_folder_name: String,
    pub project: String,
    pub source_plan_status: String,
    pub date: String,
    pub title: String,
    pub description: String,
    pub state: String,
    pub decline_reason: Option<String>,
    pub notes: Option<String>,
    pub impact: Option<String>,
}

/// Every recommendation in the database, newest plan first, optionally narrowed to one project and/or
/// one state (both matched case-insensitively).
///
/// The `PlanId`/`Title` tie-breakers keep the order deterministic when several plans share an
/// `updated` timestamp, which a bare `ORDER BY Date DESC` does not.
pub fn get_recommendations(
    conn: &Connection,
    project_filter: Option<&str>,
    state_filter: Option<&str>,
) -> Result<Vec<RecommendationRow>> {
    let mut sql = String::from(
        r#"
        SELECT PlanId, PlanTitle, PlanFolderName, Project, SourcePlanStatus, Date,
               Title, Description, State, DeclineReason, Notes, Impact
        FROM Recommendations
        "#,
    );
    let mut clauses: Vec<&str> = Vec::new();
    let mut args: Vec<String> = Vec::new();

    if let Some(project) = project_filter {
        clauses.push("LOWER(Project) = LOWER(?)");
        args.push(project.to_string());
    }
    if let Some(state) = state_filter {
        clauses.push("LOWER(State) = LOWER(?)");
        args.push(state.to_string());
    }
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(" ORDER BY Date DESC, PlanId DESC, Title ASC");

    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> =
        args.iter().map(|a| a as &dyn rusqlite::ToSql).collect();
    let rows = stmt.query_map(params.as_slice(), |row| {
        Ok(RecommendationRow {
            plan_id: row.get(0)?,
            plan_title: row.get(1)?,
            plan_folder_name: row.get(2)?,
            project: row.get(3)?,
            source_plan_status: row.get(4)?,
            date: row.get(5)?,
            title: row.get(6)?,
            description: row.get(7)?,
            state: row.get(8)?,
            decline_reason: row.get(9)?,
            notes: row.get(10)?,
            impact: row.get(11)?,
        })
    })?;

    rows.collect()
}

/// Rebuilds the whole `Recommendations` projection from the plan folders on disk, returning
/// `(rows written, plans read)`.
///
/// Wiping the table first is the point: it is what clears rows for plans that no longer exist and
/// rows a previous install wrote before `sync_plan` learned to maintain them. Folders that fail to
/// parse are skipped rather than aborting the rebuild — one broken `plan.yaml` must not leave the
/// projection empty.
pub fn rebuild_recommendations_projection(
    conn: &Connection,
    plans_dir: &std::path::Path,
) -> Result<(usize, usize)> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM Recommendations", [])?;

    let mut rows = 0usize;
    let mut plans = 0usize;

    if plans_dir.exists() {
        let entries = match std::fs::read_dir(plans_dir) {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!(
                    "Failed to read plans directory {}: {}",
                    plans_dir.display(),
                    e
                );
                tx.commit()?;
                return Ok((0, 0));
            }
        };

        for entry in entries.filter_map(|e| e.ok()) {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let Ok(plan) = crate::plans::reader::read_plan_file(&entry.path()) else {
                continue;
            };
            plans += 1;
            rows += plan
                .metadata
                .recommendations
                .as_ref()
                .map(|r| r.len())
                .unwrap_or(0);
            sync_plan(&tx, &plan)?;
        }
    }

    tx.commit()?;
    Ok((rows, plans))
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
