mod common;

use common::HomeFixture;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tendril_core::config::get_database_path;
use tendril_core::db::{list_costs_by_plan, open_database};
use tendril_core::jobs::manager::finish_job;
use tendril_core::models::{JobItem, JobStatus};
use tokio::sync::RwLock;

#[tokio::test]
async fn test_job_completion_cost_extraction() {
    let home = HomeFixture::new("cost-extract");
    let db_path = get_database_path(&home.path);
    let conn = open_database(&db_path).expect("open database");

    // Insert dummy plan into Plans table with Id = 42
    conn.execute(
        r#"
        INSERT INTO Plans (
            Id, Title, Project, Level, State, FolderPath, FolderName,
            YamlRaw, RevisionCount, LatestRevisionContent, Created, Updated
        ) VALUES (42, 'Cost Test Plan', 'TestProject', 'Feature', 'Executing', '/path/to/00042-CostPlan', '00042-CostPlan', '', 1, '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        "#,
        [],
    )
    .expect("insert dummy plan");

    // Create eventwire log simulating agent result event
    let logs_dir = home.path.join("Logs").join("Jobs");
    std::fs::create_dir_all(&logs_dir).unwrap();
    let eventwire_path = logs_dir.join("00100.eventwire.jsonl");

    let event_json = r#"{"kind":"result","is_success":true,"usage":{"input_tokens":10000,"output_tokens":2000,"cache_read_tokens":5000,"cache_write_tokens":1000,"reasoning_tokens":500,"model":"claude-3-5-sonnet"},"timestamp":"2026-09-07T12:00:00Z"}"#;
    std::fs::write(&eventwire_path, format!("{}\n", event_json)).expect("write eventwire log");

    let job_id = "00100".to_string();
    let plan_file_path = home.plans_dir().join("00042-CostPlan");
    std::fs::create_dir_all(&plan_file_path).unwrap();

    let job = JobItem {
        id: job_id.clone(),
        job_type: "ExecutePlan".to_string(),
        plan_file: plan_file_path.to_string_lossy().to_string(),
        project: "TestProject".to_string(),
        status: JobStatus::Running,
        provider: "claude".to_string(),
        model: None,
        execution_profile: None,
        effort: None,
        started_at: Some(chrono::Utc::now()),
        completed_at: None,
        duration_seconds: None,
        cost: None,
        tokens: None,
        input_tokens: None,
        output_tokens: None,
        cache_read_tokens: None,
        cache_write_tokens: None,
        reasoning_tokens: None,
        cost_source: None,
        status_message: None,
        args: None,
        typed_args: None,
        working_directory: None,
        cli_command: None,
        process_id: None,
        previous_plan_state: None,
        reported_plan_id: Some("00042".to_string()),
        reported_plan_title: Some("Cost Test Plan".to_string()),
        reported_failure_reason: None,
        cleared: false,
    };

    let jobs_map = Arc::new(RwLock::new(HashMap::new()));
    let handles = Arc::new(RwLock::new(HashMap::new()));
    let completion_claimed = AtomicBool::new(false);

    finish_job(
        &home.path,
        &jobs_map,
        &handles,
        &completion_claimed,
        job,
        JobStatus::Completed,
        "Job completed successfully".to_string(),
        Some(15),
    )
    .await;

    // Check in-memory job
    let map = jobs_map.read().await;
    let finished_job = map.get(&job_id).expect("job in map");

    assert_eq!(finished_job.status, JobStatus::Completed);
    assert_eq!(finished_job.tokens, Some(18000)); // 10000 + 2000 + 5000 + 1000
    assert_eq!(finished_job.input_tokens, Some(10000));
    assert_eq!(finished_job.output_tokens, Some(2000));
    assert_eq!(finished_job.cache_read_tokens, Some(5000));
    assert_eq!(finished_job.cache_write_tokens, Some(1000));
    assert_eq!(finished_job.reasoning_tokens, Some(500));
    assert_eq!(finished_job.model, Some("claude-3-5-sonnet".to_string()));
    assert_eq!(finished_job.cost_source, Some("estimated".to_string()));
    assert!(finished_job.cost.is_some());
    let cost_val = finished_job.cost.unwrap();
    assert!(cost_val > 0.0);

    // Verify record in SQLite Costs table
    let records = list_costs_by_plan(&conn, 42).expect("list costs for plan 42");
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].plan_id, 42);
    assert_eq!(records[0].promptware, "ExecutePlan");
    assert_eq!(records[0].tokens, 18000);
    assert!((records[0].cost.unwrap() - cost_val).abs() < 1e-6);
}
