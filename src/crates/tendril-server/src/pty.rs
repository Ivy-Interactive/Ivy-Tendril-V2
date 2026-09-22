//! Hosts a review action's command in a pseudo-terminal and streams its raw output as SSE.
//!
//! Split out of [`crate::routes::projects::execute_review_action`] so the route keeps only the
//! resolution it always did — project, action, working directory — and everything about *how* the
//! command runs lives here: the ports and environment it is given, the pty pair it is spawned under,
//! and the session handle that makes it writable and resizable afterwards.
//!
//! **Why a pty rather than two pipes.** A dev server that cannot see a TTY on stdout disables
//! colour, buffers differently, and — the case that actually wedges a review — has nowhere to read
//! an answer from when it asks a question on first run. The legacy app used a real pty for exactly
//! these reasons; a pipe transport is strictly less than the feature being ported.
//!
//! **Why the `log` payload is base64.** A pty emits ANSI escapes and bare `\r` for progress
//! redraws, which is precisely what the terminal view exists to render. Splitting on `\n` and
//! shipping the text destroys it, and an SSE `data:` field cannot carry a raw newline anyway. So a
//! `log` frame carries base64 of the raw chunk, and a one-off `meta` frame says so up front rather
//! than leaving a client to guess which encoding it is looking at.

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use tendril_core::models::ProjectConfig;

/// SSE event carrying one base64 chunk of pty output.
pub const EVENT_LOG: &str = "log";
/// SSE event carrying the exit message, once.
pub const EVENT_END: &str = "end";
/// SSE event carrying `{"encoding","sessionId","rows","cols"}`, first and once.
pub const EVENT_META: &str = "meta";

/// The encoding a `log` frame's payload is in, as reported by the `meta` frame.
pub const LOG_ENCODING: &str = "base64";

/// Geometry a session starts at, until the client's first resize arrives. A dev server reads the
/// winsize at startup to decide how to wrap its banner, so the default has to be a plausible
/// terminal rather than 0×0.
const DEFAULT_ROWS: u16 = 24;
const DEFAULT_COLS: u16 = 80;

/// Bytes taken from the pty in one read. Chunk boundaries are arbitrary — a frame is not a line and
/// may split an escape sequence — which is fine because the client writes bytes straight through to
/// xterm.js, whose parser is itself a stream parser.
const READ_CHUNK: usize = 8192;

/// How many frames may be buffered for a client that is reading slowly.
const CHANNEL_CAPACITY: usize = 256;

type SseFrame = Result<axum::response::sse::Event, std::convert::Infallible>;

// ---------------------------------------------------------------------------
// Spawn configuration: ports, command interpolation, environment

/// The ports one review-action session should use, in the project's configured order so the first
/// entry is the primary one.
///
/// A plan contributes the ports allocated to its worktree; a project opened without a plan has no
/// worktree and therefore no allocation, so the configured defaults are used instead. Ports the
/// project no longer configures but the plan still holds are kept at the end, so a command
/// referencing one keeps working until the plan is cleaned up.
///
/// Returns a `Vec` rather than a map because the order *is* the meaning: `%PORT%` is the first
/// entry. `ProjectConfig::ports` is a `BTreeMap`, so "configured order" in V2 is name order.
pub fn resolve_ports(
    project: Option<&ProjectConfig>,
    allocated: Option<&BTreeMap<String, u16>>,
) -> Vec<(String, u16)> {
    let mut ports: Vec<(String, u16)> = Vec::new();

    if let Some(project) = project {
        for (name, config) in &project.ports {
            if let Some(port) = allocated.and_then(|a| a.get(name)).copied() {
                ports.push((name.clone(), port));
            } else if config.default_port > 0 {
                ports.push((name.clone(), config.default_port));
            }
        }
    }

    if let Some(allocated) = allocated {
        for (name, port) in allocated {
            if !ports.iter().any(|(existing, _)| existing == name) {
                ports.push((name.clone(), *port));
            }
        }
    }

    ports
}

/// Substitutes the session's ports into the command: `${ports.<name>}` for a named service and
/// `%PORT%` for the primary one.
///
/// `sh` does not expand `%PORT%`, so a command written that way has to be rewritten here rather
/// than left to the injected environment. An unknown port name is left as written, so the
/// misconfiguration is visible in the terminal instead of silently becoming an empty string —
/// matching what [`tendril_core::plans::env`] does for env files.
pub fn interpolate_command(command: &str, ports: &[(String, u16)]) -> String {
    if command.is_empty() || ports.is_empty() {
        return command.to_string();
    }

    let mut result = String::with_capacity(command.len());
    let bytes = command.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        if command[index..].starts_with("${ports.") {
            if let Some(close) = command[index..].find('}') {
                let name = &command[index + "${ports.".len()..index + close];
                if let Some((_, port)) = ports.iter().find(|(candidate, _)| candidate == name) {
                    result.push_str(&port.to_string());
                    index += close + 1;
                    continue;
                }
            }
        }
        if command[index..].starts_with("%PORT%") {
            result.push_str(&ports[0].1.to_string());
            index += "%PORT%".len();
            continue;
        }

        // Advance by one whole character: a byte-wise walk would split a multi-byte one.
        let width = command[index..]
            .chars()
            .next()
            .map(char::len_utf8)
            .unwrap_or(1);
        result.push_str(&command[index..index + width]);
        index += width;
    }

    result
}

/// The plan a review action was launched from, as far as the environment is concerned.
pub struct PlanEnvContext<'a> {
    /// Zero-padded plan id, e.g. `00636`.
    pub plan_id: &'a str,
    pub plan_folder: &'a Path,
    pub project: &'a str,
    /// The plan's repo paths, used to locate a worktree that exists.
    pub repos: &'a [String],
}

/// Environment injected into the pty: `PORT_<NAME>` per named service plus `PORT` for the primary
/// one, and the plan's identity so a review action can locate its worktree without the command line
/// having to hard-code paths.
///
/// `WORKTREE_DIR` is set only when a worktree actually exists: a variable pointing at a directory
/// that is not there is worse than an unset one, because a command that tests for it would `cd`
/// into nothing.
pub fn build_environment(
    ports: &[(String, u16)],
    plan: Option<&PlanEnvContext<'_>>,
    project_name: Option<&str>,
) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = Vec::new();

    for (name, port) in ports {
        env.push((
            format!("PORT_{}", to_env_var_suffix(name)),
            port.to_string(),
        ));
    }

    if let Some((_, primary)) = ports.first() {
        env.push(("PORT".to_string(), primary.to_string()));
    }

    if let Some(plan) = plan {
        env.push(("PLAN_ID".to_string(), plan.plan_id.to_string()));
        env.push((
            "PLAN_FOLDER".to_string(),
            plan.plan_folder.to_string_lossy().to_string(),
        ));
        env.push(("PROJECT_NAME".to_string(), plan.project.to_string()));

        if let Some(worktree) = resolve_worktree_dir(plan.plan_folder, plan.repos) {
            env.push((
                "WORKTREE_DIR".to_string(),
                worktree.to_string_lossy().to_string(),
            ));
        }
    } else if let Some(project) = project_name {
        env.push(("PROJECT_NAME".to_string(), project.to_string()));
    }

    env
}

/// Uppercases a port name into an environment variable suffix (`web-api` → `WEB_API`).
fn to_env_var_suffix(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect()
}

/// The plan's first existing worktree, or `None` when none has been created.
///
/// Tries the canonical `<plan>/Worktrees/<repo name>` for each repo first, then falls back to
/// whatever is actually under `Worktrees/`, because a worktree added for a nested repo path does not
/// always sit at the derived name.
pub fn resolve_worktree_dir(plan_folder: &Path, repos: &[String]) -> Option<PathBuf> {
    let worktrees = plan_folder.join("Worktrees");

    for repo in repos {
        let candidate = worktrees.join(tendril_core::git::worktree::derive_worktree_relative_path(
            Path::new(repo.as_str()),
        ));
        if candidate.is_dir() {
            return Some(candidate);
        }
    }

    tendril_core::git::worktree::enumerate_worktree_directories(&worktrees)
        .into_iter()
        .find(|path| path.is_dir())
}

// ---------------------------------------------------------------------------
// Sessions

/// A live pty, kept so the client can type into it and tell it how big its window is.
///
/// Both handles sit behind a `Mutex`: `MasterPty` is `Send` but not `Sync`, and a session is shared
/// between the request that created it and any later `input`/`resize` request.
pub struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    /// The child's pid, for [`PtySession::kill`]. `None` when the platform did not report one.
    pid: Option<u32>,
}

impl PtySession {
    /// Sends keystrokes to the process. The bytes go through untouched — a control character is the
    /// point of most of them.
    pub fn write_input(&self, bytes: &[u8]) -> Result<(), String> {
        let mut writer = lock(&self.writer);
        writer
            .write_all(bytes)
            .and_then(|()| writer.flush())
            .map_err(|e| e.to_string())
    }

    /// Ends the session's process, and everything it started.
    ///
    /// A pane that hosts an interactive agent has no reason to outlive its own view — unlike a review
    /// action, whose dev server has to keep serving the preview that replaces the terminal, which is
    /// why closing *that* only stops reading. The whole tree goes, because an agent's children (a
    /// build, a test run) are not the caller's to leave behind.
    pub fn kill(&self) -> bool {
        match self.pid {
            Some(pid) => {
                tendril_core::jobs::process_tree::kill_tree(
                    pid,
                    tendril_core::jobs::process_tree::DEFAULT_KILL_GRACE,
                );
                true
            }
            None => false,
        }
    }

    /// Tells the kernel the window changed size, which is what makes the process redraw to fit.
    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        lock(&self.master)
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }
}

/// A poisoned mutex here means a previous holder panicked mid-write. The pty itself is unharmed, so
/// recovering the guard is better than taking the daemon down with it.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Live sessions, keyed by the id handed to the client in the `meta` frame.
///
/// A process-wide table rather than a field on `AppState`: a session is owned by the daemon for as
/// long as the child runs, not by the request that started it, and keying by a uuid means two
/// routers in one test process cannot collide.
static SESSIONS: LazyLock<Mutex<HashMap<String, Arc<PtySession>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The session `id`, or `None` once its process has exited (or if it never existed) — which is what
/// makes `input`/`resize` on an unknown id a `404` rather than a panic.
pub fn session(id: &str) -> Option<Arc<PtySession>> {
    lock(&SESSIONS).get(id).cloned()
}

fn forget_session(id: &str) {
    lock(&SESSIONS).remove(id);
}

/// Kills every live pty session. Returns how many were still running.
///
/// Called from `run_server` on the way out, and this is what lets the daemon actually exit.
///
/// A pty session's reader lives on a `spawn_blocking` thread parked in `reader.read(..)`, which only
/// returns when the *last slave fd* closes — that is, when the child and everything holding the pty
/// have gone. `#[tokio::main]` drops the runtime when `main` returns, and dropping a runtime *joins*
/// its blocking pool: a reader still parked in `read` therefore blocks the process from exiting
/// forever, long after the listener is closed and `.master` is released.
///
/// Signalling the tree does not reach these children on its own. `portable_pty` puts each child in
/// its own session (`setsid`) so it owns the terminal, so it is in neither the daemon's process
/// group nor its session — a group-wide SIGINT of the kind `dev-desktop.ts` sends reaches the daemon
/// and misses every pty child. Nothing else ever closes them, so the read never ends.
///
/// Hence killing them by pid explicitly. `PtySession::kill` takes the whole tree, so a review
/// action's dev server goes with it; once the last one is gone the master sees EOF, each reader
/// returns, and the blocking pool drains.
pub fn kill_all_sessions() -> usize {
    // Drained rather than iterated: the cleanup task calls `forget_session` as each child is reaped,
    // and holding the lock across `kill` would deadlock against it.
    let sessions: Vec<Arc<PtySession>> = {
        let mut guard = lock(&SESSIONS);
        guard.drain().map(|(_, session)| session).collect()
    };

    let mut killed = 0;
    for session in sessions {
        if session.kill() {
            killed += 1;
        }
    }
    killed
}

/// A spawned review action: the id its `input`/`resize` routes are keyed by, and the SSE frames it
/// produces.
pub struct PtyStream {
    pub session_id: String,
    pub frames: tokio::sync::mpsc::Receiver<SseFrame>,
}

/// Turns a session's frames into an SSE body that ends when the daemon does.
///
/// The frame channel alone has no terminal event — a terminal lives as long as its process, which is
/// the point — and axum's graceful shutdown waits for every open connection. So a stream left
/// attached at shutdown is counted as a connection to drain and holds the daemon on
/// [`crate::SHUTDOWN_GRACE`] for the full ten seconds; `dev-desktop.ts` gives it five and then
/// SIGKILLs, and a SIGKILL skips `MasterGuard::drop` and leaves `.master` behind.
///
/// This is the same treatment `/api/changes/events` and the job log streams already get, and the
/// other half of [`kill_all_sessions`]: that one unblocks the *process*, this one unblocks *graceful
/// shutdown*. Both are needed — killing the child ends the reader thread but does not retract a
/// connection axum has already committed to waiting for.
///
/// The client is told nothing beyond the stream ending, which is correct: there is no outcome to
/// report, and the daemon going away is not the session's own business.
pub fn shutdown_aware_body(
    mut frames: tokio::sync::mpsc::Receiver<SseFrame>,
    mut shutdown_rx: tokio::sync::watch::Receiver<bool>,
) -> impl futures_util::Stream<Item = SseFrame> + Send + 'static {
    futures_util::stream::poll_fn(move |cx| {
        // Checked first and latched, so a stream opened after the signal ends immediately rather
        // than attaching to a daemon that is already leaving.
        if *shutdown_rx.borrow() {
            return std::task::Poll::Ready(None);
        }
        // Registers this task for a wake on the signal, so shutdown is noticed the instant it
        // happens rather than whenever the next frame arrives — a quiet terminal produces no frames
        // at all, which is exactly the case that used to wait out the whole grace period.
        let signalled = {
            use std::future::Future as _;
            let changed = shutdown_rx.changed();
            futures_util::pin_mut!(changed);
            // `Err` is the sender gone, which only happens with `AppState` itself, and means there
            // is nothing left to stream to either way.
            matches!(changed.poll(cx), std::task::Poll::Ready(_))
        };
        if signalled && *shutdown_rx.borrow() {
            return std::task::Poll::Ready(None);
        }
        frames.poll_recv(cx)
    })
}

/// Runs a shell `command` under a pty and returns its frame stream.
///
/// The child is owned by the tasks spawned here, not by the request, so it outlives a client
/// disconnect — which is the whole point for a review action: the app it started has to stay up for
/// the preview that replaces the terminal.
pub fn spawn_review_action(
    command: &str,
    working_dir: Option<&Path>,
    env: &[(String, String)],
) -> Result<PtyStream, String> {
    let builder = if cfg!(windows) {
        let mut builder = CommandBuilder::new("cmd");
        builder.args(["/C", command]);
        builder
    } else {
        let mut builder = CommandBuilder::new("sh");
        builder.args(["-c", command]);
        builder
    };
    spawn_pty(builder, working_dir, env)
}

/// Runs `argv` under a pty, with no shell in between.
///
/// An interactive agent is launched this way rather than through [`spawn_review_action`] because its
/// initial task is an *argument*: routing that through `sh -c` would mean quoting a prompt that can
/// contain anything, and a mis-quoted prompt is a command substitution rather than a typo. A review
/// action is the opposite case — its command is authored as shell and needs the shell.
pub fn spawn_pty_argv(
    argv: &[String],
    working_dir: Option<&Path>,
    env: &[(String, String)],
) -> Result<PtyStream, String> {
    let (program, args) = argv
        .split_first()
        .ok_or_else(|| "No command to run under the pseudo-terminal".to_string())?;
    let mut builder = CommandBuilder::new(program);
    builder.args(args);
    spawn_pty(builder, working_dir, env)
}

fn spawn_pty(
    mut builder: CommandBuilder,
    working_dir: Option<&Path>,
    env: &[(String, String)],
) -> Result<PtyStream, String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: DEFAULT_ROWS,
            cols: DEFAULT_COLS,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open a pseudo-terminal: {e}"))?;

    if let Some(dir) = working_dir {
        builder.cwd(dir);
    }
    // Set before the caller's variables so a project can override it, and at all because a process
    // that finds no TERM under a pty falls back to a dumb terminal and stops emitting the escapes
    // the view is there to render.
    builder.env("TERM", "xterm-256color");
    for (key, value) in env {
        builder.env(key, value);
    }

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to read from the pseudo-terminal: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to write to the pseudo-terminal: {e}"))?;

    let mut child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| format!("Failed to spawn command: {e}"))?;
    // The slave fd has to go, or the master never sees EOF when the child exits and the stream
    // hangs open forever.
    drop(pair.slave);

    let session_id = uuid::Uuid::new_v4().simple().to_string();
    let session = Arc::new(PtySession {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        pid: child.process_id(),
    });
    lock(&SESSIONS).insert(session_id.clone(), Arc::clone(&session));

    let (tx, frames) = tokio::sync::mpsc::channel::<SseFrame>(CHANNEL_CAPACITY);

    // First frame, before any output: a client has to know the encoding and the session id before it
    // can decode a `log` or answer a prompt. `try_send` on an empty channel cannot fail.
    let _ = tx.try_send(Ok(axum::response::sse::Event::default()
        .event(EVENT_META)
        .data(
            serde_json::json!({
                "encoding": LOG_ENCODING,
                "sessionId": session_id,
                "rows": DEFAULT_ROWS,
                "cols": DEFAULT_COLS,
            })
            .to_string(),
        )));

    let tx_read = tx.clone();
    let reader_task = tokio::task::spawn_blocking(move || {
        let mut buffer = vec![0u8; READ_CHUNK];
        // Once the client is gone we keep draining rather than stopping: a full pty buffer blocks
        // the child on write, and a dev server frozen mid-log is a dev server that stops serving the
        // app the preview is pointed at.
        let mut client_gone = false;

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if client_gone {
                        continue;
                    }
                    let data = base64::engine::general_purpose::STANDARD.encode(&buffer[..read]);
                    let frame = axum::response::sse::Event::default()
                        .event(EVENT_LOG)
                        .data(data);
                    if tx_read.blocking_send(Ok(frame)).is_err() {
                        client_gone = true;
                    }
                }
                // A pty master reports EIO rather than EOF when the last slave closes, so an error
                // here is the ordinary end of the stream.
                Err(_) => break,
            }
        }
    });

    let cleanup_id = session_id.clone();
    tokio::spawn(async move {
        let _ = reader_task.await;

        let status = tokio::task::spawn_blocking(move || child.wait()).await;
        let exit_message = match status {
            Ok(Ok(status)) => {
                if status.success() {
                    "Process exited with code 0".to_string()
                } else {
                    format!("Process exited with code {}", status.exit_code())
                }
            }
            Ok(Err(e)) => format!("Process wait failed: {e}"),
            Err(e) => format!("Process wait failed: {e}"),
        };

        let _ = tx
            .send(Ok(axum::response::sse::Event::default()
                .event(EVENT_END)
                .data(exit_message)))
            .await;

        // The process is gone, so the handles are useless; leaving them registered would make
        // `input` on a dead session look like a live one.
        forget_session(&cleanup_id);
    });

    Ok(PtyStream { session_id, frames })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tendril_core::models::ProjectPortConfig;

    fn project_with_ports(ports: &[(&str, u16)]) -> ProjectConfig {
        ProjectConfig {
            name: "Demo".to_string(),
            ports: ports
                .iter()
                .map(|(name, port)| {
                    (
                        name.to_string(),
                        ProjectPortConfig {
                            default_port: *port,
                            description: String::new(),
                            ..Default::default()
                        },
                    )
                })
                .collect(),
            ..Default::default()
        }
    }

    #[test]
    fn allocated_ports_win_over_configured_defaults() {
        let project = project_with_ports(&[("backend", 3001), ("frontend", 3000)]);
        let allocated = BTreeMap::from([("frontend".to_string(), 31234u16)]);

        let ports = resolve_ports(Some(&project), Some(&allocated));

        // Name order, so `backend` is primary — and the unallocated one keeps its default.
        assert_eq!(
            ports,
            vec![
                ("backend".to_string(), 3001),
                ("frontend".to_string(), 31234)
            ]
        );
    }

    #[test]
    fn a_port_the_project_no_longer_configures_is_still_honoured() {
        let project = project_with_ports(&[("backend", 3001)]);
        let allocated = BTreeMap::from([
            ("backend".to_string(), 30001u16),
            ("legacy".to_string(), 30099u16),
        ]);

        let ports = resolve_ports(Some(&project), Some(&allocated));

        assert_eq!(
            ports,
            vec![
                ("backend".to_string(), 30001),
                ("legacy".to_string(), 30099)
            ],
            "a retired port name must keep working while the worktree that uses it exists"
        );
    }

    #[test]
    fn a_zero_default_with_no_allocation_contributes_nothing() {
        let project = project_with_ports(&[("unset", 0)]);
        assert!(resolve_ports(Some(&project), None).is_empty());
    }

    #[test]
    fn interpolate_command_resolves_named_and_primary_ports() {
        let ports = vec![
            ("backend".to_string(), 3001u16),
            ("frontend".to_string(), 5173u16),
        ];

        assert_eq!(
            interpolate_command("vite --port ${ports.frontend} --api %PORT%", &ports),
            "vite --port 5173 --api 3001"
        );
    }

    #[test]
    fn interpolate_command_leaves_an_unknown_name_as_written() {
        let ports = vec![("backend".to_string(), 3001u16)];
        assert_eq!(
            interpolate_command("serve ${ports.nope}", &ports),
            "serve ${ports.nope}",
            "an unknown port name must stay visible rather than becoming an empty string"
        );
    }

    #[test]
    fn interpolate_command_is_a_no_op_without_ports() {
        assert_eq!(
            interpolate_command("serve %PORT%", &[]),
            "serve %PORT%",
            "with nothing allocated there is no port to substitute"
        );
    }

    #[test]
    fn interpolate_command_survives_multibyte_input() {
        let ports = vec![("web".to_string(), 8080u16)];
        assert_eq!(
            interpolate_command("echo “héllo” && serve %PORT%", &ports),
            "echo “héllo” && serve 8080"
        );
    }

    #[test]
    fn build_environment_names_every_port_and_the_primary() {
        let ports = vec![
            ("backend".to_string(), 3001u16),
            ("web-api".to_string(), 3002u16),
        ];

        let env = build_environment(&ports, None, Some("Demo"));

        assert!(env.contains(&("PORT_BACKEND".to_string(), "3001".to_string())));
        assert!(env.contains(&("PORT_WEB_API".to_string(), "3002".to_string())));
        assert!(env.contains(&("PORT".to_string(), "3001".to_string())));
        assert!(env.contains(&("PROJECT_NAME".to_string(), "Demo".to_string())));
        assert!(
            !env.iter().any(|(key, _)| key == "PLAN_ID"),
            "a project-scoped action has no plan to identify"
        );
    }

    #[test]
    fn build_environment_omits_worktree_dir_when_there_is_no_worktree() {
        let folder =
            std::env::temp_dir().join(format!("tendril-pty-env-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&folder).unwrap();

        let repos = vec!["/nowhere/Demo".to_string()];
        let plan = PlanEnvContext {
            plan_id: "00636",
            plan_folder: &folder,
            project: "Demo",
            repos: &repos,
        };

        let env = build_environment(&[], Some(&plan), None);

        assert!(env.contains(&("PLAN_ID".to_string(), "00636".to_string())));
        assert!(env.contains(&("PROJECT_NAME".to_string(), "Demo".to_string())));
        assert!(!env.iter().any(|(key, _)| key == "WORKTREE_DIR"));

        // Now give it one to find.
        let worktree = folder.join("Worktrees").join("Demo");
        std::fs::create_dir_all(&worktree).unwrap();
        let env = build_environment(&[], Some(&plan), None);
        assert!(env.contains(&(
            "WORKTREE_DIR".to_string(),
            worktree.to_string_lossy().to_string()
        )));

        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn an_unknown_session_id_has_no_handle() {
        assert!(session("not-a-session").is_none());
    }
}
