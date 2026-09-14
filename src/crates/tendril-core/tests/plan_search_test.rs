//! Plan full-text search and incremental-sync bookkeeping.
//!
//! Every test opens a **freshly created** database. The FTS5 index only goes missing on a database
//! V2 created itself — one the original created already carries the table and triggers, which is what
//! hid this defect during development.

use chrono::{DateTime, Duration, Utc};
use std::path::{Path, PathBuf};
use tendril_core::db::{
    delete_plan, get_last_sync_time, get_plans, open_database, rebuild_search_index,
    set_last_sync_time, sync_plan, sync_plans_from_disk,
};
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

fn setup_test_db(prefix: &str) -> (TempDir, rusqlite::Connection) {
    let temp_dir = TempDir::new(prefix);
    let db_path = temp_dir.path().join("tendril.db");
    let conn = open_database(&db_path).expect("open database");
    (temp_dir, conn)
}

fn plan(id: i32, title: &str) -> PlanFile {
    let now = Utc::now();
    PlanFile {
        metadata: PlanMetadata {
            id,
            project: "SearchProject".to_string(),
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
        folder_path: format!("/plans/{:05}-Plan", id),
        folder_name: format!("{:05}-Plan", id),
        yaml_raw: String::new(),
        revision_count: 1,
    }
}

fn search(conn: &rusqlite::Connection, query: &str) -> Vec<i32> {
    get_plans(conn, None, None, Some(query))
        .expect("search must not error")
        .iter()
        .map(|p| p.metadata.id)
        .collect()
}

fn integrity_check(conn: &rusqlite::Connection) {
    conn.execute(
        "INSERT INTO PlanSearch(PlanSearch) VALUES('integrity-check')",
        [],
    )
    .expect("search index must be internally consistent");
}

fn object_exists(conn: &rusqlite::Connection, kind: &str, name: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type=?1 AND name=?2)",
        rusqlite::params![kind, name],
        |r| r.get(0),
    )
    .expect("query sqlite_master")
}

#[test]
fn fresh_database_has_search_index_and_triggers() {
    let (_dir, conn) = setup_test_db("tendril-search-schema");

    assert!(
        object_exists(&conn, "table", "PlanSearch"),
        "a database V2 created must carry the FTS5 index"
    );
    for trigger in ["plans_fts_insert", "plans_fts_update", "plans_fts_delete"] {
        assert!(
            object_exists(&conn, "trigger", trigger),
            "trigger {} is missing",
            trigger
        );
    }

    let ddl: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='PlanSearch'",
            [],
            |r| r.get(0),
        )
        .expect("read PlanSearch DDL");
    for expected in [
        "Title",
        "LatestRevisionContent",
        "Project",
        "InitialPrompt",
        "SourceUrl",
        "content='Plans'",
        "content_rowid=Id",
    ] {
        assert!(
            ddl.contains(expected),
            "PlanSearch DDL is missing {}: {}",
            expected,
            ddl
        );
    }
}

#[test]
fn insert_update_delete_keep_index_consistent() {
    let (_dir, conn) = setup_test_db("tendril-search-triggers");

    sync_plan(&conn, &plan(1, "Restore worktree isolation")).expect("insert plan");
    assert_eq!(search(&conn, "worktree"), vec![1]);
    integrity_check(&conn);

    sync_plan(&conn, &plan(1, "Restore telemetry batching")).expect("update plan");
    assert_eq!(search(&conn, "telemetry"), vec![1]);
    assert!(
        search(&conn, "worktree").is_empty(),
        "the replaced title must not stay in the index"
    );
    integrity_check(&conn);

    delete_plan(&conn, 1).expect("delete plan");
    assert!(search(&conn, "telemetry").is_empty());
    integrity_check(&conn);
}

#[test]
fn search_matches_initial_prompt() {
    let (_dir, conn) = setup_test_db("tendril-search-prompt");

    let mut p = plan(1, "Unrelated title");
    p.metadata.initial_prompt = Some("Investigate the zebra rendering glitch".to_string());
    sync_plan(&conn, &p).expect("insert plan");

    assert_eq!(search(&conn, "zebra"), vec![1]);
}

#[test]
fn search_matches_source_url() {
    let (_dir, conn) = setup_test_db("tendril-search-url");

    let mut p = plan(1, "Unrelated title");
    p.metadata.source_url = Some("https://github.com/Ivy-Interactive/x/issues/7".to_string());
    sync_plan(&conn, &p).expect("insert plan");
    sync_plan(&conn, &plan(2, "Another plan entirely")).expect("insert plan");

    assert_eq!(search(&conn, "Ivy-Interactive"), vec![1]);
    // A pasted URL is the case the sanitizer exists for: `/` and `:` are FTS5 operators.
    assert_eq!(
        search(&conn, "https://github.com/Ivy-Interactive/x/issues/7"),
        vec![1]
    );
}

#[test]
fn results_are_relevance_ordered() {
    let (_dir, conn) = setup_test_db("tendril-search-rank");

    sync_plan(&conn, &plan(1, "Worktree isolation")).expect("insert plan");

    let mut buried = plan(2, "Unrelated title");
    buried.latest_revision_content = format!(
        "{} the worktree is mentioned exactly once here. {}",
        "Filler prose about many other concerns. ".repeat(40),
        "More filler prose to dilute the term. ".repeat(40)
    );
    sync_plan(&conn, &buried).expect("insert plan");

    // Plan 2 has the higher id, so `ORDER BY Id DESC` alone would put it first.
    assert_eq!(
        search(&conn, "worktree"),
        vec![1, 2],
        "a short title match must outrank a single mention in a long body"
    );
}

#[test]
fn malformed_fts_input_does_not_error() {
    let (_dir, conn) = setup_test_db("tendril-search-malformed");

    sync_plan(&conn, &plan(1, "Perfectly ordinary plan")).expect("insert plan");

    for query in [
        "\"",
        "foo(",
        "*",
        "AND",
        "NEAR(",
        "^",
        "a:b",
        "((",
        "\"\"",
        "trailing\\",
    ] {
        let result = get_plans(&conn, None, None, Some(query));
        assert!(
            result.is_ok(),
            "query {:?} must not error, got {:?}",
            query,
            result.err()
        );
    }
}

#[test]
fn numeric_query_finds_plan_by_id() {
    let (_dir, conn) = setup_test_db("tendril-search-numeric");

    sync_plan(&conn, &plan(42, "Nothing to do with numbers")).expect("insert plan");

    assert_eq!(search(&conn, "42"), vec![42]);
    // Plan ids are shown zero-padded everywhere, so that is what gets pasted into a search box.
    assert_eq!(search(&conn, "00042"), vec![42]);
}

#[test]
fn partial_word_still_matches_via_fallback() {
    let (_dir, conn) = setup_test_db("tendril-search-partial");

    sync_plan(&conn, &plan(1, "Restore worktree isolation")).expect("insert plan");

    // FTS5 matches whole tokens only; the LIKE fallback is what keeps substring search working.
    assert_eq!(search(&conn, "worktre"), vec![1]);
}

#[test]
fn rebuild_matches_incremental_index() {
    let (_dir, conn) = setup_test_db("tendril-search-rebuild");

    sync_plan(&conn, &plan(1, "Worktree isolation for plans")).expect("insert plan");
    let mut second = plan(2, "Telemetry batching");
    second.latest_revision_content = "worktree cleanup happens here".to_string();
    sync_plan(&conn, &second).expect("insert plan");
    let mut third = plan(3, "Costs schema parity");
    third.metadata.initial_prompt = Some("worktree and costs".to_string());
    sync_plan(&conn, &third).expect("insert plan");

    let queries = ["worktree", "telemetry", "costs"];
    let before: Vec<Vec<i32>> = queries.iter().map(|q| search(&conn, q)).collect();

    let indexed = rebuild_search_index(&conn).expect("rebuild index");
    assert_eq!(indexed, 3, "every plan must be reindexed");
    integrity_check(&conn);

    let after: Vec<Vec<i32>> = queries.iter().map(|q| search(&conn, q)).collect();
    assert_eq!(
        before, after,
        "a rebuilt index must rank identically to the trigger-maintained one"
    );
}

#[test]
fn last_sync_time_absent_then_advances() {
    let (_dir, conn) = setup_test_db("tendril-sync-time");

    assert_eq!(
        get_last_sync_time(&conn).expect("read sync time"),
        None,
        "a fresh database has never been synced"
    );

    sync_plan(&conn, &plan(1, "First plan")).expect("insert plan");
    let first = get_last_sync_time(&conn)
        .expect("read sync time")
        .expect("sync_plan must stamp LastSyncTime");

    sync_plan(&conn, &plan(2, "Second plan")).expect("insert plan");
    let second = get_last_sync_time(&conn)
        .expect("read sync time")
        .expect("stamp is still present");
    assert!(second >= first, "{} must not precede {}", second, first);

    let explicit: DateTime<Utc> = Utc::now() - Duration::hours(3);
    set_last_sync_time(&conn, explicit).expect("set sync time");
    let round_tripped = get_last_sync_time(&conn)
        .expect("read sync time")
        .expect("explicit stamp is readable");
    assert_eq!(
        round_tripped.timestamp_millis(),
        explicit.timestamp_millis()
    );

    // The original writes this key too; an unreadable value means "scan everything", not an error.
    conn.execute(
        "UPDATE SyncMetadata SET Value = 'not a timestamp' WHERE Key = 'LastSyncTime'",
        [],
    )
    .expect("write garbage stamp");
    assert_eq!(get_last_sync_time(&conn).expect("read sync time"), None);
}

fn write_plan_folder(plans_dir: &Path, id: i32, title: &str) -> PathBuf {
    let folder = plans_dir.join(format!("{:05}-Plan", id));
    std::fs::create_dir_all(folder.join("Revisions")).expect("create plan folder");
    std::fs::write(
        folder.join("plan.yaml"),
        format!(
            "state: Draft\nproject: SearchProject\nlevel: Feature\ntitle: {}\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n",
            title
        ),
    )
    .expect("write plan.yaml");
    std::fs::write(
        folder.join("Revisions").join("001.md"),
        format!("# {}\n", title),
    )
    .expect("write revision");
    folder
}

#[test]
fn sync_plans_from_disk_is_incremental() {
    let (dir, conn) = setup_test_db("tendril-sync-disk");
    let plans_dir = dir.path().join("Plans");
    std::fs::create_dir_all(&plans_dir).expect("create plans dir");

    write_plan_folder(&plans_dir, 1, "First plan");
    write_plan_folder(&plans_dir, 2, "Second plan");
    let third = write_plan_folder(&plans_dir, 3, "Third plan");

    // The scan deliberately looks 2s further back than the stamp it is given (mtime granularity is a
    // whole second on some volumes), so a folder written in the same breath as the stamp is always
    // resynced once more. Waiting past that window is what makes "nothing changed" observable.
    std::thread::sleep(std::time::Duration::from_millis(3100));

    assert_eq!(
        sync_plans_from_disk(&conn, &plans_dir, None).expect("full scan"),
        3
    );
    let stamp = get_last_sync_time(&conn)
        .expect("read sync time")
        .expect("a scan stamps LastSyncTime");

    assert_eq!(
        sync_plans_from_disk(&conn, &plans_dir, Some(stamp)).expect("incremental scan"),
        0,
        "nothing changed since the stamp"
    );

    std::fs::write(
        third.join("plan.yaml"),
        "state: Executing\nproject: SearchProject\nlevel: Feature\ntitle: Third plan renamed\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-02T00:00:00Z\n",
    )
    .expect("rewrite plan.yaml");

    assert_eq!(
        sync_plans_from_disk(&conn, &plans_dir, Some(stamp)).expect("incremental scan"),
        1,
        "only the rewritten plan is resynced"
    );

    let title: String = conn
        .query_row("SELECT Title FROM Plans WHERE Id = 3", [], |r| r.get(0))
        .expect("read synced row");
    assert_eq!(title, "Third plan renamed");
    assert_eq!(search(&conn, "renamed"), vec![3]);
}
