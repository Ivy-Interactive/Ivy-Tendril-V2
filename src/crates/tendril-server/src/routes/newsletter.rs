use crate::state::AppState;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use std::sync::Arc;
use tendril_core::config::load_config;
use tendril_core::{newsletter, telemetry};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeRequest {
    pub email: String,
}

/// Always 200 with a `SubscribeOutcome` body, including for an invalid address: the outcome *is* the
/// answer, and a 4xx would make the app's error path fight the daemon's.
pub async fn subscribe_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SubscribeRequest>,
) -> impl IntoResponse {
    let settings = load_config(&state.config_path).unwrap_or_default();
    let anonymous_id = settings
        .telemetry_enabled()
        .then(|| telemetry::get_or_create_anonymous_id(&state.tendril_home));

    let outcome = newsletter::subscribe(
        newsletter::SUBSCRIBERS_URL,
        &req.email,
        anonymous_id.as_deref(),
    )
    .await;

    Json(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::response::Response;

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
    async fn invalid_address_returns_200_with_validation_error_and_no_outbound_request() {
        let state = scratch_state("tendril-newsletter-route-invalid");
        let body = body_json(
            subscribe_handler(
                State(state.clone()),
                Json(SubscribeRequest {
                    email: "not-an-email".to_string(),
                }),
            )
            .await
            .into_response(),
        )
        .await;

        assert_eq!(body["subscribed"], false);
        assert_eq!(body["error"], "Please enter a valid email address.");

        let _ = std::fs::remove_dir_all(&state.tendril_home);
    }
}
