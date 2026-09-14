//! `costs.csv` is the durable record both apps append to; a plan's `Costs` rows are a projection of
//! it. These tests pin the two properties that make the arrangement safe: reconciling is idempotent,
//! and V2's parse and write formats match the original's byte for byte.

use std::path::PathBuf;
use tendril_core::db::costs::{insert_cost_entry, list_costs_by_plan, CostEntry};
use tendril_core::db::open_database;
use tendril_core::plans::costs_csv::{append_cost, read_costs, reconcile_plan_costs};

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

/// A database with plan 1 present (the Costs foreign key needs it) plus a plan folder to hold
/// `costs.csv`.
fn setup() -> (TempDir, rusqlite::Connection, PathBuf) {
    let dir = TempDir::new("tendril-costs-csv-test");
    let conn = open_database(&dir.path().join("tendril.db")).expect("open database");
    let plan_folder = dir.path().join("00001-TestPlan");
    std::fs::create_dir_all(&plan_folder).expect("create plan folder");

    conn.execute(
        r#"
        INSERT INTO Plans (
            Id, Title, Project, Level, State, FolderPath, FolderName,
            YamlRaw, RevisionCount, LatestRevisionContent, Created, Updated
        ) VALUES (1, 'Test Plan', 'TestProject', 'Feature', 'Draft', ?1, '00001-TestPlan', '', 1, '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        "#,
        rusqlite::params![plan_folder.to_string_lossy()],
    )
    .expect("insert plan");

    (dir, conn, plan_folder)
}

fn entry(promptware: &str, tokens: i64, cost: Option<f64>) -> CostEntry {
    CostEntry {
        promptware: promptware.to_string(),
        tokens,
        cost,
        model: Some("claude-opus-5".to_string()),
        cost_source: Some("agent".to_string()),
        agent: Some("claude".to_string()),
        log_timestamp: None,
    }
}

#[test]
fn append_then_reconcile_is_idempotent() {
    let (_dir, conn, plan_folder) = setup();

    append_cost(&plan_folder, &entry("CreatePlan", 1000, Some(0.5))).expect("append first");
    reconcile_plan_costs(&conn, &plan_folder, 1, Some("2026-01-01T00:00:00Z"))
        .expect("reconcile after first append");

    append_cost(&plan_folder, &entry("ExecutePlan", 2000, Some(1.25))).expect("append second");
    reconcile_plan_costs(&conn, &plan_folder, 1, Some("2026-01-02T00:00:00Z"))
        .expect("reconcile after second append");

    let first_pass = list_costs_by_plan(&conn, 1).expect("list costs");
    assert_eq!(first_pass.len(), 2);
    assert_eq!(first_pass[0].promptware, "CreatePlan");
    assert_eq!(first_pass[0].tokens, 1000);
    assert_eq!(
        first_pass[0].log_timestamp.as_deref(),
        Some("2026-01-01T00:00:00Z")
    );
    assert_eq!(first_pass[1].promptware, "ExecutePlan");
    assert_eq!(
        first_pass[1].log_timestamp.as_deref(),
        Some("2026-01-02T00:00:00Z")
    );

    // Reconciling again with no new CSV row must reproduce the identical row set, timestamps and all:
    // the FIFO match by promptware is what carries them across the DELETE + reinsert.
    reconcile_plan_costs(&conn, &plan_folder, 1, None).expect("reconcile again");
    let second_pass = list_costs_by_plan(&conn, 1).expect("list costs again");

    assert_eq!(second_pass.len(), 2);
    for (before, after) in first_pass.iter().zip(second_pass.iter()) {
        assert_eq!(before.promptware, after.promptware);
        assert_eq!(before.tokens, after.tokens);
        assert_eq!(before.cost, after.cost);
        assert_eq!(before.model, after.model);
        assert_eq!(before.cost_source, after.cost_source);
        assert_eq!(before.agent, after.agent);
        assert_eq!(before.log_timestamp, after.log_timestamp);
    }
}

#[test]
fn reconcile_matches_original_upsert() {
    let (_dir, conn, plan_folder) = setup();

    // The original's exact 6-column format, including a row whose Cost field is empty (an
    // unpriceable subscription run) and a legacy 3-column row from before costs.csv v2.
    std::fs::write(
        plan_folder.join("costs.csv"),
        "Promptware,Tokens,Cost,Model,CostSource,Agent\n\
         CreatePlan,1000,0.5000,claude-opus-5,agent,claude\n\
         ExecutePlan,2000,,claude-opus-5,estimated,claude\n\
         ExpandPlan,3000,0.7500\n",
    )
    .expect("write costs.csv");

    reconcile_plan_costs(&conn, &plan_folder, 1, Some("2026-03-01T00:00:00Z"))
        .expect("reconcile from a hand-written csv");

    let records = list_costs_by_plan(&conn, 1).expect("list costs");
    assert_eq!(records.len(), 3);

    assert_eq!(records[0].promptware, "CreatePlan");
    assert_eq!(records[0].tokens, 1000);
    assert_eq!(records[0].cost, Some(0.5));
    assert_eq!(records[0].model.as_deref(), Some("claude-opus-5"));
    assert_eq!(records[0].cost_source.as_deref(), Some("agent"));
    assert_eq!(records[0].agent.as_deref(), Some("claude"));

    assert_eq!(records[1].promptware, "ExecutePlan");
    assert_eq!(records[1].tokens, 2000);
    assert_eq!(
        records[1].cost, None,
        "an empty Cost field is unknown, not zero"
    );
    assert_eq!(records[1].cost_source.as_deref(), Some("estimated"));

    // The legacy row keeps its cost and leaves the columns it predates NULL.
    assert_eq!(records[2].promptware, "ExpandPlan");
    assert_eq!(records[2].tokens, 3000);
    assert_eq!(records[2].cost, Some(0.75));
    assert_eq!(records[2].model, None);
    assert_eq!(records[2].cost_source, None);
    assert_eq!(records[2].agent, None);

    // NULL rather than 0.0 in the column itself, which is what makes SUM and COUNT(Cost) skip it.
    let null_costs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM Costs WHERE PlanId = 1 AND Cost IS NULL",
            [],
            |r| r.get(0),
        )
        .expect("count null costs");
    assert_eq!(null_costs, 1);
}

#[test]
fn reconcile_without_csv_preserves_existing_rows() {
    let (_dir, conn, plan_folder) = setup();

    insert_cost_entry(&conn, 1, &entry("ExecutePlan", 1500, Some(0.25))).expect("insert row");

    // No costs.csv yet — a row appended by an older V2 build must not be wiped just because the file
    // does not exist. The original short-circuits the same way.
    reconcile_plan_costs(&conn, &plan_folder, 1, None).expect("reconcile with no csv");

    let records = list_costs_by_plan(&conn, 1).expect("list costs");
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].promptware, "ExecutePlan");
    assert_eq!(records[0].cost, Some(0.25));
}

#[test]
fn csv_round_trips_through_read_costs() {
    let (_dir, _conn, plan_folder) = setup();

    append_cost(&plan_folder, &entry("CreatePlan", 1000, Some(0.5))).expect("append priced row");
    append_cost(&plan_folder, &entry("ExecutePlan", 2000, None)).expect("append unpriced row");

    let raw = std::fs::read_to_string(plan_folder.join("costs.csv")).expect("read csv");
    assert_eq!(
        raw,
        "Promptware,Tokens,Cost,Model,CostSource,Agent\n\
         CreatePlan,1000,0.5000,claude-opus-5,agent,claude\n\
         ExecutePlan,2000,,claude-opus-5,agent,claude\n",
        "the file must be byte-identical to what the original's LogCostToCsv writes, including the \
         empty Cost field for an unpriceable run rather than 0.0000"
    );

    let entries = read_costs(&plan_folder).expect("read entries back");
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].cost, Some(0.5));
    assert_eq!(entries[1].cost, None);
    assert_eq!(entries[1].tokens, 2000);
    assert_eq!(entries[1].model.as_deref(), Some("claude-opus-5"));
}
