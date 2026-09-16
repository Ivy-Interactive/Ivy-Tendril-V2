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

    let mut streamed = String::new();
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
                            streamed.push_str(&delta);
                            print!("{}", delta);
                            std::io::stdout().flush().ok();
                        }
                        ChatEvent::MessageAdded {
                            session_id: sid,
                            message,
                        } if sid == session_id && message.role == "assistant" => {
                            print_finalized_tail(&streamed, &message.content);
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
    };

    let target_session_id = session_id.to_string();
    let turn_handle = tokio::spawn(async move {
        manager
            .start_session_turn(&session_id_clone, &prompt, options)
            .await
    });

    let mut streamed = String::new();
    while let Ok(event) = rx.recv().await {
        match event {
            ChatEvent::StreamDelta {
                session_id: sid,
                delta,
                ..
            } if sid == target_session_id => {
                streamed.push_str(&delta);
                print!("{}", delta);
                std::io::stdout().flush().ok();
            }
            ChatEvent::MessageAdded {
                session_id: sid,
                message,
            } if sid == target_session_id && message.role == "assistant" => {
                print_finalized_tail(&streamed, &message.content);
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

fn print_finalized_tail(streamed: &str, content: &str) {
    if let Some(tail) = finalized_tail(streamed, content) {
        print!("{}", tail);
        std::io::stdout().flush().ok();
    }
}

#[cfg(test)]
mod tests {
    use super::finalized_tail;

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
