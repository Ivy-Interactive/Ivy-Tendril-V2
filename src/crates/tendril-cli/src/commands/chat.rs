use clap::{Args, Subcommand};
use futures_util::StreamExt;
use std::io::Write;
use std::path::Path;
use tendril_core::chat::execution::{ChatEvent, ChatExecutionManager, ChatTurnOptions};
use tendril_core::chat::models::ChatSession;
use tendril_core::chat::storage;
use tendril_core::config::{get_config_path, load_config, read_master, MasterInfo};
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
    let sessions = if let Some(master) = read_master(tendril_home) {
        let client = super::daemon_client(&master)?;
        let url = format!("{}/api/chat/sessions", master.base_url());
        let resp = client.get(&url).bearer_auth(&master.secret).send().await?;
        if resp.status().is_success() {
            resp.json::<Vec<ChatSession>>().await?
        } else {
            storage::load_all_sessions(tendril_home)?
        }
    } else {
        storage::load_all_sessions(tendril_home)?
    };

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
    let session = if let Some(master) = read_master(tendril_home) {
        let client = super::daemon_client(&master)?;
        let url = format!("{}/api/chat/sessions", master.base_url());
        let resp = client
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
            .await?;

        if resp.status().is_success() {
            resp.json::<ChatSession>().await?
        } else {
            create_session_local(&args, tendril_home)?
        }
    } else {
        create_session_local(&args, tendril_home)?
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

    if let Some(master) = read_master(tendril_home) {
        let client = super::daemon_client(&master)?;
        let url = format!("{}/api/chat/sessions/{}", master.base_url(), session.id);
        let _ = client.delete(&url).bearer_auth(&master.secret).send().await;
    } else {
        storage::delete_session(tendril_home, &session.id)?;
    }

    println!("Deleted chat session: {}", session.id);
    Ok(())
}

async fn handle_chat_send(args: ChatSendArgs, tendril_home: &Path) -> anyhow::Result<()> {
    let session = resolve_session(tendril_home, &args.id).await?;
    let session_id = session.id.clone();

    if let Some(master) = read_master(tendril_home) {
        stream_via_server(&master, &session_id, &args).await?;
    } else {
        stream_via_local(tendril_home, &session_id, &args).await?;
    }

    Ok(())
}

async fn stream_via_server(
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

    let client = super::daemon_client(master)?;
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
                            print!("{}", delta);
                            std::io::stdout().flush().ok();
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

    while let Ok(event) = rx.recv().await {
        match event {
            ChatEvent::StreamDelta {
                session_id: sid,
                delta,
                ..
            } if sid == target_session_id => {
                print!("{}", delta);
                std::io::stdout().flush().ok();
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
