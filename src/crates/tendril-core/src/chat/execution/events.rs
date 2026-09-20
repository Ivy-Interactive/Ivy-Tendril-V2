//! The `chat.*` frames a turn broadcasts, as the daemon's websocket and `tendril chat send` read them.

use crate::chat::models::ChatMessage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum ChatEvent {
    #[serde(rename = "chat.message_added")]
    MessageAdded {
        #[serde(rename = "sessionId")]
        session_id: String,
        message: ChatMessage,
    },
    #[serde(rename = "chat.stream_delta")]
    StreamDelta {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "messageId")]
        message_id: String,
        delta: String,
    },
    /// One eventwire line of a turn in flight — a tool call, its result, thinking, or prose.
    ///
    /// The port of V1's `ChatExecutionService.StreamLineEmitted`, which is what makes a turn's tool
    /// calls appear *as they happen*: the client appends the line to the message's `rawStream`, which
    /// is what `TurnActivity` renders. Without it the activity existed only on the copy re-read from
    /// the daemon once the turn had already finished.
    #[serde(rename = "chat.stream_event")]
    StreamEvent {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "messageId")]
        message_id: String,
        line: String,
    },
    #[serde(rename = "chat.generating_state")]
    GeneratingState {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "isGenerating")]
        is_generating: bool,
    },
    #[serde(rename = "chat.question_answered")]
    QuestionAnswered {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "messageId")]
        message_id: String,
        answers: HashMap<String, Vec<String>>,
    },
    #[serde(rename = "chat.job_spawned")]
    JobSpawned {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "jobId")]
        job_id: String,
    },
    #[serde(rename = "chat.session_renamed")]
    SessionRenamed {
        #[serde(rename = "sessionId")]
        session_id: String,
        title: String,
    },
}
