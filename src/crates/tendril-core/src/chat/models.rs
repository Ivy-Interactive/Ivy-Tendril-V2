//! Chat persistence and wire models.
//!
//! These serialize as camelCase, which is what every consumer expects: the Tauri host's
//! `ChatSessionDto`, the TypeScript types in `types/chat.ts`, and the `chat.message_added` WS event
//! that embeds `ChatMessage` verbatim. They previously serialized snake_case while `ChatSessionDto`
//! declared `rename_all = "camelCase"` with a required `createdAt`, so every chat command failed to
//! deserialize and the sidebar showed an error and no sessions. `plan_folder_name` was already
//! renamed by hand, which is what gave the original intent away.
//!
//! The same structs persist `Chats/*.json`, and `storage::load_all_sessions` skips any file it cannot
//! parse, so a bare rename would have made existing history vanish rather than error. Every renamed
//! field therefore keeps a snake_case `alias`, which serde applies on deserialization only: old files
//! still load, and are rewritten camelCase on the next save.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachment {
    pub name: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "mime_type")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatQueuedItem {
    pub id: String,
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<ChatAttachment>>,
    #[serde(alias = "created_at")]
    pub created_at: DateTime<Utc>,
    /// `system` for an event Tendril queued behind a turn that was already running — a job finishing
    /// while the user was still talking. Absent means the user typed it, which is every item the
    /// composer enqueues, so an existing queue file loads unchanged.
    ///
    /// It matters because the role decides how the turn is framed: dequeued as a user prompt, "Job 03589
    /// has finished" reads as something the user said and the agent answers it instead of reacting to it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String, // "user" | "assistant" | "system"
    pub content: String,
    pub timestamp: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "agent_id")]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "model_id")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "raw_stream")]
    pub raw_stream: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
}

/// Whether a recorded spawned-job id could be one. A job id is allocated by the daemon and never
/// starts with `-`; a command-line flag always does, and that is the only shape the old scrape
/// produced. Deliberately no stricter than that — ids are `00042` in production but tests and older
/// data use other spellings, and dropping a real id would lose a job from a conversation's header.
fn looks_like_job_id(candidate: &str) -> bool {
    let trimmed = candidate.trim();
    !trimmed.is_empty() && !trimmed.starts_with('-')
}

fn deserialize_spawned_job_ids<'de, D>(
    deserializer: D,
) -> std::result::Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Vec::<String>::deserialize(deserializer)?;
    Ok(raw.into_iter().filter(|id| looks_like_job_id(id)).collect())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    #[serde(alias = "created_at")]
    pub created_at: DateTime<Utc>,
    #[serde(alias = "updated_at")]
    pub updated_at: DateTime<Utc>,
    #[serde(alias = "agent_id")]
    pub agent_id: String,
    #[serde(alias = "model_id")]
    pub model_id: String,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    /// The jobs this conversation started.
    ///
    /// Read through [`deserialize_spawned_job_ids`], which drops what an earlier version of the
    /// stream-scraping regex wrote here: it matched the job-start *command* as well as its result, so it
    /// captured the flag that followed the job type — `--chat-session`, `--description` — as an id. Those
    /// resolve to no job and were already filtered out of the header, but they are still in every session
    /// file written while that regex was live, and `tendril chat show` printed them. Dropped on read, so
    /// the next save writes the list back clean.
    #[serde(
        default,
        alias = "spawned_job_ids",
        deserialize_with = "deserialize_spawned_job_ids"
    )]
    pub spawned_job_ids: Vec<String>,
    // `rename_all` already produces `planFolderName`; the alias keeps the snake_case form readable.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "plan_folder_name"
    )]
    pub plan_folder_name: Option<String>,
}
