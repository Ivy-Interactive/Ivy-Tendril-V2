//! The storm shape from Ivy-Tendril#2710: N blockers finishing together, one `Blocked` row, N copies
//! of the same job started on one worktree.
//!
//! `restart_unblocked_jobs` deletes the stale `Blocked` row and starts a replacement. The delete is
//! the claim — SQLite serialises it, so exactly one concurrent release pass can be the one that
//! removed the row — and a pass that removed nothing must not start anything.
//!
//! No `Promptwares/ExecutePlan` is written and the spec builder panics if reached: a restart is
//! observed by the job it created, not by what that job then did.

mod common;

use common::{plan_with, HomeFixture};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tendril_core::config::{get_database_path, TendrilSettings};
use tendril_core::db::jobs::{delete_job, get_job, insert_job, list_jobs};
use tendril_core::db::open_database;
use tendril_core::jobs::dependents::{release_dependents, ReleaseReport};
use tendril_core::jobs::manager::{JobManager, SpecBuilder};
use tendril_core::models::{ExecutePlanArgs, JobArgs, JobItem, JobStatus, PlanStatus};
use tokio::sync::RwLock;

fn settings() -> TendrilSettings {
    TendrilSettings {
        max_concurrent_jobs: 4,
        ..Default::default()
    }
}

/// A spec builder that fails the test if the launch path ever reaches it.
fn panicking_spec_builder() -> SpecBuilder {
    Arc::new(|_provider, _config| panic!("no agent process may be spawned for this job"))
}

/// A fixture whose dependency is satisfied and whose `Blocked` job row is waiting to be restarted.
struct BlockedFixture {
    home: HomeFixture,
    dependent: std::path::PathBuf,
    manager: Arc<JobManager>,
    jobs_map: Arc<RwLock<HashMap<String, JobItem>>>,
}

impl BlockedFixture {
    fn new(label: &str) -> Self {
        let home = HomeFixture::new(label);

        // The blocker is done, so the gate the restart re-runs will now pass.
        let mut upstream = plan_with(PlanStatus::Completed, &[]);
        upstream.commits = vec!["abc1234".to_string()];
        home.write_plan("00002-Blocker", &upstream);

        let mut dependent_plan = plan_with(PlanStatus::Blocked, &[]);
        dependent_plan.depends_on = vec!["00002-Blocker".to_string()];
        let dependent = home.write_plan("00003-Waiting", &dependent_plan);

        let mut blocked = JobItem::new(
            "00900".to_string(),
            "ExecutePlan".to_string(),
            dependent.to_string_lossy().to_string(),
            "FixtureProject".to_string(),
        );
        blocked.status = JobStatus::Blocked;
        blocked.status_message = Some("Waiting for 00002-Blocker".to_string());
        let args = JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: dependent.to_string_lossy().to_string(),
            note: None,
        });
        // `typed_args` has no column of its own: it is rehydrated from the Args JSON, so a row
        // without that JSON is a row the restart path cannot act on at all.
        blocked.args = Some(serde_json::to_string(&args).expect("serialize job args"));
        blocked.typed_args = Some(args);
        {
            let conn =
                open_database(&get_database_path(&home.path)).expect("open fixture database");
            insert_job(&conn, &blocked).expect("insert blocked row");
        }

        let manager = JobManager::new(home.path.clone(), settings())
            .with_spec_builder(panicking_spec_builder())
            .with_plans_dir(Some(home.plans_dir()))
            .share();

        let jobs_map = Arc::new(RwLock::new(HashMap::from([("00900".to_string(), blocked)])));

        Self {
            home,
            dependent,
            manager,
            jobs_map,
        }
    }

    /// A finished blocker, as `finish_job` would hand it to the release path. It needs no row of its
    /// own: the release path reads its type and its id and nothing else.
    fn finisher(&self, id: &str) -> JobItem {
        JobItem::new(
            id.to_string(),
            "ExecutePlan".to_string(),
            self.home
                .plans_dir()
                .join("00002-Blocker")
                .to_string_lossy()
                .to_string(),
            "FixtureProject".to_string(),
        )
    }

    async fn release(&self, finished: &JobItem) -> ReleaseReport {
        release_dependents(
            &self.home.path,
            &self.home.plans_dir(),
            &self.jobs_map,
            Some(&self.manager),
            finished,
        )
        .await
    }

    fn blocked_row_survives(&self) -> bool {
        let conn =
            open_database(&get_database_path(&self.home.path)).expect("open fixture database");
        get_job(&conn, "00900").expect("query job row").is_some()
    }

    /// Every job row recorded against the dependent plan, whatever its status.
    fn rows_for_dependent(&self) -> Vec<JobItem> {
        let conn =
            open_database(&get_database_path(&self.home.path)).expect("open fixture database");
        let target = self.dependent.to_string_lossy().to_string();
        list_jobs(&conn, None, 500)
            .expect("list job rows")
            .into_iter()
            .filter(|j| j.plan_file == target)
            .collect()
    }
}

/// The union of restarts across the passes, deduplicated: two passes reporting the same id would
/// still be one restart, and that is what must be true.
fn restarts(reports: &[&ReleaseReport]) -> Vec<String> {
    let mut ids: Vec<String> = reports
        .iter()
        .flat_map(|r| r.restarted_jobs.iter().cloned())
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

fn assert_restarted_exactly_once(fixture: &BlockedFixture, reports: &[&ReleaseReport]) {
    let restarted = restarts(reports);
    assert_eq!(
        restarted.len(),
        1,
        "one Blocked row must yield one restart, got {:?}",
        restarted
    );
    assert!(
        !fixture.blocked_row_survives(),
        "the claimed row must be gone, not left behind for the next pass to claim again"
    );

    let rows = fixture.rows_for_dependent();
    assert_eq!(
        rows.len(),
        1,
        "exactly one job row may exist for the plan, got {:?}",
        rows.iter()
            .map(|j| (j.id.clone(), j.status))
            .collect::<Vec<_>>()
    );
    assert_eq!(rows[0].id, restarted[0]);
    assert_ne!(
        rows[0].status,
        JobStatus::Blocked,
        "the replacement passed the gate, so it must not be blocked again"
    );
}

/// The claim itself, on its own terms: two writers on two connections both try to remove one row,
/// and exactly one of them is told it did.
///
/// This is the property `restart_unblocked_jobs` leans on, and the only test here that isolates it.
/// The end-to-end tests below assert the invariant that matters — one restart — which the submission
/// dedupe gate would also enforce on its own, so they cannot tell the two fixes apart.
#[test]
fn only_one_of_two_concurrent_deletes_claims_the_row() {
    let home = HomeFixture::new("claim-primitive");
    let db_path = get_database_path(&home.path);
    {
        let conn = open_database(&db_path).expect("open fixture database");
        let mut job = JobItem::new(
            "00900".to_string(),
            "ExecutePlan".to_string(),
            String::new(),
            "FixtureProject".to_string(),
        );
        job.status = JobStatus::Blocked;
        insert_job(&conn, &job).expect("insert blocked row");
    }

    let barrier = Arc::new(std::sync::Barrier::new(2));
    let claims: Vec<bool> = (0..2)
        .map(|_| {
            let db_path = db_path.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                let conn = open_database(&db_path).expect("open database on this thread");
                barrier.wait();
                delete_job(&conn, "00900").expect("delete the blocked row")
            })
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|h| h.join().expect("claim thread"))
        .collect();

    assert_eq!(
        claims.iter().filter(|c| **c).count(),
        1,
        "exactly one writer may be told it removed the row, got {:?}",
        claims
    );
}

/// Two blockers finishing together: the release passes race, and one restart is the answer.
#[tokio::test]
async fn two_concurrent_release_passes_restart_a_blocked_row_once() {
    let fixture = BlockedFixture::new("claim-two-passes");
    let first = fixture.finisher("00800");
    let second = fixture.finisher("00801");

    let (a, b) = tokio::join!(fixture.release(&first), fixture.release(&second));

    assert_restarted_exactly_once(&fixture, &[&a, &b]);
    assert!(
        !fixture.jobs_map.read().await.contains_key("00900"),
        "the claimed row must be dropped from the in-memory map too"
    );
    // Both passes see the plan leave Blocked; only the row may be claimed once.
    assert!(
        a.unblocked_plans
            .iter()
            .chain(b.unblocked_plans.iter())
            .any(|p| p.contains("00003")),
        "the satisfied plan should be reported unblocked: {:?} / {:?}",
        a.unblocked_plans,
        b.unblocked_plans
    );
}

/// The N-blockers case, which is the one that produced N agents on one worktree.
#[tokio::test]
async fn three_concurrent_release_passes_restart_a_blocked_row_once() {
    let fixture = BlockedFixture::new("claim-three-passes");
    let first = fixture.finisher("00800");
    let second = fixture.finisher("00801");
    let third = fixture.finisher("00802");

    let (a, b, c) = tokio::join!(
        fixture.release(&first),
        fixture.release(&second),
        fixture.release(&third)
    );

    assert_restarted_exactly_once(&fixture, &[&a, &b, &c]);
}

/// A pass with no manager to start jobs with must leave the row alone rather than claim it and drop
/// it on the floor.
#[tokio::test]
async fn a_release_pass_without_a_manager_claims_nothing() {
    let fixture = BlockedFixture::new("claim-no-manager");
    let finished = fixture.finisher("00800");

    let report = release_dependents(
        &fixture.home.path,
        &fixture.home.plans_dir(),
        &fixture.jobs_map,
        None,
        &finished,
    )
    .await;

    assert!(report.restarted_jobs.is_empty());
    assert!(
        fixture.blocked_row_survives(),
        "an unclaimable row must survive for a later pass that can start jobs"
    );
    assert_eq!(
        fixture.rows_for_dependent()[0].status,
        JobStatus::Blocked,
        "and it must still be blocked"
    );
    assert!(Path::new(&fixture.dependent).is_dir());
}
