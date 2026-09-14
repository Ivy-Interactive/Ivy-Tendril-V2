use crate::chat::models::ChatSession;
use crate::error::{Result, TendrilError};
use chrono::Utc;
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub fn get_chats_dir(tendril_home: &Path) -> PathBuf {
    tendril_home.join("Chats")
}

pub fn sanitize_title(title: &str) -> String {
    let mut t = title.trim();
    loop {
        if t.ends_with("...") {
            t = t[..t.len() - 3].trim();
        } else if t.ends_with('…') {
            t = t[..t.len() - '…'.len_utf8()].trim();
        } else {
            break;
        }
    }

    if t.is_empty() {
        "New Chat".to_string()
    } else {
        t.to_string()
    }
}

pub fn load_all_sessions(tendril_home: &Path) -> Result<Vec<ChatSession>> {
    let chats_dir = get_chats_dir(tendril_home);
    if !chats_dir.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();
    for entry in std::fs::read_dir(chats_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(session) = serde_json::from_str::<ChatSession>(&content) {
                    sessions.push(session);
                }
            }
        }
    }

    sessions.sort_by_key(|a| std::cmp::Reverse(a.updated_at));
    Ok(sessions)
}

pub fn load_session(tendril_home: &Path, id: &str) -> Result<ChatSession> {
    let path = get_chats_dir(tendril_home).join(format!("{}.json", id));
    if !path.exists() {
        return Err(TendrilError::Chat(format!(
            "Chat session '{}' not found",
            id
        )));
    }

    let content = std::fs::read_to_string(&path)?;
    let session = serde_json::from_str::<ChatSession>(&content)?;
    Ok(session)
}

pub fn save_session(tendril_home: &Path, session: &ChatSession) -> Result<()> {
    let chats_dir = get_chats_dir(tendril_home);
    std::fs::create_dir_all(&chats_dir)?;

    let target_path = chats_dir.join(format!("{}.json", session.id));
    let temp_path = chats_dir.join(format!("{}.tmp-{}", session.id, Uuid::new_v4().simple()));

    let json_bytes = serde_json::to_vec_pretty(session)?;

    {
        let mut file = std::fs::File::create(&temp_path)?;
        file.write_all(&json_bytes)?;
        file.sync_all()?;
    }

    std::fs::rename(temp_path, target_path)?;
    Ok(())
}

pub fn delete_session(tendril_home: &Path, id: &str) -> Result<()> {
    let path = get_chats_dir(tendril_home).join(format!("{}.json", id));
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

pub fn rename_session(tendril_home: &Path, id: &str, new_title: &str) -> Result<ChatSession> {
    let mut session = load_session(tendril_home, id)?;
    session.title = sanitize_title(new_title);
    session.updated_at = Utc::now();
    save_session(tendril_home, &session)?;
    Ok(session)
}

pub fn broadcast_system_message_to_plan_sessions(
    tendril_home: &Path,
    folder_name: &str,
    plan_chat_session_id: Option<&str>,
    source_chat_session_id: Option<&str>,
    content: &str,
) -> Result<Vec<String>> {
    let mut sessions = load_all_sessions(tendril_home)?;
    let mut recipient_ids = Vec::new();
    for session in &sessions {
        let matches_folder = session.plan_folder_name.as_deref() == Some(folder_name);
        let matches_plan_chat = plan_chat_session_id == Some(&session.id);
        if matches_folder || matches_plan_chat {
            recipient_ids.push(session.id.clone());
        }
    }
    recipient_ids.sort();
    recipient_ids.dedup();
    if let Some(src) = source_chat_session_id {
        recipient_ids.retain(|id| id != src);
    }

    for session in &mut sessions {
        if recipient_ids.contains(&session.id) {
            session.messages.push(crate::chat::models::ChatMessage {
                id: Uuid::new_v4().to_string(),
                role: "system".to_string(),
                content: content.to_string(),
                timestamp: Utc::now(),
                agent_id: None,
                model_id: None,
                raw_stream: None,
                effort: None,
            });
            session.updated_at = Utc::now();
            let _ = save_session(tendril_home, session);
        }
    }
    Ok(recipient_ids)
}
