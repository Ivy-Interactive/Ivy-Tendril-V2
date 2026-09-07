use crate::models::{
    PlanFile, PlanMetadata, PlanStatus, PlanVerificationEntry, VerificationStatus,
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
