//! [`MasterGuard`] — the mastership election itself: claiming `.master`, judging somebody else's
//! claim, and re-asserting or standing down while the daemon runs.

use super::home::ensure_not_real_home;
use super::master_file::{
    delete_master, delete_master_if_pid, inspect_master_file, read_master, read_master_claim,
    read_master_claim_settled, try_claim_master, write_master_claim, MasterFileKind,
};
use super::master_info::{heartbeat_now, MasterClaim, MASTER_SCHEMA_VERSION};
use super::process::{is_process_running, probe_health_with_retries, HEALTH_PROBE_ATTEMPTS};
use crate::error::{Result, TendrilError};
use std::path::{Path, PathBuf};

pub struct MasterGuard {
    tendril_home: PathBuf,
    pid: u32,
    /// What this process wrote, so it can be republished with the bound port or re-asserted after
    /// something deleted it. Behind a `Mutex` so the guard can live in an `Arc` and be beaten on
    /// from a background task while `run_server` holds it for the process lifetime.
    claim: std::sync::Mutex<MasterClaim>,
}

/// What [`MasterGuard::check_and_reassert`] found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MasterCheck {
    /// The claim is ours and unchanged. Nothing was written.
    Intact,
    /// The file is there but is not a claim this build can read. Left exactly as found: it cannot be
    /// attributed to anybody, so neither re-asserting over it nor deleting it is defensible.
    Foreign,
    /// The claim had gone (deleted by a repair tool, a `tendril reset`, or a stale sweep) or was held
    /// by a pid that is no longer running, and has been rewritten in this process's name.
    Reasserted,
    /// Another live process holds the claim. This process is no longer the master and must not
    /// re-take it: that is the collision the election exists to prevent.
    Superseded { pid: u32 },
}

fn master_takeover_allowed() -> bool {
    std::env::var("TENDRIL_ALLOW_MASTER_TAKEOVER").as_deref() == Ok("1")
}

/// How many times [`MasterGuard::acquire`] will re-try the exclusive create after clearing a claim it
/// proved stale. More than one because clearing and re-creating is not one atomic step: a sibling can
/// win the gap, and then the loser has to inspect *its* claim rather than assume the file is free.
const MASTER_CLAIM_ATTEMPTS: u32 = 3;

impl MasterGuard {
    /// Claims mastership of `tendril_home`, or fails.
    ///
    /// Call this **before** binding the port: the claim is what serialises two daemons against one
    /// home, so announcing a bound port before holding it is how both of them end up running the
    /// master-only subsystems. The claim records `port`; once the listener is up, call
    /// [`MasterGuard::publish_port`] with the port that was actually bound (which is the only thing
    /// that differs when `--port 0` asked for an ephemeral one).
    pub fn acquire(
        tendril_home: &Path,
        port: u16,
        secret: &str,
        host: &str,
        scheme: &str,
    ) -> Result<Self> {
        ensure_not_real_home(tendril_home)?;

        let claim = MasterClaim::for_this_process(port, secret, host, scheme);

        for _ in 0..MASTER_CLAIM_ATTEMPTS {
            if try_claim_master(tendril_home, &claim)? {
                return Ok(Self {
                    tendril_home: tendril_home.to_path_buf(),
                    pid: claim.info.pid,
                    claim: std::sync::Mutex::new(claim),
                });
            }

            // Somebody got here first. Either they are alive — in which case this daemon must not
            // start — or the claim is a leftover and can be cleared for one more attempt.
            let Some(existing) = read_master_claim_settled(tendril_home) else {
                // It did not read as a claim. What happens next depends on *why*, because only one of
                // the reasons says nothing about whether a daemon is alive.
                // `read_master_claim_settled` has already ruled out a sibling's half-written claim by
                // re-reading it.
                match inspect_master_file(tendril_home) {
                    // Vanished between the create and this read: the next attempt simply wins it.
                    MasterFileKind::Missing => continue,
                    // Not JSON at all — an empty or truncated write. It names nobody and blocks every
                    // future claim, so it goes.
                    MasterFileKind::Garbage => {
                        tracing::warn!(
                            "Discarding a truncated {}/.master: it is not a JSON document",
                            tendril_home.display()
                        );
                        delete_master(tendril_home);
                        continue;
                    }
                    // A structured claim written by something else. It may well be a running daemon
                    // this build is too old to understand, and there is no way to tell from here — so
                    // it is left standing and this daemon refuses to start instead. Deleting it is
                    // what the V1 CLI did to a V2 claim, and that took a live daemon off the air.
                    MasterFileKind::Foreign { schema_version } => {
                        if !master_takeover_allowed() {
                            return Err(TendrilError::Other(format!(
                                "{}/.master was written by a Tendril this build does not understand \
                                 (schema version {}, this build writes {}). Refusing to delete it: it \
                                 may belong to a running daemon. Stop that daemon, start this one with \
                                 a different TENDRIL_HOME, or set \
                                 TENDRIL_ALLOW_MASTER_TAKEOVER=1 to clear the claim deliberately.",
                                tendril_home.display(),
                                schema_version
                                    .map(|v| v.to_string())
                                    .unwrap_or_else(|| "unmarked".to_string()),
                                MASTER_SCHEMA_VERSION
                            )));
                        }
                        tracing::warn!(
                            "TENDRIL_ALLOW_MASTER_TAKEOVER=1: clearing a {}/.master this build cannot \
                             read",
                            tendril_home.display()
                        );
                        delete_master(tendril_home);
                        continue;
                    }
                    // Readable after all — a claim landed between the two reads. Loop round and judge
                    // it the normal way.
                    MasterFileKind::Claim(_) => continue,
                }
            };

            let info = &existing.info;
            if existing.owner_is_running() {
                // `probe_health` speaks plaintext HTTP, so it cannot tell a live TLS server from a
                // dead one; for those, the pid check above is the whole answer.
                let responding = info.scheme.eq_ignore_ascii_case("https")
                    || probe_health_with_retries(&info.host, info.port, HEALTH_PROBE_ATTEMPTS);
                if responding {
                    return Err(TendrilError::Other(format!(
                        "Another Tendril instance is running with PID {} on port {}",
                        info.pid, info.port
                    )));
                }

                if !master_takeover_allowed() {
                    return Err(TendrilError::Other(format!(
                        "Refusing to take mastership from live PID {} on port {} recorded in \
                         {}/.master: the process is alive but did not answer /api/ping after {} \
                         probes. Stop that instance, or start this one with a different \
                         TENDRIL_HOME.",
                        info.pid,
                        info.port,
                        tendril_home.display(),
                        HEALTH_PROBE_ATTEMPTS
                    )));
                }

                tracing::warn!(
                    "TENDRIL_ALLOW_MASTER_TAKEOVER=1: evicting live but unresponsive master PID {} on port {}",
                    info.pid,
                    info.port
                );
            } else if is_process_running(info.pid) {
                // The pid is in use, but by something that started after the claim was written: the
                // original daemon is gone and its pid was recycled. Without this the claim would be
                // unbreakable except through TENDRIL_ALLOW_MASTER_TAKEOVER=1.
                tracing::warn!(
                    "Cleaning up stale .master file from PID {} on port {} (that pid has been \
                     recycled: it started after the claim was written)",
                    info.pid,
                    info.port
                );
            } else {
                tracing::warn!(
                    "Cleaning up stale .master file from PID {} on port {} (process is not running)",
                    info.pid,
                    info.port
                );
            }

            delete_master_if_pid(tendril_home, info.pid);
        }

        Err(TendrilError::Other(format!(
            "Could not claim mastership of {}/.master after {} attempts: another process keeps \
             winning the race. Retry, or start this one with a different TENDRIL_HOME.",
            tendril_home.display(),
            MASTER_CLAIM_ATTEMPTS
        )))
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// The claim as it currently stands on disk from this process's point of view.
    pub fn claim(&self) -> MasterClaim {
        self.claim.lock().expect("master claim mutex").clone()
    }

    /// Republishes the claim with the port the listener actually bound.
    ///
    /// Needed because the claim is taken before the bind: with `--port 0` the recorded port would
    /// otherwise stay 0 and every client would fail to connect. A no-op when the port is unchanged,
    /// and it refuses to write if this process no longer owns the claim.
    pub fn publish_port(&self, port: u16) -> Result<()> {
        let mut claim = self.claim.lock().expect("master claim mutex");
        if claim.info.port == port {
            return Ok(());
        }

        if !read_master(&self.tendril_home).is_some_and(|info| info.pid == self.pid) {
            return Err(TendrilError::Other(format!(
                "Not publishing port {}: {}/.master is no longer held by pid {}",
                port,
                self.tendril_home.display(),
                self.pid
            )));
        }

        claim.info.port = port;
        claim.heartbeat = Some(heartbeat_now());
        write_master_claim(&self.tendril_home, &claim)
    }

    /// Refreshes the claim's heartbeat, and reports whether it was written.
    ///
    /// Nothing in V2 reads the timestamp to decide anything, so this exists for foreign readers: the
    /// shipped V1 CLI deletes a claim whose `heartbeat` is more than 90s old, and "the daemon has been
    /// up for two minutes" must not look like that. Cheap enough to do on a timer — one 600-byte
    /// atomic rename — and it makes the field mean what it says.
    ///
    /// Refuses to write unless the claim on disk is still ours, exactly like [`Self::publish_port`]: a
    /// superseded daemon beating on someone else's claim would be the collision the election prevents.
    pub fn beat(&self) -> bool {
        let mut claim = self.claim.lock().expect("master claim mutex");
        if !read_master(&self.tendril_home).is_some_and(|info| info.pid == self.pid) {
            return false;
        }

        claim.heartbeat = Some(heartbeat_now());
        match write_master_claim(&self.tendril_home, &claim) {
            Ok(()) => true,
            Err(e) => {
                tracing::warn!("Could not write a master heartbeat: {}", e);
                false
            }
        }
    }

    /// Re-asserts this process's claim if it has gone missing, and reports what it found.
    ///
    /// A claim that vanishes while its daemon is alive is not a hypothetical: the app's "Repair
    /// service" button deleted it unconditionally, and `is_master` then reads false for the rest of
    /// the process's life, silently switching off every master-only subsystem. Repairing the file is
    /// the correct response — surrendering mastership because a file disappeared is not.
    ///
    /// A *live* foreign claim is never taken back: that daemon won the election, and re-taking it
    /// would give the home two masters.
    pub fn check_and_reassert(&self) -> MasterCheck {
        let claim = self.claim.lock().expect("master claim mutex");

        match read_master_claim(&self.tendril_home) {
            Some(existing) if existing.info.pid == self.pid => MasterCheck::Intact,
            Some(existing) if existing.owner_is_running() => MasterCheck::Superseded {
                pid: existing.info.pid,
            },
            existing => {
                if let Some(existing) = &existing {
                    tracing::warn!(
                        "Re-asserting mastership over .master: it names pid {}, which is not running",
                        existing.info.pid
                    );
                } else if matches!(
                    inspect_master_file(&self.tendril_home),
                    MasterFileKind::Foreign { .. }
                ) {
                    // Overwriting it would be this daemon guessing that an unreadable claim is not a
                    // live one — the same guess that made a V1 CLI delete a V2 claim.
                    tracing::warn!(
                        "Not re-asserting over {}/.master: it holds a claim this build cannot read, \
                         and it is left untouched",
                        self.tendril_home.display()
                    );
                    return MasterCheck::Foreign;
                } else {
                    tracing::warn!(
                        "Re-asserting mastership: {}/.master vanished while this daemon (pid {}) was \
                         running",
                        self.tendril_home.display(),
                        self.pid
                    );
                }

                let mut reasserted = claim.clone();
                reasserted.heartbeat = Some(heartbeat_now());
                match write_master_claim(&self.tendril_home, &reasserted) {
                    Ok(()) => MasterCheck::Reasserted,
                    Err(e) => {
                        tracing::warn!("Could not re-assert .master: {}", e);
                        MasterCheck::Intact
                    }
                }
            }
        }
    }
}

impl Drop for MasterGuard {
    fn drop(&mut self) {
        if let Some(info) = read_master(&self.tendril_home) {
            if info.pid == self.pid {
                delete_master(&self.tendril_home);
            } else {
                tracing::warn!(
                    "Not deleting .master on drop: file has foreign pid {} (current pid {})",
                    info.pid,
                    self.pid
                );
            }
        }
    }
}
