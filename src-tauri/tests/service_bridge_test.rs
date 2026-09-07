use axum::{
    extract::{Path, Query},
    http::{HeaderMap, StatusCode},
    routing::get,
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;
use tendril_app_lib::models::PlanQueryDto;
use tendril_app_lib::service::TendrilClient;
use tokio::net::TcpListener;

async fn spawn_mock_service(secret: &'static str) -> (SocketAddr, tokio::task::JoinHandle<()>) {
    let auth_check = move |headers: &HeaderMap| -> bool {
        if let Some(auth) = headers.get(axum::http::header::AUTHORIZATION) {
            if let Ok(s) = auth.to_str() {
                return s == format!("Bearer {secret}");
            }
        }
        false
    };

    let app = Router::new()
        .route("/api/ping", get(|| async { "pong" }))
        .route(
            "/api/health",
            get(move |headers: HeaderMap| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (
                    StatusCode::OK,
                    Json(json!({
                        "status": "healthy",
                        "apiVersion": 1,
                        "capabilities": ["plans", "jobs"]
                    })),
                )
            }),
        )
        .route(
            "/api/plans",
            get(move |headers: HeaderMap, Query(params): Query<std::collections::HashMap<String, String>>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                let mut plans = vec![
                    json!({
                        "id": "00001",
                        "title": "First Test Plan",
                        "state": "Draft",
                        "project": "DemoApp",
                        "level": "Feature",
                        "verifications": [{ "name": "RustBuild", "status": "Pending" }]
                    }),
                    json!({
                        "id": "00002",
                        "title": "Second Test Plan",
                        "state": "Review",
                        "project": "DemoApp",
                        "level": "Bug",
                        "verifications": [{ "name": "RustBuild", "status": "Pass" }]
                    }),
                ];

                if let Some(status) = params.get("status") {
                    plans.retain(|p| p.get("state").and_then(|s| s.as_str()) == Some(status));
                }

                (StatusCode::OK, Json(json!(plans)))
            })
            .post(move |headers: HeaderMap, Json(body): Json<serde_json::Value>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (StatusCode::CREATED, Json(json!({ "id": "00003", "title": body["title"], "state": "Draft" })))
            }),
        )
        .route(
            "/api/plans/{id}",
            get(move |headers: HeaderMap, Path(id): Path<String>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                if id == "00001" {
                    (
                        StatusCode::OK,
                        Json(json!({
                            "metadata": {
                                "id": "00001",
                                "title": "First Test Plan",
                                "state": "Draft",
                                "project": "DemoApp",
                                "level": "Feature",
                                "repos": ["/path/to/repo"],
                                "verifications": [{ "name": "RustBuild", "status": "Pending" }],
                                // snake_case: `PlanFile`/`PlanMetadata` carry no
                                // `rename_all`. See service::plan_mapping docs.
                                "depends_on": []
                            },
                            "latest_revision_content": "# Plan Spec Markdown"
                        })),
                    )
                } else {
                    (StatusCode::NOT_FOUND, Json(json!({ "error": "not found" })))
                }
            })
            .put(move |headers: HeaderMap, Path(_id): Path<String>, Json(_body): Json<serde_json::Value>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (StatusCode::OK, Json(json!({ "message": "updated" })))
            }),
        )
        .route(
            "/api/plans/{id}/revisions",
            get(move |headers: HeaderMap, Path(_id): Path<String>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, "unauthorized".to_string());
                }
                (StatusCode::OK, "# Revision content markdown".to_string())
            })
            .post(move |headers: HeaderMap, Path(_id): Path<String>, Json(_body): Json<serde_json::Value>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (StatusCode::OK, Json(json!({ "revision": 2, "message": "Revision 002 written" })))
            }),
        )
        .route(
            "/api/jobs",
            get(move |headers: HeaderMap| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (
                    StatusCode::OK,
                    Json(json!([
                        {
                            "id": "00100",
                            "type": "CreatePlan",
                            "planId": "00001",
                            "planTitle": "First Test Plan",
                            "project": "DemoApp",
                            "status": "Completed"
                        }
                    ])),
                )
            })
            .post(move |headers: HeaderMap, Json(_body): Json<serde_json::Value>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (StatusCode::OK, Json(json!({ "jobId": "00101", "status": "Started" })))
            }),
        )
        .route(
            "/api/jobs/{id}",
            get(move |headers: HeaderMap, Path(id): Path<String>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (
                    StatusCode::OK,
                    Json(json!({
                        "id": id,
                        "type": "ExecutePlan",
                        "status": "Running",
                        "statusMessage": "Executing tests..."
                    })),
                )
            }),
        )
        .route(
            "/api/config",
            get(move |headers: HeaderMap| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (
                    StatusCode::OK,
                    Json(json!({
                        "codingAgent": "claude",
                        "jobTimeout": 1800,
                        "theme": "dark"
                    })),
                )
            }),
        )
        .route(
            "/api/projects",
            get(move |headers: HeaderMap| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (
                    StatusCode::OK,
                    Json(json!([
                        {
                            "name": "DemoApp",
                            "repos": ["/repos/demo"],
                            "verifications": ["RustBuild"]
                        }
                    ])),
                )
            }),
        );

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let addr = listener.local_addr().expect("local addr");

    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    (addr, handle)
}

#[tokio::test]
async fn test_client_authentication_and_methods() {
    let secret = "valid-test-secret-999";
    let (addr, _server) = spawn_mock_service(secret).await;
    let base_url = format!("http://127.0.0.1:{}", addr.port());

    // 1. Client with valid secret
    let client = TendrilClient::new(base_url.clone(), Some(secret.to_string()));

    // Ping
    let pong = client.ping().await.expect("ping");
    assert_eq!(pong, "pong");

    // List plans
    let plans = client.list_plans(None).await.expect("list plans");
    assert_eq!(plans.len(), 2);
    assert_eq!(plans[0].id, "00001");
    assert_eq!(plans[0].title, "First Test Plan");

    // Filter plans by status
    let review_plans = client
        .list_plans(Some(PlanQueryDto {
            status: Some("Review".to_string()),
            project: None,
            q: None,
        }))
        .await
        .expect("filter plans");
    assert_eq!(review_plans.len(), 1);
    assert_eq!(review_plans[0].id, "00002");

    // Get plan detail
    let detail = client.get_plan("00001").await.expect("get plan detail");
    assert_eq!(detail.id, "00001");
    assert_eq!(
        detail.latest_revision_content,
        Some("# Plan Spec Markdown".to_string())
    );

    // Get revision
    let rev = client.get_revision("00001", None).await.expect("get rev");
    assert!(rev.contains("Revision content"));

    // Write revision
    let rev_res = client
        .write_revision("00001", "# New rev")
        .await
        .expect("write rev");
    assert_eq!(rev_res.revision, 2);

    // Update field
    client
        .update_plan_field("00001", "state", "Review", false)
        .await
        .expect("update field");

    // List jobs
    let jobs = client.list_jobs(None, None).await.expect("list jobs");
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].id, "00100");

    // Get job detail
    let job_detail = client.get_job("00100").await.expect("get job");
    assert_eq!(job_detail.status, "Running");

    // Start job
    let start_res = client
        .start_job(json!({ "type": "CreatePlan", "description": "New task" }))
        .await
        .expect("start job");
    assert_eq!(start_res.job_id, "00101");

    // Get config
    let config = client.get_config().await.expect("get config");
    assert_eq!(config.coding_agent, Some("claude".to_string()));
    assert_eq!(config.job_timeout, Some(1800));

    // List projects
    let projects = client.list_projects().await.expect("list projects");
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].name, "DemoApp");

    // 2. Client with invalid secret: verify error propagation
    let invalid_client = TendrilClient::new(base_url, Some("bad-secret".to_string()));
    let auth_error = invalid_client.list_plans(None).await;
    assert!(auth_error.is_err());
    let err_str = auth_error.unwrap_err().to_string();
    assert!(err_str.contains("401") || err_str.contains("LIST_PLANS_FAILED"));
}
