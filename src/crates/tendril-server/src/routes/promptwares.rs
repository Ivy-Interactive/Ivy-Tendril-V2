//! `GET /api/promptwares/:name/program` — the prompt a promptware actually runs.
//!
//! The Settings pane shows the program alongside the profile and tool rules it is configured with,
//! so an operator can see what they are configuring rather than only its name. It reads the
//! *deployed* tree under `<TendrilHome>/Promptwares/`, not the shipped source, because the deployed
//! copy is what a job compiles: an overlay that replaces `Program.md` has to be what the pane shows,
//! or the screen contradicts the run.
//!
//! Read-only by design. Editing a program is `promptwareOverlay`'s job — a directory the team owns
//! and version-controls — and adding a write route here would put an unversioned third layer in
//! front of it.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use tendril_core::promptware::read_promptware_program;

use crate::state::AppState;

/// One promptware's deployed `Program.md`, with the layer that supplied it.
///
/// `404` covers both "no such promptware" and "deployed tree has no program for it". They are the
/// same thing to the pane — there is nothing to show — and distinguishing them in the status would
/// tell an unauthenticated prober which names exist. The message names the promptware, which is what
/// the caller already asked for.
pub async fn get_promptware_program_handler(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let promptwares_dir = state.tendril_home.join("Promptwares");

    match read_promptware_program(&promptwares_dir, &name) {
        Ok(program) => (StatusCode::OK, Json(json!(program))),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}
