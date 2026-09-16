//! The active full-access tunnel, recorded in `$TENDRIL_HOME/.full-tunnel.json`.
//!
//! Deliberately a *different* file and a *different* shape from [`super::share_state`], because the two
//! tunnels mean opposite things and conflating their records would be a security bug:
//!
//! - A share record grants something. It carries a capability token, and `auth_middleware` accepts that
//!   token — narrowly — for a request addressed to the recorded host. Writing a share record for a
//!   full-access tunnel would mint a capability nobody asked for.
//! - A full-access record grants nothing. It has no token, because a full-access tunnel publishes the
//!   *authenticated* API and the credential is the operator's password (or the bearer secret), never the
//!   tunnel itself. The record exists only so the daemon can answer two questions: "did this request
//!   arrive over my public tunnel?" and "is there a cloudflared from a previous daemon still running?".
//!
//! The direction that matters most: `share_exposure::arrived_over_share` must stay `false` for a
//! full-access tunnel's host. `/api/auth/login` is refused over a *share* — a reviewer has no business
//! logging in — but it is the only way to use a full-access tunnel at all, so refusing it there would
//! publish a daemon nobody could authenticate to. That distinction is exactly why this is not the same
//! file.
//!
//! No secret is stored here, so unlike `.share-tunnel.json` this file does not need `0o600` to be safe —
//! it is written with the same restriction anyway, because a file naming a public hostname the daemon
//! answers on is not something to leave world-readable either.
//!
//! # What this host is *not* added to
//!
//! `tendril_server::local_file_guard` feeds a share's host to
//! [`crate::security::host_policy::is_allowed_host`], so that a plan's images load for a reviewer. A
//! full-access tunnel's host is deliberately **not** fed to it. `/ivy/local-file` reads arbitrary files
//! from the configured roots and sits outside `auth_middleware` (an `<img src>` carries no
//! `Authorization` header); its own guard supplies a `?token=` check plus origin, `Sec-Fetch-Site`,
//! extension and root confinement. Widening its host allow-list is the one change here that would make
//! that guard's job harder, and a full-access tunnel's consumers — the CLI, the extension, another app
//! instance — reach files through `/api` rather than through it. The cost is that plan images do not load
//! for a browser pointed at a full-access tunnel; the alternative is loosening a file-serving guard for a
//! host on the public internet, which is the wrong trade.

use super::TunnelError;
use std::path::{Path, PathBuf};

/// Name of the state file, alongside `.master` and `.share-tunnel.json`.
pub const FULL_SESSION_FILE: &str = ".full-tunnel.json";

/// A full-access tunnel that is (or was) live. No token: see the module docs.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct FullTunnelSession {
    /// The public base URL, e.g. `https://calm-otter.trycloudflare.com`.
    pub url: String,
    /// [`Self::url`]'s host, lowercased — what the tunnel-host comparisons use. Stored rather than
    /// re-derived so a reader never has to parse a URL to make a decision.
    pub host: String,
    /// The cloudflared pid, for [`reap_orphan`].
    pub pid: u32,
    /// RFC3339, for display and for age-based diagnostics.
    #[serde(rename = "startedAt", alias = "started_at", default)]
    pub started_at: String,
}

pub fn state_path(tendril_home: &Path) -> PathBuf {
    tendril_home.join(FULL_SESSION_FILE)
}

/// The recorded tunnel, or `None` when there is none or it cannot be parsed.
///
/// Never an error, and a record with no host reads as `None`: the one decision this drives is "refuse
/// the unauthenticated surface for this host", and a record that cannot name a host must not be able to
/// refuse an empty `Host` header.
pub fn read(tendril_home: &Path) -> Option<FullTunnelSession> {
    let content = std::fs::read_to_string(state_path(tendril_home)).ok()?;
    let session: FullTunnelSession = serde_json::from_str(&content).ok()?;
    if session.host.trim().is_empty() {
        return None;
    }
    Some(session)
}

/// Records `session`, replacing any previous one.
pub fn write(tendril_home: &Path, session: &FullTunnelSession) -> Result<(), TunnelError> {
    let path = state_path(tendril_home);
    let json =
        serde_json::to_string_pretty(session).map_err(|err| TunnelError::State(err.to_string()))?;
    crate::fs_lock::write_atomic(&path, json.as_bytes())
        .map_err(|err| TunnelError::State(err.to_string()))?;
    restrict_permissions(&path);
    Ok(())
}

/// Removes the record. Called on every stop path, including the failure ones.
pub fn clear(tendril_home: &Path) {
    let path = state_path(tendril_home);
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => tracing::warn!("Could not remove {}: {err}", path.display()),
    }
}

/// The host an active full-access tunnel is reachable on.
pub fn active_host(tendril_home: &Path) -> Option<String> {
    read(tendril_home).map(|session| session.host)
}

/// Kills a `cloudflared` left behind by a daemon that died without cleaning up, then clears the record.
///
/// Delegates the pid-reuse guards to [`super::share_state::reap_orphan_pid`] so there is one
/// implementation of "is this pid really cloudflared".
pub fn reap_orphan(tendril_home: &Path) -> Option<u32> {
    let session = read(tendril_home)?;
    let killed = super::share_state::reap_orphan_pid(session.pid, &session.url);
    clear(tendril_home);
    killed
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
                "tendril-full-state-{label}-{}",
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

    fn session() -> FullTunnelSession {
        FullTunnelSession {
            url: "https://calm-otter.trycloudflare.com".to_string(),
            host: "calm-otter.trycloudflare.com".to_string(),
            pid: 0,
            started_at: "2026-09-16T10:00:00Z".to_string(),
        }
    }

    #[test]
    fn nothing_is_active_before_a_tunnel_starts() {
        let home = Home::new("empty");
        assert!(read(&home.0).is_none());
        assert!(active_host(&home.0).is_none());
    }

    #[test]
    fn a_written_record_round_trips_and_clears() {
        let home = Home::new("roundtrip");
        write(&home.0, &session()).expect("write state");
        assert_eq!(read(&home.0), Some(session()));
        assert_eq!(
            active_host(&home.0).as_deref(),
            Some("calm-otter.trycloudflare.com")
        );

        clear(&home.0);
        assert!(read(&home.0).is_none());
        // Clearing twice is not an error.
        clear(&home.0);
    }

    /// The two records must never be readable as each other: a full-access tunnel that registered
    /// itself as a share would mint a capability token and would get `/api/auth/login` refused.
    #[test]
    fn a_full_access_record_is_not_a_share_record() {
        let home = Home::new("not-a-share");
        write(&home.0, &session()).expect("write state");
        assert!(
            super::super::share_state::read(&home.0).is_none(),
            "a full-access tunnel is not a share"
        );
        assert!(super::super::share_state::active_host(&home.0).is_none());
        assert!(!super::super::share_state::accepts_token(&home.0, ""));
        assert_ne!(
            state_path(&home.0),
            super::super::share_state::state_path(&home.0)
        );
    }

    #[test]
    fn a_corrupt_or_hostless_record_reads_as_nothing() {
        let home = Home::new("corrupt");
        std::fs::write(state_path(&home.0), b"{ not json").unwrap();
        assert!(read(&home.0).is_none());

        std::fs::write(
            state_path(&home.0),
            br#"{"url":"https://x.trycloudflare.com","host":"","pid":0}"#,
        )
        .unwrap();
        assert!(
            read(&home.0).is_none(),
            "a record with no host names nobody"
        );
    }

    #[test]
    fn reaping_a_stale_record_kills_nothing_and_clears_it() {
        let home = Home::new("reap-stale");
        write(&home.0, &session()).expect("write state");
        assert_eq!(reap_orphan(&home.0), None, "pid 0 can never be signalled");
        assert!(read(&home.0).is_none(), "the stale record is gone");
    }

    #[cfg(unix)]
    #[test]
    fn the_state_file_is_not_world_readable() {
        use std::os::unix::fs::PermissionsExt;
        let home = Home::new("perms");
        write(&home.0, &session()).expect("write state");
        let mode = std::fs::metadata(state_path(&home.0))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(
            mode & 0o077,
            0,
            "mode {mode:o} is wider than it needs to be"
        );
    }
}
