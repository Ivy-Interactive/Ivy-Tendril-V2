//! Copies a file the user attached into Tendril's own attachment directory.
//!
//! The composer's other half of [`super::local_file::cmd_get_local_file_preview`]. That command can
//! only show what the daemon's `local_file_guard` will serve, and the guard serves the Tendril home,
//! the plans folder, the configured project repos and `security.localFileRoots` — so a screenshot
//! dragged in from `~/Desktop` is refused, and a message that referenced it could never render more
//! than a paperclip chip. Widening the roots is not the answer: they are the security boundary of a
//! route deliberately reachable without a bearer header. Copying the file into the home *is* the
//! answer, and is what V1 does — its chat composer uploads every attachment into
//! `<TendrilHome>/Attachments/<sessionId>/` and references the copy.
//!
//! The split of work is deliberate:
//!
//! * **This side reads.** Reading a file the user just picked in a file dialog or dropped on the window
//!   is what the app is for, and it happens in the app's own process, at the same privilege as the
//!   dialog that named it.
//! * **The daemon writes.** It owns the Tendril home and may not even be on this machine, so the bytes
//!   are posted to `POST /api/attachments/:session_id` rather than written here. That route validates
//!   the name it is given and confines the write; nothing about it can read a caller-named path.
//!
//! One property worth stating, because it is the reason the destination name is derived from the source
//! rather than taken from the caller: the stored file keeps the source file's extension. So
//! `/etc/passwd` stages as `passwd`, which the preview route's extension allowlist then refuses — a
//! path this command copies does not thereby become previewable unless it was already an image or a
//! PDF.

use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::ChatAttachmentDto;
use std::path::Path;
use tendril_core::jobs::attachments::{
    safe_attachment_name, MAX_ATTACHMENT_BYTES, UNASSIGNED_SESSION,
};

/// Copies `path` into the attachment directory for `session_id` and answers with the attachment the
/// composer should carry: the user's own file name, and the staged path.
///
/// `session_id` is the chat session the file is being attached to. It is optional because a file can be
/// attached before the session exists — V1's composer stages those under `temp`, and so does this.
#[tauri::command]
pub async fn cmd_upload_chat_attachment(
    path: String,
    session_id: Option<String>,
) -> Result<ChatAttachmentDto, BridgeError> {
    let source = Path::new(path.trim());
    if path.trim().is_empty() || !source.is_absolute() {
        return Err(BridgeError::validation(format!(
            "'{path}' is not an absolute path to attach"
        )));
    }

    let metadata = std::fs::metadata(source)
        .map_err(|_| BridgeError::not_found(format!("'{path}' could not be read")))?;
    if !metadata.is_file() {
        return Err(BridgeError::validation(format!("'{path}' is not a file")));
    }
    // Checked before the read, not after: this is the difference between refusing a 4 GB video and
    // pulling it into memory to refuse it.
    if metadata.len() > MAX_ATTACHMENT_BYTES as u64 {
        return Err(BridgeError::validation(format!(
            "'{path}' is larger than {} MiB and cannot be attached",
            MAX_ATTACHMENT_BYTES / (1024 * 1024)
        )));
    }

    // The stored name comes from the source's own final component, so the caller never names the
    // destination. `safe_attachment_name` is the daemon's rule, applied here too so an unusable name is
    // refused before a request is made rather than after.
    let file_name = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .and_then(|name| safe_attachment_name(&name))
        .ok_or_else(|| {
            BridgeError::validation(format!("'{path}' does not have a usable file name"))
        })?;

    let bytes = std::fs::read(source)
        .map_err(|err| BridgeError::not_found(format!("'{path}' could not be read: {err}")))?;

    let session = session_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .unwrap_or(UNASSIGNED_SESSION);

    get_client_from_master()?
        .upload_attachment(session, &file_name, bytes)
        .await
}

/// Stages bytes the webview already holds — a file picked, dropped or pasted into a `ContentInput`,
/// which a webview hands over as a `File` with no path — into the attachment directory for
/// `session_id`, and answers with the staged attachment.
///
/// The path-based [`cmd_upload_chat_attachment`] cannot serve those: there is no path to read. V1's
/// dialogs upload the stream itself (`UseUpload` in `CreatePlanDialog`, `UpdatePlanDialog`,
/// `SuggestChangesDialog`), and this is that half. The bytes arrive base64-encoded because that is
/// what `FileReader.readAsDataURL` gives `ContentInput`'s `OnUploadFile` event.
#[tauri::command]
pub async fn cmd_upload_attachment_bytes(
    file_name: String,
    data_base64: String,
    session_id: Option<String>,
) -> Result<ChatAttachmentDto, BridgeError> {
    use base64::Engine as _;

    let file_name = safe_attachment_name(file_name.trim()).ok_or_else(|| {
        BridgeError::validation(format!(
            "'{file_name}' is not a usable attachment file name"
        ))
    })?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.trim())
        .map_err(|err| {
            BridgeError::validation(format!("The attachment is not valid base64: {err}"))
        })?;
    if bytes.is_empty() {
        return Err(BridgeError::validation(format!("'{file_name}' is empty")));
    }
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(BridgeError::validation(format!(
            "'{file_name}' is larger than {} MiB and cannot be attached",
            MAX_ATTACHMENT_BYTES / (1024 * 1024)
        )));
    }

    let session = session_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .unwrap_or(UNASSIGNED_SESSION);

    get_client_from_master()?
        .upload_attachment(session, &file_name, bytes)
        .await
}
