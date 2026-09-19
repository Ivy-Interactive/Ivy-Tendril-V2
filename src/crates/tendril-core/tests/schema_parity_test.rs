//! Guards the schema V2 shares with the original Tendril app. Both point at the same `tendril.db`,
//! so a divergence here is silent forward-compatibility corruption: the original migrates a chain
//! ending at 25 and only replays migrations above the stamped `user_version`, so a database V2
//! stamped low is never repaired and the original hard-fails on the objects it expects.

use chrono::Utc;
use rusqlite::Connection;
use std::path::PathBuf;
use tendril_core::db::{open_database, sync_plan, SCHEMA_VERSION};
use tendril_core::models::{PlanFile, PlanMetadata, PlanStatus};

struct TempDir(PathBuf);

impl TempDir {
    fn new(prefix: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("{}-{}", prefix, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    fn path(&self) -> &PathBuf {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn user_version(conn: &Connection) -> i64 {
    conn.query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("read user_version")
}

/// `(name, notnull)` for every column of `table`, in declaration order.
fn columns(conn: &Connection, table: &str) -> Vec<(String, bool)> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .expect("prepare table_info");
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(1)?, row.get::<_, i64>(3)? == 1))
        })
        .expect("query table_info");
    rows.map(|r| r.expect("table_info row")).collect()
}

fn column_names(conn: &Connection, table: &str) -> Vec<String> {
    columns(conn, table).into_iter().map(|(n, _)| n).collect()
}

fn object_exists(conn: &Connection, kind: &str, name: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = ?1 AND name = ?2)",
        rusqlite::params![kind, name],
        |r| r.get(0),
    )
    .expect("query sqlite_master")
}

fn costs_index_names(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare("PRAGMA index_list('Costs')")
        .expect("prepare index_list");
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .expect("query index_list");
    rows.map(|r| r.expect("index_list row")).collect()
}

const COSTS_INDEXES: &[&str] = &[
    "idx_costs_plan",
    "idx_costs_plan_logtimestamp",
    "idx_costs_logtimestamp",
    "idx_costs_promptware",
    "idx_costs_promptware_logtimestamp",
];

const PLANS_FTS_TRIGGERS: &[&str] = &["plans_fts_insert", "plans_fts_update", "plans_fts_delete"];

#[test]
fn stamp_is_not_downgraded_from_25() {
    // 26 as well as 25: the guarantee is MAX(existing, target), not "equal to target". The original
    // refuses to run at all when the stamp exceeds its latest migration, so a stamp V2 lowered would
    // be unrecoverable without hand-editing the database.
    for existing in [25_i64, 26] {
        let dir = TempDir::new("tendril-stamp-test");
        let db_path = dir.path().join("tendril.db");

        {
            let conn = Connection::open(&db_path).expect("create database");
            conn.execute_batch(&format!("PRAGMA user_version = {existing};"))
                .expect("stamp fixture");
        }

        let conn = open_database(&db_path).expect("open database");
        assert_eq!(
            user_version(&conn),
            existing,
            "opening a database stamped {existing} must leave the stamp alone"
        );
    }
}

#[test]
fn fresh_database_is_stamped_25() {
    let dir = TempDir::new("tendril-stamp-fresh-test");
    let conn = open_database(&dir.path().join("tendril.db")).expect("open database");

    assert_eq!(SCHEMA_VERSION, 25);
    assert_eq!(user_version(&conn), 25);
}

#[test]
fn fresh_database_has_every_v25_object() {
    let dir = TempDir::new("tendril-schema-test");
    let conn = open_database(&dir.path().join("tendril.db")).expect("open database");

    assert!(
        object_exists(&conn, "table", "PlanSearch"),
        "the original hard-fails plan search with `no such table: PlanSearch` without it"
    );
    for trigger in PLANS_FTS_TRIGGERS {
        assert!(
            object_exists(&conn, "trigger", trigger),
            "missing FTS trigger {trigger}"
        );
    }

    // The full v25 column list per table, so a future column drop is caught rather than discovered
    // by the original app failing on a shared database.
    let expected: &[(&str, &[&str])] = &[
        (
            "Costs",
            &[
                "Id",
                "PlanId",
                "Promptware",
                "Tokens",
                "Cost",
                "Model",
                "LogTimestamp",
                "CostSource",
                "Agent",
            ],
        ),
        (
            "Plans",
            &[
                "Id",
                "Title",
                "Project",
                "Level",
                "State",
                "FolderPath",
                "FolderName",
                "YamlRaw",
                "RevisionCount",
                "LatestRevisionContent",
                "Created",
                "Updated",
                "InitialPrompt",
                "SourceUrl",
                "ChatSessionId",
            ],
        ),
        (
            "Jobs",
            &[
                "Id",
                "Type",
                "PlanFile",
                "Project",
                "Status",
                "Provider",
                "SessionId",
                "StartedAt",
                "CompletedAt",
                "DurationSeconds",
                "Cost",
                "Tokens",
                "StatusMessage",
                "Args",
                "TypedArgs",
                "WorkingDirectory",
                "CliCommand",
                "Cleared",
                "ProcessId",
                "ReportedPlanId",
                "ReportedPlanTitle",
                "ReportedFailureReason",
                "Model",
                "InputTokens",
                "OutputTokens",
                "CacheReadTokens",
                "CacheWriteTokens",
                "ReasoningTokens",
                "CostSource",
                "ExecutionProfile",
                "Effort",
                // The original app's `Migration_026_JobsInboxFileAndChatSessionId` adds this, so both
                // apps have to spell it the same way to share one `tendril.db`.
                "ChatSessionId",
            ],
        ),
        (
            "Recommendations",
            &[
                "Id",
                "PlanId",
                "Title",
                "Description",
                "State",
                "DeclineReason",
                "PlanTitle",
                "PlanFolderName",
                "Project",
                "Date",
                "SourcePlanStatus",
                "Impact",
            ],
        ),
        (
            "PrStatuses",
            &["PrUrl", "Owner", "Repo", "Status", "LastChecked", "Branch"],
        ),
    ];

    for (table, expected_columns) in expected {
        let actual = column_names(&conn, table);
        for column in *expected_columns {
            assert!(
                actual.contains(&column.to_string()),
                "{table} is missing the v25 column {column}; actual columns: {actual:?}"
            );
        }
    }

    // Cost order matters too: a fresh V2 database and a fully migrated original one should be
    // indistinguishable, not merely equivalent.
    assert_eq!(
        column_names(&conn, "Costs"),
        vec![
            "Id",
            "PlanId",
            "Promptware",
            "Tokens",
            "Cost",
            "Model",
            "LogTimestamp",
            "CostSource",
            "Agent"
        ]
    );

    let cost_column = columns(&conn, "Costs")
        .into_iter()
        .find(|(name, _)| name == "Cost")
        .expect("Costs has a Cost column");
    assert!(
        !cost_column.1,
        "Costs.Cost must be nullable: a subscription-plan run reports tokens and no charge"
    );
}

#[test]
fn plan_search_is_backfilled_on_upgrade() {
    let dir = TempDir::new("tendril-upgrade-test");
    let db_path = dir.path().join("tendril.db");

    // A database as V2 used to create them: no PlanSearch, Cost REAL NOT NULL, stamped 24.
    {
        let conn = Connection::open(&db_path).expect("create database");
        conn.execute_batch(
            r#"
            CREATE TABLE Plans (
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
            CREATE TABLE Costs (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                PlanId INTEGER NOT NULL,
                Promptware TEXT NOT NULL,
                Tokens INTEGER NOT NULL,
                Cost REAL NOT NULL,
                LogTimestamp TEXT,
                FOREIGN KEY (PlanId) REFERENCES Plans(Id) ON DELETE CASCADE
            );
            CREATE INDEX idx_costs_plan ON Costs(PlanId);

            INSERT INTO Plans (Id, Title, Project, Level, State, FolderPath, FolderName, YamlRaw,
                RevisionCount, LatestRevisionContent, Created, Updated, InitialPrompt, SourceUrl)
            VALUES
                (1, 'Restore Costs Schema Parity', 'TestProject', 'Feature', 'Draft', '/plans/00001',
                 '00001-RestoreCostsSchemaParity', '', 1, 'revision body', '2026-01-01T00:00:00Z',
                 '2026-01-01T00:00:00Z', 'initial', NULL),
                (2, 'Unrelated Widget Work', 'TestProject', 'Feature', 'Draft', '/plans/00002',
                 '00002-UnrelatedWidgetWork', '', 1, 'other body', '2026-01-01T00:00:00Z',
                 '2026-01-01T00:00:00Z', 'initial', NULL);

            INSERT INTO Costs (PlanId, Promptware, Tokens, Cost, LogTimestamp)
            VALUES (1, 'ExecutePlan', 1250, 0.045, '2026-01-01T00:00:00Z');

            PRAGMA user_version = 24;
            "#,
        )
        .expect("build pre-fix fixture");
    }

    let conn = open_database(&db_path).expect("open database");

    assert_eq!(user_version(&conn), 25);

    // FTS was created and backfilled from the rows that were already there, mirroring migration
    // 002/007's populate step.
    assert!(object_exists(&conn, "table", "PlanSearch"));
    let matched: i64 = conn
        .query_row(
            "SELECT rowid FROM PlanSearch WHERE PlanSearch MATCH 'Parity'",
            [],
            |r| r.get(0),
        )
        .expect("PlanSearch matches a backfilled title term");
    assert_eq!(matched, 1);

    // The Cost NOT NULL rebuild preserved the row, value and all.
    let (tokens, cost, timestamp): (i64, Option<f64>, Option<String>) = conn
        .query_row(
            "SELECT Tokens, Cost, LogTimestamp FROM Costs WHERE PlanId = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("the pre-existing cost row survived the rebuild");
    assert_eq!(tokens, 1250);
    assert!((cost.expect("cost preserved") - 0.045).abs() < 1e-9);
    assert_eq!(timestamp.as_deref(), Some("2026-01-01T00:00:00Z"));

    let cost_column = columns(&conn, "Costs")
        .into_iter()
        .find(|(name, _)| name == "Cost")
        .expect("Costs has a Cost column");
    assert!(!cost_column.1, "Cost must be nullable after the rebuild");

    // DROP TABLE takes a table's indexes with it, so all five have to come back.
    let indexes = costs_index_names(&conn);
    for index in COSTS_INDEXES {
        assert!(
            indexes.contains(&index.to_string()),
            "missing {index} after the Costs rebuild; actual: {indexes:?}"
        );
    }

    // A second open is a no-op rather than a second rebuild.
    let conn = open_database(&db_path).expect("reopen database");
    assert_eq!(user_version(&conn), 25);
    let row_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM Costs", [], |r| r.get(0))
        .expect("count costs");
    assert_eq!(row_count, 1);
}

fn test_plan(id: i32, title: &str) -> PlanFile {
    let now = Utc::now();
    PlanFile {
        metadata: PlanMetadata {
            id,
            project: "TestProject".to_string(),
            level: "Feature".to_string(),
            title: title.to_string(),
            state: PlanStatus::Draft,
            repos: Vec::new(),
            commits: Vec::new(),
            prs: Vec::new(),
            verifications: Vec::new(),
            related_plans: Vec::new(),
            depends_on: Vec::new(),
            created: now,
            updated: now,
            initial_prompt: None,
            source_url: None,
            partial_delivery: false,
            chat_session_id: None,
            recommendations: None,
        },
        latest_revision_content: String::new(),
        folder_path: format!("/plans/{:05}", id),
        folder_name: format!("{:05}-Plan", id),
        yaml_raw: String::new(),
        revision_count: 1,
    }
}

#[test]
fn fts_triggers_track_plan_upserts() {
    let dir = TempDir::new("tendril-fts-trigger-test");
    let conn = open_database(&dir.path().join("tendril.db")).expect("open database");

    sync_plan(&conn, &test_plan(1, "Wire Up Telemetry Pipeline")).expect("initial sync");

    let matched: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM PlanSearch WHERE PlanSearch MATCH 'Telemetry'",
            [],
            |r| r.get(0),
        )
        .expect("search after insert");
    assert_eq!(matched, 1, "the AFTER INSERT trigger should index the plan");

    // sync_plan's ON CONFLICT(Id) DO UPDATE fires AFTER UPDATE, which the trigger turns into a
    // delete-then-insert against the FTS index.
    sync_plan(&conn, &test_plan(1, "Wire Up Screenshot Pipeline")).expect("re-sync");

    let new_title: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM PlanSearch WHERE PlanSearch MATCH 'Screenshot'",
            [],
            |r| r.get(0),
        )
        .expect("search for the new title");
    assert_eq!(new_title, 1);

    let old_title: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM PlanSearch WHERE PlanSearch MATCH 'Telemetry'",
            [],
            |r| r.get(0),
        )
        .expect("search for the old title");
    assert_eq!(old_title, 0, "the old title must not linger in the index");
}
