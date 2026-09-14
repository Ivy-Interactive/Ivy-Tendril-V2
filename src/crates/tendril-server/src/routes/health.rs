use crate::state::AppState;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::default_capabilities;
use tendril_core::health::{self, CheckResult};

pub async fn health_handler() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "pid": std::process::id(),
        "version": env!("CARGO_PKG_VERSION"),
        "apiVersion": 1,
        "capabilities": default_capabilities()
    }))
}

/// The last known release-check result — whatever `spawn_version_check` last found, or the disk
/// cache seeded at startup if it hasn't run yet. Never triggers a network call itself.
pub async fn get_version_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(state.version_info.read().await.clone())
}

/// Runs one release check synchronously and returns the result. Always `200`, even when the check
/// fails — a manual "check now" click must never surface a 5xx for what is, from the operator's
/// perspective, just "no update found (or couldn't tell)".
pub async fn check_version_now_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let settings = tendril_core::config::load_config(&state.config_path).unwrap_or_default();
    let client = tendril_core::version_check::build_client();
    let result =
        tendril_core::version_check::check_once(&client, &state.tendril_home, settings.beta).await;

    let mut info = state.version_info.write().await;
    match result {
        Ok(fresh) => *info = fresh,
        Err(e) => {
            tracing::debug!("Manual version check failed: {e}");
            info.consecutive_failures = info.consecutive_failures.saturating_add(1);
        }
    }
    Json(info.clone())
}

/// The same checks `tendril doctor` prints, as data, plus one probe per coding-agent CLI so the
/// onboarding wizard can annotate the agents it offers. `run_checks` already covers git and the
/// GitHub CLI, so only `agent_checks` is appended — appending the full prerequisite set would list
/// those two twice.
///
/// Blocking probes (`git --version`, config/database reads) run on a blocking thread: a handful of
/// process spawns must not stall the async runtime.
pub async fn doctor_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let tendril_home = state.tendril_home.clone();
    let checks = tokio::task::spawn_blocking(move || {
        let mut checks = health::run_checks(&tendril_home);
        checks.extend(health::agent_checks());
        checks
    })
    .await
    .unwrap_or_else(|e| {
        tracing::error!("Doctor checks panicked: {e}");
        Vec::<CheckResult>::new()
    });

    Json(checks)
}
