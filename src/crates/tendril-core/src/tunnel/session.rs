//! One `cloudflared tunnel` child process — a port of `Services/Tunnel/TunnelSession.cs`, and of
//! `Services/Tunnel/ChildProcessTracker.cs`'s guarantee that it cannot outlive us.
//!
//! # Not leaking the child
//!
//! A leaked `cloudflared` is worse than a failed share: it keeps publishing this machine on a URL
//! nobody is looking at any more. Four layers, because each one covers a case the others do not:
//!
//! 1. **Its own process group.** Spawned with `process_group(0)`, the same idiom
//!    `agents::runner` uses, so [`crate::jobs::process_tree::kill_tree`] signals the whole tree
//!    rather than just the launcher.
//! 2. **[`Drop`].** Dropping a `TunnelSession` kills it. This is what makes a cancelled or panicking
//!    supervisor task safe: the session is owned by the task, so unwinding takes the process with it.
//! 3. **A pid file.** [`super::share_state`] records the pid, so a daemon that was `SIGKILL`ed —
//!    where no `Drop` and no shutdown hook runs — kills the orphan on its next start instead of
//!    leaving it running for days. The original's `ChildProcessTracker` only ever covered this case
//!    on Windows (a job object with `KILL_ON_JOB_CLOSE`); on macOS and Linux it had nothing.
//! 4. **`kill_on_drop`** on the tokio child, so the runtime reaps the zombie after the signal.

use super::TunnelError;
use crate::jobs::process_tree::kill_tree;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::watch;

/// How many lines of cloudflared output to keep for the "it never printed a URL" error. The original
/// keeps 20 and quotes the last 3.
const RECENT_LOG_CAPACITY: usize = 20;
const RECENT_LOG_QUOTED: usize = 3;

/// Grace given to a `SIGTERM` before `SIGKILL`, matching [`crate::jobs::process_tree`]'s default.
const KILL_GRACE: Duration = Duration::from_secs(3);

/// How the session is launched. Separate from the config block so tests can shrink the timeouts
/// without writing a `config.yaml`.
#[derive(Debug, Clone)]
pub struct SessionOptions {
    pub binary_path: PathBuf,
    /// What cloudflared publishes, e.g. `http://127.0.0.1:5010`.
    pub origin_url: String,
    /// How long to wait for the `https://<name>.trycloudflare.com` line. The original's 60s.
    pub url_timeout: Duration,
    /// How long to wait for a "Registered tunnel connection" line after the URL appears. The
    /// original's 6s, and a timeout here is not an error: the health probe is the real gate.
    pub registered_grace: Duration,
}

impl SessionOptions {
    pub fn new(binary_path: PathBuf, origin_url: impl Into<String>) -> Self {
        Self {
            binary_path,
            origin_url: origin_url.into(),
            url_timeout: Duration::from_secs(60),
            registered_grace: Duration::from_secs(6),
        }
    }
}

/// A running `cloudflared`, plus what it told us about itself.
pub struct TunnelSession {
    child: Option<Child>,
    pid: u32,
    url: String,
    registered: Arc<AtomicBool>,
    recent: Arc<Mutex<Vec<String>>>,
}

impl TunnelSession {
    /// Starts cloudflared and resolves once it has printed its public URL.
    ///
    /// Port of `TunnelSession.StartAsync`, including the argument list
    /// (`tunnel --protocol http2 --url <origin>`, plus `--no-tls-verify` for an https origin, because
    /// a daemon started with `--tls-cert` is serving a self-signed certificate cloudflared has no
    /// reason to trust).
    pub async fn start(options: SessionOptions) -> Result<Self, TunnelError> {
        let mut cmd = Command::new(&options.binary_path);
        cmd.arg("tunnel")
            .arg("--protocol")
            .arg("http2")
            .arg("--url")
            .arg(&options.origin_url);
        if options
            .origin_url
            .to_ascii_lowercase()
            .starts_with("https://")
        {
            cmd.arg("--no-tls-verify");
        }
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            // Reaps the zombie once the tree has been signalled. Not a substitute for the explicit
            // kill: `kill_on_drop` alone would leave grandchildren behind.
            .kill_on_drop(true);

        // Its own process group, so `kill_tree` can signal the whole tree. Same idiom as
        // `agents::runner::run_agent_process_inner`.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.as_std_mut().process_group(0);
        }

        let mut child = cmd.spawn().map_err(|source| TunnelError::Spawn {
            binary: options.binary_path.clone(),
            source,
        })?;

        // A pid of 0 would make `kill_tree` a no-op and the pid file a lie, so it is a hard failure.
        let pid = child.id().unwrap_or(0);
        if pid == 0 {
            let _ = child.start_kill();
            return Err(TunnelError::Spawn {
                binary: options.binary_path.clone(),
                source: std::io::Error::other("the process exited before its pid could be read"),
            });
        }

        let registered = Arc::new(AtomicBool::new(false));
        let recent = Arc::new(Mutex::new(Vec::new()));
        // `watch` rather than a oneshot: cloudflared prints the URL on stderr, but the original reads
        // both streams for it, so two tasks race to publish and only the first result matters.
        let (url_tx, mut url_rx) = watch::channel(None::<String>);
        let url_tx = Arc::new(url_tx);

        if let Some(stdout) = child.stdout.take() {
            spawn_reader(stdout, registered.clone(), recent.clone(), url_tx.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_reader(stderr, registered.clone(), recent.clone(), url_tx.clone());
        }
        // The readers are now the only senders, which is what makes "every sender gone" mean "both
        // streams hit EOF", i.e. cloudflared exited. Holding this clone here would instead make the
        // wait below run to its full timeout for a binary that died in a second.
        drop(url_tx);

        // Partially-constructed but already owning the child, so every early return from here on
        // kills it through `Drop` rather than leaking it.
        let mut session = Self {
            child: Some(child),
            pid,
            url: String::new(),
            registered: registered.clone(),
            recent: recent.clone(),
        };

        let url = tokio::time::timeout(options.url_timeout, async {
            loop {
                if let Some(url) = url_rx.borrow_and_update().clone() {
                    return Some(url);
                }
                if url_rx.changed().await.is_err() {
                    // Every reader is gone: the process closed both streams, i.e. it exited. Read the
                    // value one last time — a URL printed immediately before exit is still a URL.
                    return url_rx.borrow().clone();
                }
            }
        })
        .await;

        let url = match url {
            Ok(Some(url)) => url,
            // Either the timeout fired or cloudflared exited without printing a URL. The original
            // reports both the same way, quoting the tail of its output, which is the only thing that
            // distinguishes "binary is too old" from "network is blocked" in practice.
            Ok(None) | Err(_) => {
                return Err(TunnelError::NoUrl {
                    seconds: options.url_timeout.as_secs(),
                    recent: quote_recent(&recent),
                })
            }
        };

        session.url = url;

        // Best-effort: a registered edge connection means the health probe's failures are DNS
        // propagation rather than a dead tunnel, which is what lets it stop waiting early.
        let _ = tokio::time::timeout(options.registered_grace, async {
            while !registered.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await;

        tracing::info!("Share tunnel established: {}", session.url);
        Ok(session)
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Whether cloudflared has logged a registered edge connection.
    pub fn is_registered(&self) -> bool {
        self.registered.load(Ordering::Relaxed)
    }

    pub fn recent_logs(&self) -> Vec<String> {
        self.recent
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Resolves when cloudflared exits. Port of `WaitForExitAsync`.
    pub async fn wait_for_exit(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.wait().await;
        }
    }

    /// Kills the process tree. Idempotent, and safe to call from [`Drop`].
    ///
    /// `kill_tree` blocks for up to [`KILL_GRACE`] between `SIGTERM` and `SIGKILL`. That is
    /// deliberate here rather than moved to `spawn_blocking` the way `agents::runner` does it: the
    /// only callers are `stop`/`Drop`, one process is being signalled, and a `Drop` cannot await.
    pub fn stop(&mut self) {
        if self.pid != 0 {
            kill_tree(self.pid, KILL_GRACE);
        }
        if let Some(child) = self.child.as_mut() {
            let _ = child.start_kill();
        }
    }
}

impl Drop for TunnelSession {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Hand-written rather than derived so a `{:?}` — in a log line, or in a test assertion message —
/// prints the tunnel's identity and not its whole captured output.
impl std::fmt::Debug for TunnelSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TunnelSession")
            .field("pid", &self.pid)
            .field("url", &self.url)
            .field("registered", &self.is_registered())
            .finish()
    }
}

fn spawn_reader<R>(
    stream: R,
    registered: Arc<AtomicBool>,
    recent: Arc<Mutex<Vec<String>>>,
    url_tx: Arc<watch::Sender<Option<String>>>,
) where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(stream).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::debug!("[cloudflared] {line}");

            {
                let mut buffer = recent
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if buffer.len() >= RECENT_LOG_CAPACITY {
                    buffer.remove(0);
                }
                buffer.push(line.clone());
            }

            if is_registered_line(&line) {
                registered.store(true, Ordering::Relaxed);
            }

            if let Some(url) = parse_tunnel_url(&line) {
                // Only the first URL counts: cloudflared repeats it, and a later line must not
                // replace a URL the supervisor is already probing.
                if url_tx.borrow().is_none() {
                    let _ = url_tx.send(Some(url));
                }
            }
        }
    });
}

fn quote_recent(recent: &Arc<Mutex<Vec<String>>>) -> String {
    let buffer = recent
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if buffer.is_empty() {
        return "no output received from cloudflared".to_string();
    }
    let start = buffer.len().saturating_sub(RECENT_LOG_QUOTED);
    buffer[start..].join(" | ")
}

/// Port of the two substrings the original watches for.
pub fn is_registered_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("registered tunnel connection") || lower.contains("connection registered")
}

/// Port of `TunnelSession.ParseTunnelUrl`.
///
/// `https://api.trycloudflare.com` is excluded because cloudflared logs it as the *API endpoint it
/// called*, several lines before the tunnel hostname it was given. Treating it as the tunnel URL
/// would publish a share link pointing at Cloudflare's own API.
pub fn parse_tunnel_url(line: &str) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    let start = lower.find("https://")?;
    // Scan forward over the URL's host characters only; cloudflared wraps the URL in box-drawing
    // characters, so anything outside `[a-z0-9.-]` ends it.
    let tail = &lower[start + "https://".len()..];
    let host_len = tail
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '.'))
        .unwrap_or(tail.len());
    let host = &tail[..host_len];

    let name = host.strip_suffix(".trycloudflare.com")?;
    // A single label, no dots: `foo.bar.trycloudflare.com` is not a quick tunnel hostname.
    if name.is_empty() || name.contains('.') || name == "api" {
        return None;
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    Some(format!("https://{host}"))
}

/// The host part of a tunnel URL, which is what the host allowlist compares against.
pub fn host_of(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split(['/', ':', '?', '#']).next()?;
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_quick_tunnel_url_out_of_a_decorated_log_line() {
        let line =
            "2026-09-16T10:00:00Z INF |  https://calm-otter-reads-plans.trycloudflare.com  |";
        assert_eq!(
            parse_tunnel_url(line).as_deref(),
            Some("https://calm-otter-reads-plans.trycloudflare.com")
        );
    }

    /// The one exclusion the original makes, and the reason it exists.
    #[test]
    fn does_not_mistake_the_api_endpoint_for_the_tunnel() {
        assert_eq!(
            parse_tunnel_url("requesting new quick tunnel on trycloudflare.com..."),
            None
        );
        assert_eq!(
            parse_tunnel_url("POST https://api.trycloudflare.com/tunnel"),
            None
        );
        assert_eq!(parse_tunnel_url("https://API.trycloudflare.com"), None);
    }

    #[test]
    fn ignores_urls_that_are_not_quick_tunnels() {
        for line in [
            "https://dash.cloudflare.com/argotunnel",
            "https://example.com",
            "no url here at all",
            "https://.trycloudflare.com",
            "https://a.b.trycloudflare.com",
            "https://evil.trycloudflare.com.attacker.test",
        ] {
            assert_eq!(parse_tunnel_url(line), None, "{line} must not parse");
        }
    }

    #[test]
    fn recognises_both_registration_lines() {
        assert!(is_registered_line(
            "INF Registered tunnel connection connIndex=0"
        ));
        assert!(is_registered_line("Connection registered connIndex=1"));
        assert!(!is_registered_line("INF Starting tunnel"));
    }

    #[test]
    fn host_of_strips_scheme_port_and_path() {
        assert_eq!(
            host_of("https://calm-otter.trycloudflare.com/review?share=1").as_deref(),
            Some("calm-otter.trycloudflare.com")
        );
        assert_eq!(
            host_of("http://127.0.0.1:5010").as_deref(),
            Some("127.0.0.1")
        );
        assert_eq!(host_of("not a url"), None);
        assert_eq!(host_of("https://"), None);
    }
}
