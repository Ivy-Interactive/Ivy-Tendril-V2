use std::sync::{Mutex, MutexGuard, OnceLock};
use tendril_core::config::{
    default_capabilities, process_start_token, read_master, read_master_claim,
    real_user_tendril_home, try_claim_master, write_master, write_master_info, MasterCheck,
    MasterClaim, MasterGuard, MasterInfo,
};

/// Serialises the tests that mutate process-global environment variables, following the same
/// convention as `tendril-cli`'s harnesses.
fn env_lock() -> MutexGuard<'static, ()> {
    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    ENV_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn temp_home(prefix: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("{}-{}", prefix, uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A port that nothing is listening on: bind it, note it, then release it.
fn closed_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap().port()
}

fn live_master_info(port: u16, secret: &str) -> MasterInfo {
    MasterInfo {
        port,
        pid: std::process::id(),
        secret: secret.to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
        host: "127.0.0.1".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: default_capabilities(),
        scheme: "http".to_string(),
    }
}

#[test]
fn test_atomic_write_master_permissions() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-atomic-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).unwrap();

    write_master(&test_dir, 5010, "secret-token-123", "127.0.0.1", "http").unwrap();

    let master_file = test_dir.join(".master");
    assert!(master_file.exists());

    let mut tmp_files = 0;
    for entry in std::fs::read_dir(&test_dir).unwrap().flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(".master.tmp.") {
            tmp_files += 1;
        }
    }
    assert_eq!(tmp_files, 0);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = std::fs::metadata(&master_file).unwrap();
        let mode = metadata.permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o600,
            "Expected file permissions to be 0600, got {:o}",
            mode
        );
    }

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_master_info_version_and_capabilities() {
    let legacy_json = r#"{
        "port": 5010,
        "pid": 12345,
        "secret": "legacy-secret",
        "startedAt": "2026-09-01T00:00:00Z"
    }"#;
    let legacy_info: MasterInfo = serde_json::from_str(legacy_json).unwrap();
    assert_eq!(legacy_info.port, 5010);
    assert_eq!(legacy_info.pid, 12345);
    assert_eq!(legacy_info.secret, "legacy-secret");
    assert_eq!(legacy_info.host, "127.0.0.1");
    assert_eq!(legacy_info.api_version, 1);
    assert!(legacy_info.capabilities.is_empty());

    let full_info = MasterInfo {
        port: 5020,
        pid: 67890,
        secret: "new-secret".to_string(),
        started_at: "2026-09-05T12:00:00Z".to_string(),
        host: "127.0.0.1".to_string(),
        scheme: "http".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: vec![
            "jobs".to_string(),
            "plans".to_string(),
            "auth_bearer".to_string(),
        ],
    };
    let json = serde_json::to_string(&full_info).unwrap();
    let deserialized: MasterInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.port, 5020);
    assert_eq!(deserialized.host, "127.0.0.1");
    assert_eq!(deserialized.version, "0.1.0");
    assert_eq!(deserialized.api_version, 1);
    assert_eq!(deserialized.capabilities.len(), 3);
}

#[test]
fn test_stale_master_detection_and_cleanup() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-stale-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).unwrap();

    let stale_info = MasterInfo {
        port: 49199,
        pid: 99999999,
        secret: "stale-secret".to_string(),
        started_at: "2020-01-01T00:00:00Z".to_string(),
        host: "127.0.0.1".to_string(),
        scheme: "http".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: default_capabilities(),
    };
    write_master_info(&test_dir, &stale_info).unwrap();
    assert!(read_master(&test_dir).is_some());

    let guard = MasterGuard::acquire(&test_dir, 5010, "fresh-secret", "127.0.0.1", "http").unwrap();
    assert_eq!(guard.pid(), std::process::id());

    let current = read_master(&test_dir).unwrap();
    assert_eq!(current.pid, std::process::id());
    assert_eq!(current.secret, "fresh-secret");

    drop(guard);
    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_live_master_collision_prevention() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-collision-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).unwrap();

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    let running = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    let running_clone = running.clone();

    let server_thread = std::thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        while running_clone.load(std::sync::atomic::Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut socket, _)) => {
                    use std::io::{Read, Write};
                    let mut buf = [0u8; 1024];
                    let _ = socket.read(&mut buf);
                    let resp =
                        "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\npong";
                    let _ = socket.write_all(resp.as_bytes());
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }
    });

    let live_info = MasterInfo {
        port,
        pid: std::process::id(),
        secret: "live-secret".to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
        host: "127.0.0.1".to_string(),
        scheme: "http".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: default_capabilities(),
    };
    write_master_info(&test_dir, &live_info).unwrap();

    let err = MasterGuard::acquire(&test_dir, 5011, "second-secret", "127.0.0.1", "http");
    assert!(err.is_err());
    let err_msg = err.err().unwrap().to_string();
    assert!(
        err_msg.contains("Another Tendril instance is running"),
        "Expected collision error, got: {}",
        err_msg
    );

    running.store(false, std::sync::atomic::Ordering::Relaxed);
    let _ = server_thread.join();
    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_master_guard_drop_preserves_foreign_pid() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-foreign-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).unwrap();

    let guard = MasterGuard::acquire(&test_dir, 5010, "guard-secret", "127.0.0.1", "http").unwrap();
    assert!(read_master(&test_dir).is_some());

    let foreign_info = MasterInfo {
        port: 5012,
        pid: 99999998,
        secret: "foreign-secret".to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
        host: "127.0.0.1".to_string(),
        scheme: "http".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: default_capabilities(),
    };
    write_master_info(&test_dir, &foreign_info).unwrap();

    drop(guard);

    let after_drop = read_master(&test_dir);
    assert!(
        after_drop.is_some(),
        ".master should not have been deleted on drop of foreign guard"
    );
    assert_eq!(after_drop.unwrap().pid, 99999998);

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_live_unresponsive_master_is_not_evicted() {
    let _env = env_lock();
    std::env::remove_var("TENDRIL_ALLOW_MASTER_TAKEOVER");

    let test_dir = temp_home("tendril-live-unresponsive-test");
    write_master_info(&test_dir, &live_master_info(closed_port(), "live-secret")).unwrap();

    let err = MasterGuard::acquire(&test_dir, 5011, "second-secret", "127.0.0.1", "http");
    assert!(
        err.is_err(),
        "A live process that does not answer /api/ping must not be evicted"
    );
    let err_msg = err.err().unwrap().to_string();
    assert!(
        err_msg.contains("Refusing to take mastership"),
        "Expected a refusal, got: {}",
        err_msg
    );
    assert!(
        err_msg.contains(&std::process::id().to_string()),
        "Refusal must name the live PID, got: {}",
        err_msg
    );

    let current = read_master(&test_dir).unwrap();
    assert_eq!(
        current.secret, "live-secret",
        ".master must still hold the original claim"
    );
    assert_eq!(current.pid, std::process::id());

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_probe_retries_before_declaring_unresponsive() {
    let _env = env_lock();
    std::env::remove_var("TENDRIL_ALLOW_MASTER_TAKEOVER");

    let test_dir = temp_home("tendril-probe-retry-test");

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    let running = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    let running_clone = running.clone();

    // Drops the first connection without replying, then answers normally: the first probe must not
    // be enough to declare the master dead.
    let server_thread = std::thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        let mut connections = 0;
        while running_clone.load(std::sync::atomic::Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut socket, _)) => {
                    connections += 1;
                    if connections == 1 {
                        drop(socket);
                        continue;
                    }
                    use std::io::{Read, Write};
                    let mut buf = [0u8; 1024];
                    let _ = socket.read(&mut buf);
                    let resp =
                        "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\npong";
                    let _ = socket.write_all(resp.as_bytes());
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }
    });

    write_master_info(&test_dir, &live_master_info(port, "live-secret")).unwrap();

    let err = MasterGuard::acquire(&test_dir, 5011, "second-secret", "127.0.0.1", "http");
    assert!(err.is_err());
    let err_msg = err.err().unwrap().to_string();
    assert!(
        err_msg.contains("Another Tendril instance is running"),
        "A retried probe must recognise the master as live, got: {}",
        err_msg
    );

    running.store(false, std::sync::atomic::Ordering::Relaxed);
    let _ = server_thread.join();
    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_takeover_escape_hatch() {
    let _env = env_lock();

    let test_dir = temp_home("tendril-takeover-hatch-test");
    write_master_info(&test_dir, &live_master_info(closed_port(), "wedged-secret")).unwrap();

    std::env::set_var("TENDRIL_ALLOW_MASTER_TAKEOVER", "1");
    let guard = MasterGuard::acquire(&test_dir, 5013, "hatch-secret", "127.0.0.1", "http");
    std::env::remove_var("TENDRIL_ALLOW_MASTER_TAKEOVER");

    let guard = guard.expect("TENDRIL_ALLOW_MASTER_TAKEOVER=1 must restore the takeover behaviour");
    let current = read_master(&test_dir).unwrap();
    assert_eq!(current.secret, "hatch-secret");

    drop(guard);
    let _ = std::fs::remove_dir_all(test_dir);
}

/// A claim naming `pid`, with whatever start token is passed. `None` mimics a claim written by a
/// build that predates the PID-reuse guard.
fn claim_for(pid: u32, port: u16, secret: &str, pid_started_at: Option<String>) -> MasterClaim {
    let mut claim = MasterClaim::for_this_process(port, secret, "127.0.0.1", "http");
    claim.info.pid = pid;
    claim.pid_started_at = pid_started_at;
    claim
}

/// A real, live, foreign process — for the cases where a fake pid would not do.
#[cfg(unix)]
struct LiveProcess(std::process::Child);

#[cfg(unix)]
impl LiveProcess {
    fn spawn() -> Self {
        Self(
            std::process::Command::new("sleep")
                .arg("30")
                .spawn()
                .expect("spawn a live helper process"),
        )
    }

    fn pid(&self) -> u32 {
        self.0.id()
    }
}

#[cfg(unix)]
impl Drop for LiveProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Issue #128: `.master` was claimed read-then-write, and the write was a `rename`, which silently
/// overwrites. Every racer therefore "won" and every one of them started the master-only subsystems.
/// With an exclusive create, exactly one can.
#[test]
fn only_one_racer_can_claim_master() {
    const RACERS: u32 = 8;

    let test_dir = temp_home("tendril-claim-race-test");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(RACERS as usize));

    let winners: Vec<u32> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..RACERS)
            .map(|i| {
                let dir = test_dir.clone();
                let barrier = barrier.clone();
                scope.spawn(move || {
                    // A distinct pid per racer stands in for a distinct process; the point under test
                    // is the file operation, not the pids.
                    let claim =
                        claim_for(90_000 + i, 6000 + i as u16, &format!("secret-{i}"), None);
                    barrier.wait();
                    if try_claim_master(&dir, &claim).expect("claim must not fail") {
                        Some(claim.info.pid)
                    } else {
                        None
                    }
                })
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|h| h.join().expect("racer thread"))
            .collect()
    });

    assert_eq!(
        winners.len(),
        1,
        "exactly one racer may claim .master, but {} did: {:?}",
        winners.len(),
        winners
    );
    let claimed = read_master(&test_dir).expect("the winner's claim must be on disk");
    assert_eq!(claimed.pid, winners[0]);
    assert_eq!(claimed.secret, format!("secret-{}", winners[0] - 90_000));

    // The claim carries the bearer secret, so the exclusive create must be as private as the
    // tmp-file-plus-rename path it replaces.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(test_dir.join(".master"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600, "expected 0600, got {mode:o}");
    }

    let _ = std::fs::remove_dir_all(test_dir);
}

/// A pid that is alive and started *before* the claim was written is the rightful owner. This is the
/// dangerous direction of the PID-reuse guard: reading a live daemon as stale is exactly the
/// double-master bug, so it gets its own test.
#[test]
fn a_claim_whose_start_token_matches_is_respected() {
    let _env = env_lock();
    std::env::remove_var("TENDRIL_ALLOW_MASTER_TAKEOVER");

    let test_dir = temp_home("tendril-token-match-test");
    let pid = std::process::id();
    let claim = claim_for(pid, closed_port(), "owner-secret", process_start_token(pid));
    assert!(
        claim.pid_started_at.is_some(),
        "this platform must be able to read a start token for the current process"
    );
    assert!(try_claim_master(&test_dir, &claim).unwrap());

    let result = MasterGuard::acquire(&test_dir, 5011, "second-secret", "127.0.0.1", "http");
    assert!(
        result.is_err(),
        "a live owner's claim must never be taken over"
    );
    let err = result.err().unwrap().to_string();
    assert!(
        err.contains("Refusing to take mastership"),
        "unexpected error: {err}"
    );
    assert_eq!(read_master(&test_dir).unwrap().secret, "owner-secret");

    let _ = std::fs::remove_dir_all(test_dir);
}

/// The other half of the same guard: a pid can be recycled, and a bare `kill(pid, 0)` reads the new
/// owner of that pid as the old daemon. Without the start-token check such a claim is unbreakable
/// except through the undocumented `TENDRIL_ALLOW_MASTER_TAKEOVER=1`.
#[test]
fn a_claim_from_a_recycled_pid_is_stale() {
    let _env = env_lock();
    std::env::remove_var("TENDRIL_ALLOW_MASTER_TAKEOVER");

    let test_dir = temp_home("tendril-recycled-pid-test");
    // Our own pid — provably alive — but recorded as having started at a different time, which is
    // what a recycled pid looks like.
    let claim = claim_for(
        std::process::id(),
        closed_port(),
        "recycled-secret",
        Some("Thu Jan  1 00:00:00 1970".to_string()),
    );
    assert!(try_claim_master(&test_dir, &claim).unwrap());

    let guard = MasterGuard::acquire(&test_dir, 5011, "fresh-secret", "127.0.0.1", "http")
        .expect("a recycled pid's claim is stale and must be reclaimable");
    let current = read_master(&test_dir).unwrap();
    assert_eq!(current.secret, "fresh-secret");
    assert_eq!(current.pid, std::process::id());

    drop(guard);
    let _ = std::fs::remove_dir_all(test_dir);
}

/// Issue #128: the port was announced before the claim existed. Now the claim comes first, which
/// means the real port is only known afterwards — so it has to be published, or `--port 0` would
/// leave every client dialling port 0.
#[test]
fn publish_port_rewrites_the_claim_after_the_bind() {
    let test_dir = temp_home("tendril-publish-port-test");

    let guard = MasterGuard::acquire(&test_dir, 0, "bound-secret", "127.0.0.1", "http").unwrap();
    assert_eq!(read_master(&test_dir).unwrap().port, 0);

    guard.publish_port(54321).expect("publish the bound port");

    let claim = read_master_claim(&test_dir).unwrap();
    assert_eq!(claim.info.port, 54321);
    assert_eq!(claim.info.pid, std::process::id());
    assert_eq!(claim.info.secret, "bound-secret");
    assert!(
        claim.heartbeat_at.is_some(),
        "publishing the port re-asserts the claim, so it carries a heartbeat"
    );

    drop(guard);
    let _ = std::fs::remove_dir_all(test_dir);
}

/// Issue #129: something deleted a live daemon's claim and nothing put it back, so `is_master()` read
/// false for the rest of the process's life and every master-only sweep went silently dead.
#[test]
fn a_vanished_claim_is_reasserted_not_surrendered() {
    let test_dir = temp_home("tendril-reassert-test");

    let guard = MasterGuard::acquire(&test_dir, 5010, "owner-secret", "127.0.0.1", "http").unwrap();
    assert_eq!(guard.check_and_reassert(), MasterCheck::Intact);

    // What "Repair service" used to do to a healthy daemon.
    std::fs::remove_file(test_dir.join(".master")).unwrap();
    assert!(!tendril_core::config::is_master(&test_dir));

    assert_eq!(guard.check_and_reassert(), MasterCheck::Reasserted);
    assert!(
        tendril_core::config::is_master(&test_dir),
        "the daemon must be master again after re-asserting"
    );
    let restored = read_master(&test_dir).unwrap();
    assert_eq!(restored.secret, "owner-secret");
    assert_eq!(restored.port, 5010);

    // Idempotent: a claim that is already ours is left exactly as it is.
    assert_eq!(guard.check_and_reassert(), MasterCheck::Intact);

    drop(guard);
    let _ = std::fs::remove_dir_all(test_dir);
}

/// The re-assert must not become a way to win the election twice: a live foreign claim stands, and the
/// demoted daemon stays demoted.
#[cfg(unix)]
#[test]
fn a_live_foreign_claim_is_not_retaken() {
    let test_dir = temp_home("tendril-superseded-test");

    let guard = MasterGuard::acquire(&test_dir, 5010, "old-secret", "127.0.0.1", "http").unwrap();

    let successor = LiveProcess::spawn();
    let foreign = claim_for(
        successor.pid(),
        closed_port(),
        "successor-secret",
        process_start_token(successor.pid()),
    );
    tendril_core::config::write_master_claim(&test_dir, &foreign).unwrap();

    assert_eq!(
        guard.check_and_reassert(),
        MasterCheck::Superseded {
            pid: successor.pid()
        }
    );
    assert_eq!(
        read_master(&test_dir).unwrap().secret,
        "successor-secret",
        "the successor's claim must be untouched"
    );

    // And dropping the demoted guard must not take the successor's claim with it.
    drop(guard);
    assert_eq!(read_master(&test_dir).unwrap().secret, "successor-secret");

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_guard_refuses_real_home_in_test_context() {
    let real_home = real_user_tendril_home();
    let master_file = real_home.join(".master");
    let before = std::fs::read(&master_file).ok();

    let err = MasterGuard::acquire(&real_home, 5099, "test-secret", "127.0.0.1", "http");

    assert!(
        err.is_err(),
        "A test process must never claim mastership of the real Tendril home {}",
        real_home.display()
    );
    let err_msg = err.err().unwrap().to_string();
    assert!(
        err_msg.contains("Refusing to use the real Tendril home"),
        "Expected the real-home refusal, got: {}",
        err_msg
    );

    let after = std::fs::read(&master_file).ok();
    assert_eq!(
        before, after,
        "The real home's .master must be untouched (present or absent) by this test"
    );

    if real_home.is_dir() {
        let tmp_files: Vec<_> = std::fs::read_dir(&real_home)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .filter(|name| name.starts_with(".master.tmp."))
                    .collect()
            })
            .unwrap_or_default();
        assert!(
            tmp_files.is_empty(),
            "No .master.tmp.* file may be written into the real home: {:?}",
            tmp_files
        );
    }
}
