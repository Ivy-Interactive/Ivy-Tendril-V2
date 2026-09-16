//! `tendril chat` — argument parsing, the local store, and the daemon wire contract.
//!
//! `chat` is the one command group that is *local-first*: `Chats/*.json` is the same store the daemon
//! persists to, so every read and every mutation has a filesystem path that works with no daemon
//! running at all. That is what most of these tests pin — including the two cases where the daemon is
//! present but unusable, since a stale `.master` file must not turn a working local store into an
//! error.
//!
//! `chat send` is the exception: it streams the assistant's output over a WebSocket rather than over
//! the HTTP request, and the local path spawns a real coding agent. So the streaming contract is
//! covered against a stub daemon that serves `/api/ws` and answers `/execute`, and the local path is
//! only exercised where it fails before any agent could be launched.
//!
//! Layers and isolation are as in `job_cli_test.rs`: parsing runs in-process against the public
//! `ChatCommands`, everything that asserts an exit code or an output shape spawns
//! `env!("CARGO_BIN_EXE_tendril")` against a throwaway `--home`, and the child's `TENDRIL_*`
//! environment is always overridden so a developer's real Tendril home cannot leak in.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::routing::{any, get};
use axum::{Json, Router};
use clap::{CommandFactory, Parser};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tendril_cli::commands::chat::ChatCommands;
use tendril_core::chat::execution::ChatEvent;
use tendril_core::chat::models::{ChatMessage, ChatSession};
use tendril_core::chat::storage;
use tendril_core::config::write_master;

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

#[derive(Parser)]
#[command(name = "tendril")]
struct TestCli {
    #[command(subcommand)]
    command: ChatCommands,
}

fn parse(args: &[&str]) -> ChatCommands {
    TestCli::try_parse_from(args)
        .unwrap_or_else(|e| panic!("parse {:?}: {}", args, e))
        .command
}

fn parse_err(args: &[&str]) -> clap::error::ErrorKind {
    match TestCli::try_parse_from(args) {
        Ok(_) => panic!("expected {:?} to fail parsing", args),
        Err(e) => e.kind(),
    }
}

#[test]
fn the_clap_definition_is_internally_consistent() {
    TestCli::command().debug_assert();
}

#[test]
fn every_subcommand_parses_under_its_documented_name() {
    assert!(matches!(parse(&["tendril", "list"]), ChatCommands::List(_)));
    assert!(matches!(
        parse(&["tendril", "get", "abc"]),
        ChatCommands::Get(_)
    ));
    assert!(matches!(
        parse(&["tendril", "create"]),
        ChatCommands::Create(_)
    ));
    assert!(matches!(
        parse(&["tendril", "delete", "abc"]),
        ChatCommands::Delete(_)
    ));
    assert!(matches!(
        parse(&["tendril", "send", "abc", "hello"]),
        ChatCommands::Send(_)
    ));
}

#[test]
fn list_takes_only_json() {
    let ChatCommands::List(args) = parse(&["tendril", "list"]) else {
        panic!("expected list");
    };
    assert!(!args.json);
    let ChatCommands::List(args) = parse(&["tendril", "list", "--json"]) else {
        panic!("expected list");
    };
    assert!(args.json);
}

#[test]
fn get_requires_a_session_id() {
    let ChatCommands::Get(args) = parse(&["tendril", "get", "abc123", "--json"]) else {
        panic!("expected get");
    };
    assert_eq!(args.id, "abc123");
    assert!(args.json);

    assert_eq!(
        parse_err(&["tendril", "get"]),
        clap::error::ErrorKind::MissingRequiredArgument
    );
}

#[test]
fn create_parses_every_flag_and_defaults_them_all_to_absent() {
    let ChatCommands::Create(args) = parse(&[
        "tendril",
        "create",
        "--agent",
        "codestory",
        "--model",
        "claude-sonnet-4-5",
        "--title",
        "Investigate the flake",
        "--effort",
        "high",
        "--plan",
        "00123-Fix",
        "--json",
    ]) else {
        panic!("expected create");
    };
    assert_eq!(args.agent.as_deref(), Some("codestory"));
    assert_eq!(args.model.as_deref(), Some("claude-sonnet-4-5"));
    assert_eq!(args.title.as_deref(), Some("Investigate the flake"));
    assert_eq!(args.effort.as_deref(), Some("high"));
    assert_eq!(args.plan.as_deref(), Some("00123-Fix"));
    assert!(args.json);

    let ChatCommands::Create(args) = parse(&["tendril", "create"]) else {
        panic!("expected create");
    };
    assert!(
        args.agent.is_none()
            && args.model.is_none()
            && args.title.is_none()
            && args.effort.is_none()
            && args.plan.is_none()
            && !args.json,
        "`chat create` with no flags has to be valid: the config supplies the defaults"
    );
}

#[test]
fn send_requires_both_a_session_and_a_message() {
    let ChatCommands::Send(args) = parse(&[
        "tendril",
        "send",
        "abc123",
        "what broke?",
        "--agent",
        "claude",
        "--model",
        "claude-opus-4-1",
        "--effort",
        "low",
    ]) else {
        panic!("expected send");
    };
    assert_eq!(args.id, "abc123");
    assert_eq!(args.message, "what broke?");
    assert_eq!(args.agent.as_deref(), Some("claude"));
    assert_eq!(args.model.as_deref(), Some("claude-opus-4-1"));
    assert_eq!(args.effort.as_deref(), Some("low"));

    assert_eq!(
        parse_err(&["tendril", "send", "abc123"]),
        clap::error::ErrorKind::MissingRequiredArgument,
        "a turn with no prompt has nothing to send"
    );
    assert_eq!(
        parse_err(&["tendril", "send"]),
        clap::error::ErrorKind::MissingRequiredArgument
    );
}

#[test]
fn an_unknown_flag_is_a_parse_error_not_a_silent_ignore() {
    assert_eq!(
        parse_err(&["tendril", "list", "--bogus"]),
        clap::error::ErrorKind::UnknownArgument
    );
    assert_eq!(
        parse_err(&["tendril", "delete", "abc", "--force"]),
        clap::error::ErrorKind::UnknownArgument
    );
}

// ---------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------

struct Run {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

impl Run {
    fn ok(&self) -> bool {
        self.code == Some(0)
    }
}

/// A throwaway `TENDRIL_HOME`, removed on drop.
struct Home {
    path: PathBuf,
}

impl Home {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "tendril-chat-cli-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        assert!(path.starts_with(std::env::temp_dir()));
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(
            tendril_core::config::get_config_path(&path),
            "daemonRequestTimeout: 5\nenrichModels: false\n",
        )
        .unwrap();
        Self { path }
    }

    fn session_file(&self, id: &str) -> PathBuf {
        self.path.join("Chats").join(format!("{}.json", id))
    }

    /// Writes a session straight into the local store, the way the daemon persists one.
    fn write_session(&self, id: &str, title: &str) -> ChatSession {
        let session = ChatSession {
            id: id.to_string(),
            title: title.to_string(),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            agent_id: "claude".to_string(),
            model_id: "claude-sonnet-4-5".to_string(),
            messages: Vec::new(),
            effort: None,
            spawned_job_ids: Vec::new(),
            plan_folder_name: None,
        };
        storage::save_session(&self.path, &session).unwrap();
        session
    }

    fn run(&self, args: &[&str]) -> Run {
        let output = std::process::Command::new(env!("CARGO_BIN_EXE_tendril"))
            .arg("--home")
            .arg(&self.path)
            .args(args)
            .env("TENDRIL_HOME", &self.path)
            .env_remove("TENDRIL_CONFIG")
            .env_remove("TENDRIL_PLANS")
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap_or_else(|e| panic!("run tendril {:?}: {}", args, e));

        Run {
            code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        }
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        assert!(self.path.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// One request the stub daemon answered.
#[derive(Clone, Debug)]
struct Recorded {
    method: String,
    uri: String,
    auth: Option<String>,
    body: serde_json::Value,
}

/// A daemon that records HTTP requests, answers them from a closure, and serves `/api/ws` with a
/// canned event stream for the session it was told about.
struct Stub {
    home: Home,
    secret: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Stub {
    fn new<F>(label: &str, ws_session_id: Option<String>, respond: F) -> Self
    where
        F: Fn(&str, &str) -> (axum::http::StatusCode, serde_json::Value)
            + Clone
            + Send
            + Sync
            + 'static,
    {
        let home = Home::new(label);
        let secret = format!("stub-secret-{}", uuid::Uuid::new_v4().simple());

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        write_master(&home.path, port, &secret, "127.0.0.1", "http").unwrap();

        let requests: Arc<Mutex<Vec<Recorded>>> = Arc::new(Mutex::new(Vec::new()));
        let recorder = Arc::clone(&requests);

        let ws_session_id = ws_session_id.unwrap_or_default();
        let app =
            Router::new()
                .route(
                    "/api/ws",
                    get(move |ws: WebSocketUpgrade| {
                        let session_id = ws_session_id.clone();
                        async move {
                            ws.on_upgrade(move |socket| stream_canned_turn(socket, session_id))
                        }
                    }),
                )
                .fallback(any(move |req: axum::extract::Request| {
                    let respond = respond.clone();
                    let recorder = Arc::clone(&recorder);
                    async move {
                        let (parts, body) = req.into_parts();
                        let bytes = axum::body::to_bytes(body, 1 << 20)
                            .await
                            .unwrap_or_default();
                        let recorded = Recorded {
                            method: parts.method.to_string(),
                            uri: parts.uri.to_string(),
                            auth: parts
                                .headers
                                .get(axum::http::header::AUTHORIZATION)
                                .and_then(|v| v.to_str().ok())
                                .map(|v| v.to_string()),
                            body: serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
                        };
                        let (status, payload) = respond(&recorded.method, &recorded.uri);
                        recorder.lock().unwrap().push(recorded);
                        (status, Json(payload))
                    }
                }));

        let (shutdown, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
        let thread = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            rt.block_on(async move {
                let listener = tokio::net::TcpListener::from_std(listener).unwrap();
                let _ = axum::serve(listener, app)
                    .with_graceful_shutdown(async move {
                        let _ = shutdown_rx.await;
                    })
                    .await;
            });
        });

        Self {
            home,
            secret,
            requests,
            shutdown: Some(shutdown),
            thread: Some(thread),
        }
    }

    fn run(&self, args: &[&str]) -> Run {
        self.home.run(args)
    }

    fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }

    fn only_request(&self) -> Recorded {
        let all = self.requests();
        assert_eq!(all.len(), 1, "expected exactly one request, got {:?}", all);
        all.into_iter().next().unwrap()
    }
}

impl Drop for Stub {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// The event sequence a real turn produces, plus events for a *different* session that the CLI has to
/// ignore — the WebSocket is a single broadcast of everything happening in the daemon, so filtering
/// by session id is load-bearing rather than decorative.
async fn stream_canned_turn(mut socket: WebSocket, session_id: String) {
    let other = "another-session".to_string();
    let events = vec![
        ChatEvent::StreamDelta {
            session_id: other.clone(),
            message_id: "m0".to_string(),
            delta: "SHOULD-NOT-APPEAR".to_string(),
        },
        ChatEvent::GeneratingState {
            session_id: session_id.clone(),
            is_generating: true,
        },
        ChatEvent::StreamDelta {
            session_id: session_id.clone(),
            message_id: "m1".to_string(),
            delta: "Hello from ".to_string(),
        },
        ChatEvent::StreamDelta {
            session_id: session_id.clone(),
            message_id: "m1".to_string(),
            delta: "the daemon.".to_string(),
        },
        ChatEvent::GeneratingState {
            session_id: other,
            is_generating: false,
        },
        ChatEvent::GeneratingState {
            session_id,
            is_generating: false,
        },
    ];

    for event in events {
        let json = serde_json::to_string(&event).unwrap();
        if socket.send(Message::Text(json)).await.is_err() {
            return;
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The local store, with no daemon
// ---------------------------------------------------------------------------------------------

#[test]
fn list_says_so_when_there_are_no_sessions() {
    let home = Home::new("list-empty");

    let run = home.run(&["chat", "list"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(
        run.stdout, "No chat sessions found.\n",
        "an empty store prints a sentence, not an empty table"
    );

    let run = home.run(&["chat", "list", "--json"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&run.stdout).unwrap(),
        serde_json::json!([]),
        "--json is machine-readable even when empty"
    );
    assert!(
        !home.path.join("Chats").exists(),
        "listing must not create the store as a side effect"
    );
}

#[test]
fn create_writes_the_session_to_the_local_store_and_sanitizes_its_title() {
    let home = Home::new("create-local");

    let run = home.run(&[
        "chat",
        "create",
        "--title",
        "  Investigate the flake...  ",
        "--agent",
        "codestory",
        "--model",
        "claude-sonnet-4-5",
        "--effort",
        "high",
        "--plan",
        "00123-Fix",
        "--json",
    ]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);

    let session: serde_json::Value = serde_json::from_str(&run.stdout).expect("--json is JSON");
    assert_eq!(
        session["title"], "Investigate the flake",
        "the trailing ellipsis a truncated title carries is stripped"
    );
    assert_eq!(session["agentId"], "codestory");
    assert_eq!(session["modelId"], "claude-sonnet-4-5");
    assert_eq!(session["effort"], "high");
    assert_eq!(session["planFolderName"], "00123-Fix");
    assert_eq!(session["messages"], serde_json::json!([]));

    let id = session["id"].as_str().expect("an id");
    let on_disk = std::fs::read_to_string(home.session_file(id)).expect("Chats/<id>.json");
    let reread: serde_json::Value = serde_json::from_str(&on_disk).unwrap();
    assert_eq!(
        reread["id"], session["id"],
        "the printed session is the persisted session"
    );
    assert_eq!(
        reread["agentId"], "codestory",
        "the store is camelCase, which is what the app and the daemon read"
    );
}

#[test]
fn create_falls_back_to_the_configured_agent_and_a_default_title() {
    let home = Home::new("create-defaults");

    let run = home.run(&["chat", "create"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    let lines: Vec<&str> = run.stdout.lines().collect();
    assert!(
        lines[0].starts_with("Created chat session: "),
        "{:?}",
        lines
    );
    assert_eq!(lines[1], "Title: New Chat");
    assert_eq!(
        lines[2], "Agent: claude",
        "with no --agent the config's codingAgent is used"
    );
    assert_eq!(lines.len(), 3, "{:?}", lines);
}

#[test]
fn list_renders_a_row_per_session_and_truncates_a_long_title() {
    let home = Home::new("list-rows");
    home.write_session(
        "11111111-1111-4111-8111-111111111111",
        "A title that is definitely longer than thirty characters",
    );

    let run = home.run(&["chat", "list"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    let lines: Vec<&str> = run.stdout.lines().collect();
    assert!(
        lines[0].starts_with("SESSION ID")
            && lines[0].contains("TITLE")
            && lines[0].contains("AGENT")
            && lines[0].ends_with("UPDATED"),
        "{:?}",
        lines
    );
    assert_eq!(lines[1], "-".repeat(95));
    assert!(
        lines[2].starts_with("11111111-1111-4111-8111-111111111111"),
        "{:?}",
        lines
    );
    assert!(
        lines[2].contains("A title that is definitely ..."),
        "a title over 30 characters is cut to 27 plus an ellipsis: {:?}",
        lines
    );
    assert!(lines[2].contains("claude"), "{:?}", lines);
    assert_eq!(lines.len(), 3, "{:?}", lines);
}

#[test]
fn get_resolves_a_full_id_or_an_unambiguous_prefix() {
    let home = Home::new("get-resolve");
    let id = "22222222-2222-4222-8222-222222222222";
    let mut session = home.write_session(id, "Session under test");
    session.messages.push(ChatMessage {
        id: "m1".to_string(),
        role: "user".to_string(),
        content: "why is it failing?".to_string(),
        timestamp: chrono::Utc::now(),
        agent_id: None,
        model_id: None,
        raw_stream: None,
        effort: None,
    });
    session.effort = Some("high".to_string());
    session.spawned_job_ids.push("00123".to_string());
    storage::save_session(&home.path, &session).unwrap();

    for arg in [id, "22222222"] {
        let run = home.run(&["chat", "get", arg]);
        assert!(run.ok(), "{:?}: {}{}", arg, run.stdout, run.stderr);
        assert!(
            run.stdout.contains(&format!("Session: {}", id)),
            "{:?}: {}",
            arg,
            run.stdout
        );
    }

    let run = home.run(&["chat", "get", id]);
    assert!(
        run.stdout.contains("Title:   Session under test"),
        "{}",
        run.stdout
    );
    assert!(run.stdout.contains("Agent:   claude"), "{}", run.stdout);
    assert!(
        run.stdout.contains("Model:   claude-sonnet-4-5"),
        "{}",
        run.stdout
    );
    assert!(run.stdout.contains("Effort:  high"), "{}", run.stdout);
    assert!(
        run.stdout.contains("Jobs:    00123"),
        "a session that spawned a job says which one: {}",
        run.stdout
    );
    assert!(run.stdout.contains("Messages (1):"), "{}", run.stdout);
    assert!(
        run.stdout.contains("[USER]"),
        "the role is upper-cased: {}",
        run.stdout
    );
    assert!(run.stdout.contains("why is it failing?"), "{}", run.stdout);

    let run = home.run(&["chat", "get", id, "--json"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    let doc: serde_json::Value = serde_json::from_str(&run.stdout).expect("--json is JSON");
    assert_eq!(doc["id"], id);
    assert_eq!(doc["messages"][0]["content"], "why is it failing?");
}

#[test]
fn get_refuses_an_unknown_id_and_an_ambiguous_prefix() {
    let home = Home::new("get-refuse");

    let run = home.run(&["chat", "get", "nope"]);
    assert_eq!(run.code, Some(1), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stderr.contains("Chat session 'nope' not found"),
        "{}",
        run.stderr
    );

    home.write_session("aaaa1111-1111-4111-8111-111111111111", "First");
    home.write_session("aaaa2222-2222-4222-8222-222222222222", "Second");

    let run = home.run(&["chat", "get", "aaaa"]);
    assert_eq!(run.code, Some(1), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stderr.contains("Ambiguous session prefix 'aaaa'")
            && run.stderr.contains("matches 2 sessions"),
        "guessing between two sessions would be worse than refusing: {}",
        run.stderr
    );
}

#[test]
fn delete_removes_the_session_from_the_local_store() {
    let home = Home::new("delete-local");
    let id = "33333333-3333-4333-8333-333333333333";
    home.write_session(id, "To be deleted");

    // A prefix is enough, as it is for `get`.
    let run = home.run(&["chat", "delete", "33333333"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(
        run.stdout,
        format!("Deleted chat session: {}\n", id),
        "the full id is echoed, not the prefix that was typed"
    );
    assert!(
        !home.session_file(id).exists(),
        "the session file must actually be gone"
    );

    let run = home.run(&["chat", "get", id]);
    assert_eq!(run.code, Some(1), "{}{}", run.stdout, run.stderr);

    let run = home.run(&["chat", "delete", id]);
    assert_eq!(
        run.code,
        Some(1),
        "deleting twice is an error, not a silent success: {}{}",
        run.stdout,
        run.stderr
    );
}

/// A `.master` file pointing at a dead port is what a crashed daemon leaves behind. Reads must fall
/// back to the local store rather than fail: it is the same store the daemon was persisting to.
#[test]
fn a_stale_master_file_does_not_break_the_local_store() {
    let home = Home::new("stale-master");
    let id = "44444444-4444-4444-8444-444444444444";
    home.write_session(id, "Survives a crashed daemon");

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    write_master(&home.path, port, "secret", "127.0.0.1", "http").unwrap();

    let run = home.run(&["chat", "list"]);
    assert!(
        run.ok(),
        "a dead daemon must not fail a read: {}{}",
        run.stdout,
        run.stderr
    );
    assert!(run.stdout.contains(id), "{}", run.stdout);

    let run = home.run(&["chat", "create", "--title", "Made without a daemon"]);
    assert!(
        run.ok(),
        "a refused connection proves nothing was created remotely, so the local write is safe: {}{}",
        run.stdout,
        run.stderr
    );
    let created = run
        .stdout
        .lines()
        .next()
        .and_then(|l| l.strip_prefix("Created chat session: "))
        .expect("the id is printed")
        .to_string();
    assert!(home.session_file(&created).exists());

    let run = home.run(&["chat", "delete", id]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert!(
        !home.session_file(id).exists(),
        "`chat delete` reported success, so the session must really be gone"
    );
}

/// `chat send` cannot stream from a TLS daemon, because the WebSocket client is built without TLS
/// support. Saying so beats attempting `ws://` against a TLS port and reporting the handshake error.
#[test]
fn send_refuses_to_stream_from_a_tls_daemon() {
    let home = Home::new("send-tls");
    let id = "55555555-5555-4555-8555-555555555555";
    home.write_session(id, "TLS daemon");
    write_master(&home.path, 5010, "secret", "127.0.0.1", "https").unwrap();

    let run = home.run(&["chat", "send", id, "hello"]);
    assert_eq!(run.code, Some(1), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stderr.contains("cannot stream from a TLS daemon"),
        "{}",
        run.stderr
    );
    assert!(
        run.stderr.contains("https://127.0.0.1:5010"),
        "the message names the daemon it will not talk to: {}",
        run.stderr
    );
    assert!(
        run.stderr.contains("--tls-cert") && run.stderr.contains("the app"),
        "the operator needs a way forward: {}",
        run.stderr
    );
}

/// The session has to be resolved before anything is sent, so an unknown id fails without launching
/// an agent or opening a socket.
#[test]
fn send_to_an_unknown_session_fails_before_anything_is_launched() {
    let home = Home::new("send-unknown");

    let run = home.run(&["chat", "send", "nope", "hello"]);
    assert_eq!(run.code, Some(1), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stderr.contains("Chat session 'nope' not found"),
        "{}",
        run.stderr
    );
    assert!(run.stdout.is_empty(), "{}", run.stdout);
}

// ---------------------------------------------------------------------------------------------
// Wire contract, against a recording stub
// ---------------------------------------------------------------------------------------------

/// A running daemon is the source of truth: it holds sessions that are mid-turn and not yet
/// persisted, so its answer wins over whatever is on disk.
#[test]
fn list_prefers_the_running_daemon_over_the_local_store() {
    let stub = Stub::new("list-daemon", None, |_, _| {
        (
            axum::http::StatusCode::OK,
            serde_json::json!([{
                "id": "66666666-6666-4666-8666-666666666666",
                "title": "Known only to the daemon",
                "createdAt": "2026-01-01T00:00:00Z",
                "updatedAt": "2026-01-01T00:00:00Z",
                "agentId": "claude",
                "modelId": "claude-sonnet-4-5",
                "messages": [],
            }]),
        )
    });
    stub.home
        .write_session("77777777-7777-4777-8777-777777777777", "Only on disk");

    let run = stub.run(&["chat", "list"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stdout.contains("Known only to the daemon"),
        "{}",
        run.stdout
    );
    assert!(
        !run.stdout.contains("Only on disk"),
        "the daemon's answer replaces the local one, it is not merged with it: {}",
        run.stdout
    );

    let request = stub.only_request();
    assert_eq!(request.method, "GET");
    assert_eq!(request.uri, "/api/chat/sessions");
    assert_eq!(
        request.auth.as_deref(),
        Some(format!("Bearer {}", stub.secret).as_str())
    );
}

/// A daemon that answers with an error has nothing useful to say about the store, so the read falls
/// back rather than failing.
#[test]
fn list_falls_back_to_the_local_store_when_the_daemon_errors() {
    let stub = Stub::new("list-fallback", None, |_, _| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({ "error": "database is locked" }),
        )
    });
    stub.home
        .write_session("88888888-8888-4888-8888-888888888888", "On disk");

    let run = stub.run(&["chat", "list"]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert!(run.stdout.contains("On disk"), "{}", run.stdout);
}

#[test]
fn create_posts_to_the_daemon_and_reports_the_session_it_made() {
    let stub = Stub::new("create-daemon", None, |_, _| {
        (
            axum::http::StatusCode::CREATED,
            serde_json::json!({
                "id": "99999999-9999-4999-8999-999999999999",
                "title": "Made by the daemon",
                "createdAt": "2026-01-01T00:00:00Z",
                "updatedAt": "2026-01-01T00:00:00Z",
                "agentId": "codestory",
                "modelId": "claude-sonnet-4-5",
                "messages": [],
            }),
        )
    });

    let run = stub.run(&[
        "chat",
        "create",
        "--title",
        "Investigate the flake",
        "--agent",
        "codestory",
        "--model",
        "claude-sonnet-4-5",
        "--effort",
        "high",
        "--plan",
        "00123-Fix",
    ]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stdout
            .contains("Created chat session: 99999999-9999-4999-8999-999999999999"),
        "the daemon's id is reported, never a locally invented one: {}",
        run.stdout
    );
    assert!(run.stdout.contains("Agent: codestory"), "{}", run.stdout);
    assert!(
        !stub
            .home
            .session_file("99999999-9999-4999-8999-999999999999")
            .exists(),
        "the daemon owns the write; the CLI must not make a second copy"
    );

    let request = stub.only_request();
    assert_eq!(request.method, "POST");
    assert_eq!(request.uri, "/api/chat/sessions");
    assert_eq!(
        request.body,
        serde_json::json!({
            "title": "Investigate the flake",
            "agent_id": "codestory",
            "model_id": "claude-sonnet-4-5",
            "effort": "high",
            "planFolderName": "00123-Fix",
        }),
        "the daemon accepts these key spellings; renaming one silently drops the value"
    );
}

#[test]
fn delete_goes_to_the_daemon_when_one_is_running() {
    let stub = Stub::new("delete-daemon", None, |_, _| {
        (axum::http::StatusCode::OK, serde_json::json!({}))
    });
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    stub.home.write_session(id, "Deleted by the daemon");

    let run = stub.run(&["chat", "delete", id]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(run.stdout, format!("Deleted chat session: {}\n", id));

    let request = stub.only_request();
    assert_eq!(request.method, "DELETE");
    assert_eq!(request.uri, format!("/api/chat/sessions/{}", id));
}

/// The streaming contract. The turn is *started* by the POST, which only replies `{"started": true}`;
/// every token arrives on the WebSocket, filtered by session id.
#[test]
fn send_starts_the_turn_over_http_and_streams_the_reply_over_the_websocket() {
    let id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb".to_string();
    let stub = Stub::new("send-stream", Some(id.clone()), |_, _| {
        (
            axum::http::StatusCode::OK,
            serde_json::json!({ "started": true }),
        )
    });
    stub.home.write_session(&id, "Streaming session");

    let run = stub.run(&[
        "chat",
        "send",
        &id,
        "what broke?",
        "--agent",
        "claude",
        "--model",
        "claude-opus-4-1",
        "--effort",
        "low",
    ]);
    assert!(run.ok(), "{}{}", run.stdout, run.stderr);
    assert_eq!(
        run.stdout, "Hello from the daemon.\n",
        "the deltas are concatenated verbatim and completion adds the newline"
    );
    assert!(
        !run.stdout.contains("SHOULD-NOT-APPEAR"),
        "another session's tokens must not leak into this turn: {}",
        run.stdout
    );

    let request = stub.only_request();
    assert_eq!(request.method, "POST");
    assert_eq!(request.uri, format!("/api/chat/sessions/{}/execute", id));
    assert_eq!(
        request.body,
        serde_json::json!({
            "prompt": "what broke?",
            "agent_id": "claude",
            "model_id": "claude-opus-4-1",
            "effort": "low",
        }),
        "the per-turn overrides travel in the execute body"
    );
}

#[test]
fn send_reports_a_turn_the_daemon_refused_to_start() {
    let id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc".to_string();
    let stub = Stub::new("send-refused", Some(id.clone()), |_, _| {
        (
            axum::http::StatusCode::CONFLICT,
            serde_json::json!({ "error": "session is already generating" }),
        )
    });
    stub.home.write_session(&id, "Busy session");

    let run = stub.run(&["chat", "send", &id, "hello"]);
    assert_eq!(run.code, Some(1), "{}{}", run.stdout, run.stderr);
    assert!(
        run.stderr.contains("Failed to start chat turn on server"),
        "{}",
        run.stderr
    );
    assert!(
        run.stderr.contains("session is already generating"),
        "the daemon's own reason has to survive: {}",
        run.stderr
    );
}
