//! Naming a session: the background naming run, the prompt it is given, and the cleanup its answer
//! goes through before it becomes a title.

use super::manager::ChatExecutionManager;
use super::streaming::next_text_delta;
use crate::agents::eventwire::EventWireNormalizer;
use crate::agents::providers::AgentLaunchConfig;
use crate::agents::runner::{run_agent_process, AgentOutputEvent, TerminationReason};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;

impl ChatExecutionManager {
    /// Runs the naming agent in Plan mode against `user_prompt` and renames the session if the
    /// result is usable and the title has not been changed since `snippet` was written (a user
    /// rename during the 30s budget always wins).
    pub(super) async fn generate_title(
        self: Arc<Self>,
        session_id: &str,
        user_prompt: &str,
        snippet: &str,
        agent_id: &str,
        model_id: String,
        working_directory: PathBuf,
    ) {
        let launch_config = AgentLaunchConfig {
            prompt: build_title_prompt(user_prompt),
            working_directory,
            model: Some(model_id),
            effort: None,
            permission_mode: Some("Plan".to_string()),
            session_id: None,
            ..Default::default()
        };

        let spec = (self.spec_builder)(agent_id, &launch_config);
        let (line_tx, mut line_rx) = tokio::sync::mpsc::unbounded_channel::<AgentOutputEvent>();
        let (_cancel_tx, cancel_rx) = watch::channel(false);

        let run_handle = tokio::spawn(async move {
            run_agent_process(
                spec,
                move |evt| {
                    let _ = line_tx.send(evt);
                },
                |_pid| {},
                cancel_rx,
                Some(Duration::from_secs(30)),
            )
            .await
        });

        // The same normalisation the turn itself uses, so the naming agent's answer is read out of
        // whatever shape its provider emits rather than only the one shape a guess covered.
        let mut normalizer = EventWireNormalizer::new();
        let mut accumulated_text = String::new();
        while let Some(evt) = line_rx.recv().await {
            for wire_line in normalizer.normalize(&evt.raw_line, evt.is_stderr) {
                if let Some(delta) = next_text_delta(&accumulated_text, &wire_line) {
                    accumulated_text.push_str(&delta);
                }
            }
        }

        let outcome = match run_handle.await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(err)) => {
                tracing::warn!(
                    "Title generation failed for chat session {}: {}",
                    session_id,
                    err
                );
                return;
            }
            Err(err) => {
                tracing::warn!(
                    "Title generation task panicked for chat session {}: {}",
                    session_id,
                    err
                );
                return;
            }
        };

        if outcome.terminated != TerminationReason::Exited || outcome.exit_code != Some(0) {
            tracing::warn!(
                "Title generation for chat session {} did not complete successfully: {:?}",
                session_id,
                outcome.terminated
            );
            return;
        }

        let cleaned = match clean_generated_title(&accumulated_text) {
            Some(t) if !is_default_chat_title(&t) => t,
            _ => {
                tracing::debug!(
                    "Generated title for chat session {} was empty or default after cleaning",
                    session_id
                );
                return;
            }
        };

        let latest = match self.get_session(session_id).await {
            Ok(s) => s,
            Err(_) => return,
        };
        if latest.title == snippet {
            if let Err(err) = self.rename_session(session_id, &cleaned).await {
                tracing::warn!(
                    "Failed to persist generated title for chat session {}: {}",
                    session_id,
                    err
                );
            }
        }
    }
}

/// True for the placeholder title a session is created with, and for anything blank —
/// the guard `start_session_turn` and `generate_title` use to decide whether a title is still
/// eligible for auto-generation.
pub fn is_default_chat_title(title: &str) -> bool {
    let trimmed = title.trim();
    trimmed.is_empty() || trimmed.eq_ignore_ascii_case("New Chat")
}

/// Verbatim port of `ChatSessionNamingService.BuildPrompt` (legacy C#).
pub fn build_title_prompt(user_prompt: &str) -> String {
    format!(
        "Generate a short 3 to 6 word title describing the topic of the following user request.\n\
Output ONLY the title text. Do not include quotes, markdown headings, prefixes like \"Title:\", or trailing punctuation.\n\
Do not act on the request, run tools, or edit any files.\n\
\n\
User:\n\
{}",
        user_prompt
    )
}

fn strip_wrapping_title_formatting(text: &str) -> String {
    let result = text.trim();
    let char_count = result.chars().count();
    if result.starts_with("**") && result.ends_with("**") && char_count >= 4 {
        result[2..result.len() - 2].trim().to_string()
    } else if ((result.starts_with('*') && result.ends_with('*'))
        || (result.starts_with('`') && result.ends_with('`')))
        && char_count >= 2
    {
        result[1..result.len() - 1].trim().to_string()
    } else {
        result.to_string()
    }
}

const TITLE_QUOTE_CHARS: [char; 7] = [
    '"', '\'', '`', '\u{201C}', '\u{201D}', '\u{00AB}', '\u{00BB}',
];

/// Port of `ChatSessionNamingService.CleanGeneratedTitle` (legacy C#): first non-empty line, then
/// a fixpoint loop stripping heading markers, bold/italic/code wrapping, `Title:`-style prefixes,
/// surrounding quotes and trailing punctuation, capped at 50 **chars** (not bytes — the C#
/// `title[..50]` is a UTF-16 index and a byte slice in Rust would panic on multi-byte input).
/// Unlike the legacy split between this method and the caller's own `IsDefaultTitle` check, a
/// cleaned result that is still the default title is folded in here and returned as `None`, so
/// every caller gets one signal for "no usable title" rather than two to check separately.
pub fn clean_generated_title(raw: &str) -> Option<String> {
    let first_line = raw
        .split(['\r', '\n'])
        .map(|l| l.trim())
        .find(|l| !l.is_empty())?;

    let mut title = first_line.to_string();
    let prefixes = ["Title:", "Topic:", "Subject:", "Name:"];

    loop {
        let previous = title.clone();

        while title.starts_with('#') {
            title = title.trim_start_matches('#').trim_start().to_string();
        }

        title = strip_wrapping_title_formatting(&title);

        for prefix in prefixes {
            let plen = prefix.chars().count();
            let candidate: String = title.chars().take(plen).collect();
            if candidate.eq_ignore_ascii_case(prefix) {
                title = title
                    .chars()
                    .skip(plen)
                    .collect::<String>()
                    .trim()
                    .to_string();
                break;
            }
        }

        title = title
            .trim_matches(|c| TITLE_QUOTE_CHARS.contains(&c))
            .to_string();

        while title.ends_with("...") || title.ends_with('…') {
            if title.ends_with("...") {
                title = title[..title.len() - 3].trim_end().to_string();
            } else {
                let new_len = title.len() - '…'.len_utf8();
                title = title[..new_len].trim_end().to_string();
            }
        }
        title = title
            .trim_end_matches(['.', '!', '?', ':', ';', ','])
            .to_string();

        title = title
            .trim_matches(|c| TITLE_QUOTE_CHARS.contains(&c))
            .to_string();
        title = title.trim().to_string();

        if title == previous || title.is_empty() {
            break;
        }
    }

    if title.is_empty() {
        return None;
    }

    if title.chars().count() > 50 {
        title = title
            .chars()
            .take(50)
            .collect::<String>()
            .trim()
            .to_string();
    }

    if title.is_empty() || is_default_chat_title(&title) {
        None
    } else {
        Some(title)
    }
}
