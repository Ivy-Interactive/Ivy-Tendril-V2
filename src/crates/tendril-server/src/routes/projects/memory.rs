//! A project's memory files: the markdown under `<TENDRIL_HOME>/Projects/<Project>/Memory/`.
//!
//! V1 reads and writes these straight from the UI (`Apps/Settings/Blades/ProjectTableViews.cs`'s
//! `ProjectMemoryTableView`, `Apps/Settings/Sheets/EditProjectMemorySheet.cs`). The V2 webview has no
//! filesystem, so these four routes are that access, and nothing more: list the `*.md` files, read
//! one, write one (optionally renaming it), and delete one. The same folder is what the vault's
//! push/import carries as a project's "memories" (`vault::assets`), and what the firmware hands a job.
//!
//! Every file name is a single path segment ending in `.md`, checked before anything touches the
//! disk, so no request can reach outside the project's `Memory` directory.

use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{get_project_memory_dir, load_config};

/// One row of the memory table: V1's file name and its two-line snippet.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemoryEntry {
    pub file_name: String,
    /// The first two non-blank lines with their markdown markers trimmed, joined with " — " —
    /// exactly what `ProjectMemoryTableView` prints under each file name.
    pub snippet: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemoryFile {
    pub file_name: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteMemoryRequest {
    pub content: String,
    /// The name the file had when the sheet opened, when the save renames it.
    #[serde(default)]
    pub previous_file_name: Option<String>,
}

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

/// `EditProjectMemorySheet.cs`'s rule — a missing `.md` is appended — plus the guard V1 never
/// needed because it never took a name from over the wire: one plain segment, nothing that climbs.
pub fn normalize_memory_file_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("A memory file name is required.".to_string());
    }
    if trimmed.contains(['/', '\\', ':', '\0'])
        || trimmed == "."
        || trimmed == ".."
        || trimmed.starts_with('.')
    {
        return Err(format!(
            "'{trimmed}' is not a valid memory file name: use a plain file name such as stack.md."
        ));
    }
    let name = if trimmed.to_ascii_lowercase().ends_with(".md") {
        trimmed.to_string()
    } else {
        format!("{trimmed}.md")
    };
    Ok(name)
}

/// The first two non-blank lines, stripped of heading/list markers (`TrimStart('#', ' ', '-')`).
pub fn memory_snippet(content: &str) -> String {
    content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(2)
        .map(|line| line.trim().trim_start_matches(['#', ' ', '-']).to_string())
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" — ")
}

/// The project's `Memory` directory, or a 404 when no such project is configured.
fn memory_dir(state: &AppState, project: &str) -> Result<(String, PathBuf), Response> {
    let settings = load_config(&state.config_path).map_err(|e| {
        error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to load config: {e}"),
        )
    })?;
    let Some(found) = settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(project))
    else {
        return Err(error(
            StatusCode::NOT_FOUND,
            format!("Project '{project}' not found"),
        ));
    };
    Ok((
        found.name.clone(),
        get_project_memory_dir(&state.tendril_home, &found.name),
    ))
}

/// `GET /api/projects/:name/memory` — the `*.md` files, sorted by name. A project that has never
/// had one has no directory yet, which is an empty list rather than an error.
pub async fn list_project_memory(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let (_, dir) = match memory_dir(&state, &name) {
        Ok(found) => found,
        Err(response) => return response,
    };

    let mut entries = Vec::new();
    if let Ok(read) = std::fs::read_dir(&dir) {
        for entry in read.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if !file_name.to_ascii_lowercase().ends_with(".md") {
                continue;
            }
            // One unreadable file must not hide the rest: it is listed without a snippet.
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            entries.push(ProjectMemoryEntry {
                file_name: file_name.to_string(),
                snippet: memory_snippet(&content),
                size_bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
            });
        }
    }
    entries.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
    (StatusCode::OK, Json(json!(entries))).into_response()
}

/// `GET /api/projects/:name/memory/:file`.
pub async fn get_project_memory(
    State(state): State<Arc<AppState>>,
    Path((name, file)): Path<(String, String)>,
) -> impl IntoResponse {
    let (_, dir) = match memory_dir(&state, &name) {
        Ok(found) => found,
        Err(response) => return response,
    };
    let file_name = match normalize_memory_file_name(&file) {
        Ok(n) => n,
        Err(message) => return error(StatusCode::BAD_REQUEST, message),
    };
    match std::fs::read_to_string(dir.join(&file_name)) {
        Ok(content) => (
            StatusCode::OK,
            Json(json!(ProjectMemoryFile { file_name, content })),
        )
            .into_response(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => error(
            StatusCode::NOT_FOUND,
            format!("Memory file '{file_name}' not found in project '{name}'"),
        ),
        Err(e) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read '{file_name}': {e}"),
        ),
    }
}

/// `PUT /api/projects/:name/memory/:file` — create or overwrite, as V1's Add/Save both do.
///
/// With `previousFileName` set to a different name the save is a rename: the new file is written
/// first and the old one removed after, so a failed write loses nothing. Renaming onto a file that
/// already exists is refused (409) rather than silently replacing it — V1 would overwrite, and the
/// operator who renamed `stack.md` to `conventions.md` did not mean to delete the other one.
pub async fn put_project_memory(
    State(state): State<Arc<AppState>>,
    Path((name, file)): Path<(String, String)>,
    Json(req): Json<WriteMemoryRequest>,
) -> impl IntoResponse {
    let (_, dir) = match memory_dir(&state, &name) {
        Ok(found) => found,
        Err(response) => return response,
    };
    let file_name = match normalize_memory_file_name(&file) {
        Ok(n) => n,
        Err(message) => return error(StatusCode::BAD_REQUEST, message),
    };
    let previous = match req.previous_file_name.as_deref().map(str::trim) {
        Some(prev) if !prev.is_empty() => match normalize_memory_file_name(prev) {
            Ok(n) => Some(n),
            Err(message) => return error(StatusCode::BAD_REQUEST, message),
        },
        _ => None,
    };
    let renaming = previous
        .as_deref()
        .is_some_and(|prev| !prev.eq_ignore_ascii_case(&file_name));

    let target = dir.join(&file_name);
    if renaming && target.exists() {
        return error(
            StatusCode::CONFLICT,
            format!("A memory file named '{file_name}' already exists in project '{name}'"),
        );
    }

    if let Err(e) = std::fs::create_dir_all(&dir) {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create the memory directory: {e}"),
        );
    }
    if let Err(e) = std::fs::write(&target, req.content.as_bytes()) {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to write '{file_name}': {e}"),
        );
    }
    if renaming {
        if let Some(prev) = previous.as_deref() {
            let _ = std::fs::remove_file(dir.join(prev));
        }
    }

    (
        StatusCode::OK,
        Json(json!(ProjectMemoryFile {
            file_name,
            content: req.content,
        })),
    )
        .into_response()
}

/// `DELETE /api/projects/:name/memory/:file`.
pub async fn delete_project_memory(
    State(state): State<Arc<AppState>>,
    Path((name, file)): Path<(String, String)>,
) -> impl IntoResponse {
    let (_, dir) = match memory_dir(&state, &name) {
        Ok(found) => found,
        Err(response) => return response,
    };
    let file_name = match normalize_memory_file_name(&file) {
        Ok(n) => n,
        Err(message) => return error(StatusCode::BAD_REQUEST, message),
    };
    match std::fs::remove_file(dir.join(&file_name)) {
        Ok(()) => (
            StatusCode::OK,
            Json(json!({ "message": format!("Memory file '{file_name}' deleted") })),
        )
            .into_response(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => error(
            StatusCode::NOT_FOUND,
            format!("Memory file '{file_name}' not found in project '{name}'"),
        ),
        Err(e) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to delete '{file_name}': {e}"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_md_and_refuses_anything_that_is_not_one_segment() {
        assert_eq!(normalize_memory_file_name(" stack ").unwrap(), "stack.md");
        assert_eq!(normalize_memory_file_name("Notes.MD").unwrap(), "Notes.MD");
        for bad in [
            "",
            "  ",
            "../x.md",
            "a/b.md",
            "a\\b.md",
            "..",
            ".hidden.md",
            "c:x.md",
        ] {
            assert!(
                normalize_memory_file_name(bad).is_err(),
                "{bad:?} should be refused"
            );
        }
    }

    #[test]
    fn snippet_is_the_first_two_non_blank_lines_without_markers() {
        assert_eq!(
            memory_snippet("\n# Stack\n\n- Rust daemon\n- React app\n"),
            "Stack — Rust daemon"
        );
        assert_eq!(memory_snippet(""), "");
    }
}
