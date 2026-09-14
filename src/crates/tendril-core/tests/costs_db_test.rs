use chrono::{Duration, Utc};
use std::path::PathBuf;
use tendril_core::db::{
    get_costs_series, get_costs_summary, insert_cost, insert_cost_entry, list_costs_by_plan,
    open_database, CostEntry, CostsFilter,
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
    assert!(
        index_names.contains(&"idx_costs_promptware".to_string()),
        "Expected idx_costs_promptware index to exist in Costs table"
    );
    assert!(
        index_names.contains(&"idx_costs_promptware_logtimestamp".to_string()),
        "Expected idx_costs_promptware_logtimestamp index to exist in Costs table"
    );

    // Insert a cost record
    let now_str = Utc::now().to_rfc3339();
    let row_id = insert_cost(&conn, 1, "CreatePlan", 1250, Some(0.045), Some(&now_str))
        .expect("insert_cost should succeed");
    assert!(row_id > 0);

    // Read back records by plan
    let records = list_costs_by_plan(&conn, 1).expect("list_costs_by_plan should succeed");
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].id, row_id);
    assert_eq!(records[0].plan_id, 1);
    assert_eq!(records[0].promptware, "CreatePlan");
    assert_eq!(records[0].tokens, 1250);
    assert!((records[0].cost.unwrap() - 0.045).abs() < 1e-6);
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
    insert_cost(&conn, 1, "ExecutePlan", 1000, Some(10.0), Some(&today)).unwrap();
    insert_cost(
        &conn,
        1,
        "ExecutePlan",
        2000,
        Some(20.0),
        Some(&three_days_ago),
    )
    .unwrap();
    insert_cost(
        &conn,
        1,
        "ExecutePlan",
        3000,
        Some(30.0),
        Some(&fifteen_days_ago),
    )
    .unwrap();
    insert_cost(
        &conn,
        1,
        "ExecutePlan",
        4000,
        Some(40.0),
        Some(&forty_five_days_ago),
    )
    .unwrap();

    let summary = get_costs_summary(&conn, &CostsFilter::default())
        .expect("get_costs_summary should succeed");

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
    let fallback_summary = get_costs_summary(&conn, &CostsFilter::default()).unwrap();
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
    insert_cost(
        &conn,
        1,
        "Job1",
        100,
        Some(1.5),
        Some("2026-08-10T10:00:00Z"),
    )
    .unwrap();
    insert_cost(
        &conn,
        1,
        "Job2",
        200,
        Some(2.5),
        Some("2026-08-10T14:00:00Z"),
    )
    .unwrap();
    insert_cost(
        &conn,
        1,
        "Job3",
        300,
        Some(4.0),
        Some("2026-08-11T12:00:00Z"),
    )
    .unwrap();
    insert_cost(
        &conn,
        1,
        "Job4",
        400,
        Some(5.0),
        Some("2026-08-18T12:00:00Z"),
    )
    .unwrap();

    // Daily series
    let daily =
        get_costs_series(&conn, "daily", &CostsFilter::default()).expect("get daily costs series");
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
    let weekly = get_costs_series(&conn, "weekly", &CostsFilter::default())
        .expect("get weekly costs series");
    assert_eq!(weekly.len(), 2);
    assert_eq!(weekly[0].tokens, 600);
    assert!((weekly[0].cost - 8.0).abs() < 1e-6);
    assert_eq!(weekly[1].tokens, 400);
    assert!((weekly[1].cost - 5.0).abs() < 1e-6);
}

#[test]
fn test_costs_summary_filtering() {
    let (_dir, conn) = setup_test_db();

    // Insert a second plan for another project
    conn.execute(
        r#"
        INSERT INTO Plans (
            Id, Title, Project, Level, State, FolderPath, FolderName,
            YamlRaw, RevisionCount, LatestRevisionContent, Created, Updated
        ) VALUES (2, 'Plan Two', 'ProjectBeta', 'Feature', 'Draft', '/path/to/plan2', '00002-PlanTwo', '', 1, '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        "#,
        [],
    )
    .expect("insert second plan");

    let now = Utc::now();
    let today = now.to_rfc3339();
    let two_days_ago = (now - Duration::days(2)).to_rfc3339();
    let four_days_ago = (now - Duration::days(4)).to_rfc3339();
    let ten_days_ago = (now - Duration::days(10)).to_rfc3339();

    // Plan 1 (TestProject):
    // - CreatePlan: 10.0 (today)
    // - ExecutePlan: 20.0 (two days ago)
    insert_cost(&conn, 1, "CreatePlan", 1000, Some(10.0), Some(&today)).unwrap();
    insert_cost(
        &conn,
        1,
        "ExecutePlan",
        2000,
        Some(20.0),
        Some(&two_days_ago),
    )
    .unwrap();

    // Plan 2 (ProjectBeta):
    // - ExecutePlan: 30.0 (four days ago)
    // - UpdatePlan: 40.0 (ten days ago)
    insert_cost(
        &conn,
        2,
        "ExecutePlan",
        3000,
        Some(30.0),
        Some(&four_days_ago),
    )
    .unwrap();
    insert_cost(
        &conn,
        2,
        "UpdatePlan",
        4000,
        Some(40.0),
        Some(&ten_days_ago),
    )
    .unwrap();

    // 1. Filter by project (TestProject)
    let filter_project = CostsFilter {
        project: Some("TestProject".to_string()),
        promptware: None,
    };
    let summary_project = get_costs_summary(&conn, &filter_project).unwrap();
    assert!((summary_project.total_spend - 30.0).abs() < 1e-6);
    assert!((summary_project.thirty_day_spend - 30.0).abs() < 1e-6);
    assert!((summary_project.seven_day_spend - 30.0).abs() < 1e-6);
    assert!((summary_project.daily_run_rate - (30.0 / 7.0)).abs() < 1e-6);

    // Case insensitivity check for project
    let filter_project_ci = CostsFilter {
        project: Some("testproject".to_string()),
        promptware: None,
    };
    let summary_project_ci = get_costs_summary(&conn, &filter_project_ci).unwrap();
    assert!((summary_project_ci.total_spend - 30.0).abs() < 1e-6);

    // 2. Filter by project (ProjectBeta)
    let filter_beta = CostsFilter {
        project: Some("ProjectBeta".to_string()),
        promptware: None,
    };
    let summary_beta = get_costs_summary(&conn, &filter_beta).unwrap();
    assert!((summary_beta.total_spend - 70.0).abs() < 1e-6);
    assert!((summary_beta.thirty_day_spend - 70.0).abs() < 1e-6);
    assert!((summary_beta.seven_day_spend - 30.0).abs() < 1e-6);

    // 3. Filter by promptware (ExecutePlan)
    let filter_pw = CostsFilter {
        project: None,
        promptware: Some("ExecutePlan".to_string()),
    };
    let summary_pw = get_costs_summary(&conn, &filter_pw).unwrap();
    assert!((summary_pw.total_spend - 50.0).abs() < 1e-6);
    assert!((summary_pw.thirty_day_spend - 50.0).abs() < 1e-6);
    assert!((summary_pw.seven_day_spend - 50.0).abs() < 1e-6);
    assert!((summary_pw.daily_run_rate - (50.0 / 7.0)).abs() < 1e-6);

    // Case insensitivity check for promptware
    let filter_pw_ci = CostsFilter {
        project: None,
        promptware: Some("executeplan".to_string()),
    };
    let summary_pw_ci = get_costs_summary(&conn, &filter_pw_ci).unwrap();
    assert!((summary_pw_ci.total_spend - 50.0).abs() < 1e-6);

    // 4. Filter by both project and promptware
    let filter_both = CostsFilter {
        project: Some("TestProject".to_string()),
        promptware: Some("ExecutePlan".to_string()),
    };
    let summary_both = get_costs_summary(&conn, &filter_both).unwrap();
    assert!((summary_both.total_spend - 20.0).abs() < 1e-6);
    assert!((summary_both.thirty_day_spend - 20.0).abs() < 1e-6);
    assert!((summary_both.seven_day_spend - 20.0).abs() < 1e-6);
    assert!((summary_both.daily_run_rate - (20.0 / 7.0)).abs() < 1e-6);

    // 5. Non-matching project
    let filter_none_proj = CostsFilter {
        project: Some("NonExistentProject".to_string()),
        promptware: None,
    };
    let summary_none_proj = get_costs_summary(&conn, &filter_none_proj).unwrap();
    assert_eq!(summary_none_proj.total_spend, 0.0);
    assert_eq!(summary_none_proj.thirty_day_spend, 0.0);
    assert_eq!(summary_none_proj.seven_day_spend, 0.0);
    assert_eq!(summary_none_proj.daily_run_rate, 0.0);

    // 6. Non-matching promptware
    let filter_none_pw = CostsFilter {
        project: None,
        promptware: Some("NoSuchPromptware".to_string()),
    };
    let summary_none_pw = get_costs_summary(&conn, &filter_none_pw).unwrap();
    assert_eq!(summary_none_pw.total_spend, 0.0);
    assert_eq!(summary_none_pw.thirty_day_spend, 0.0);
    assert_eq!(summary_none_pw.seven_day_spend, 0.0);
    assert_eq!(summary_none_pw.daily_run_rate, 0.0);
}

#[test]
fn test_costs_series_filtering() {
    let (_dir, conn) = setup_test_db();

    // Insert second plan
    conn.execute(
        r#"
        INSERT INTO Plans (
            Id, Title, Project, Level, State, FolderPath, FolderName,
            YamlRaw, RevisionCount, LatestRevisionContent, Created, Updated
        ) VALUES (2, 'Plan Two', 'ProjectBeta', 'Feature', 'Draft', '/path/to/plan2', '00002-PlanTwo', '', 1, '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        "#,
        [],
    )
    .expect("insert second plan");

    // Plan 1 (TestProject):
    insert_cost(
        &conn,
        1,
        "CreatePlan",
        100,
        Some(1.0),
        Some("2026-08-10T10:00:00Z"),
    )
    .unwrap();
    insert_cost(
        &conn,
        1,
        "ExecutePlan",
        200,
        Some(2.0),
        Some("2026-08-10T14:00:00Z"),
    )
    .unwrap();
    insert_cost(
        &conn,
        1,
        "ExecutePlan",
        300,
        Some(3.0),
        Some("2026-08-17T10:00:00Z"),
    )
    .unwrap();

    // Plan 2 (ProjectBeta):
    insert_cost(
        &conn,
        2,
        "CreatePlan",
        400,
        Some(4.0),
        Some("2026-08-10T11:00:00Z"),
    )
    .unwrap();
    insert_cost(
        &conn,
        2,
        "ExecutePlan",
        500,
        Some(5.0),
        Some("2026-08-17T14:00:00Z"),
    )
    .unwrap();

    // Daily with project filter
    let daily_p1 = get_costs_series(
        &conn,
        "daily",
        &CostsFilter {
            project: Some("TestProject".to_string()),
            promptware: None,
        },
    )
    .unwrap();
    assert_eq!(daily_p1.len(), 2);
    assert_eq!(daily_p1[0].period, "2026-08-10");
    assert_eq!(daily_p1[0].tokens, 300);
    assert!((daily_p1[0].cost - 3.0).abs() < 1e-6);
    assert_eq!(daily_p1[1].period, "2026-08-17");
    assert_eq!(daily_p1[1].tokens, 300);
    assert!((daily_p1[1].cost - 3.0).abs() < 1e-6);

    // Daily with promptware filter
    let daily_cp = get_costs_series(
        &conn,
        "daily",
        &CostsFilter {
            project: None,
            promptware: Some("CreatePlan".to_string()),
        },
    )
    .unwrap();
    assert_eq!(daily_cp.len(), 1);
    assert_eq!(daily_cp[0].period, "2026-08-10");
    assert_eq!(daily_cp[0].tokens, 500);
    assert!((daily_cp[0].cost - 5.0).abs() < 1e-6);

    // Daily with combined filter
    let daily_both = get_costs_series(
        &conn,
        "daily",
        &CostsFilter {
            project: Some("TestProject".to_string()),
            promptware: Some("ExecutePlan".to_string()),
        },
    )
    .unwrap();
    assert_eq!(daily_both.len(), 2);
    assert_eq!(daily_both[0].period, "2026-08-10");
    assert_eq!(daily_both[0].tokens, 200);
    assert!((daily_both[0].cost - 2.0).abs() < 1e-6);
    assert_eq!(daily_both[1].period, "2026-08-17");
    assert_eq!(daily_both[1].tokens, 300);
    assert!((daily_both[1].cost - 3.0).abs() < 1e-6);

    // Weekly with project filter
    let weekly_p1 = get_costs_series(
        &conn,
        "weekly",
        &CostsFilter {
            project: Some("TestProject".to_string()),
            promptware: None,
        },
    )
    .unwrap();
    assert_eq!(weekly_p1.len(), 2);
    assert_eq!(weekly_p1[0].tokens, 300);
    assert!((weekly_p1[0].cost - 3.0).abs() < 1e-6);
    assert_eq!(weekly_p1[1].tokens, 300);
    assert!((weekly_p1[1].cost - 3.0).abs() < 1e-6);

    // Weekly with promptware filter
    let weekly_ep = get_costs_series(
        &conn,
        "weekly",
        &CostsFilter {
            project: None,
            promptware: Some("ExecutePlan".to_string()),
        },
    )
    .unwrap();
    assert_eq!(weekly_ep.len(), 2);
    assert_eq!(weekly_ep[0].tokens, 200);
    assert!((weekly_ep[0].cost - 2.0).abs() < 1e-6);
    assert_eq!(weekly_ep[1].tokens, 800);
    assert!((weekly_ep[1].cost - 8.0).abs() < 1e-6);

    // Non-matching filter returns empty
    let empty = get_costs_series(
        &conn,
        "daily",
        &CostsFilter {
            project: Some("NonExistent".to_string()),
            promptware: None,
        },
    )
    .unwrap();
    assert!(empty.is_empty());
}

#[test]
fn none_cost_round_trips_as_null() {
    let (_dir, conn) = setup_test_db();

    insert_cost(&conn, 1, "ExecutePlan", 1500, None, None).expect("insert unpriced cost");

    let records = list_costs_by_plan(&conn, 1).expect("list costs");
    assert_eq!(records.len(), 1);
    assert_eq!(
        records[0].cost, None,
        "an unpriceable run must read back as unknown, not as free"
    );

    // Proves the column holds NULL rather than 0.0, which is what makes SUM and COUNT(Cost) skip it.
    let is_null: i64 = conn
        .query_row("SELECT Cost IS NULL FROM Costs WHERE PlanId = 1", [], |r| {
            r.get(0)
        })
        .expect("query Cost IS NULL");
    assert_eq!(is_null, 1);
}

#[test]
fn aggregates_skip_null_costs() {
    let (_dir, conn) = setup_test_db();

    let now = Utc::now().to_rfc3339();
    insert_cost(&conn, 1, "ExecutePlan", 1000, Some(10.0), Some(&now)).unwrap();
    insert_cost(&conn, 1, "ExecutePlan", 2000, None, Some(&now)).unwrap();
    insert_cost(&conn, 1, "ExecutePlan", 3000, Some(20.0), Some(&now)).unwrap();

    let summary = get_costs_summary(&conn, &CostsFilter::default()).expect("summary");
    assert!(
        (summary.total_spend - 30.0).abs() < 1e-6,
        "SUM skips the NULL rather than treating it as zero"
    );

    let (priced, total): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(Cost), COUNT(*) FROM Costs WHERE PlanId = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("count costs");
    assert_eq!(priced, 2, "COUNT(Cost) counts only the rows we could price");
    assert_eq!(total, 3);

    let average: f64 = conn
        .query_row("SELECT AVG(Cost) FROM Costs WHERE PlanId = 1", [], |r| {
            r.get(0)
        })
        .expect("average cost");
    assert!(
        (average - 15.0).abs() < 1e-6,
        "the average is over the runs we could price, not 10.0 with a zero dragging it down"
    );
}

#[test]
fn cost_source_agent_model_persist() {
    let (_dir, conn) = setup_test_db();

    insert_cost_entry(
        &conn,
        1,
        &CostEntry {
            promptware: "ExecutePlan".to_string(),
            tokens: 4000,
            cost: Some(1.25),
            model: Some("claude-opus-5".to_string()),
            cost_source: Some("agent".to_string()),
            agent: Some("claude".to_string()),
            log_timestamp: Some("2026-01-01T00:00:00Z".to_string()),
        },
    )
    .expect("insert fully populated entry");

    insert_cost_entry(
        &conn,
        1,
        &CostEntry {
            promptware: "CreatePlan".to_string(),
            tokens: 500,
            cost: None,
            model: None,
            cost_source: None,
            agent: None,
            log_timestamp: None,
        },
    )
    .expect("insert bare entry");

    let records = list_costs_by_plan(&conn, 1).expect("list costs");
    assert_eq!(records.len(), 2);

    assert_eq!(records[0].model.as_deref(), Some("claude-opus-5"));
    assert_eq!(records[0].cost_source.as_deref(), Some("agent"));
    assert_eq!(records[0].agent.as_deref(), Some("claude"));
    assert_eq!(
        records[0].log_timestamp.as_deref(),
        Some("2026-01-01T00:00:00Z")
    );

    assert_eq!(records[1].model, None);
    assert_eq!(records[1].cost_source, None);
    assert_eq!(records[1].agent, None);
    assert_eq!(records[1].log_timestamp, None);
}
