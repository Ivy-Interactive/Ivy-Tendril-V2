use crate::plans::helpers::resolve_plan_folder;
use std::path::Path;

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct PlanArtifacts {
    pub screenshots: Vec<String>,
    pub other: Vec<String>,
}

/// Reads the plan's code changes diff and file statistics across its worktrees and repos.
pub fn read_plan_changes(
    tendril_home: &Path,
    plans_dir: &Path,
    plan_id_or_ref: &str,
) -> crate::git::PlanChangesData {
    let folder = match resolve_plan_folder(plan_id_or_ref, plans_dir) {
        Ok(f) => f,
        Err(_) => return crate::git::PlanChangesData::default(),
    };

    let (plan, _) = match crate::plans::read_plan_yaml(&folder) {
        Ok(p) => p,
        Err(_) => return crate::git::PlanChangesData::default(),
    };

    let mut repos: Vec<std::path::PathBuf> =
        plan.repos.iter().map(std::path::PathBuf::from).collect();
    if repos.is_empty() {
        let config_path = crate::config::get_config_path(tendril_home);
        if let Ok(settings) = crate::config::load_config(&config_path) {
            if let Some(project) = settings
                .projects
                .iter()
                .find(|p| p.name.eq_ignore_ascii_case(&plan.project))
            {
                repos = project
                    .repo_paths()
                    .into_iter()
                    .map(std::path::PathBuf::from)
                    .collect();
            }
        }
    }

    crate::git::build_plan_changes_data(&folder, &plan.commits, &repos)
}

/// Reads the plan's summary markdown from `<planFolder>/Artifacts/summary.md` (or casing variants),
/// or synthesizes a diagnostic summary from the latest execution job when execution failed.
pub fn read_plan_summary(
    tendril_home: &Path,
    plans_dir: &Path,
    plan_id_or_ref: &str,
) -> Option<String> {
    let folder = resolve_plan_folder(plan_id_or_ref, plans_dir).ok()?;

    for candidate in &[
        folder.join("Artifacts").join("summary.md"),
        folder.join("Artifacts").join("Summary.md"),
        folder.join("summary.md"),
        folder.join("Summary.md"),
    ] {
        if candidate.is_file() {
            if let Ok(content) = std::fs::read_to_string(candidate) {
                if !content.trim().is_empty() {
                    return Some(content);
                }
            }
        }
    }

    resolve_diagnostic_summary(tendril_home, &folder)
}

/// Lists screenshots and non-summary artifact files in `<planFolder>/Artifacts`.
pub fn read_plan_artifacts(plans_dir: &Path, plan_id_or_ref: &str) -> PlanArtifacts {
    let folder = match resolve_plan_folder(plan_id_or_ref, plans_dir) {
        Ok(f) => f,
        Err(_) => return PlanArtifacts::default(),
    };

    let artifacts_dir = folder.join("Artifacts");
    if !artifacts_dir.is_dir() {
        return PlanArtifacts::default();
    }

    let mut screenshots = Vec::new();
    let mut other = Vec::new();

    let is_img_ext = |ext: &str| matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg");

    let screenshots_dir = artifacts_dir.join("screenshots");
    if screenshots_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&screenshots_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let ext = path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or_default()
                        .to_lowercase();
                    if is_img_ext(&ext) {
                        screenshots.push(path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    if let Ok(entries) = std::fs::read_dir(&artifacts_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if !name.starts_with("draft_") && !name.eq_ignore_ascii_case("summary.md") {
                        let ext = path
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or_default()
                            .to_lowercase();
                        if is_img_ext(&ext) {
                            screenshots.push(path.to_string_lossy().to_string());
                        } else {
                            other.push(path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }

    screenshots.sort();
    other.sort();
    PlanArtifacts { screenshots, other }
}

/// The largest artifact [`read_plan_artifact`] hands back as text.
///
/// The Review app's artifact sheet shows the text inline — highlighted while it is small, as a plain
/// block past `ARTIFACT_RICH_PREVIEW_LIMIT_BYTES` — and a multi-megabyte log is more than a webview
/// should be handed in one IPC answer to scroll through. Past this size the sheet says so and offers
/// the file manager instead.
pub const MAX_ARTIFACT_PREVIEW_BYTES: u64 = 1024 * 1024;

/// One file in `<planFolder>/Artifacts`, as the Review app's artifact sheet shows it.
///
/// Serialized with a `kind` tag (`text`, `binary`, `tooLarge`) so the app can switch on it: only
/// `text` carries content, and the other two say why there is none.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlanArtifactContent {
    /// The file as UTF-8 text, with any byte-order mark removed.
    Text { text: String, size: u64 },
    /// Not UTF-8 text — an archive, a PDF, a recording — so there is nothing to show inline.
    Binary { size: u64 },
    /// Larger than [`MAX_ARTIFACT_PREVIEW_BYTES`], so it was not read.
    TooLarge { size: u64 },
}

/// Why [`read_plan_artifact`] could not answer.
#[derive(Debug, thiserror::Error)]
pub enum PlanArtifactReadError {
    #[error("Plan '{0}' not found")]
    PlanNotFound(String),
    /// A relative path, or one that resolves — through `..` or a symlink — outside the plan's
    /// `Artifacts` folder. V1 answers the same request "Access denied: file is outside the
    /// artifacts folder."
    #[error("'{0}' is not in the plan's Artifacts folder")]
    OutsideArtifacts(String),
    #[error("Artifact '{0}' does not exist")]
    NotFound(String),
    #[error("Failed to read artifact '{0}': {1}")]
    Io(String, std::io::Error),
}

/// Reads one file out of `<planFolder>/Artifacts` for the Review app's artifact sheet.
///
/// V1's `Review/ContentView.cs` does this in its `artifactContentQuery`: the sheet names the file by
/// the absolute path the artifact listing gave it, and the read is refused unless that path resolves
/// inside the plan's `Artifacts` folder (`ValidateArtifactPath`). Containment here is decided on the
/// canonical, symlink-resolved path of both sides rather than V1's string prefix, so neither `..`
/// nor a symlink planted in the folder can reach a file outside it.
///
/// This is deliberately not a widening of `GET /ivy/local-file`, which serves images and PDFs from
/// every local-file root: text there would include `config.yaml` and anything else under the Tendril
/// home. This read reaches one plan's artifacts and nothing else.
pub fn read_plan_artifact(
    plans_dir: &Path,
    plan_id_or_ref: &str,
    path: &str,
) -> Result<PlanArtifactContent, PlanArtifactReadError> {
    use std::io::Read;

    let folder = resolve_plan_folder(plan_id_or_ref, plans_dir)
        .map_err(|_| PlanArtifactReadError::PlanNotFound(plan_id_or_ref.to_string()))?;

    let requested = Path::new(path);
    if !requested.is_absolute() {
        return Err(PlanArtifactReadError::OutsideArtifacts(path.to_string()));
    }

    // No `Artifacts` folder means the plan produced no artifacts, so whatever was asked for is not
    // one of them.
    let artifacts_dir = folder
        .join("Artifacts")
        .canonicalize()
        .map_err(|_| PlanArtifactReadError::NotFound(path.to_string()))?;
    let resolved = match requested.canonicalize() {
        Ok(resolved) => resolved,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(PlanArtifactReadError::NotFound(path.to_string()))
        }
        Err(err) => return Err(PlanArtifactReadError::Io(path.to_string(), err)),
    };
    if !resolved.starts_with(&artifacts_dir) {
        return Err(PlanArtifactReadError::OutsideArtifacts(path.to_string()));
    }

    let io_error = |err| PlanArtifactReadError::Io(path.to_string(), err);
    let metadata = std::fs::metadata(&resolved).map_err(io_error)?;
    if !metadata.is_file() {
        return Err(PlanArtifactReadError::NotFound(path.to_string()));
    }
    if metadata.len() > MAX_ARTIFACT_PREVIEW_BYTES {
        return Ok(PlanArtifactContent::TooLarge {
            size: metadata.len(),
        });
    }

    // Bounded, because an agent may still be writing the file: the size checked above is not a
    // promise about the size read here.
    let mut bytes = Vec::new();
    std::fs::File::open(&resolved)
        .and_then(|file| {
            file.take(MAX_ARTIFACT_PREVIEW_BYTES + 1)
                .read_to_end(&mut bytes)
        })
        .map_err(io_error)?;
    let size = bytes.len() as u64;
    if size > MAX_ARTIFACT_PREVIEW_BYTES {
        return Ok(PlanArtifactContent::TooLarge { size });
    }

    // A NUL byte is the conventional binary sniff (git's own), and strict UTF-8 keeps a PDF or an
    // image the local-file route does not allow from rendering as mojibake.
    if bytes.contains(&0) {
        return Ok(PlanArtifactContent::Binary { size });
    }
    match String::from_utf8(bytes) {
        Ok(text) => {
            let text = match text.strip_prefix('\u{feff}') {
                Some(without_bom) => without_bom.to_string(),
                None => text,
            };
            Ok(PlanArtifactContent::Text { text, size })
        }
        Err(_) => Ok(PlanArtifactContent::Binary { size }),
    }
}

/// Synthesizes an "# Execution Summary" when `<planFolder>/Artifacts/summary.md` is missing,
/// extracting failure reason and last agent output from the newest job that targeted the plan.
pub fn resolve_diagnostic_summary(tendril_home: &Path, folder: &Path) -> Option<String> {
    let db_path = tendril_home.join("tendril.db");
    let conn = crate::db::open_database(&db_path).ok()?;
    let folder_name = folder.file_name()?.to_str()?;
    let pattern = format!("%{}%", folder_name);

    let mut stmt = conn
        .prepare(
            "SELECT Id, Type, Status, StatusMessage, ReportedFailureReason \
             FROM Jobs WHERE PlanFile LIKE ?1 COLLATE NOCASE ORDER BY Id DESC LIMIT 1",
        )
        .ok()?;

    let row = stmt
        .query_row([pattern], |r| {
            let id: String = r.get(0)?;
            let job_type: String = r.get(1)?;
            let status: String = r.get(2)?;
            let status_msg: Option<String> = r.get(3)?;
            let failure_reason: Option<String> = r.get(4)?;
            Ok((id, job_type, status, status_msg, failure_reason))
        })
        .ok()?;

    let (job_id, job_type, status, status_msg, failure_reason) = row;

    let mut agent_output: Option<String> = None;
    if let Ok(Some(lines)) = crate::jobs::logger::read_eventwire_log(tendril_home, &job_id, None) {
        agent_output = extract_last_agent_text(&lines);
    }
    if agent_output.is_none() {
        if let Ok(Some(lines)) = crate::jobs::logger::read_raw_log(tendril_home, &job_id, None) {
            agent_output = extract_last_agent_text(&lines);
        }
    }

    let detail = failure_reason
        .or(status_msg)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| status.clone());

    if let Some(output) = agent_output {
        Some(format!(
            "# Execution Summary\n\n> [!CAUTION]\n> No summary was generated because execution did not complete successfully.\n>\n> **Job {job_id} ({job_type}):** {detail}\n>\n> `Reset to Draft` or `Request Changes` to retry the plan.\n\n### Last Agent Output\n\n```\n{output}\n```\n"
        ))
    } else if matches!(
        status.as_str(),
        "Failed" | "Timeout" | "Stopped" | "Cancelled"
    ) {
        Some(format!(
            "# Execution Summary\n\n> [!CAUTION]\n> No summary was generated because execution did not complete successfully.\n>\n> **Job {job_id} ({job_type}):** {detail}\n>\n> `Reset to Draft` or `Request Changes` to retry the plan.\n"
        ))
    } else {
        None
    }
}

fn extract_last_agent_text(lines: &[String]) -> Option<String> {
    for line in lines.iter().rev() {
        if let Some(text) = crate::jobs::failure_analysis::agent_text(line) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                let snippet = if trimmed.len() > 3000 {
                    let start = trimmed.len() - 3000;
                    format!("... (earlier output omitted)\n{}", &trimmed[start..])
                } else {
                    trimmed.to_string()
                };
                return Some(snippet);
            }
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(resp) = v
                .get("result")
                .and_then(|r| r.get("response"))
                .and_then(|s| s.as_str())
            {
                let trimmed = resp.trim();
                if !trimmed.is_empty() {
                    let snippet = if trimmed.len() > 3000 {
                        let start = trimmed.len() - 3000;
                        format!("... (earlier output omitted)\n{}", &trimmed[start..])
                    } else {
                        trimmed.to_string()
                    };
                    return Some(snippet);
                }
            }
        }
    }
    None
}
