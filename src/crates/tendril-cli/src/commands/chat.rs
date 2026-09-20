use clap::{Args, Subcommand};
use futures_util::StreamExt;
use std::io::Write;
use std::path::Path;
use tendril_core::chat::execution::{ChatEvent, ChatExecutionManager, ChatTurnOptions};
use tendril_core::chat::models::ChatSession;
use tendril_core::chat::storage;
use tendril_core::config::{get_config_path, load_config, read_master, MasterInfo};
use tendril_core::http::{
    classify_transport_error, daemon_client, daemon_request_timeout_for, describe_transport_error,
    DaemonTransportFailure,
};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use uuid::Uuid;

#[derive(Subcommand)]
pub enum ChatCommands {
    #[command(about = "List chat sessions")]
    List(ChatListArgs),

    #[command(about = "Get session details and messages")]
    Get(ChatGetArgs),

    #[command(about = "Create a new chat session")]
    Create(ChatCreateArgs),

    #[command(about = "Delete a chat session")]
    Delete(ChatDeleteArgs),

    #[command(about = "Send a message to a chat session and stream response")]
    Send(ChatSendArgs),
}

#[derive(Args)]
pub struct ChatListArgs {
    #[arg(long, help = "Output sessions as JSON")]
    pub json: bool,
}

#[derive(Args)]
pub struct ChatGetArgs {
    #[arg(help = "Session ID")]
    pub id: String,

    #[arg(long, help = "Output session as JSON")]
    pub json: bool,
}

#[derive(Args, Clone)]
pub struct ChatCreateArgs {
    #[arg(long, help = "Coding agent ID (e.g. claude, codestory)")]
    pub agent: Option<String>,

    #[arg(long, help = "Model ID")]
    pub model: Option<String>,

    #[arg(long, help = "Session title")]
    pub title: Option<String>,

    #[arg(long, help = "Reasoning effort level")]
    pub effort: Option<String>,

    #[arg(long, help = "Plan folder name to associate with this session")]
    pub plan: Option<String>,

    #[arg(long, help = "Output created session as JSON")]
    pub json: bool,
}

#[derive(Args)]
pub struct ChatDeleteArgs {
    #[arg(help = "Session ID")]
    pub id: String,
}

#[derive(Args)]
pub struct ChatSendArgs {
    #[arg(help = "Session ID")]
    pub id: String,

    #[arg(help = "Message prompt to send")]
    pub message: String,

    #[arg(long, help = "Override agent ID for this turn")]
    pub agent: Option<String>,

    #[arg(long, help = "Override model ID for this turn")]
    pub model: Option<String>,

    #[arg(long, help = "Override effort level for this turn")]
    pub effort: Option<String>,
}

pub async fn handle_chat_command(cmd: ChatCommands, tendril_home: &Path) -> anyhow::Result<()> {
    match cmd {
        ChatCommands::List(args) => handle_chat_list(args, tendril_home).await,
        ChatCommands::Get(args) => handle_chat_get(args, tendril_home).await,
        ChatCommands::Create(args) => handle_chat_create(args, tendril_home).await,
        ChatCommands::Delete(args) => handle_chat_delete(args, tendril_home).await,
        ChatCommands::Send(args) => handle_chat_send(args, tendril_home).await,
    }
}

async fn handle_chat_list(args: ChatListArgs, tendril_home: &Path) -> anyhow::Result<()> {
    let sessions = list_sessions(tendril_home).await?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&sessions)?);
        return Ok(());
    }

    if sessions.is_empty() {
        println!("No chat sessions found.");
        return Ok(());
    }

    println!(
        "{:<36}  {:<30}  {:<12}  UPDATED",
        "SESSION ID", "TITLE", "AGENT"
    );
    println!("{}", "-".repeat(95));
    for s in sessions {
        let updated = s.updated_at.format("%Y-%m-%d %H:%M:%S").to_string();
        let title_display = if s.title.chars().count() > 30 {
            let truncated: String = s.title.chars().take(27).collect();
            format!("{}...", truncated)
        } else {
            s.title.clone()
        };

        println!(
            "{:<36}  {:<30}  {:<12}  {}",
            s.id, title_display, s.agent_id, updated
        );
    }

    Ok(())
}

/// Every session the daemon knows about, or the ones on disk when it cannot say.
///
/// The daemon is asked first because it holds sessions that are mid-turn and not yet persisted. When
/// it cannot answer — refused, wedged, erroring, or replying with something that will not decode —
/// `Chats/*.json` is the answer rather than an error: it is the same store the daemon itself persists
/// to, so a read has nothing to gain from failing. Only the mutating paths have to care *why* the
/// call failed.
async fn list_sessions(tendril_home: &Path) -> anyhow::Result<Vec<ChatSession>> {
    if let Some(master) = read_master(tendril_home) {
        let client = daemon_client(tendril_home);
        let url = format!("{}/api/chat/sessions", master.base_url());
        if let Ok(resp) = client.get(&url).bearer_auth(&master.secret).send().await {
            if resp.status().is_success() {
                if let Ok(sessions) = resp.json::<Vec<ChatSession>>().await {
                    return Ok(sessions);
                }
            }
        }
    }
    Ok(storage::load_all_sessions(tendril_home)?)
}

async fn handle_chat_get(args: ChatGetArgs, tendril_home: &Path) -> anyhow::Result<()> {
    let session = resolve_session(tendril_home, &args.id).await?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&session)?);
        return Ok(());
    }

    println!("Session: {}", session.id);
    println!("Title:   {}", session.title);
    println!("Agent:   {}", session.agent_id);
    if !session.model_id.is_empty() {
        println!("Model:   {}", session.model_id);
    }
    if let Some(ref effort) = session.effort {
        println!("Effort:  {}", effort);
    }
    println!(
        "Created: {}",
        session.created_at.format("%Y-%m-%d %H:%M:%S UTC")
    );
    println!(
        "Updated: {}",
        session.updated_at.format("%Y-%m-%d %H:%M:%S UTC")
    );

    if !session.spawned_job_ids.is_empty() {
        println!("Jobs:    {}", session.spawned_job_ids.join(", "));
    }

    println!("\nMessages ({}):", session.messages.len());
    for msg in &session.messages {
        println!("{}", "-".repeat(80));
        let ts = msg.timestamp.format("%Y-%m-%d %H:%M:%S UTC");
        println!("[{}] {}", msg.role.to_uppercase(), ts);
        println!("{}", msg.content);
    }

    Ok(())
}

async fn handle_chat_create(args: ChatCreateArgs, tendril_home: &Path) -> anyhow::Result<()> {
    let session = match read_master(tendril_home) {
        Some(master) => create_session_via_daemon(&args, tendril_home, &master).await?,
        None => create_session_local(&args, tendril_home)?,
    };

    if args.json {
        println!("{}", serde_json::to_string_pretty(&session)?);
    } else {
        println!("Created chat session: {}", session.id);
        println!("Title: {}", session.title);
        println!("Agent: {}", session.agent_id);
    }

    Ok(())
}

/// Asks the daemon to create the session, falling back to the local store only when it is safe to.
///
/// A refused connection proves the daemon never saw the request, so writing the session locally
/// cannot duplicate one it already made — that is the stale-`.master` case, and it has to keep
/// working. A timeout or a mid-read failure is ambiguous: the daemon may well have created the
/// session, and a second one is worse than an error, so those are reported.
async fn create_session_via_daemon(
    args: &ChatCreateArgs,
    tendril_home: &Path,
    master: &MasterInfo,
) -> anyhow::Result<ChatSession> {
    let client = daemon_client(tendril_home);
    let url = format!("{}/api/chat/sessions", master.base_url());
    let resp = match client
        .post(&url)
        .bearer_auth(&master.secret)
        .json(&serde_json::json!({
            "title": args.title,
            "agent_id": args.agent,
            "model_id": args.model,
            "effort": args.effort,
            "planFolderName": args.plan,
        }))
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) if classify_transport_error(&e) == DaemonTransportFailure::Unreachable => {
            return create_session_local(args, tendril_home);
        }
        Err(e) => anyhow::bail!(describe_transport_error(
            &e,
            master,
            daemon_request_timeout_for(tendril_home)
        )),
    };

    if resp.status().is_success() {
        Ok(resp.json::<ChatSession>().await?)
    } else {
        create_session_local(args, tendril_home)
    }
}

fn create_session_local(args: &ChatCreateArgs, tendril_home: &Path) -> anyhow::Result<ChatSession> {
    let cfg = load_config(&get_config_path(tendril_home)).unwrap_or_default();
    let session = ChatSession {
        id: Uuid::new_v4().to_string(),
        title: storage::sanitize_title(args.title.as_deref().unwrap_or("New Chat")),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        agent_id: args.agent.clone().unwrap_or(cfg.coding_agent),
        model_id: args.model.clone().unwrap_or_default(),
        messages: Vec::new(),
        effort: args.effort.clone(),
        spawned_job_ids: Vec::new(),
        plan_folder_name: args.plan.clone(),
    };
    storage::save_session(tendril_home, &session)?;
    Ok(session)
}

async fn handle_chat_delete(args: ChatDeleteArgs, tendril_home: &Path) -> anyhow::Result<()> {
    let session = resolve_session(tendril_home, &args.id).await?;

    // A daemon that did not answer has deleted nothing, and printing "Deleted" while the session is
    // still sitting in `Chats/` — where `chat list` will keep showing it — is a lie. Deleting is
    // idempotent, so falling back is safe even if the daemon did get there first and only lost its
    // reply.
    let deleted_by_daemon = match read_master(tendril_home) {
        Some(master) => {
            let client = daemon_client(tendril_home);
            let url = format!("{}/api/chat/sessions/{}", master.base_url(), session.id);
            matches!(
                client.delete(&url).bearer_auth(&master.secret).send().await,
                Ok(resp) if resp.status().is_success()
            )
        }
        None => false,
    };
    if !deleted_by_daemon {
        storage::delete_session(tendril_home, &session.id)?;
    }

    println!("Deleted chat session: {}", session.id);
    Ok(())
}

async fn handle_chat_send(args: ChatSendArgs, tendril_home: &Path) -> anyhow::Result<()> {
    let session = resolve_session(tendril_home, &args.id).await?;
    let session_id = session.id.clone();

    if let Some(master) = read_master(tendril_home) {
        stream_via_server(tendril_home, &master, &session_id, &args).await?;
    } else {
        stream_via_local(tendril_home, &session_id, &args).await?;
    }

    Ok(())
}

/// The execute POST only *starts* the turn and replies `{"started": true}`; the assistant's output
/// arrives over the WebSocket opened above, which is not a reqwest request. So the daemon timeout
/// bounds the handshake, not the length of the turn.
async fn stream_via_server(
    tendril_home: &Path,
    master: &MasterInfo,
    session_id: &str,
    args: &ChatSendArgs,
) -> anyhow::Result<()> {
    // The event stream is a WebSocket, and `connect_async` here is built without TLS support, so a
    // daemon serving HTTPS cannot be streamed from. Saying so beats attempting `ws://` against a TLS
    // port and reporting whatever the handshake failure looks like.
    if master.scheme.eq_ignore_ascii_case("https") {
        anyhow::bail!(
            "`tendril chat send` cannot stream from a TLS daemon ({}); restart it without \
             --tls-cert/--tls-key, or use the app.",
            master.base_url()
        );
    }
    let ws_url = format!("ws://{}:{}/api/ws", master.host, master.port);
    let mut req = ws_url.into_client_request()?;
    req.headers_mut()
        .insert(AUTHORIZATION, format!("Bearer {}", master.secret).parse()?);

    let (ws_stream, _) = connect_async(req).await?;
    let (_, mut read) = ws_stream.split();

    let client = daemon_client(tendril_home);
    let exec_url = format!(
        "{}/api/chat/sessions/{}/execute",
        master.base_url(),
        session_id
    );

    let resp = client
        .post(&exec_url)
        .bearer_auth(&master.secret)
        .json(&serde_json::json!({
            "prompt": args.message,
            "agent_id": args.agent,
            "model_id": args.model,
            "effort": args.effort,
        }))
        .send()
        .await?;

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        anyhow::bail!("Failed to start chat turn on server: {}", err_text);
    }

    let mut printer = TurnPrinter::new();
    while let Some(msg_res) = read.next().await {
        match msg_res {
            Ok(WsMessage::Text(txt)) => {
                if let Ok(event) = serde_json::from_str::<ChatEvent>(&txt) {
                    match event {
                        ChatEvent::StreamDelta {
                            session_id: sid,
                            delta,
                            ..
                        } if sid == session_id => {
                            printer.write_prose(&delta);
                        }
                        ChatEvent::StreamEvent {
                            session_id: sid,
                            line,
                            ..
                        } if sid == session_id => {
                            printer.write_tool_activity(&line);
                        }
                        ChatEvent::MessageAdded {
                            session_id: sid,
                            message,
                        } if sid == session_id && message.role == "assistant" => {
                            printer.finish(&message.content);
                        }
                        ChatEvent::GeneratingState {
                            session_id: sid,
                            is_generating,
                        } if sid == session_id && !is_generating => {
                            println!();
                            break;
                        }
                        _ => {}
                    }
                }
            }
            Ok(WsMessage::Close(_)) => break,
            Err(_) => break,
            _ => {}
        }
    }

    Ok(())
}

async fn stream_via_local(
    tendril_home: &Path,
    session_id: &str,
    args: &ChatSendArgs,
) -> anyhow::Result<()> {
    let manager = std::sync::Arc::new(ChatExecutionManager::new(tendril_home.to_path_buf()));
    let mut rx = manager.subscribe_events();
    let session_id_clone = session_id.to_string();
    let prompt = args.message.clone();
    let options = ChatTurnOptions {
        agent_id: args.agent.clone(),
        model_id: args.model.clone(),
        effort: args.effort.clone(),
        working_directory: None,
        // `tendril chat send` is always the user talking; events are injected by the daemon.
        role: None,
    };

    let target_session_id = session_id.to_string();
    let turn_handle = tokio::spawn(async move {
        manager
            .start_session_turn(&session_id_clone, &prompt, options)
            .await
    });

    let mut printer = TurnPrinter::new();
    while let Ok(event) = rx.recv().await {
        match event {
            ChatEvent::StreamDelta {
                session_id: sid,
                delta,
                ..
            } if sid == target_session_id => {
                printer.write_prose(&delta);
            }
            ChatEvent::StreamEvent {
                session_id: sid,
                line,
                ..
            } if sid == target_session_id => {
                printer.write_tool_activity(&line);
            }
            ChatEvent::MessageAdded {
                session_id: sid,
                message,
            } if sid == target_session_id && message.role == "assistant" => {
                printer.finish(&message.content);
            }
            ChatEvent::GeneratingState {
                session_id: sid,
                is_generating,
            } if sid == target_session_id && !is_generating => {
                println!();
                break;
            }
            _ => {}
        }
    }

    let res = turn_handle.await?;
    res?;
    Ok(())
}

/// The one-line rendering of an eventwire tool event, or `None` for every event that is not one.
pub(crate) fn tool_activity_line(wire_line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(wire_line.trim()).ok()?;
    match value.get("kind").and_then(|k| k.as_str())? {
        "tool_call" => {
            let name = value
                .get("tool_name")
                .and_then(|n| n.as_str())
                .unwrap_or("tool");
            Some(match summarize_tool_input(value.get("input")) {
                Some(input) => format!("· {} ({})", name, input),
                None => format!("· {}", name),
            })
        }
        // Only a failure: a result that worked adds nothing the call line did not already say.
        "tool_result" => {
            if !value
                .get("is_error")
                .and_then(|e| e.as_bool())
                .unwrap_or(false)
            {
                return None;
            }
            let name = value
                .get("tool_name")
                .and_then(|n| n.as_str())
                .unwrap_or("tool");
            let output = value
                .get("output")
                .and_then(|o| o.as_str())
                .unwrap_or("")
                .trim();
            Some(if output.is_empty() {
                format!("  ! {} failed", name)
            } else {
                format!("  ! {} failed: {}", name, first_line_capped(output, 160))
            })
        }
        _ => None,
    }
}

/// The first argument or two of a tool call, short enough to sit on one line.
fn summarize_tool_input(input: Option<&serde_json::Value>) -> Option<String> {
    let map = input?.as_object()?;
    if map.is_empty() {
        return None;
    }
    let mut parts: Vec<String> = map
        .iter()
        .take(2)
        .map(|(key, value)| match value {
            serde_json::Value::String(text) => format!("{}: {}", key, first_line_capped(text, 60)),
            other => format!("{}: {}", key, first_line_capped(&other.to_string(), 60)),
        })
        .collect();
    parts.sort();
    Some(parts.join(", "))
}

/// The first non-empty line of `text`, truncated on a character boundary.
fn first_line_capped(text: &str, max: usize) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    if line.chars().count() <= max {
        return line.to_string();
    }
    format!("{}…", line.chars().take(max).collect::<String>())
}

/// What a finished turn's content still owes the terminal, given everything the deltas already
/// printed. `None` when there is nothing new to show.
///
/// A turn's final content is not always the concatenation of its deltas: a turn that produced no
/// prose is finalized with a synthesized report, and a failed turn has its reason appended. The
/// daemon publishes that final copy as a `chat.message_added` upsert rather than as another delta —
/// a delta is only correct when applied exactly once — so a streaming client renders the difference.
pub(crate) fn finalized_tail(streamed: &str, content: &str) -> Option<String> {
    // An empty assistant stub is published at the top of the turn too; nothing to print for it.
    if content.is_empty() || content == streamed {
        return None;
    }
    Some(match content.strip_prefix(streamed) {
        Some(tail) => tail.to_string(),
        // The final copy is not an extension of what was streamed (prose replaced by a report, say),
        // so it is shown in full on its own line.
        None => format!("\n{}", content),
    })
}

/// Writes one turn to the terminal, keeping the agent's prose apart from everything else printed
/// around it.
///
/// The distinction is load-bearing. [`finalized_tail`] works out what the finished message still owes
/// the terminal by comparing it against the prose already printed, so the tool lines — which are not
/// part of the message at all — must not be counted in it. Mixing them made every turn print its
/// answer a second time, because the transcript no longer prefixed the content.
#[derive(Default)]
pub(crate) struct TurnPrinter {
    /// The agent's prose, and nothing else.
    prose: String,
    /// Whether the cursor is at the start of a line, so a tool line can claim one of its own without
    /// leaving a blank one behind.
    at_line_start: bool,
}

impl TurnPrinter {
    pub(crate) fn new() -> Self {
        Self {
            prose: String::new(),
            at_line_start: true,
        }
    }

    /// One streamed chunk of the agent's answer.
    pub(crate) fn write_prose(&mut self, delta: &str) {
        if delta.is_empty() {
            return;
        }
        self.prose.push_str(delta);
        self.at_line_start = delta.ends_with('\n');
        print!("{}", delta);
        std::io::stdout().flush().ok();
    }

    /// One eventwire line's worth of tool activity, if it carries any.
    pub(crate) fn write_tool_activity(&mut self, wire_line: &str) {
        let Some(line) = tool_activity_line(wire_line) else {
            return;
        };
        if self.at_line_start {
            println!("{}", line);
        } else {
            // Prose is streamed without a trailing newline, so the line breaks out of it first.
            println!("\n{}", line);
        }
        self.at_line_start = true;
        std::io::stdout().flush().ok();
    }

    #[cfg(test)]
    pub(crate) fn prose_for_test(&self) -> &str {
        &self.prose
    }

    /// Whatever the finished message still owes the terminal.
    pub(crate) fn finish(&mut self, content: &str) {
        if let Some(tail) = finalized_tail(&self.prose, content) {
            if !self.at_line_start && !tail.starts_with('\n') {
                println!();
            }
            print!("{}", tail);
            self.at_line_start = tail.ends_with('\n');
            std::io::stdout().flush().ok();
        }
    }
}

async fn resolve_session(tendril_home: &Path, id_or_prefix: &str) -> anyhow::Result<ChatSession> {
    if let Ok(exact) = storage::load_session(tendril_home, id_or_prefix) {
        return Ok(exact);
    }

    let all = storage::load_all_sessions(tendril_home)?;
    let matching: Vec<_> = all
        .into_iter()
        .filter(|s| s.id.starts_with(id_or_prefix))
        .collect();

    if matching.is_empty() {
        anyhow::bail!("Chat session '{}' not found", id_or_prefix);
    }
    if matching.len() > 1 {
        anyhow::bail!(
            "Ambiguous session prefix '{}', matches {} sessions",
            id_or_prefix,
            matching.len()
        );
    }

    Ok(matching.into_iter().next().unwrap())
}

#[cfg(test)]
mod tests {
    use super::{finalized_tail, tool_activity_line, TurnPrinter};

    /// The regression this pins: tool lines are printed *around* the prose, not counted as part of it.
    /// Counting them made `finalized_tail` stop recognising the prose as a prefix of the finished
    /// message, so every turn printed its answer a second time underneath.
    #[test]
    fn test_tool_activity_does_not_count_as_prose() {
        let mut printer = TurnPrinter::new();
        printer.write_prose("The command printed:\n");
        printer.write_tool_activity(
            r#"{"kind":"tool_call","tool_use_id":"t1","tool_name":"run_command","input":{"CommandLine":"echo hello"}}"#,
        );
        printer.write_prose("hello");
        // The finished message is exactly the prose, so there is nothing left to print.
        assert_eq!(
            finalized_tail(printer.prose_for_test(), "The command printed:\nhello"),
            None
        );
        // And a message that *did* grow still owes only the growth.
        assert_eq!(
            finalized_tail(
                printer.prose_for_test(),
                "The command printed:\nhello\n\nDone."
            )
            .as_deref(),
            Some("\n\nDone.")
        );
    }

    /// A streaming client has no tool cards, so it gets the live equivalent: the call as it starts and
    /// its error if it reported one. This is what replaced the prose summary the message used to carry.
    #[test]
    fn test_tool_activity_lines() {
        assert_eq!(
            tool_activity_line(
                r#"{"kind":"tool_call","tool_use_id":"t1","tool_name":"run_command","input":{"CommandLine":"tendril doctor"}}"#
            )
            .as_deref(),
            Some("· run_command (CommandLine: tendril doctor)")
        );
        // No arguments worth showing, and a non-object input, both still name the tool.
        assert_eq!(
            tool_activity_line(r#"{"kind":"tool_call","tool_use_id":"t1","tool_name":"finish"}"#)
                .as_deref(),
            Some("· finish")
        );
        assert_eq!(
            tool_activity_line(
                r#"{"kind":"tool_call","tool_use_id":"t1","tool_name":"view_file","input":{}}"#
            )
            .as_deref(),
            Some("· view_file")
        );

        // A result that worked adds nothing the call line did not already say.
        assert_eq!(
            tool_activity_line(
                r#"{"kind":"tool_result","tool_use_id":"t1","tool_name":"run_command","output":"ok","is_error":false}"#
            ),
            None
        );
        assert_eq!(
            tool_activity_line(
                r#"{"kind":"tool_result","tool_use_id":"t1","tool_name":"run_command","output":"command not found","is_error":true}"#
            )
            .as_deref(),
            Some("  ! run_command failed: command not found")
        );

        // Long and multi-line values are capped to one readable line.
        let long = tool_activity_line(&format!(
            r#"{{"kind":"tool_result","tool_use_id":"t1","tool_name":"x","output":"{}","is_error":true}}"#,
            "e".repeat(400)
        ))
        .expect("a failure line");
        assert!(
            long.chars().count() < 200,
            "got {} chars",
            long.chars().count()
        );
        assert!(long.ends_with('…'));

        // Everything that is not a tool event is silent: prose is streamed separately, and metadata is
        // not something a terminal reader asked for.
        for line in [
            r#"{"kind":"text","text":"hello","delta":true}"#,
            r#"{"kind":"session_init","session_id":"s"}"#,
            r#"{"kind":"result","is_success":true}"#,
            r#"{"kind":"thinking","content":"hmm"}"#,
            "not json",
            "{}",
        ] {
            assert_eq!(tool_activity_line(line), None, "line: {}", line);
        }
    }

    #[test]
    fn test_finalized_tail_only_reports_what_is_new() {
        // Nothing streamed: the whole report is new.
        assert_eq!(
            finalized_tail("", "Agent execution completed with status code 1: it broke").as_deref(),
            Some("Agent execution completed with status code 1: it broke")
        );
        // The failure reason was appended to prose that already streamed.
        assert_eq!(
            finalized_tail(
                "partial answer",
                "partial answer\n\nExecution was cancelled."
            )
            .as_deref(),
            Some("\n\nExecution was cancelled.")
        );
        // Already fully printed, and the empty stub.
        assert_eq!(finalized_tail("all of it", "all of it"), None);
        assert_eq!(finalized_tail("", ""), None);
        // A final copy that is not an extension of the stream is shown on its own line.
        assert_eq!(
            finalized_tail("streamed", "something else").as_deref(),
            Some("\nsomething else")
        );
    }
}
