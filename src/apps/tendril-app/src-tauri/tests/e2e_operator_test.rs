//! End-to-end operator flow against a **real** `tendril-server`.
//!
//! Every other test in this crate mocks the service, so all of them would keep
//! passing if the app's idea of the API drifted from the daemon's. This suite
//! spawns the actual server binary, seeds a plan through it, and then drives the
//! app's own `cmd_*` command layer — the same code the webview invokes.
//!
//! Isolation, in order of how easy each is to get wrong:
//!
//! * `TENDRIL_HOME` is a `TempDir`. The server is also given `--home`, because
//!   its default is the operator's real `~/.tendril`.
//! * `TENDRIL_PLANS` is *removed* from the child's environment. It takes
//!   precedence over `TENDRIL_HOME`, so leaving it set writes plans into the
//!   operator's real plans directory even though `TENDRIL_HOME` points at a
//!   temp dir.
//! * The server binds loopback only, on a port picked by binding `:0` first.
//!
//! **No job here ever reaches a coding agent.** `build_agent_spec` in
//! tendril-core maps an unrecognised provider name onto the real `claude` CLI,
//! so there is no configuration that substitutes a stub. The job cases below are
//! therefore limited to the outcomes the service decides by itself — dependency
//! blocking, a missing promptware, and cancellation — which is every job path
//! reachable without spending tokens or letting an agent loose on a repo.
//!
//! The binary is located through `TENDRIL_E2E_SERVER_BIN`. When that is unset
//! the suite skips: a checkout with no built service must not fail the build.
//! Run it with, for example:
//!
//! ```sh
//! TENDRIL_E2E_SERVER_BIN=~/git/Tendril-Service/target/debug/tendril-server \
//!   cargo test --test e2e_operator_test
//! ```
//!
//! Rebuild that binary first (`cargo build -p tendril-server`). A stale one
//! passes just as happily while asserting last week's service behaviour, which
//! defeats the point of the suite.

use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tempfile::TempDir;
use tendril_app_lib::commands::jobs::{cmd_cancel_job, cmd_get_job, cmd_list_jobs, cmd_start_job};
use tendril_app_lib::commands::plans::{
    cmd_get_plan, cmd_get_revision, cmd_list_plans, cmd_list_recommendations,
    cmd_list_verification_reports, cmd_set_recommendation_state, cmd_write_revision,
};
use tendril_app_lib::commands::{cmd_check_service_health, cmd_get_service_info};
use tendril_app_lib::service::{MasterDiscovery, TendrilClient};

/// Guards the process-global `TENDRIL_HOME` these tests point at their own
/// temp dirs. Async-aware, because it is held across the service startup and
/// every command call in a test.
async fn env_lock() -> tokio::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

/// The service binary, or `None` when this environment has none to run.
fn server_binary() -> Option<PathBuf> {
    let raw = std::env::var("TENDRIL_E2E_SERVER_BIN").ok()?;
    let path = PathBuf::from(shellexpand_home(raw.trim()));
    if path.is_file() {
        Some(path)
    } else {
        eprintln!(
            "TENDRIL_E2E_SERVER_BIN={} is not a file; skipping the real-service E2E suite",
            path.display()
        );
        None
    }
}

fn shellexpand_home(raw: &str) -> String {
    match raw.strip_prefix("~/") {
        Some(rest) => dirs::home_dir()
            .map(|home| home.join(rest).to_string_lossy().to_string())
            .unwrap_or_else(|| raw.to_string()),
        None => raw.to_string(),
    }
}

/// A free loopback port. Bound and immediately released, so the server can take
/// it; nothing else on this machine is listening on loopback ephemeral ports in
/// between in practice.
fn free_loopback_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
    listener.local_addr().expect("local addr").port()
}

/// Kills the spawned service even if a test panics part-way through.
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
}

impl Drop for ServiceProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Spawn the service on loopback against an isolated home, and wait until the
/// app's own client can reach it.
async fn start_real_service(bin: &Path, home: &Path) -> (ServiceProcess, u16) {
    let port = free_loopback_port();
    let log_path = home.join("service.log");
    let log = std::fs::File::create(&log_path).expect("create service log");
    let errlog = log.try_clone().expect("clone log handle");

    let child = Command::new(bin)
        .arg("--port")
        .arg(port.to_string())
        // Loopback only. The daemon holds a bearer secret in `.master`; it must
        // never be reachable off this machine.
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--home")
        .arg(home)
        .env("TENDRIL_HOME", home)
        // See the module docs: this one overrides TENDRIL_HOME for plans.
        .env_remove("TENDRIL_PLANS")
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(errlog))
        .spawn()
        .expect("spawn tendril-server");

    let service = ServiceProcess { child, log_path };

    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if home.join(".master").is_file() {
            let master = MasterDiscovery::with_home(home)
                .read_master()
                .expect("read .master written by the service");
            let client = TendrilClient::new(
                format!("http://127.0.0.1:{}", master.port),
                Some(master.secret.clone()),
            );
            if client.ping().await.is_ok() {
                assert_eq!(master.port, port, "the service took the port it was given");
                assert_eq!(master.host, "127.0.0.1", "the service must bind loopback");
                assert!(
                    !master.secret.is_empty(),
                    "the service must publish a bearer secret"
                );
                return (service, port);
            }
        }

        assert!(
            Instant::now() < deadline,
            "tendril-server did not become reachable within 30s. Log tail:\n{}",
            service.log_tail()
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// An isolated home with the service running against it, plus the seeded
/// project the plans belong to.
async fn isolated_service(bin: &Path) -> (TempDir, ServiceProcess, TendrilClient) {
    let temp = tempfile::tempdir().expect("tempdir");
    let home = temp.path().to_path_buf();
    std::fs::create_dir_all(home.join("Plans")).expect("create Plans dir");

    let (service, port) = start_real_service(bin, &home).await;
    std::env::set_var("TENDRIL_HOME", &home);

    let master = MasterDiscovery::with_home(&home)
        .read_master()
        .expect("read master");
    let client = TendrilClient::new(format!("http://127.0.0.1:{port}"), Some(master.secret));

    (temp, service, client)
}

#[tokio::test]
async fn the_operator_flow_works_against_a_real_service() {
    let _guard = env_lock().await;
    let Some(bin) = server_binary() else { return };
    let (temp, _service, client) = isolated_service(&bin).await;
    let home = temp.path();

    // 1. The service is discovered from `.master`, and the discovery result is
    //    safe to hand to the webview.
    let info = cmd_get_service_info().await.expect("service info");
    assert_eq!(info.state, "Connected", "message: {}", info.message);
    assert_eq!(info.tendril_home, home.to_string_lossy());
    assert!(!info.capabilities.is_empty());

    let health = cmd_check_service_health().await.expect("service health");
    assert!(health.is_healthy, "status: {}", health.status);

    let info_json = serde_json::to_string(&info).expect("serialize service info");
    assert!(
        !info_json.contains("secret"),
        "service info must not carry the daemon credential: {info_json}"
    );

    // 2. A fresh home has no plans, and the empty list is an empty list rather
    //    than an error.
    assert!(cmd_list_plans(None).await.expect("list plans").is_empty());
    assert!(cmd_list_jobs(None, None)
        .await
        .expect("list jobs")
        .is_empty());

    // 3. Seed one plan through the service's own API. This is a plain REST
    //    write: no job is started, so no coding agent runs.
    let created = client
        .create_plan(json!({
            "title": "E2E Seeded Plan",
            "project": "E2EProject",
            "level": "Feature",
            "repos": [home.join("repo").to_string_lossy()],
            "verifications": [
                { "name": "RustClippy", "status": "Pass" },
                { "name": "RustTest", "status": "Fail" },
                { "name": "CheckResult", "status": "Pending" }
            ]
        }))
        .await
        .expect("create plan");
    let plan_id = created["metadata"]["id"]
        .as_i64()
        .map(|id| format!("{id:05}"))
        .expect("created plan has a numeric metadata id");

    // 4. The list view sees it, mapped off the real `PlanFile` payload.
    let plans = cmd_list_plans(None).await.expect("list plans");
    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].id, plan_id);
    assert_eq!(plans[0].title, "E2E Seeded Plan");
    assert_eq!(plans[0].state, "Draft");
    assert_eq!(plans[0].verifications.len(), 3);

    // 5. Two revisions written through the app's own command, then read back —
    //    this is the data the Diff View compares.
    cmd_write_revision(
        plan_id.clone(),
        "# E2E Seeded Plan\n\nRevision one.\n".to_string(),
    )
    .await
    .expect("write revision 1");
    cmd_write_revision(
        plan_id.clone(),
        "# E2E Seeded Plan\n\nRevision two, with a change.\n".to_string(),
    )
    .await
    .expect("write revision 2");

    let plan = cmd_get_plan(plan_id.clone()).await.expect("plan detail");
    assert_eq!(
        plan.revision_count, 2,
        "revisionCount bounds the diff selectors"
    );
    let folder = plan
        .folder_path
        .clone()
        .expect("the service reports the plan folder");
    assert!(
        Path::new(&folder).starts_with(home),
        "the plan must live inside the isolated home, not {folder}"
    );

    let first = cmd_get_revision(plan_id.clone(), Some(1))
        .await
        .expect("revision 1");
    let second = cmd_get_revision(plan_id.clone(), Some(2))
        .await
        .expect("revision 2");
    assert!(first.contains("Revision one"));
    assert!(second.contains("Revision two"));
    assert_ne!(first, second, "the diff tab needs two different revisions");

    // 6. Verification reports, as ExecutePlan writes them: markdown with
    //    frontmatter under the plan folder. CheckResult has not run, so it has
    //    no file and must simply be absent rather than an error.
    let verification_dir = Path::new(&folder).join("Verification");
    std::fs::create_dir_all(&verification_dir).expect("create Verification dir");
    std::fs::write(
        verification_dir.join("RustClippy.md"),
        "---\nresult: Pass\ndate: 2026-09-07T11:00:00Z\n---\n# RustClippy\n\nNo warnings.\n",
    )
    .expect("write clippy report");
    std::fs::write(
        verification_dir.join("RustTest.md"),
        "---\nresult: Fail\ndate: 2026-09-07T11:05:00Z\n---\n# RustTest\n\n2 tests failed.\n",
    )
    .expect("write test report");

    let reports = cmd_list_verification_reports(plan_id.clone())
        .await
        .expect("list verification reports");
    assert_eq!(reports.len(), 2, "CheckResult has no report on disk");
    assert_eq!(reports[0].name, "RustClippy");
    assert_eq!(reports[0].result.as_deref(), Some("Pass"));
    assert_eq!(reports[1].result.as_deref(), Some("Fail"));
    assert!(reports[1].content.contains("2 tests failed"));

    // 7. A plan created without recommendations reports none, rather than the
    //    placeholder list the Review view used to show.
    let recommendations = cmd_list_recommendations(plan_id.clone())
        .await
        .expect("list recommendations");
    assert!(recommendations.is_empty());

    // 8. Nothing leaked outside the temp home.
    assert!(home.join(".master").is_file());
    assert!(home
        .join("Plans")
        .join(created["folder_name"].as_str().unwrap_or_default())
        .is_dir());
}

/// Seed a plan and return `(plan_id, folder_path)`.
async fn seed_plan(client: &TendrilClient, body: serde_json::Value) -> (String, String) {
    let created = client.create_plan(body).await.expect("create plan");
    let id = created["metadata"]["id"]
        .as_i64()
        .map(|id| format!("{id:05}"))
        .expect("created plan has a numeric metadata id");
    let folder = created["folder_path"]
        .as_str()
        .expect("created plan reports its folder")
        .to_string();
    (id, folder)
}

/// Poll a job until it stops moving. Jobs that fail before spawning a process
/// settle in well under a second; the generous deadline is only so a loaded
/// machine does not turn this into a flake.
async fn wait_for_terminal_job(job_id: &str) -> tendril_app_lib::models::JobDetailDto {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let job = cmd_get_job(job_id.to_string()).await.expect("job detail");
        if matches!(
            job.status.as_str(),
            "Completed" | "Failed" | "Stopped" | "Blocked" | "TimedOut"
        ) {
            return job;
        }
        assert!(
            Instant::now() < deadline,
            "job {job_id} never reached a terminal status (last: {})",
            job.status
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[tokio::test]
async fn a_job_blocked_by_its_dependency_never_starts_and_says_why() {
    let _guard = env_lock().await;
    let Some(bin) = server_binary() else { return };
    let (temp, _service, client) = isolated_service(&bin).await;

    // The dependency is left in Draft, which is the whole point: only a
    // Completed dependency satisfies the gate. It gets no PRs, so the gate never
    // reaches out to GitHub.
    let dep = client
        .create_plan(json!({
            "title": "Dependency Plan",
            "project": "E2EProject",
            "level": "Chore",
            "repos": [temp.path().join("repo").to_string_lossy()],
            "verifications": []
        }))
        .await
        .expect("create dependency plan");
    let dep_folder_name = dep["folder_name"]
        .as_str()
        .expect("dependency reports its folder name")
        .to_string();

    let (plan_id, folder_path) = seed_plan(
        &client,
        json!({
            "title": "Gated Plan",
            "project": "E2EProject",
            "level": "Feature",
            "repos": [temp.path().join("repo").to_string_lossy()],
            "verifications": [{ "name": "RustTest", "status": "Pending" }],
            "dependsOn": [dep_folder_name.clone()]
        }),
    )
    .await;

    let started = cmd_start_job(json!({ "type": "ExecutePlan", "folderPath": folder_path }))
        .await
        .expect("starting a blocked job is not itself an error");

    // `Blocked` is the JobStatus this plan added to the DTOs; the service decides
    // it synchronously, before allocating a process, so there is nothing to poll.
    let job = cmd_get_job(started.job_id.clone())
        .await
        .expect("job detail");
    assert_eq!(job.status, "Blocked");
    let message = job.status_message.expect("a blocked job explains itself");
    assert!(
        message.contains(&dep_folder_name) && message.contains("not Completed"),
        "the operator is told which dependency blocked them: {message}"
    );

    // The plan must not look like it started.
    let plan = cmd_get_plan(plan_id).await.expect("plan detail");
    assert_eq!(plan.state, "Blocked");

    // It is listed under its own status, so the dashboard can show it.
    let jobs = cmd_list_jobs(Some("Blocked".to_string()), None)
        .await
        .expect("list blocked jobs");
    assert!(jobs.iter().any(|j| j.id == started.job_id));

    // A blocked job has no process, but the service still lets it be cancelled,
    // which is how an operator clears one out of the list.
    cmd_cancel_job(started.job_id.clone(), Some("Not now".to_string()))
        .await
        .expect("a blocked job can be cancelled");
    let cancelled = cmd_get_job(started.job_id).await.expect("job detail");
    assert_eq!(cancelled.status, "Stopped");
}

#[tokio::test]
async fn a_job_that_fails_before_starting_reports_a_real_reason() {
    let _guard = env_lock().await;
    let Some(bin) = server_binary() else { return };
    let (temp, _service, client) = isolated_service(&bin).await;

    // No `Promptwares/ExecutePlan` exists under this temp home, so the runner
    // fails at the promptware lookup — before it builds an agent command line,
    // which is what keeps this test agent-free.
    let (plan_id, folder_path) = seed_plan(
        &client,
        json!({
            "title": "No Promptware Plan",
            "project": "E2EProject",
            "level": "Chore",
            "repos": [temp.path().join("repo").to_string_lossy()],
            "verifications": []
        }),
    )
    .await;

    let started = cmd_start_job(json!({ "type": "ExecutePlan", "folderPath": folder_path }))
        .await
        .expect("the job starts; it fails afterwards");
    let job = wait_for_terminal_job(&started.job_id).await;

    assert_eq!(job.status, "Failed");
    let message = job
        .status_message
        .expect("a failed job carries the reason the session header renders");
    assert!(
        message.contains("Promptware folder not found"),
        "the service's own reason survives to the command layer: {message}"
    );
    assert_eq!(job.job_type, "ExecutePlan");
    assert!(job.completed_at.is_some());

    // The plan is put back where it was rather than left Executing.
    let plan = cmd_get_plan(plan_id).await.expect("plan detail");
    assert_eq!(plan.state, "Draft");

    // Cancelling a job that already finished is a real error, not a silent
    // no-op — the cancel button in JobSessionView surfaces this rather than
    // pretending it worked.
    let err = cmd_cancel_job(started.job_id, None)
        .await
        .expect_err("a finished job cannot be cancelled");
    assert_eq!(err.code, "CANCEL_JOB_FAILED");
}

#[tokio::test]
async fn the_real_service_updates_recommendation_state() {
    let _guard = env_lock().await;
    let Some(bin) = server_binary() else { return };
    let (temp, _service, client) = isolated_service(&bin).await;

    let (plan_id, folder) = seed_plan(
        &client,
        json!({
            "title": "Recommendation Route Probe",
            "project": "E2EProject",
            "level": "Chore",
            "repos": [temp.path().join("repo").to_string_lossy()],
            "verifications": []
        }),
    )
    .await;

    // Seed a recommendation into plan.yaml on disk.
    let plan_yaml_path = Path::new(&folder).join("plan.yaml");
    let content = std::fs::read_to_string(&plan_yaml_path).expect("read plan.yaml");
    let updated = if content.contains("recommendations:") {
        content.replace(
            "recommendations: []",
            "recommendations:\n  - title: \"Tauri WebDriver E2E Automation\"\n    state: Pending",
        )
    } else {
        format!(
            "{content}\nrecommendations:\n  - title: \"Tauri WebDriver E2E Automation\"\n    state: Pending\n"
        )
    };
    std::fs::write(&plan_yaml_path, updated).expect("seed recommendation into plan.yaml");

    // Mutate the recommendation state via the app's command layer, which calls
    // PUT /api/plans/:id/recommendations/:title on the running service.
    cmd_set_recommendation_state(
        plan_id.clone(),
        "Tauri WebDriver E2E Automation".to_string(),
        "Accepted".to_string(),
        None,
        None,
    )
    .await
    .expect("update recommendation state");

    // Verify the state transition end-to-end against the real service.
    let recommendations = cmd_list_recommendations(plan_id)
        .await
        .expect("list recommendations");
    assert_eq!(recommendations.len(), 1);
    assert_eq!(recommendations[0].title, "Tauri WebDriver E2E Automation");
    assert_eq!(recommendations[0].state, "Accepted");
}
