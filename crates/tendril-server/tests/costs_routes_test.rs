use chrono::{Duration, Utc};
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{get_database_path, MasterGuard};
use tendril_core::db::{insert_cost, open_database};
use tendril_server::{create_router, AppState};

struct TestServer {
    pub tendril_home: PathBuf,
    pub port: u16,
    pub secret: String,
    _guard: MasterGuard,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

async fn start_test_server() -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-costs-server-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let host_str = "127.0.0.1".to_string();
    let tokio_listener = tokio::net::TcpListener::bind(format!("{}:0", host_str))
        .await
        .unwrap();
    let port = tokio_listener.local_addr().unwrap().port();

    let secret = tendril_core::config::generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, &host_str).unwrap();

    let plans_dir = tendril_home.join("Plans");
    std::fs::create_dir_all(&plans_dir).unwrap();
    let state = Arc::new(AppState::with_plans_dir(
        tendril_home.clone(),
        plans_dir,
        secret.clone(),
    ));
    let app = create_router(state);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        let _ = axum::serve(tokio_listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    TestServer {
        tendril_home,
        port,
        secret,
        _guard: guard,
        shutdown_tx: Some(shutdown_tx),
    }
}

#[tokio::test]
async fn test_costs_routes_contract() {
    let server = start_test_server().await;
    let client = reqwest::Client::new();

    let db_path = get_database_path(&server.tendril_home);
    let conn = open_database(&db_path).expect("open database");

    // Insert dummy plan
    conn.execute(
        r#"
        INSERT INTO Plans (
            Id, Title, Project, Level, State, FolderPath, FolderName,
            YamlRaw, RevisionCount, LatestRevisionContent, Created, Updated
        ) VALUES (10, 'Costs Route Plan', 'TestProject', 'Feature', 'Draft', '/path/to/plan', '00010-Plan', '', 1, '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        "#,
        [],
    )
    .expect("insert dummy plan");

    let now = Utc::now();
    let today = now.to_rfc3339();
    let two_days_ago = (now - Duration::days(2)).to_rfc3339();
    let ten_days_ago = (now - Duration::days(10)).to_rfc3339();

    insert_cost(&conn, 10, "CreatePlan", 1000, 5.0, Some(&today)).unwrap();
    insert_cost(&conn, 10, "ExecutePlan", 2000, 15.0, Some(&two_days_ago)).unwrap();
    insert_cost(&conn, 10, "UpdatePlan", 3000, 20.0, Some(&ten_days_ago)).unwrap();

    // 1. GET /api/costs/summary
    let summary_resp = client
        .get(format!(
            "http://127.0.0.1:{}/api/costs/summary",
            server.port
        ))
        .header("Authorization", format!("Bearer {}", server.secret))
        .send()
        .await
        .unwrap();

    assert_eq!(summary_resp.status(), reqwest::StatusCode::OK);
    let summary_json: serde_json::Value = summary_resp.json().await.unwrap();

    assert!(
        (summary_json["totalSpend"].as_f64().unwrap() - 40.0).abs() < 1e-6,
        "Expected totalSpend 40.0, got {:?}",
        summary_json["totalSpend"]
    );
    assert!(
        (summary_json["thirtyDaySpend"].as_f64().unwrap() - 40.0).abs() < 1e-6,
        "Expected thirtyDaySpend 40.0, got {:?}",
        summary_json["thirtyDaySpend"]
    );
    assert!(
        (summary_json["sevenDaySpend"].as_f64().unwrap() - 20.0).abs() < 1e-6,
        "Expected sevenDaySpend 20.0, got {:?}",
        summary_json["sevenDaySpend"]
    );
    let expected_run_rate = 20.0 / 7.0;
    assert!(
        (summary_json["dailyRunRate"].as_f64().unwrap() - expected_run_rate).abs() < 1e-6,
        "Expected dailyRunRate {}, got {:?}",
        expected_run_rate,
        summary_json["dailyRunRate"]
    );

    // 2. GET /api/costs/series?period=daily
    let daily_resp = client
        .get(format!(
            "http://127.0.0.1:{}/api/costs/series?period=daily",
            server.port
        ))
        .header("Authorization", format!("Bearer {}", server.secret))
        .send()
        .await
        .unwrap();

    assert_eq!(daily_resp.status(), reqwest::StatusCode::OK);
    let daily_json: serde_json::Value = daily_resp.json().await.unwrap();
    let daily_arr = daily_json.as_array().expect("series is an array");
    assert!(!daily_arr.is_empty());
    for point in daily_arr {
        assert!(point.get("period").is_some());
        assert!(point.get("cost").is_some());
        assert!(point.get("tokens").is_some());
    }

    // 3. GET /api/costs/series?period=weekly
    let weekly_resp = client
        .get(format!(
            "http://127.0.0.1:{}/api/costs/series?period=weekly",
            server.port
        ))
        .header("Authorization", format!("Bearer {}", server.secret))
        .send()
        .await
        .unwrap();

    assert_eq!(weekly_resp.status(), reqwest::StatusCode::OK);
    let weekly_json: serde_json::Value = weekly_resp.json().await.unwrap();
    let weekly_arr = weekly_json.as_array().expect("series is an array");
    assert!(!weekly_arr.is_empty());
    for point in weekly_arr {
        assert!(point.get("period").is_some());
        assert!(point.get("cost").is_some());
        assert!(point.get("tokens").is_some());
    }
}
