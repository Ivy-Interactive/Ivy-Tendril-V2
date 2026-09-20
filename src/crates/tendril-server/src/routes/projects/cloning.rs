//! Turning the remote URLs in a create/update request into local clones, and undoing that when the
//! request then fails.

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::path::PathBuf;
use tendril_core::config::expand_variables;
use tendril_core::git::clone::{
    import_remote_repo, is_remote_url, redact_credentials, CloneError, CloneFailure,
};
use tendril_core::models::RepoRef;

/// Turns every remote URL among `repos` into the local clone it now points at, leaving local paths
/// exactly as written.
///
/// This is V1's `OnboardingRepoHelper.ResolveReposAsync`, and the reason it exists is the same: a
/// URL in `config.yaml` is a project nothing downstream can use, because `resolve_working_directory`
/// only ever picks a repo path that `is_dir()`. The clone happens before `save_config`, so a
/// failure leaves no half-written project behind.
///
/// `base_branch` is filled in from the clone's own HEAD when the caller did not supply one — the
/// same fact V1 gets from a pre-clone `ls-remote --symref`, without the extra round trip.
///
/// Cloning shells out to `git clone`, which can run for minutes on a large repository, so the whole
/// pass runs off the async runtime — the precedent [`sync_project_repos`] sets for `git fetch`.
pub(super) async fn materialize_repos(
    tendril_home: PathBuf,
    project_name: String,
    repos: Vec<RepoRef>,
) -> Result<MaterializedRepos, CloneError> {
    // A path git would read as an option is refused whether or not it looks like a remote: it has
    // no scheme, so it reaches here as a "local path", and nothing downstream would treat it as one.
    if let Some(repo) = repos.iter().find(|r| r.path.trim().starts_with('-')) {
        return Err(CloneError {
            kind: CloneFailure::InvalidUrl,
            message: format!(
                "'{}' is not a valid repository path: it starts with a dash, which git would read as an option.",
                redact_credentials(repo.path.trim())
            ),
        });
    }

    // A relative local path is refused rather than stored, because nothing downstream can turn it
    // back into the directory the caller meant. Every consumer -- `resolve_working_directory`,
    // `resolve_project_github_repos` -- expands the stored string and then asks `is_dir()`, and
    // `is_dir()` resolves a relative path against *this process's* working directory: wherever the
    // daemon happened to be started, which is neither the client's directory nor TENDRIL_HOME. A
    // daemon launched from a checkout resolves a stored `..` to that checkout's parent, so the
    // project silently points at a directory nobody chose and the mistake only surfaces later, as
    // jobs running in the wrong tree.
    //
    // V1 never had the hole: `RepoPathValidator.IsLocalPath` accepts only an absolute path, a `~`
    // one, or a drive letter, and the app still enforces that port of it in
    // `views/onboarding/validation.ts`. This closes the same gap for the callers the app does not
    // own -- the HTTP API, the CLI's daemon path and MCP -- which reach these routes directly.
    //
    // Checked *after* expansion, the same expansion the consumers run before they resolve, so
    // `~/repos/x` and `%TENDRIL_HOME%/Projects/...` stay exactly as acceptable here as they are
    // there. An empty path is left to the per-route emptiness checks, so this guard's message is
    // only ever shown for a path that really does name something relative.
    let home_str = tendril_home.to_string_lossy().to_string();
    if let Some(repo) = repos.iter().find(|r| {
        let raw = r.path.trim();
        !raw.is_empty()
            && !is_remote_url(raw)
            && !std::path::Path::new(&expand_variables(raw, &home_str)).is_absolute()
    }) {
        return Err(CloneError {
            kind: CloneFailure::InvalidUrl,
            message: format!(
                "'{}' is not a valid repository path: it is relative, so it would resolve against the daemon's own working directory rather than against anything you chose. Use an absolute path.",
                redact_credentials(repo.path.trim())
            ),
        });
    }

    if !repos.iter().any(|r| is_remote_url(&r.path)) {
        return Ok(MaterializedRepos {
            repos,
            created: Vec::new(),
        });
    }

    let joined = tokio::task::spawn_blocking(move || {
        let mut resolved = Vec::with_capacity(repos.len());
        let mut created = Vec::new();
        for repo in repos {
            if !is_remote_url(&repo.path) {
                resolved.push(repo);
                continue;
            }
            let cloned = match import_remote_repo(&tendril_home, &project_name, &repo.path) {
                Ok(cloned) => cloned,
                // One remote in a list of three failing still leaves the first two on disk with
                // nothing about to reference them, so the partial pass rolls itself back before it
                // reports — the same rule the handlers below apply to their own later failures.
                Err(e) => {
                    remove_cloned_repos(&created);
                    return Err(e);
                }
            };
            if !cloned.refreshed {
                created.push(cloned.path.clone());
            }
            resolved.push(RepoRef {
                path: cloned.path.to_string_lossy().to_string(),
                base_branch: repo.base_branch.or(cloned.default_branch),
                extra: repo.extra,
            });
        }
        Ok(MaterializedRepos {
            repos: resolved,
            created,
        })
    })
    .await;

    match joined {
        Ok(result) => result,
        Err(e) => Err(CloneError {
            kind: CloneFailure::GitFailed,
            // The join error carries the panic payload, never a URL, so there is nothing to redact.
            message: format!("The repository clone task failed: {e}"),
        }),
    }
}

/// What [`materialize_repos`] resolved, and what it had to create on disk to do it.
///
/// `created` is the rollback list, and it holds only the clones this pass *made*. A remote that was
/// already there was refreshed rather than cloned (V1's pull-instead-of-clone), and that directory
/// belongs to whoever imported it first — deleting it because a later, unrelated step failed would
/// destroy a repository the operator is using. `ClonedRepo::refreshed` is the only thing that can
/// tell the two apart, which is why the flag is threaded out to here.
pub(super) struct MaterializedRepos {
    pub(super) repos: Vec<RepoRef>,
    /// Clone directories this pass created, in the order it created them.
    pub(super) created: Vec<PathBuf>,
}

/// Deletes the clones a request created, for a request that is about to fail.
///
/// The failure paths below all end with a handler returning an error status and writing nothing, so
/// without this the clone tree stays under `<TendrilHome>/Projects/<name>/Repos/` with nothing in
/// `config.yaml` naming it: invisible to the app, counted by nothing, and re-cloned on the next
/// attempt. The sequence that makes it two trees rather than one is the app's own 600s clone
/// timeout firing on a create the daemon then completes — the wizard reports failure, the operator
/// presses Create Project again, and the second attempt hits the post-clone duplicate check.
///
/// Best-effort by design: a clone that cannot be removed is logged and the original failure is
/// still what the caller reports, because the operator needs to hear why their request failed, not
/// why the cleanup after it did.
pub(super) fn remove_cloned_repos(created: &[PathBuf]) {
    for path in created {
        if let Err(e) = std::fs::remove_dir_all(path) {
            // `NotFound` is the expected case when a previous cleanup already ran, not a problem.
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    "Could not remove the clone at {} after a failed request: {}",
                    path.display(),
                    e
                );
            }
        }
    }
}

/// The status each failure deserves: the request was wrong (400), the disk is already occupied
/// (409), the remote took too long (504), or it would not cooperate (502). The message is already
/// redacted.
pub(super) fn clone_error_response(err: CloneError) -> axum::response::Response {
    let status = match err.kind {
        CloneFailure::InvalidUrl => StatusCode::BAD_REQUEST,
        CloneFailure::DestinationConflict => StatusCode::CONFLICT,
        // 504 rather than 502: the upstream answered, it just never finished. Split out because
        // "try again" is reasonable advice for this one and is not for a 502.
        CloneFailure::TimedOut => StatusCode::GATEWAY_TIMEOUT,
        CloneFailure::Unreachable | CloneFailure::AuthRequired | CloneFailure::GitFailed => {
            StatusCode::BAD_GATEWAY
        }
    };
    (status, Json(json!({ "error": err.message }))).into_response()
}
