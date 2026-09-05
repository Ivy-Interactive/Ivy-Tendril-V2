use rusqlite::{Connection, Result};

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
            SourceUrl TEXT
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

        CREATE TABLE IF NOT EXISTS Costs (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            PlanId INTEGER NOT NULL,
            Promptware TEXT NOT NULL,
            Tokens INTEGER NOT NULL,
            Cost REAL NOT NULL,
            LogTimestamp TEXT,
            FOREIGN KEY (PlanId) REFERENCES Plans(Id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_costs_plan ON Costs(PlanId);
        CREATE INDEX IF NOT EXISTS idx_costs_plan_logtimestamp ON Costs(PlanId, LogTimestamp);

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
            Effort TEXT
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

        PRAGMA user_version = 21;
        "#,
    )?;

    Ok(())
}
