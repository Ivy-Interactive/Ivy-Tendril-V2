//! The webview's one way to look at a file on the machine's own filesystem.
//!
//! A chat attachment, a plan screenshot and a PDF all live at an absolute path, and the webview cannot
//! load one: `file://` is blocked from a `tauri://` (or `http://localhost`) page, and Tauri's asset
//! protocol is deliberately not enabled — it would be a second file-reading surface with a second
//! allow-list to keep right, and V1 has never used it.
//!
//! V1 reads such a file through `GET /ivy/local-file`, and so does this. The daemon's
//! `local_file_guard` is the thing that decides whether a path may be read at all: credential first,
//! then host, origin, `Sec-Fetch-Site`, the extension allowlist and root confinement. This command
//! adds no policy of its own — it names one route, forwards one path, and returns whatever the guard
//! allowed as a `data:` URL.
//!
//! Two things it deliberately does not do:
//!
//! * **It is not a proxy.** As with [`super::tables::cmd_query_table`], the route is fixed here and only
//!   the path travels, because a command that carried the daemon's credential to a caller-named *route*
//!   would make everything the daemon can do reachable from the webview.
//! * **It does not hand out the token.** The guard takes its credential in the query string (an
//!   `<img src>` sends no `Authorization` header), and the only credential the app has is the bearer
//!   secret out of `.master`. Returning a URL carrying it would put the daemon's full credential in the
//!   DOM; the bytes come back instead and the secret stays native. See
//!   [`crate::service::TendrilClient::get_local_file_data_url`].

use super::get_client_from_master;
use crate::error::BridgeError;

/// A local file as a `data:` URL, or an error if the daemon will not serve it.
///
/// `path` must be absolute. A relative path would be resolved against the *daemon's* working
/// directory, which no caller here can reason about, so it is refused rather than guessed at.
///
/// Everything else is the guard's call, including which extensions are previewable and which
/// directories may be read from — a refusal comes back as `NOT_FOUND` whether the file is outside
/// every allowed root or simply absent, exactly as the endpoint answers it.
#[tauri::command]
pub async fn cmd_get_local_file_preview(path: String) -> Result<String, BridgeError> {
    validate_preview_path(&path)?;
    get_client_from_master()?
        .get_local_file_data_url(&path)
        .await
}

/// The one check this side makes: a non-empty, absolute path.
fn validate_preview_path(path: &str) -> Result<(), BridgeError> {
    if path.trim().is_empty() {
        return Err(BridgeError::validation("No file path was given to preview"));
    }
    if !std::path::Path::new(path).is_absolute() {
        return Err(BridgeError::validation(format!(
            "'{path}' is not an absolute path"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_preview_path;

    #[test]
    fn an_absolute_path_is_accepted() {
        let absolute = if cfg!(windows) {
            r"C:\Users\me\shot.png"
        } else {
            "/Users/me/shot.png"
        };
        assert!(validate_preview_path(absolute).is_ok());
    }

    #[test]
    fn a_relative_or_empty_path_is_refused_here() {
        for path in ["", "   ", "shot.png", "Attachments/shot.png", "./shot.png"] {
            assert!(
                validate_preview_path(path).is_err(),
                "{path} must be refused"
            );
        }
    }

    /// Everything about *which* files may be read belongs to the daemon's guard, so a traversal or a
    /// forbidden extension is not refused here — it is forwarded and refused there. The
    /// `local_file_preview_command_test` suite proves the refusal survives the round trip.
    #[test]
    fn path_policy_is_left_to_the_guard() {
        assert!(validate_preview_path("/etc/passwd").is_ok());
        assert!(validate_preview_path("/Users/me/../../etc/hosts.png").is_ok());
    }
}
