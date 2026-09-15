//! End-to-end coverage for the review-action stream: the pty it runs under, the frames it emits, and
//! the input/resize routes that make it interactive.
//!
//! The assertions deliberately look for terminal behaviour rather than just "some output arrived".
//! `\n` arriving as `\r\n`, `[ -t 1 ]` succeeding, and `stty size` reporting the size the client
//! asked for are only true of a real pty — a pipe transport would satisfy a test that merely checked
//! the text, which is exactly the regression this suite exists to catch.
//!
//! The server binds 127.0.0.1:0 and every fixture lives in a temp `TENDRIL_HOME` that `Drop` removes.

use base64::Engine;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tendril_server::{create_router, AppState};

// ---- harness --------------------------------------------------------------

/// Long enough to cover a loaded CI machine spawning a shell, short enough that a wedged stream
/// fails the test instead of hanging the suite.
const READ_TIMEOUT: Duration = Duration::from_secs(20);

struct Server {
    port: u16,
    secret: String,
    tendril_home: PathBuf,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Drop for Server {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

/// The project every test runs against. Two ports so "primary" is a real choice: `ProjectConfig`
/// stores them in a `BTreeMap`, so `backend` sorts first and is what `PORT` and `%PORT%` resolve to.
const CONFIG: &str = r#"
projects:
  - name: Demo
    ports:
      backend:
        defaultPort: 8080
      frontend:
        defaultPort: 4321
    reviewActions:
      - name: Echo
        command: echo hello
      - name: Tty
        command: 'if [ -t 1 ]; then echo TTY; else echo PIPE; fi'
      - name: Ports
        command: 'echo "cmd=${ports.frontend} pct=%PORT% primary=$PORT named=$PORT_FRONTEND project=$PROJECT_NAME"'
      - name: Plan
        command: 'echo "id=$PLAN_ID project=$PROJECT_NAME worktree=$WORKTREE_DIR primary=$PORT"'
      - name: Read
        command: 'read line; echo "got:$line"'
      - name: Resize
        command: 'read _; stty size'
      - name: Fail
        command: exit 3
      - name: Empty
        command: ''
"#;

async fn start_server() -> Server {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-review-action-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(tendril_home.join("Plans")).unwrap();

    let secret = tendril_core::config::generate_bearer_secret();
    let state = Arc::new(AppState::with_plans_dir(
        tendril_home.clone(),
        tendril_home.join("Plans"),
        secret.clone(),
    ));

    // Written through the path the state actually resolved, and asserted to be inside the temp home:
    // `TENDRIL_CONFIG` can redirect it, and a test must fail rather than write over a real config.
    assert_eq!(
        state.config_path,
        tendril_home.join("config.yaml"),
        "TENDRIL_CONFIG must not be set when running this suite"
    );
    std::fs::write(&state.config_path, CONFIG).unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (shutdown, rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        let _ = axum::serve(listener, create_router(state))
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await;
    });

    Server {
        port,
        secret,
        tendril_home,
        shutdown: Some(shutdown),
    }
}

impl Server {
    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.port, path)
    }

    async fn execute(&self, action: &str, query: &str) -> reqwest::Response {
        reqwest::Client::new()
            .post(self.url(&format!(
                "/api/projects/Demo/review-actions/{action}/execute{query}"
            )))
            .bearer_auth(&self.secret)
            .send()
            .await
            .unwrap()
    }

    async fn post_json(&self, path: &str, body: serde_json::Value) -> reqwest::Response {
        reqwest::Client::new()
            .post(self.url(path))
            .bearer_auth(&self.secret)
            .json(&body)
            .send()
            .await
            .unwrap()
    }
}

/// Incremental reader over one review action's SSE body.
///
/// Frames have to be consumed as they arrive rather than after the fact: the session id needed to
/// answer a prompt is in the first frame, and the process producing the later frames is waiting for
/// that answer. Buffering the whole body first would deadlock.
struct Stream {
    response: reqwest::Response,
    buffer: String,
    pending: std::collections::VecDeque<(String, String)>,
    /// Every `log` frame decoded and concatenated, which is the byte stream the terminal would see.
    output: Vec<u8>,
}

impl Stream {
    fn new(response: reqwest::Response) -> Self {
        assert_eq!(response.status(), 200);
        Self {
            response,
            buffer: String::new(),
            pending: std::collections::VecDeque::new(),
            output: Vec::new(),
        }
    }

    /// The next frame as `(event, data)`, or `None` once the body ends.
    async fn next_frame(&mut self) -> Option<(String, String)> {
        loop {
            if let Some(frame) = self.pending.pop_front() {
                if frame.0 == "log" {
                    self.output.extend(
                        base64::engine::general_purpose::STANDARD
                            .decode(frame.1.as_bytes())
                            .expect("a log frame must be base64"),
                    );
                }
                return Some(frame);
            }

            let chunk = tokio::time::timeout(READ_TIMEOUT, self.response.chunk())
                .await
                .expect("timed out waiting for the next frame")
                .expect("stream read failed");
            // End of the stream: no more frames will arrive.
            let chunk = chunk?;
            self.buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(end) = self.buffer.find("\n\n") {
                let frame: String = self.buffer.drain(..end + 2).collect();
                let mut name = String::new();
                let mut data: Vec<String> = Vec::new();
                for line in frame.lines() {
                    let line = line.trim_end_matches('\r');
                    if let Some(rest) = line.strip_prefix("event:") {
                        name = rest.trim().to_string();
                    } else if let Some(rest) = line.strip_prefix("data:") {
                        data.push(rest.strip_prefix(' ').unwrap_or(rest).to_string());
                    }
                }
                if !data.is_empty() {
                    self.pending.push_back((name, data.join("\n")));
                }
            }
        }
    }

    /// Reads to the end of the stream and returns the `end` frame's message.
    async fn drain(&mut self) -> String {
        let mut end_message = None;
        while let Some((name, data)) = self.next_frame().await {
            if name == "end" {
                end_message = Some(data);
            }
        }
        end_message.expect("the stream must end with an `end` frame")
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.output).to_string()
    }
}

/// The first frame, which must be the `meta` frame, returning the session id it carries.
async fn expect_meta(stream: &mut Stream) -> String {
    let (name, data) = stream.next_frame().await.expect("the stream must open");
    assert_eq!(
        name, "meta",
        "the encoding must be announced before any payload a client would have to decode"
    );
    let meta: serde_json::Value = serde_json::from_str(&data).unwrap();
    assert_eq!(meta["encoding"], "base64");
    let session_id = meta["sessionId"].as_str().unwrap().to_string();
    assert!(!session_id.is_empty());
    session_id
}

// ---- tests ----------------------------------------------------------------

#[tokio::test]
async fn stream_announces_base64_then_delivers_raw_pty_bytes() {
    let server = start_server().await;
    let mut stream = Stream::new(server.execute("Echo", "").await);

    expect_meta(&mut stream).await;
    let end = stream.drain().await;

    assert_eq!(end, "Process exited with code 0");
    // `echo` writes a bare `\n`; it arrives as `\r\n` because a terminal's line discipline expands
    // it. Over pipes this assertion fails, which is the point.
    assert_eq!(
        stream.text(),
        "hello\r\n",
        "output must arrive as raw terminal bytes, carriage returns and all"
    );
}

#[tokio::test]
async fn the_command_sees_a_real_terminal_on_stdout() {
    let server = start_server().await;
    let mut stream = Stream::new(server.execute("Tty", "").await);

    expect_meta(&mut stream).await;
    stream.drain().await;

    assert!(
        stream.text().contains("TTY"),
        "the command must be able to detect a tty, or dev servers will disable colour and \
         over-buffer: got {:?}",
        stream.text()
    );
}

#[tokio::test]
async fn ports_are_interpolated_into_the_command_and_exported() {
    let server = start_server().await;
    let mut stream = Stream::new(server.execute("Ports", "").await);

    expect_meta(&mut stream).await;
    stream.drain().await;

    let text = stream.text();
    // `backend` sorts first, so it is the primary port `%PORT%` and `$PORT` resolve to.
    assert!(
        text.contains("cmd=4321 pct=8080 primary=8080 named=4321 project=Demo"),
        "got {text:?}"
    );
}

#[tokio::test]
async fn a_plan_contributes_its_allocated_ports_and_identity() {
    let server = start_server().await;

    // A plan whose worktree exists and whose allocation overrides the project default.
    let plan_folder = server.tendril_home.join("Plans").join("00042-Fixture");
    let worktree = plan_folder.join("Worktrees").join("Demo");
    std::fs::create_dir_all(&worktree).unwrap();

    let mut plan = tendril_core::models::PlanYaml {
        project: "Demo".to_string(),
        title: "Fixture".to_string(),
        repos: vec!["/tmp/Demo".to_string()],
        ..Default::default()
    };
    plan.allocated_ports = Some(BTreeMap::from([("backend".to_string(), 31234u16)]));
    std::fs::write(
        plan_folder.join("plan.yaml"),
        serde_yaml::to_string(&plan).unwrap(),
    )
    .unwrap();

    let mut stream = Stream::new(server.execute("Plan", "?planId=42").await);
    expect_meta(&mut stream).await;
    stream.drain().await;

    let text = stream.text();
    assert!(
        text.contains("id=00042"),
        "PLAN_ID must be padded: {text:?}"
    );
    assert!(text.contains("project=Demo"), "got {text:?}");
    assert!(
        text.contains(&format!("worktree={}", worktree.display())),
        "got {text:?}"
    );
    assert!(
        text.contains("primary=31234"),
        "the plan's allocation must beat the project default: {text:?}"
    );
}

#[tokio::test]
async fn input_reaches_the_waiting_process() {
    let server = start_server().await;
    let mut stream = Stream::new(server.execute("Read", "").await);
    let session_id = expect_meta(&mut stream).await;

    // A terminal sends CR on Enter, not LF; the line discipline is what turns it into the newline
    // `read` is waiting for.
    let response = server
        .post_json(
            "/api/projects/Demo/review-actions/Read/input",
            serde_json::json!({
                "sessionId": session_id,
                "data": base64::engine::general_purpose::STANDARD.encode("hi\r"),
            }),
        )
        .await;
    assert_eq!(response.status(), 200);

    stream.drain().await;
    assert!(
        stream.text().contains("got:hi"),
        "the process must receive what the client typed: {:?}",
        stream.text()
    );
}

#[tokio::test]
async fn resize_changes_the_window_the_process_sees() {
    let server = start_server().await;
    let mut stream = Stream::new(server.execute("Resize", "").await);
    let session_id = expect_meta(&mut stream).await;

    let response = server
        .post_json(
            "/api/projects/Demo/review-actions/Resize/resize",
            serde_json::json!({ "sessionId": session_id, "rows": 40, "cols": 120 }),
        )
        .await;
    assert_eq!(response.status(), 200);

    // The size is read only after the resize has been applied, so `stty` cannot see the default.
    server
        .post_json(
            "/api/projects/Demo/review-actions/Resize/input",
            serde_json::json!({
                "sessionId": session_id,
                "data": base64::engine::general_purpose::STANDARD.encode("\r"),
            }),
        )
        .await;

    stream.drain().await;
    assert!(
        stream.text().contains("40 120"),
        "the process must see the size the client reported: {:?}",
        stream.text()
    );
}

#[tokio::test]
async fn a_nonzero_exit_is_reported_in_the_end_frame() {
    let server = start_server().await;
    let mut stream = Stream::new(server.execute("Fail", "").await);

    expect_meta(&mut stream).await;
    assert_eq!(stream.drain().await, "Process exited with code 3");
}

#[tokio::test]
async fn input_and_resize_reject_a_session_that_is_not_running() {
    let server = start_server().await;

    let input = server
        .post_json(
            "/api/projects/Demo/review-actions/Echo/input",
            serde_json::json!({ "sessionId": "nope", "data": "" }),
        )
        .await;
    assert_eq!(input.status(), 404);

    let resize = server
        .post_json(
            "/api/projects/Demo/review-actions/Echo/resize",
            serde_json::json!({ "sessionId": "nope", "rows": 24, "cols": 80 }),
        )
        .await;
    assert_eq!(resize.status(), 404);
}

#[tokio::test]
async fn an_unconfigured_action_or_project_never_reaches_the_pty() {
    let server = start_server().await;

    assert_eq!(server.execute("Empty", "").await.status(), 400);
    assert_eq!(server.execute("Nope", "").await.status(), 404);

    let unknown_project = reqwest::Client::new()
        .post(server.url("/api/projects/Nope/review-actions/Echo/execute"))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(unknown_project.status(), 404);
}

#[tokio::test]
async fn the_stream_requires_authentication() {
    let server = start_server().await;

    let response = reqwest::Client::new()
        .post(server.url("/api/projects/Demo/review-actions/Echo/execute"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        401,
        "the review-action routes run shell commands and must stay behind the bearer check"
    );
}
