//! The share tunnel's process lifecycle, against a **fake** `cloudflared`.
//!
//! Nothing here contacts the network and nothing here starts a real tunnel. The fake is a shell script
//! that prints the two lines the real binary prints — a quick-tunnel URL and a registered connection —
//! and then sits there, plus a grandchild so the tree kill can be observed. The health probe is stubbed
//! [`ProbeOutcome::Routable`], which is the only reason the tunnel can reach `Connected` offline.
//!
//! The assertions that matter are the ones about *not leaking a process*: a share that leaves a
//! `cloudflared` behind keeps publishing the machine on a URL nobody is watching.

#![cfg(unix)]

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use futures_util::future::BoxFuture;
use tendril_core::tunnel::service::{ProbeOutcome, TunnelProbe};
use tendril_core::tunnel::session::{SessionOptions, TunnelSession};
use tendril_core::tunnel::{share_state, ShareTunnelService, TunnelStatus, TunnelTimings};

struct Fixture {
    home: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let home = std::env::temp_dir().join(format!(
            "tendril-share-tunnel-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        assert!(home.starts_with(std::env::temp_dir()));
        std::fs::create_dir_all(&home).expect("create fixture home");
        Self { home }
    }

    /// A stand-in for `cloudflared` that behaves the way the supervisor expects: announce a URL, claim
    /// a registered connection, spawn a grandchild, then stay up until it is killed.
    ///
    /// The grandchild is announced *before* the URL, because `TunnelSession::start` returns as soon as
    /// it has a URL — anything printed after that may not have been read yet.
    fn fake_cloudflared(&self, url: &str) -> PathBuf {
        self.script(
            "fake-cloudflared",
            &format!(
                "#!/bin/sh\n\
                 echo \"INF Requesting new quick tunnel on trycloudflare.com...\" >&2\n\
                 sleep 600 &\n\
                 echo \"GRANDCHILD $!\" >&2\n\
                 echo \"INF +----------------------------------------+\" >&2\n\
                 echo \"INF |  {url}  |\" >&2\n\
                 echo \"INF Registered tunnel connection connIndex=0\" >&2\n\
                 sleep 600\n"
            ),
        )
    }

    /// A `cloudflared` that publishes a URL but never reports a registered edge connection, so the
    /// health probe is the only thing deciding whether the tunnel is up.
    fn unregistered_cloudflared(&self, url: &str) -> PathBuf {
        self.script(
            "unregistered-cloudflared",
            &format!(
                "#!/bin/sh\n\
                 echo \"INF |  {url}  |\" >&2\n\
                 sleep 600\n"
            ),
        )
    }

    /// A `cloudflared` that starts, says something unhelpful, and never produces a URL.
    fn silent_cloudflared(&self) -> PathBuf {
        self.script(
            "silent-cloudflared",
            "#!/bin/sh\n\
             echo \"ERR failed to request quick Tunnel: context deadline exceeded\" >&2\n\
             sleep 600\n",
        )
    }

    /// A `cloudflared` that exits straight away, as an outdated or wrong binary would.
    fn exiting_cloudflared(&self) -> PathBuf {
        self.script(
            "exiting-cloudflared",
            "#!/bin/sh\necho \"flag provided but not defined: -url\" >&2\nexit 2\n",
        )
    }

    fn script(&self, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = self.home.join(name);
        std::fs::write(&path, body).expect("write fake binary");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("chmod fake binary");
        path
    }

    /// The `.master` the service reads to find out what to publish.
    fn write_master(&self, port: u16) {
        let info: tendril_core::config::MasterInfo = serde_json::from_str(&format!(
            r#"{{"port":{port},"pid":{},"host":"127.0.0.1","scheme":"http"}}"#,
            std::process::id()
        ))
        .expect("master info");
        tendril_core::config::write_master_info(&self.home, &info).expect("write .master");
    }

    fn write_config(&self, yaml: &str) {
        std::fs::write(tendril_core::config::get_config_path(&self.home), yaml)
            .expect("write config");
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.home.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

/// The stub that lets a tunnel be "routable" with no network.
struct AlwaysRoutable;

impl TunnelProbe for AlwaysRoutable {
    fn probe(&self, _url: String) -> BoxFuture<'static, ProbeOutcome> {
        Box::pin(async { ProbeOutcome::Routable })
    }
}

/// Never routable, so the supervisor gives up rather than reporting a tunnel that does not work.
struct NeverRoutable;

impl TunnelProbe for NeverRoutable {
    fn probe(&self, _url: String) -> BoxFuture<'static, ProbeOutcome> {
        Box::pin(async { ProbeOutcome::NotReady })
    }
}

/// Timings small enough for a test but with the same *shape* as production.
fn fast_timings() -> TunnelTimings {
    TunnelTimings {
        probe_initial_delay: Duration::from_millis(20),
        probe_interval: Duration::from_millis(20),
        probe_timeout: Duration::from_millis(200),
        url_timeout: Duration::from_secs(10),
        registered_grace: Duration::from_millis(500),
        max_backoff: Duration::from_millis(50),
        stop_timeout: Duration::from_secs(5),
    }
}

/// Whether `pid` is a live process.
///
/// `is_process_running` alone is not enough *in a test*: a killed child whose parent has not called
/// `wait` is a zombie, and `kill(pid, 0)` on a zombie still succeeds. That only happens here — in
/// production the orphan being reaped belongs to a dead daemon and is reparented to init, which reaps
/// it — so the extra check lives in the test rather than in the library.
fn is_running(pid: u32) -> bool {
    if pid == 0 || !tendril_core::config::is_process_running(pid) {
        return false;
    }
    match std::process::Command::new("ps")
        .args(["-o", "state=", "-p", &pid.to_string()])
        .output()
    {
        Ok(output) => !String::from_utf8_lossy(&output.stdout)
            .trim()
            .starts_with('Z'),
        Err(_) => true,
    }
}

async fn wait_until<F: Fn() -> bool>(label: &str, predicate: F) {
    for _ in 0..300 {
        if predicate() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("timed out waiting for {label}");
}

fn grandchild_pid(logs: &[String]) -> u32 {
    logs.iter()
        .find_map(|line| line.strip_prefix("GRANDCHILD "))
        .and_then(|pid| pid.trim().parse().ok())
        .expect("the fake binary announced its grandchild")
}

#[tokio::test]
async fn a_session_reports_the_url_the_binary_printed() {
    let fx = Fixture::new("session-url");
    let binary = fx.fake_cloudflared("https://calm-otter-reads-plans.trycloudflare.com");

    let mut options = SessionOptions::new(binary, "http://127.0.0.1:5010");
    options.url_timeout = Duration::from_secs(10);
    options.registered_grace = Duration::from_secs(2);

    let mut session = TunnelSession::start(options).await.expect("session starts");
    assert_eq!(
        session.url(),
        "https://calm-otter-reads-plans.trycloudflare.com"
    );
    assert!(
        session.is_registered(),
        "the registered-connection line should have been seen"
    );
    assert!(is_running(session.pid()));

    session.stop();
}

/// The central guarantee: stopping a session takes the whole process tree with it.
#[tokio::test]
async fn stopping_a_session_kills_the_process_tree() {
    let fx = Fixture::new("session-kill");
    let binary = fx.fake_cloudflared("https://kill-me.trycloudflare.com");

    let mut session = TunnelSession::start(SessionOptions::new(binary, "http://127.0.0.1:5010"))
        .await
        .expect("session starts");
    let pid = session.pid();
    let grandchild = grandchild_pid(&session.recent_logs());
    assert!(is_running(pid));
    assert!(is_running(grandchild), "the grandchild is up");

    session.stop();

    wait_until("cloudflared to die", || !is_running(pid)).await;
    wait_until("its grandchild to die", || !is_running(grandchild)).await;
}

/// The same guarantee without an explicit stop: a dropped session — which is what an aborted or
/// panicking supervisor produces — must not leave the process behind.
#[tokio::test]
async fn dropping_a_session_kills_the_process_tree() {
    let fx = Fixture::new("session-drop");
    let binary = fx.fake_cloudflared("https://drop-me.trycloudflare.com");

    let (pid, grandchild) = {
        let session = TunnelSession::start(SessionOptions::new(binary, "http://127.0.0.1:5010"))
            .await
            .expect("session starts");
        (session.pid(), grandchild_pid(&session.recent_logs()))
    };

    wait_until("cloudflared to die on drop", || !is_running(pid)).await;
    wait_until("its grandchild to die on drop", || !is_running(grandchild)).await;
}

/// A binary that never prints a URL must fail with its own output quoted, and must not be left running.
#[tokio::test]
async fn a_binary_that_never_prints_a_url_fails_with_its_output_quoted() {
    let fx = Fixture::new("session-silent");
    let binary = fx.silent_cloudflared();

    let mut options = SessionOptions::new(binary, "http://127.0.0.1:5010");
    // Long enough that a loaded machine still gets the script's first line read, short enough that the
    // test does not wait out the production 60s.
    options.url_timeout = Duration::from_secs(2);

    let err = TunnelSession::start(options)
        .await
        .expect_err("no URL means no session");
    let message = err.to_string();
    assert!(
        message.contains("did not produce a tunnel URL"),
        "{message}"
    );
    assert!(message.contains("within 2s"), "{message}");
    assert!(
        message.contains("context deadline exceeded"),
        "the binary's own output should be quoted: {message}"
    );
}

#[tokio::test]
async fn a_binary_that_exits_immediately_is_reported_rather_than_waited_out() {
    let fx = Fixture::new("session-exits");
    let binary = fx.exiting_cloudflared();

    let mut options = SessionOptions::new(binary, "http://127.0.0.1:5010");
    // Far longer than the test should take: an exiting child must not be waited out.
    options.url_timeout = Duration::from_secs(30);

    let started = std::time::Instant::now();
    let err = TunnelSession::start(options).await.expect_err("no session");
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "an exited process should be noticed at once, not after the URL timeout"
    );
    assert!(err.to_string().contains("flag provided but not defined"));
}

#[tokio::test]
async fn a_missing_binary_is_a_spawn_error() {
    let fx = Fixture::new("session-missing");
    let err = TunnelSession::start(SessionOptions::new(
        fx.home.join("does-not-exist"),
        "http://127.0.0.1:5010",
    ))
    .await
    .expect_err("nothing to spawn");
    assert!(err.to_string().contains("could not start"), "{err}");
}

/// The whole lifecycle through the service: start, reach `Connected`, publish state, stop, and leave
/// nothing running and nothing on disk.
#[tokio::test]
async fn the_service_starts_publishes_and_stops_cleanly() {
    let fx = Fixture::new("service-lifecycle");
    let binary = fx.fake_cloudflared("https://service-share.trycloudflare.com");
    fx.write_master(5010);
    fx.write_config(&format!(
        "shareTunnel:\n  binaryPath: {}\n",
        binary.display()
    ));

    let service = Arc::new(ShareTunnelService::with_parts(
        fx.home.clone(),
        fast_timings(),
        Arc::new(AlwaysRoutable),
    ));

    let snapshot = service.start().await.expect("start accepted");
    assert_eq!(snapshot.status, TunnelStatus::Connecting);
    assert!(
        snapshot.share_token.is_some(),
        "a token is minted up front so the owner can build a link"
    );

    let svc = service.clone();
    wait_until("the tunnel to connect", move || {
        svc.snapshot().status == TunnelStatus::Connected
    })
    .await;

    let connected = service.snapshot();
    assert_eq!(
        connected.url.as_deref(),
        Some("https://service-share.trycloudflare.com")
    );
    assert!(connected.error.is_none());
    assert!(connected.installed);

    // The state file is what the local-file guard reads.
    let recorded = share_state::read(&fx.home).expect("state file written");
    assert_eq!(recorded.host, "service-share.trycloudflare.com");
    assert_eq!(
        Some(recorded.token.clone()),
        connected.share_token,
        "the file and the snapshot agree on the token"
    );
    assert_eq!(
        share_state::active_host(&fx.home).as_deref(),
        Some("service-share.trycloudflare.com")
    );
    assert!(share_state::accepts_token(&fx.home, &recorded.token));
    let pid = recorded.pid;
    assert!(is_running(pid), "the recorded pid is the live cloudflared");

    // And the share link is built off it.
    let link = service.share_url_for_plan("00021-Ship-It", true);
    assert!(
        link.starts_with("https://service-share.trycloudflare.com/review?planId=00021-Ship-It&share=1&shareToken="),
        "{link}"
    );

    let stopped = service.stop().await;
    assert_eq!(stopped.status, TunnelStatus::Disabled);
    assert!(stopped.url.is_none());
    assert!(stopped.share_token.is_none());

    wait_until("cloudflared to die after stop", || !is_running(pid)).await;
    assert!(
        share_state::read(&fx.home).is_none(),
        "stopping must revoke the recorded share"
    );
    assert!(!share_state::accepts_token(&fx.home, &recorded.token));
}

/// Two starts must not produce two tunnels.
#[tokio::test]
async fn starting_twice_is_idempotent() {
    let fx = Fixture::new("service-idempotent");
    let binary = fx.fake_cloudflared("https://once-only.trycloudflare.com");
    fx.write_master(5010);
    fx.write_config(&format!(
        "shareTunnel:\n  binaryPath: {}\n",
        binary.display()
    ));

    let service = Arc::new(ShareTunnelService::with_parts(
        fx.home.clone(),
        fast_timings(),
        Arc::new(AlwaysRoutable),
    ));
    service.start().await.expect("first start");
    let svc = service.clone();
    wait_until("the tunnel to connect", move || {
        svc.snapshot().status == TunnelStatus::Connected
    })
    .await;
    let first_pid = share_state::read(&fx.home).expect("state").pid;

    service.start().await.expect("second start is accepted");
    assert_eq!(
        share_state::read(&fx.home).expect("state").pid,
        first_pid,
        "the second start must not replace the running session"
    );

    service.stop().await;
    wait_until("cloudflared to die", || !is_running(first_pid)).await;
}

/// A URL that never routes must not be reported as a working share, and the child must not survive the
/// supervisor giving up.
#[tokio::test]
async fn a_tunnel_that_never_routes_gives_up_without_leaking() {
    let fx = Fixture::new("service-unroutable");
    // Deliberately the binary that does *not* claim a registered connection: with one, the ported
    // fallback below would treat the tunnel as up despite the probe.
    let binary = fx.unregistered_cloudflared("https://never-routes.trycloudflare.com");
    fx.write_master(5010);
    fx.write_config(&format!(
        "shareTunnel:\n  binaryPath: {}\n  maxRestarts: 1\n",
        binary.display()
    ));

    let service = Arc::new(ShareTunnelService::with_parts(
        fx.home.clone(),
        fast_timings(),
        Arc::new(NeverRoutable),
    ));
    service.start().await.expect("start accepted");

    let svc = service.clone();
    wait_until("the supervisor to give up", move || {
        svc.snapshot().status == TunnelStatus::Disabled
    })
    .await;

    let snapshot = service.snapshot();
    assert!(
        snapshot.url.is_none(),
        "an unroutable tunnel has no URL to hand out"
    );
    let error = snapshot.error.expect("a reason is reported");
    assert!(error.contains("did not become routable"), "{error}");
    assert!(
        error.contains("trycloudflare.com"),
        "the DNS hint is kept: {error}"
    );
    assert!(
        share_state::read(&fx.home).is_none(),
        "nothing may be left claiming to be an active share"
    );

    service.stop().await;
}

/// The other half of the same rule, ported from `WaitForTunnelHealthyAsync`: when the local probe never
/// succeeds but cloudflared reports a registered edge connection, the tunnel *is* treated as up.
/// Locally-poisoned negative DNS is common enough that refusing on the probe alone reports working
/// shares as broken.
#[tokio::test]
async fn a_registered_tunnel_is_trusted_when_the_local_probe_keeps_failing() {
    let fx = Fixture::new("service-registered-fallback");
    let binary = fx.fake_cloudflared("https://registered-anyway.trycloudflare.com");
    fx.write_master(5010);
    fx.write_config(&format!(
        "shareTunnel:\n  binaryPath: {}\n",
        binary.display()
    ));

    let service = Arc::new(ShareTunnelService::with_parts(
        fx.home.clone(),
        fast_timings(),
        Arc::new(NeverRoutable),
    ));
    service.start().await.expect("start accepted");

    let svc = service.clone();
    wait_until("the registered fallback to accept the tunnel", move || {
        svc.snapshot().status == TunnelStatus::Connected
    })
    .await;
    assert_eq!(
        service.snapshot().url.as_deref(),
        Some("https://registered-anyway.trycloudflare.com")
    );

    let pid = share_state::read(&fx.home).expect("state").pid;
    service.stop().await;
    wait_until("cloudflared to die", || !is_running(pid)).await;
}

/// A cloudflared left behind by a daemon that was killed is reaped by the next start, rather than
/// staying up alongside the new one. This is the case the original only covered on Windows.
#[tokio::test]
async fn a_previous_daemons_orphan_is_reaped_before_a_new_share_starts() {
    let fx = Fixture::new("service-orphan");
    let binary = fx.fake_cloudflared("https://orphan.trycloudflare.com");
    fx.write_master(5010);
    fx.write_config(&format!(
        "shareTunnel:\n  binaryPath: {}\n",
        binary.display()
    ));

    // Stand in for the previous daemon: start a session, record it, then forget about it the way a
    // `SIGKILL`ed process would.
    let orphan = TunnelSession::start(SessionOptions::new(binary.clone(), "http://127.0.0.1:5010"))
        .await
        .expect("orphan starts");
    let orphan_pid = orphan.pid();
    share_state::write(
        &fx.home,
        &share_state::ShareSession {
            url: "https://orphan.trycloudflare.com".to_string(),
            host: "orphan.trycloudflare.com".to_string(),
            token: share_state::mint_token(),
            pid: orphan_pid,
            started_at: "2026-09-16T09:00:00Z".to_string(),
        },
    )
    .expect("record the orphan");
    // Leak it deliberately: `Drop` would kill it, and the point is that nothing did.
    std::mem::forget(orphan);
    assert!(is_running(orphan_pid));

    // `looks_like_cloudflared` matches on the command name, and the fake is named for it.
    let service = Arc::new(ShareTunnelService::with_parts(
        fx.home.clone(),
        fast_timings(),
        Arc::new(AlwaysRoutable),
    ));
    service.start().await.expect("start accepted");

    wait_until("the orphan to be reaped", || !is_running(orphan_pid)).await;

    let svc = service.clone();
    wait_until("the new tunnel to connect", move || {
        svc.snapshot().status == TunnelStatus::Connected
    })
    .await;
    let new_pid = share_state::read(&fx.home).expect("state").pid;
    assert_ne!(new_pid, orphan_pid);

    service.stop().await;
    wait_until("the new session to die", || !is_running(new_pid)).await;
}

/// A share cannot be started at all without a `cloudflared`, and the error has to say what to install.
#[tokio::test]
async fn a_missing_cloudflared_refuses_the_start_with_an_actionable_error() {
    let fx = Fixture::new("service-no-binary");
    fx.write_master(5010);
    fx.write_config("shareTunnel:\n  binaryPath: /definitely/not/here/cloudflared\n");

    let service =
        ShareTunnelService::with_parts(fx.home.clone(), fast_timings(), Arc::new(AlwaysRoutable));
    let err = service.start().await.expect_err("no binary, no share");
    assert!(err.to_string().contains("shareTunnel.binaryPath"), "{err}");
    assert_eq!(
        service.snapshot().status,
        TunnelStatus::Disabled,
        "a refused start must not leave the status at Connecting"
    );
    assert!(
        share_state::read(&fx.home).is_none(),
        "a refused start publishes nothing"
    );
}

/// `shareTunnel.enabled: true` in `config.yaml` is read but deliberately not obeyed: a daemon restart
/// must not silently republish the machine to the internet.
#[test]
fn an_enabled_flag_in_config_does_not_start_a_share_by_itself() {
    let fx = Fixture::new("service-no-autostart");
    fx.write_master(5010);
    fx.write_config("shareTunnel:\n  enabled: true\n");

    let settings =
        tendril_core::config::load_config(&tendril_core::config::get_config_path(&fx.home))
            .expect("config loads");
    let config = tendril_core::tunnel::TunnelConfig::from_settings(&settings);
    assert!(config.enabled, "the flag is read");

    let service = ShareTunnelService::new(fx.home.clone());
    assert_eq!(
        service.snapshot().status,
        TunnelStatus::Disabled,
        "constructing the service must never start a tunnel"
    );
    assert!(share_state::read(&fx.home).is_none());
}
