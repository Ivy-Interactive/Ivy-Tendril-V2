use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::sync::Arc;
use tendril_core::onboarding;

/// Whether the first-run wizard should be shown, and why. The app gates its whole shell on this, so
/// it must never fail: an unreadable config resolves to "not needed" inside `onboarding::status`.
pub async fn get_status_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(onboarding::status(&state.tendril_home, &state.config_path))
}

pub async fn complete_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let now = chrono::Utc::now().to_rfc3339();
    match onboarding::mark_completed(&state.config_path, &now) {
        Ok(()) => (
            StatusCode::OK,
            Json(json!({ "status": "ok", "completedAt": now })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to complete onboarding: {}", e) })),
        ),
    }
}

pub async fn dismiss_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match onboarding::mark_dismissed(&state.config_path) {
        Ok(()) => (StatusCode::OK, Json(json!({ "status": "ok" }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to dismiss onboarding: {}", e) })),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::response::Response;
    use tendril_core::config::load_config;

    fn scratch_state(name: &str) -> Arc<AppState> {
        let home = std::env::temp_dir().join(format!("{}-{}", name, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&home).unwrap();
        Arc::new(AppState::new(home, "test-secret".to_string()))
    }

    async fn body_json(response: Response) -> serde_json::Value {
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn reports_a_fresh_install_as_needing_onboarding() {
        let state = scratch_state("tendril-onboarding-route-fresh");
        let body = body_json(
            get_status_handler(State(state.clone()))
                .await
                .into_response(),
        )
        .await;

        assert_eq!(body["needed"], true);
        assert_eq!(body["reason"], "FreshInstall");
        assert_eq!(body["projectCount"], 0);
        assert_eq!(body["configExists"], false);

        let _ = std::fs::remove_dir_all(&state.tendril_home);
    }

    #[tokio::test]
    async fn dismissing_persists_and_flips_the_status() {
        let state = scratch_state("tendril-onboarding-route-dismiss");

        let dismissed =
            body_json(dismiss_handler(State(state.clone())).await.into_response()).await;
        assert_eq!(dismissed["status"], "ok");

        let settings = load_config(&state.config_path).expect("config parses");
        assert!(settings.onboarding.dismissed);

        let body = body_json(
            get_status_handler(State(state.clone()))
                .await
                .into_response(),
        )
        .await;
        assert_eq!(body["needed"], false);
        assert_eq!(body["reason"], "Dismissed");

        let _ = std::fs::remove_dir_all(&state.tendril_home);
    }

    #[tokio::test]
    async fn completing_records_a_timestamp() {
        let state = scratch_state("tendril-onboarding-route-complete");

        let completed =
            body_json(complete_handler(State(state.clone())).await.into_response()).await;
        assert_eq!(completed["status"], "ok");
        assert!(completed["completedAt"].as_str().is_some());

        let settings = load_config(&state.config_path).expect("config parses");
        assert!(settings.onboarding.completed);
        assert!(settings.onboarding.completed_at.is_some());

        let _ = std::fs::remove_dir_all(&state.tendril_home);
    }
}
