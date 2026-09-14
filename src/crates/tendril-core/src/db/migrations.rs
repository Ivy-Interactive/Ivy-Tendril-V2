use rusqlite::{Connection, Result};

/// The schema version this batch produces, matching the last migration in the original app's chain
/// (`Migration_025_CostsAgent`). Both apps open the same `tendril.db`, so the declarative schema
/// below has to be indistinguishable from the original's fully migrated one.
///
/// The original refuses to run when the database's `user_version` exceeds its own latest migration,
/// so bumping this past 25 is a deliberate act that requires a matching migration on the original
/// side first.
pub const SCHEMA_VERSION: i64 = 25;

/// Every `Costs` index, in one place: `ensure_costs_cost_nullable` rebuilds the table with a
/// `DROP TABLE`, which takes the table's indexes with it, so they have to be recreated from the
/// same copy the fresh-database path uses.
const COSTS_INDEXES: &str = r#"
    CREATE INDEX IF NOT EXISTS idx_costs_plan ON Costs(PlanId);
    CREATE INDEX IF NOT EXISTS idx_costs_plan_logtimestamp ON Costs(PlanId, LogTimestamp);
    CREATE INDEX IF NOT EXISTS idx_costs_logtimestamp ON Costs(LogTimestamp);
    CREATE INDEX IF NOT EXISTS idx_costs_promptware ON Costs(Promptware);
    CREATE INDEX IF NOT EXISTS idx_costs_promptware_logtimestamp ON Costs(Promptware, LogTimestamp);
"#;

pub fn apply_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS Plans (
            Id INTEGER PRIMARY KEY,
            Title TEXT NOT NULL,
            Project TEXT NOT NULL,
            Level TEXT NOT NULL,
            State TEXT NOT NULL,
            FolderPath TEXT NOT NULL UNIQUE,
            FolderName TEXT NOT NULL,
            YamlRaw TEXT NOT NULL,
            RevisionCount INTEGER NOT NULL DEFAULT 1,
            LatestRevisionContent TEXT NOT NULL DEFAULT '',
            Created TEXT NOT NULL,
            Updated TEXT NOT NULL,
            InitialPrompt TEXT,
            SourceUrl TEXT,
            ChatSessionId TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_plans_state ON Plans(State);
        CREATE INDEX IF NOT EXISTS idx_plans_project ON Plans(Project);
        CREATE INDEX IF NOT EXISTS idx_plans_updated ON Plans(Updated DESC);

        CREATE TABLE IF NOT EXISTS Repos (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            PlanId INTEGER NOT NULL,
            RepoPath TEXT NOT NULL,
            FOREIGN KEY (PlanId) REFERENCES Plans(Id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_repos_plan ON Repos(PlanId);

        CREATE TABLE IF NOT EXISTS Commits (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            PlanId INTEGER NOT NULL,
            CommitHash TEXT NOT NULL,
            FOREIGN KEY (PlanId) REFERENCES Plans(Id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_commits_plan ON Commits(PlanId);

        CREATE TABLE IF NOT EXISTS PullRequests (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            PlanId INTEGER NOT NULL,
            PrUrl TEXT NOT NULL,
            FOREIGN KEY (PlanId) REFERENCES Plans(Id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_prs_plan ON PullRequests(PlanId);

        CREATE TABLE IF NOT EXISTS Verifications (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            PlanId INTEGER NOT NULL,
            Name TEXT NOT NULL,
            Status TEXT NOT NULL,
            FOREIGN KEY (PlanId) REFERENCES Plans(Id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_verifications_plan ON Verifications(PlanId);

        CREATE TABLE IF NOT EXISTS RelatedPlans (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            PlanId INTEGER NOT NULL,
            RelatedPlanPath TEXT NOT NULL,
            FOREIGN KEY (PlanId) REFERENCES Plans(Id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_related_plan ON RelatedPlans(PlanId);

        CREATE TABLE IF NOT EXISTS DependsOn (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            PlanId INTEGER NOT NULL,
            DependsOnPlanPath TEXT NOT NULL,
            FOREIGN KEY (PlanId) REFERENCES Plans(Id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_depends_plan ON DependsOn(PlanId);

        -- Column order matches migration 001 + 022 + 024 + 025 so a fresh V2 database and a fully
        -- migrated original database are indistinguishable. Cost is nullable on purpose: a
        -- subscription-plan run reports tokens and no charge, and writing 0.0 makes an unpriceable
        -- run read as free. SUM and COUNT(Cost) skipping NULL is the arithmetic we want.
        CREATE TABLE IF NOT EXISTS Costs (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            PlanId INTEGER NOT NULL,
            Promptware TEXT NOT NULL,
            Tokens INTEGER NOT NULL,
            Cost REAL NULL,
            Model TEXT,
            LogTimestamp TEXT,
            CostSource TEXT,
            Agent TEXT,
            FOREIGN KEY (PlanId) REFERENCES Plans(Id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS Recommendations (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            PlanId INTEGER NOT NULL,
            Title TEXT NOT NULL,
            Description TEXT NOT NULL,
            State TEXT NOT NULL DEFAULT 'Pending',
            DeclineReason TEXT,
            PlanTitle TEXT NOT NULL DEFAULT '',
            PlanFolderName TEXT NOT NULL DEFAULT '',
            Project TEXT NOT NULL DEFAULT '',
            Date TEXT NOT NULL,
            SourcePlanStatus TEXT NOT NULL DEFAULT 'Draft',
            Impact TEXT,
            FOREIGN KEY (PlanId) REFERENCES Plans(Id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_recommendations_plan ON Recommendations(PlanId);
        CREATE INDEX IF NOT EXISTS idx_recommendations_state ON Recommendations(State);

        CREATE TABLE IF NOT EXISTS SyncMetadata (
            Key TEXT PRIMARY KEY,
            Value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS Jobs (
            Id TEXT PRIMARY KEY,
            Type TEXT NOT NULL,
            PlanFile TEXT NOT NULL,
            Project TEXT NOT NULL,
            Status TEXT NOT NULL,
            Provider TEXT NOT NULL DEFAULT 'claude',
            SessionId TEXT,
            StartedAt TEXT,
            CompletedAt TEXT,
            DurationSeconds INTEGER,
            Cost REAL,
            Tokens INTEGER,
            StatusMessage TEXT,
            Args TEXT,
            TypedArgs TEXT,
            WorkingDirectory TEXT,
            CliCommand TEXT,
            Cleared INTEGER NOT NULL DEFAULT 0,
            ProcessId INTEGER,
            ReportedPlanId TEXT,
            ReportedPlanTitle TEXT,
            ReportedFailureReason TEXT,
            Model TEXT,
            InputTokens INTEGER,
            OutputTokens INTEGER,
            CacheReadTokens INTEGER,
            CacheWriteTokens INTEGER,
            ReasoningTokens INTEGER,
            CostSource TEXT,
            ExecutionProfile TEXT,
            Effort TEXT,
            PreviousPlanState TEXT,
            Priority INTEGER NOT NULL DEFAULT 0,
            LastOutputAt TEXT,
            WaitForJobIds TEXT,
            PermissionDenials TEXT,
            DedupeKey TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON Jobs(Status);
        CREATE INDEX IF NOT EXISTS idx_jobs_completed ON Jobs(CompletedAt DESC);
        CREATE INDEX IF NOT EXISTS idx_jobs_planfile ON Jobs(PlanFile);

        CREATE TABLE IF NOT EXISTS PrStatuses (
            PrUrl TEXT PRIMARY KEY,
            Owner TEXT NOT NULL,
            Repo TEXT NOT NULL,
            Status TEXT NOT NULL,
            LastChecked TEXT NOT NULL,
            Branch TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_pr_statuses_owner_repo ON PrStatuses(Owner, Repo);
        CREATE INDEX IF NOT EXISTS idx_pr_statuses_status ON PrStatuses(Status);
        "#,
    )?;

    conn.execute_batch(COSTS_INDEXES)?;

    // The schema above is declarative `CREATE TABLE IF NOT EXISTS`, so a database created by an
    // earlier version keeps its original column set. Columns added after the fact need an
    // idempotent ALTER pass.
    ensure_columns(
        conn,
        "Jobs",
        &[
            ("PreviousPlanState", "TEXT"),
            ("Priority", "INTEGER NOT NULL DEFAULT 0"),
            ("LastOutputAt", "TEXT"),
            ("WaitForJobIds", "TEXT"),
            ("PermissionDenials", "TEXT"),
            ("DedupeKey", "TEXT"),
        ],
    )?;
    ensure_columns(conn, "Plans", &[("ChatSessionId", "TEXT")])?;
    ensure_columns(
        conn,
        "Costs",
        &[("Model", "TEXT"), ("CostSource", "TEXT"), ("Agent", "TEXT")],
    )?;
    ensure_costs_cost_nullable(conn)?;
    ensure_plan_search(conn)?;

    // Must run *after* the `ensure_columns` pass above, not inside the batch: on a database created
    // before `DedupeKey` existed, the batch runs before the ALTER and the index would reference a
    // column that is not there yet.
    //
    // A `NULL` key never collides in a SQLite unique index, which is the intended reading of a forced
    // submission and of a job type that is not deduplicated: both store `NULL` and opt out entirely
    // rather than blocking the next submission.
    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_dedupe_inflight
           ON Jobs(DedupeKey)
           WHERE DedupeKey IS NOT NULL AND Status IN ('Pending', 'Queued', 'Running');",
    )?;

    stamp_user_version(conn)?;

    Ok(())
}

/// Stamps `user_version` with `MAX(existing, SCHEMA_VERSION)`. The old unconditional assignment
/// inside the batch rewrote an existing 25 down to 24 on every open, which made the original app
/// replay migration 25 only and never notice the objects migrations 2, 7, 22 and 24 produce were
/// missing. A pragma cannot be parameterised, hence the `format!`.
fn stamp_user_version(conn: &Connection) -> Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if current < SCHEMA_VERSION {
        conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
    }
    Ok(())
}

/// Drops `NOT NULL` from `Costs.Cost` on a database V2 created before this was fixed. SQLite cannot
/// drop a constraint with `ALTER TABLE`, so the table is rebuilt exactly as migration 022 does.
///
/// Existing `0.0` rows stay `0.0`: which historical zero meant "unknown" is not guessable from the
/// row.
fn ensure_costs_cost_nullable(conn: &Connection) -> Result<()> {
    let mut cost_is_not_null = false;
    {
        let mut stmt = conn.prepare("PRAGMA table_info(Costs)")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            if row.get::<_, String>(1)? == "Cost" {
                cost_is_not_null = row.get::<_, i64>(3)? == 1;
                break;
            }
        }
    }

    if !cost_is_not_null {
        return Ok(());
    }

    // Every column of the new shape exists on the old table by now: the `ensure_columns` pass above
    // added Model, CostSource and Agent before we got here.
    conn.execute_batch(
        r#"
        CREATE TABLE Costs_new (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            PlanId INTEGER NOT NULL,
            Promptware TEXT NOT NULL,
            Tokens INTEGER NOT NULL,
            Cost REAL NULL,
            Model TEXT,
            LogTimestamp TEXT,
            CostSource TEXT,
            Agent TEXT,
            FOREIGN KEY (PlanId) REFERENCES Plans(Id) ON DELETE CASCADE
        );
        INSERT INTO Costs_new (Id, PlanId, Promptware, Tokens, Cost, Model, LogTimestamp, CostSource, Agent)
            SELECT Id, PlanId, Promptware, Tokens, Cost, Model, LogTimestamp, CostSource, Agent FROM Costs;
        DROP TABLE Costs;
        ALTER TABLE Costs_new RENAME TO Costs;
        "#,
    )?;

    // `DROP TABLE` took the indexes with it.
    conn.execute_batch(COSTS_INDEXES)?;

    Ok(())
}

/// Creates the original's FTS5 `PlanSearch` index and its triggers, in migration 007's shape, and
/// backfills it from any `Plans` rows already present. Without it the original hard-fails plan
/// search with `no such table: PlanSearch` against a database V2 created.
///
/// This runs outside the declarative batch because an existing V2 database needs the backfill,
/// mirroring migration 002/007's populate step. FTS5 is available because `libsqlite3-sys`'s bundled
/// build passes `-DSQLITE_ENABLE_FTS5`.
fn ensure_plan_search(conn: &Connection) -> Result<()> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='PlanSearch')",
        [],
        |r| r.get(0),
    )?;
    if exists {
        return Ok(());
    }

    conn.execute_batch(
        r#"
        DROP TRIGGER IF EXISTS plans_fts_insert;
        DROP TRIGGER IF EXISTS plans_fts_update;
        DROP TRIGGER IF EXISTS plans_fts_delete;

        CREATE VIRTUAL TABLE PlanSearch USING fts5(
            Title,
            LatestRevisionContent,
            Project,
            InitialPrompt,
            SourceUrl,
            content='Plans',
            content_rowid=Id
        );

        CREATE TRIGGER plans_fts_insert AFTER INSERT ON Plans BEGIN
            INSERT INTO PlanSearch(rowid, Title, LatestRevisionContent, Project, InitialPrompt, SourceUrl)
            VALUES (new.Id, new.Title, new.LatestRevisionContent, new.Project, new.InitialPrompt, new.SourceUrl);
        END;

        CREATE TRIGGER plans_fts_update AFTER UPDATE ON Plans BEGIN
            INSERT INTO PlanSearch(PlanSearch, rowid, Title, LatestRevisionContent, Project, InitialPrompt, SourceUrl)
            VALUES ('delete', old.Id, old.Title, old.LatestRevisionContent, old.Project, old.InitialPrompt, old.SourceUrl);
            INSERT INTO PlanSearch(rowid, Title, LatestRevisionContent, Project, InitialPrompt, SourceUrl)
            VALUES (new.Id, new.Title, new.LatestRevisionContent, new.Project, new.InitialPrompt, new.SourceUrl);
        END;

        CREATE TRIGGER plans_fts_delete AFTER DELETE ON Plans BEGIN
            INSERT INTO PlanSearch(PlanSearch, rowid, Title, LatestRevisionContent, Project, InitialPrompt, SourceUrl)
            VALUES ('delete', old.Id, old.Title, old.LatestRevisionContent, old.Project, old.InitialPrompt, old.SourceUrl);
        END;
        "#,
    )?;

    conn.execute_batch(
        r#"
        INSERT INTO PlanSearch(rowid, Title, LatestRevisionContent, Project, InitialPrompt, SourceUrl)
        SELECT Id, Title, LatestRevisionContent, Project, InitialPrompt, SourceUrl FROM Plans;
        "#,
    )?;

    Ok(())
}

/// Adds any of `columns` that `table` does not already have. Idempotent: existing columns are left
/// untouched, so this is safe to run on every connection open.
pub fn ensure_columns(conn: &Connection, table: &str, columns: &[(&str, &str)]) -> Result<()> {
    let mut existing = std::collections::HashSet::new();
    {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            existing.insert(row.get::<_, String>(1)?);
        }
    }

    for (name, sql_type) in columns {
        if !existing.contains(*name) {
            conn.execute(
                &format!("ALTER TABLE {} ADD COLUMN {} {}", table, name, sql_type),
                [],
            )?;
        }
    }

    Ok(())
}
