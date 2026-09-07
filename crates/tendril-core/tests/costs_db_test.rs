use chrono::{Duration, Utc};
use std::path::PathBuf;
use tendril_core::db::{
    get_costs_series, get_costs_summary, insert_cost, list_costs_by_plan, open_database,
};

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

fn setup_test_db() -> (TempDir, rusqlite::Connection) {
    let temp_dir = TempDir::new("tendril-costs-test");
    let db_path = temp_dir.path().join("tendril.db");
    let conn = open_database(&db_path).expect("open database");

    // Insert a dummy plan to satisfy foreign key constraints
    conn.execute(
        r#"
        INSERT INTO Plans (
            Id, Title, Project, Level, State, FolderPath, FolderName,
            YamlRaw, RevisionCount, LatestRevisionContent, Created, Updated
        ) VALUES (1, 'Test Plan', 'TestProject', 'Feature', 'Draft', '/path/to/plan', '00001-TestPlan', '', 1, '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        "#,
        [],
    )
    .expect("insert dummy plan");

    (temp_dir, conn)
}

#[test]
fn test_costs_insertion_and_index() {
    let (_dir, conn) = setup_test_db();

    // Verify idx_costs_logtimestamp index exists
    let mut stmt = conn.prepare("PRAGMA index_list('Costs')").unwrap();
    let index_names: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert!(
        index_names.contains(&"idx_costs_logtimestamp".to_string()),
        "Expected idx_costs_logtimestamp index to exist in Costs table"
    );

    // Insert a cost record
    let now_str = Utc::now().to_rfc3339();
    let row_id = insert_cost(&conn, 1, "CreatePlan", 1250, 0.045, Some(&now_str))
        .expect("insert_cost should succeed");
    assert!(row_id > 0);

    // Read back records by plan
    let records = list_costs_by_plan(&conn, 1).expect("list_costs_by_plan should succeed");
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].id, row_id);
    assert_eq!(records[0].plan_id, 1);
    assert_eq!(records[0].promptware, "CreatePlan");
    assert_eq!(records[0].tokens, 1250);
    assert!((records[0].cost - 0.045).abs() < 1e-6);
    assert_eq!(records[0].log_timestamp, Some(now_str));

    // Verify foreign key cascade
    conn.execute("DELETE FROM Plans WHERE Id = 1", [])
        .expect("delete plan should succeed");
    let after_delete = list_costs_by_plan(&conn, 1).expect("list costs after delete");
    assert_eq!(after_delete.len(), 0);
}

#[test]
fn test_costs_summary_metrics() {
    let (_dir, conn) = setup_test_db();

    let now = Utc::now();
    let today = now.to_rfc3339();
    let three_days_ago = (now - Duration::days(3)).to_rfc3339();
    let fifteen_days_ago = (now - Duration::days(15)).to_rfc3339();
    let forty_five_days_ago = (now - Duration::days(45)).to_rfc3339();

    // Insert records at different intervals
    insert_cost(&conn, 1, "ExecutePlan", 1000, 10.0, Some(&today)).unwrap();
    insert_cost(&conn, 1, "ExecutePlan", 2000, 20.0, Some(&three_days_ago)).unwrap();
    insert_cost(&conn, 1, "ExecutePlan", 3000, 30.0, Some(&fifteen_days_ago)).unwrap();
    insert_cost(
        &conn,
        1,
        "ExecutePlan",
        4000,
        40.0,
        Some(&forty_five_days_ago),
    )
    .unwrap();

    let summary = get_costs_summary(&conn).expect("get_costs_summary should succeed");

    assert!(
        (summary.total_spend - 100.0).abs() < 1e-6,
        "Expected total_spend 100.0, got {}",
        summary.total_spend
    );
    assert!(
        (summary.thirty_day_spend - 60.0).abs() < 1e-6,
        "Expected thirty_day_spend 60.0, got {}",
        summary.thirty_day_spend
    );
    assert!(
        (summary.seven_day_spend - 30.0).abs() < 1e-6,
        "Expected seven_day_spend 30.0, got {}",
        summary.seven_day_spend
    );
    let expected_daily_run_rate = 30.0 / 7.0;
    assert!(
        (summary.daily_run_rate - expected_daily_run_rate).abs() < 1e-6,
        "Expected daily_run_rate {}, got {}",
        expected_daily_run_rate,
        summary.daily_run_rate
    );

    // Test fallback to 30-day rate when 7-day spend is zero
    conn.execute(
        "DELETE FROM Costs WHERE datetime(LogTimestamp) >= datetime('now', '-7 days')",
        [],
    )
    .unwrap();
    let fallback_summary = get_costs_summary(&conn).unwrap();
    assert_eq!(fallback_summary.seven_day_spend, 0.0);
    assert!((fallback_summary.thirty_day_spend - 30.0).abs() < 1e-6);
    let expected_fallback_run_rate = 30.0 / 30.0;
    assert!(
        (fallback_summary.daily_run_rate - expected_fallback_run_rate).abs() < 1e-6,
        "Expected fallback daily_run_rate {}, got {}",
        expected_fallback_run_rate,
        fallback_summary.daily_run_rate
    );
}

#[test]
fn test_costs_series_aggregation() {
    let (_dir, conn) = setup_test_db();

    // Insert entries with specific ISO dates
    insert_cost(&conn, 1, "Job1", 100, 1.5, Some("2026-08-10T10:00:00Z")).unwrap();
    insert_cost(&conn, 1, "Job2", 200, 2.5, Some("2026-08-10T14:00:00Z")).unwrap();
    insert_cost(&conn, 1, "Job3", 300, 4.0, Some("2026-08-11T12:00:00Z")).unwrap();
    insert_cost(&conn, 1, "Job4", 400, 5.0, Some("2026-08-18T12:00:00Z")).unwrap();

    // Daily series
    let daily = get_costs_series(&conn, "daily").expect("get daily costs series");
    assert_eq!(daily.len(), 3);
    assert_eq!(daily[0].period, "2026-08-10");
    assert_eq!(daily[0].tokens, 300);
    assert!((daily[0].cost - 4.0).abs() < 1e-6);

    assert_eq!(daily[1].period, "2026-08-11");
    assert_eq!(daily[1].tokens, 300);
    assert!((daily[1].cost - 4.0).abs() < 1e-6);

    assert_eq!(daily[2].period, "2026-08-18");
    assert_eq!(daily[2].tokens, 400);
    assert!((daily[2].cost - 5.0).abs() < 1e-6);

    // Weekly series
    let weekly = get_costs_series(&conn, "weekly").expect("get weekly costs series");
    assert_eq!(weekly.len(), 2);
    assert_eq!(weekly[0].tokens, 600);
    assert!((weekly[0].cost - 8.0).abs() < 1e-6);
    assert_eq!(weekly[1].tokens, 400);
    assert!((weekly[1].cost - 5.0).abs() < 1e-6);
}
