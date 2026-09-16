//! The active share, recorded in `$TENDRIL_HOME/.share-tunnel.json`.
//!
//! This file is the *observable* half of a share, and it exists for three reasons the in-memory
//! service cannot cover:
//!
//! 1. **The local-file guard needs the tunnel host.** In the original, `LocalFileGuardMiddleware`
//!    takes `IShareTunnelService` from DI and asks it. V2's guard is a middleware over
//!    `Arc<AppState>`, and the share tunnel is not (and should not become) a field on it, so the guard
//!    reads the same fact from disk. It is only read for a request whose `Host` was *not* already
//!    allowed, so a loopback request pays nothing for it.
//! 2. **Orphan recovery.** A daemon that was `SIGKILL`ed leaves cloudflared running. The recorded pid
//!    is what lets the next start kill it — see [`reap_orphan`]. The original had no equivalent on
//!    macOS or Linux.
//! 3. **Test isolation.** State keyed by `TENDRIL_HOME` rather than held in a process-global means two
//!    tests in one binary cannot see each other's tunnels.
//!
//! The file contains a **capability token**, so it is written `0o600` and lives beside `.master`,
//! which holds the bearer secret under the same assumption: the Tendril home is the trust boundary.

use super::TunnelError;
use std::path::{Path, PathBuf};

/// Name of the state file, alongside `.master`.
pub const SHARE_SESSION_FILE: &str = ".share-tunnel.json";

/// A share that is (or was) live.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ShareSession {
    /// The public base URL, e.g. `https://calm-otter.trycloudflare.com`.
    pub url: String,
    /// [`Self::url`]'s host, lowercased — what the host allowlist compares against. Stored rather
    /// than re-derived so a reader never has to parse a URL to make an authorisation decision.
    pub host: String,
    /// The visitor's capability token. See [`crate::share::policy`] for what it may and may not do.
    pub token: String,
    /// The cloudflared pid, for [`reap_orphan`].
    pub pid: u32,
    /// RFC3339, for display and for age-based diagnostics.
    #[serde(rename = "startedAt", alias = "started_at", default)]
    pub started_at: String,
}

pub fn state_path(tendril_home: &Path) -> PathBuf {
    tendril_home.join(SHARE_SESSION_FILE)
}

/// The recorded share, or `None` when there is none or it cannot be parsed. Never an error: an
/// unreadable state file must fail *closed* (no tunnel host is allowed, no token is accepted), not
/// break the local-file endpoint.
pub fn read(tendril_home: &Path) -> Option<ShareSession> {
    let content = std::fs::read_to_string(state_path(tendril_home)).ok()?;
    let session: ShareSession = serde_json::from_str(&content).ok()?;
    if session.host.trim().is_empty() || session.token.trim().is_empty() {
        // A half-written record grants nothing.
        return None;
    }
    Some(session)
}

/// Records `session`, replacing any previous one.
pub fn write(tendril_home: &Path, session: &ShareSession) -> Result<(), TunnelError> {
    let path = state_path(tendril_home);
    let json =
        serde_json::to_string_pretty(session).map_err(|err| TunnelError::State(err.to_string()))?;
    crate::fs_lock::write_atomic(&path, json.as_bytes())
        .map_err(|err| TunnelError::State(err.to_string()))?;
    restrict_permissions(&path);
    Ok(())
}

/// Removes the record. A share that is not running must not leave a token behind that the guard would
/// keep accepting, so this is called on every stop path including the failure ones.
pub fn clear(tendril_home: &Path) {
    let path = state_path(tendril_home);
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => tracing::warn!("Could not remove {}: {err}", path.display()),
    }
}

/// The host an active share is reachable on. Fed to
/// [`crate::security::host_policy::is_allowed_host`] as its `tunnel_host`.
pub fn active_host(tendril_home: &Path) -> Option<String> {
    read(tendril_home).map(|session| session.host)
}

/// Whether `token` is the active share's capability token.
///
/// Returns `false` when there is no active share, so stopping a share revokes every link that was
/// handed out — the token is not a signed bearer, it is a row in a file, and deleting the row is the
/// revocation.
pub fn accepts_token(tendril_home: &Path, token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    match read(tendril_home) {
        Some(session) => tokens_match(&session.token, token),
        None => false,
    }
}

/// A fresh capability token: 32 bytes of OS randomness, hex, exactly as
/// [`crate::config::generate_bearer_secret`] mints the daemon's own secret.
pub fn mint_token() -> String {
    crate::config::generate_bearer_secret()
}

/// Length-checked, non-early-returning comparison, so a caller cannot walk the token out by timing.
/// The same shape as `tendril_server::auth::secrets_match`, duplicated rather than depended on
/// because the dependency runs the wrong way.
pub fn tokens_match(expected: &str, presented: &str) -> bool {
    let (a, b) = (expected.as_bytes(), presented.as_bytes());
    if a.is_empty() || a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Kills a `cloudflared` left behind by a daemon that died without cleaning up, then clears the
/// record. Called before starting a new share.
///
/// Two guards against killing the wrong process, because pids are reused:
///
/// - the pid must still be running, and
/// - on unix, its command name must actually look like cloudflared.
///
/// If either check fails the process is left alone and only the stale record is removed. Returns the
/// pid that was killed, for logging and for the tests.
pub fn reap_orphan(tendril_home: &Path) -> Option<u32> {
    let session = read(tendril_home)?;
    let pid = session.pid;
    let killed =
        if pid != 0 && crate::config::is_process_running(pid) && looks_like_cloudflared(pid) {
            tracing::warn!(
                "Killing a cloudflared left behind by a previous daemon (pid {pid}, {})",
                session.url
            );
            crate::jobs::process_tree::kill_tree(pid, std::time::Duration::from_secs(3));
            Some(pid)
        } else {
            None
        };
    clear(tendril_home);
    killed
}

/// Whether `pid` is executing something called cloudflared. `ps` is used rather than a new
/// dependency, the same choice [`crate::config::process_start_token`] makes.
///
/// Both `comm` and the head of `command` are consulted, because they disagree in the case that matters
/// for testing: for a wrapper script, `comm` is the *interpreter* (`sh`) and the script's own path only
/// appears in `command`. Only the first two words of `command` are examined — the executable and, for a
/// script, the script — so a process that merely mentions cloudflared in an argument is not a match.
#[cfg(unix)]
fn looks_like_cloudflared(pid: u32) -> bool {
    ps_field(pid, "comm=").is_some_and(|comm| comm.contains("cloudflared"))
        || ps_field(pid, "command=").is_some_and(|command| {
            command
                .split_whitespace()
                .take(2)
                .any(|word| word.contains("cloudflared"))
        })
}

#[cfg(unix)]
fn ps_field(pid: u32, field: &str) -> Option<String> {
    let output = std::process::Command::new("ps")
        .args(["-o", field, "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_ascii_lowercase();
    (!text.is_empty()).then_some(text)
}

/// Windows has no cheap command-name lookup here (`tasklist` reports the image name, but the check
/// would need a second shell-out with different parsing), so the orphan is not killed on the pid
/// alone. `kill_on_drop` plus the explicit stop cover every case except a killed daemon, which is
/// where this leaves a warning rather than risking an unrelated process.
#[cfg(not(unix))]
fn looks_like_cloudflared(pid: u32) -> bool {
    tracing::warn!(
        "A previous share tunnel (pid {pid}) may still be running; it cannot be verified on this \
platform and has been left alone. Stop it manually if it is still up."
    );
    false
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Err(err) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)) {
        tracing::warn!(
            "Could not restrict permissions on {}: {err}",
            path.display()
        );
    }
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    struct Home(PathBuf);

    impl Home {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "tendril-share-state-{label}-{}",
                uuid::Uuid::new_v4().simple()
            ));
            std::fs::create_dir_all(&path).expect("create fixture home");
            Self(path)
        }
    }

    impl Drop for Home {
        fn drop(&mut self) {
            assert!(self.0.starts_with(std::env::temp_dir()));
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn session(token: &str) -> ShareSession {
        ShareSession {
            url: "https://calm-otter.trycloudflare.com".to_string(),
            host: "calm-otter.trycloudflare.com".to_string(),
            token: token.to_string(),
            pid: 0,
            started_at: "2026-09-16T10:00:00Z".to_string(),
        }
    }

    #[test]
    fn nothing_is_active_before_a_share_starts() {
        let home = Home::new("empty");
        assert!(read(&home.0).is_none());
        assert!(active_host(&home.0).is_none());
        assert!(!accepts_token(&home.0, "anything"));
    }

    #[test]
    fn a_written_share_is_readable_and_its_token_is_accepted() {
        let home = Home::new("roundtrip");
        let token = mint_token();
        write(&home.0, &session(&token)).expect("write state");

        let read_back = read(&home.0).expect("state is readable");
        assert_eq!(read_back.host, "calm-otter.trycloudflare.com");
        assert_eq!(
            active_host(&home.0).as_deref(),
            Some("calm-otter.trycloudflare.com")
        );
        assert!(accepts_token(&home.0, &token));
        assert!(!accepts_token(&home.0, "not-the-token"));
        assert!(
            !accepts_token(&home.0, ""),
            "an empty token is never accepted"
        );
    }

    /// Stopping a share has to revoke the link, and the only thing standing between a stopped share
    /// and a visitor who still has the URL is this record being gone.
    #[test]
    fn clearing_the_record_revokes_the_token_and_the_host() {
        let home = Home::new("revoke");
        let token = mint_token();
        write(&home.0, &session(&token)).expect("write state");
        assert!(accepts_token(&home.0, &token));

        clear(&home.0);
        assert!(!accepts_token(&home.0, &token));
        assert!(active_host(&home.0).is_none());
        // Clearing twice is not an error.
        clear(&home.0);
    }

    #[test]
    fn a_corrupt_or_half_written_record_grants_nothing() {
        let home = Home::new("corrupt");

        std::fs::write(state_path(&home.0), b"{ not json").unwrap();
        assert!(read(&home.0).is_none());
        assert!(!accepts_token(&home.0, "x"));

        std::fs::write(
            state_path(&home.0),
            br#"{"url":"https://x.trycloudflare.com","host":"","token":"","pid":0}"#,
        )
        .unwrap();
        assert!(
            read(&home.0).is_none(),
            "an empty host/token is not a share"
        );
    }

    #[test]
    fn tokens_are_compared_without_matching_a_prefix_or_an_empty_secret() {
        assert!(tokens_match("abcdef", "abcdef"));
        assert!(!tokens_match("abcdef", "abcde"));
        assert!(!tokens_match("abcdef", "abcdefg"));
        assert!(
            !tokens_match("", ""),
            "an empty expected token matches nothing"
        );
        assert!(!tokens_match("abcdef", ""));
    }

    #[test]
    fn a_minted_token_is_long_and_unguessable() {
        let token = mint_token();
        assert_eq!(token.len(), 64, "32 random bytes, hex");
        assert_ne!(token, mint_token());
    }

    #[cfg(unix)]
    #[test]
    fn the_state_file_is_not_world_readable() {
        use std::os::unix::fs::PermissionsExt;
        let home = Home::new("perms");
        write(&home.0, &session(&mint_token())).expect("write state");
        let mode = std::fs::metadata(state_path(&home.0))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0, "mode {mode:o} exposes a capability token");
    }

    /// A stale record whose pid is not a live cloudflared must be cleared without signalling anything.
    #[test]
    fn reaping_a_stale_record_kills_nothing_and_clears_it() {
        let home = Home::new("reap-stale");
        // pid 0 can never be signalled, and `is_process_running` refuses it outright.
        write(&home.0, &session(&mint_token())).expect("write state");
        assert_eq!(reap_orphan(&home.0), None);
        assert!(read(&home.0).is_none(), "the stale record is gone");
    }

    /// pid 1 is alive on every unix but is not cloudflared: the command-name guard is the only thing
    /// stopping `reap_orphan` from signalling it.
    #[cfg(unix)]
    #[test]
    fn reaping_refuses_a_live_pid_that_is_not_cloudflared() {
        let home = Home::new("reap-wrong-pid");
        let mut stale = session(&mint_token());
        stale.pid = 1;
        write(&home.0, &stale).expect("write state");

        assert_eq!(reap_orphan(&home.0), None, "pid 1 must not be signalled");
        assert!(crate::config::is_process_running(1), "pid 1 is still alive");
        assert!(read(&home.0).is_none());
    }
}
