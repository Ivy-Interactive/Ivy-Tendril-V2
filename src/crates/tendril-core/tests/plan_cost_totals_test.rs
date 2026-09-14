//! `get_plan_cost_totals` — the one aggregate the Pull Requests view needs, so a cross-plan table
//! can show a cost and token total per row without a query per row.

use std::path::PathBuf;
use tendril_core::db::{get_plan_cost_totals, insert_cost, open_database};

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

/// `Costs.PlanId` is a foreign key, so every plan a test prices needs a row in `Plans` first.
fn setup_test_db(plan_ids: &[i32]) -> (TempDir, rusqlite::Connection) {
    let temp_dir = TempDir::new("tendril-plan-cost-totals-test");
    let conn = open_database(&temp_dir.path().join("tendril.db")).expect("open database");

    for id in plan_ids {
        conn.execute(
            r#"
            INSERT INTO Plans (
                Id, Title, Project, Level, State, FolderPath, FolderName,
                YamlRaw, RevisionCount, LatestRevisionContent, Created, Updated
            ) VALUES (?1, 'Test Plan', 'TestProject', 'Feature', 'Draft', ?2, ?3, '', 1, '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
            "#,
            // `FolderPath` is unique, so each plan needs its own — two plans sharing a path is a
            // constraint violation, not a second row.
            rusqlite::params![id, format!("/plans/{id:05}-TestPlan"), format!("{id:05}-TestPlan")],
        )
        .expect("insert plan");
    }

    (temp_dir, conn)
}

#[test]
fn sums_cost_and_tokens_per_plan() {
    let (_dir, conn) = setup_test_db(&[610, 99]);

    insert_cost(&conn, 610, "ExecutePlan", 100_000, Some(1.0), None).unwrap();
    insert_cost(&conn, 610, "CheckResult", 60_000, Some(0.23), None).unwrap();
    insert_cost(&conn, 99, "ExecutePlan", 900, Some(10.0), None).unwrap();

    let totals = get_plan_cost_totals(&conn).expect("aggregate totals");

    assert_eq!(totals.len(), 2, "one entry per plan with cost rows");
    let (cost, tokens) = totals[&610];
    assert!((cost - 1.23).abs() < 1e-9, "expected 1.23, got {cost}");
    assert_eq!(tokens, 160_000);
    assert_eq!(totals[&99], (10.0, 900));
}

#[test]
fn null_costs_do_not_break_the_sum() {
    let (_dir, conn) = setup_test_db(&[700, 701]);

    // A subscription run reports tokens and no charge, which is NULL in the Cost column.
    insert_cost(&conn, 700, "ExecutePlan", 4_000, None, None).unwrap();
    insert_cost(&conn, 700, "CheckResult", 1_000, None, None).unwrap();

    insert_cost(&conn, 701, "ExecutePlan", 2_000, None, None).unwrap();
    insert_cost(&conn, 701, "CheckResult", 500, Some(0.75), None).unwrap();

    let totals = get_plan_cost_totals(&conn).expect("aggregate totals");

    // Every row unpriced: the plan totals 0.0 and keeps its tokens, so the Cost cell renders blank
    // while the Tokens cell still reports the run.
    assert_eq!(totals[&700], (0.0, 5_000));
    // Mixed: only the priced row contributes to the cost, and all rows contribute tokens.
    let (cost, tokens) = totals[&701];
    assert!((cost - 0.75).abs() < 1e-9, "expected 0.75, got {cost}");
    assert_eq!(tokens, 2_500);
}

#[test]
fn a_plan_with_no_cost_rows_is_absent_from_the_map() {
    let (_dir, conn) = setup_test_db(&[800]);

    let totals = get_plan_cost_totals(&conn).expect("aggregate totals");

    assert!(totals.is_empty(), "a plan with no Costs rows has no entry");
    // Which is the caller's `unwrap_or_default()` path: a blank cost and token cell.
    assert_eq!(totals.get(&800).copied().unwrap_or_default(), (0.0, 0));
}
