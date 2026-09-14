use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tempfile::TempDir;
use tendril_app_lib::service::{MasterDiscovery, TendrilClient};

async fn env_lock() -> tokio::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

fn discover_service_binary() -> Option<PathBuf> {
    if let Ok(raw) = std::env::var("TENDRIL_E2E_SERVER_BIN") {
        let p = PathBuf::from(shellexpand_home(raw.trim()));
        if p.is_file() {
            return Some(p);
        }
    }
    if let Ok(raw) = std::env::var("TENDRIL_SERVER_BIN") {
        let p = PathBuf::from(shellexpand_home(raw.trim()));
        if p.is_file() {
            return Some(p);
        }
    }

    let candidates = [
        "~/git/Tendril-Service/target/release/tendril-server",
        "~/git/Tendril-Service/target/debug/tendril-server",
        "/Users/rorychatt/git/Tendril-Service/target/release/tendril-server",
        "/Users/rorychatt/git/Tendril-Service/target/debug/tendril-server",
        "~/git/Tendril-Service/target/release/tendril",
        "~/git/Tendril-Service/target/debug/tendril",
        "/Users/rorychatt/git/Tendril-Service/target/release/tendril",
        "/Users/rorychatt/git/Tendril-Service/target/debug/tendril",
    ];

    for candidate in candidates {
        let p = PathBuf::from(shellexpand_home(candidate));
        if p.is_file() {
            return Some(p);
        }
    }

    None
}

fn shellexpand_home(raw: &str) -> String {
    match raw.strip_prefix("~/") {
        Some(rest) => dirs::home_dir()
            .map(|home| home.join(rest).to_string_lossy().to_string())
            .unwrap_or_else(|| raw.to_string()),
        None => raw.to_string(),
    }
}

fn free_loopback_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
    listener.local_addr().expect("local addr").port()
}

struct ServiceProcess {
    child: Child,
    log_path: PathBuf,
}

impl ServiceProcess {
    fn log_tail(&self) -> String {
        std::fs::read_to_string(&self.log_path)
            .map(|log| {
                log.lines()
                    .rev()
                    .take(20)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_else(|err| format!("(no service log: {err})"))
    }

    fn stop(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for ServiceProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

async fn start_real_service(bin: &Path, home: &Path, port: u16) -> ServiceProcess {
    let log_path = home.join("service.log");
    let log = std::fs::File::create(&log_path).expect("create service log");
    let errlog = log.try_clone().expect("clone log handle");

    let child = Command::new(bin)
        .arg("--port")
        .arg(port.to_string())
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--home")
        .arg(home)
        .env("TENDRIL_HOME", home)
        .env_remove("TENDRIL_PLANS")
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(errlog))
        .spawn()
        .expect("spawn tendril-server");

    let service = ServiceProcess { child, log_path };

    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if home.join(".master").is_file() {
            if let Ok(master) = MasterDiscovery::with_home(home).read_master() {
                let client = TendrilClient::new(
                    format!("http://127.0.0.1:{}", master.port),
                    Some(master.secret.clone()),
                );
                if client.ping().await.is_ok() {
                    return service;
                }
            }
        }

        assert!(
            Instant::now() < deadline,
            "tendril-server did not become reachable within 30s. Log tail:\n{}",
            service.log_tail()
        );
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

fn init_isolated_home(home: &Path) {
    let config_content = r#"codingAgent: antigravity
jobTimeout: 120
staleOutputTimeout: 20
gitTimeout: 10
maxConcurrentJobs: 5
projects:
- name: sandbox-project
  repos: []
  verifications: []
"#;
    std::fs::write(home.join("config.yaml"), config_content).expect("write config.yaml");
    std::fs::create_dir_all(home.join("Plans")).expect("create Plans dir");
    std::fs::create_dir_all(home.join("Jobs")).expect("create Jobs dir");
}

#[tokio::test]
async fn test_real_service_lifecycle_and_reconnect() {
    let is_enabled = std::env::var("TENDRIL_REAL_SERVICE_TEST")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let bin = discover_service_binary();

    if !is_enabled || bin.is_none() {
        eprintln!(
            "\n[LOUD SKIP] real_service_test skipped.\n\
             Reason: TENDRIL_REAL_SERVICE_TEST=1 is not set or tendril-server binary was not found.\n\
             Discovered binary: {:?}\n\
             To run this test against the real compiled service:\n\
               1. Build Tendril-Service: cargo build --manifest-path ~/git/Tendril-Service/Cargo.toml -p tendril-server\n\
               2. Run: TENDRIL_REAL_SERVICE_TEST=1 TENDRIL_E2E_SERVER_BIN=~/git/Tendril-Service/target/debug/tendril-server cargo test --test real_service_test\n",
            bin
        );
        return;
    }

    let bin = bin.unwrap();
    let _lock = env_lock().await;

    let temp_dir = TempDir::new().expect("create tempdir");
    let home = temp_dir.path();
    init_isolated_home(home);

    let port = free_loopback_port();
    let service = start_real_service(&bin, home, port).await;

    // 1. Verify auth and ping with real bearer secret from .master
    let discovery = MasterDiscovery::with_home(home);
    let master = discovery.read_master().expect("must read .master");
    assert!(!master.secret.is_empty(), "master secret must not be empty");

    let client = TendrilClient::new(
        format!("http://127.0.0.1:{port}"),
        Some(master.secret.clone()),
    );
    let ping_res = client.ping().await;
    assert!(
        ping_res.is_ok(),
        "client ping with bearer token must succeed"
    );

    // Unauthenticated client should fail
    let unauth_client = TendrilClient::new(
        format!("http://127.0.0.1:{port}"),
        Some("wrong-secret-token".to_string()),
    );
    let unauth_ping = unauth_client.ping().await;
    assert!(unauth_ping.is_err(), "unauthenticated ping must fail");

    // 2. Plan create
    let create_res = client
        .create_plan(json!({
            "title": "Parity Acceptance Test Plan",
            "project": "sandbox-project",
            "description": "Integration test plan creation against real service"
        }))
        .await;
    assert!(
        create_res.is_ok(),
        "create_plan should succeed: {:?}",
        create_res.err()
    );
    let plan_val = create_res.unwrap();
    let plan_id = plan_val["id"].as_str().unwrap_or("00001");

    let plans = client.list_plans(None).await.expect("list_plans");
    assert!(!plans.is_empty(), "plans list should contain created plan");

    // 3. Job start & cancel flow
    let start_res = client
        .start_job(json!({
            "type": "ExecutePlan",
            "planId": plan_id,
            "project": "sandbox-project"
        }))
        .await;
    assert!(
        start_res.is_ok(),
        "start_job should succeed: {:?}",
        start_res.err()
    );
    let job_resp = start_res.unwrap();

    let cancel_res = client
        .cancel_job(&job_resp.job_id, Some("Cancelled during test"))
        .await;
    assert!(
        cancel_res.is_ok(),
        "cancel_job should succeed: {:?}",
        cancel_res.err()
    );

    let job_detail = client.get_job(&job_resp.job_id).await.expect("get_job");
    assert!(
        job_detail.status == "Stopped"
            || job_detail.status == "Failed"
            || job_detail.status == "Cancelled",
        "job status after cancel should be terminal, got: {}",
        job_detail.status
    );

    // 4. Reconnect after service is killed and restarted
    service.stop();

    // Verify service is unreachable
    let offline_ping = client.ping().await;
    assert!(
        offline_ping.is_err(),
        "client ping must fail after stopping service"
    );

    // Restart the service against the same TENDRIL_HOME
    let restarted_service = start_real_service(&bin, home, port).await;

    // Verify client reconnects and state survives
    let reconnected_ping = client.ping().await;
    assert!(
        reconnected_ping.is_ok(),
        "client ping must succeed after restart"
    );

    let surviving_plans = client
        .list_plans(None)
        .await
        .expect("list_plans after restart");
    assert!(
        surviving_plans.iter().any(|p| p.id == plan_id),
        "created plan must survive service restart"
    );

    restarted_service.stop();
}
