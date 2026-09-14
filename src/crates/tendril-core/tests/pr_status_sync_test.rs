//! The reconciliation pass: what it costs, what it records, and which plans it is allowed to move.
//!
//! No test here touches `gh` or the network — the batch fetcher is injected, and the tests that
//! assert a guard holds inject a fetcher that panics if it is called at all.

mod common;

use chrono::{Duration, TimeZone, Utc};
use common::{plan_state, plan_with, HomeFixture};
use rusqlite::Connection;
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use tendril_core::config::get_database_path;
use tendril_core::db::open_database;
use tendril_core::db::pr_status::{get_pr_status, upsert_pr_status};
use tendril_core::error::{Result, TendrilError};
use tendril_core::git::github::PrInfo;
use tendril_core::git::pr_sync::sync_pr_statuses_with;
use tendril_core::models::{parse_pr_url, PlanStatus, PrState, PrStatusRecord, VerificationStatus};

const PR_7: &str = "https://github.com/acme/widgets/pull/7";
const PR_8: &str = "https://github.com/acme/widgets/pull/8";
const PR_OTHER_REPO: &str = "https://github.com/acme/gadgets/pull/3";

fn open_fixture_db(home: &HomeFixture) -> Connection {
    open_database(&get_database_path(&home.path)).expect("open fixture database")
}

fn ten_minutes() -> Duration {
    Duration::seconds(10 * 60)
}

/// A stand-in for `gh pr list`, one entry per repository, that records every call it receives.
struct FakeGitHub {
    /// `None` means the call fails, as an unreachable GitHub or an unauthenticated `gh` would.
    repos: BTreeMap<(String, String), Option<HashMap<String, PrInfo>>>,
    calls: RefCell<Vec<(String, String)>>,
}

impl FakeGitHub {
    fn new() -> Self {
        Self {
            repos: BTreeMap::new(),
            calls: RefCell::new(Vec::new()),
        }
    }

    fn with_pr(mut self, url: &str, status: PrState, branch: Option<&str>) -> Self {
        let (owner, repo, _) = parse_pr_url(url).expect("fixture URL must parse");
        self.repos
            .entry((owner, repo))
            .or_insert_with(|| Some(HashMap::new()))
            .as_mut()
            .expect("cannot add a PR to a failing repository")
            .insert(
                url.to_string(),
                PrInfo {
                    status,
                    branch: branch.map(|b| b.to_string()),
                },
            );
        self
    }

    /// Registers a repository that answers, but without the given PR in its window.
    fn with_empty_repo(mut self, owner: &str, repo: &str) -> Self {
        self.repos
            .entry((owner.to_string(), repo.to_string()))
            .or_insert_with(|| Some(HashMap::new()));
        self
    }

    fn failing(mut self, owner: &str, repo: &str) -> Self {
        self.repos
            .insert((owner.to_string(), repo.to_string()), None);
        self
    }

    fn fetch(&self, owner: &str, repo: &str) -> Result<HashMap<String, PrInfo>> {
        self.calls
            .borrow_mut()
            .push((owner.to_string(), repo.to_string()));
        match self.repos.get(&(owner.to_string(), repo.to_string())) {
            Some(Some(map)) => Ok(map.clone()),
            Some(None) => Err(TendrilError::Git(
                "gh: could not resolve host github.com".to_string(),
            )),
            None => Ok(HashMap::new()),
        }
    }

    fn call_count(&self) -> usize {
        self.calls.borrow().len()
    }
}

/// A fetcher that must never run. Any call is a rate-limit guard that stopped working.
fn never_called_fetcher(owner: &str, repo: &str) -> Result<HashMap<String, PrInfo>> {
    panic!("the batch fetcher must not be called, but was asked about {owner}/{repo}");
}

fn cache_row(conn: &Connection, url: &str, status: PrState, last_checked_ago: Duration) {
    let (owner, repo, number) = parse_pr_url(url).expect("fixture URL must parse");
    upsert_pr_status(
        conn,
        &PrStatusRecord {
            pr_url: url.to_string(),
            owner,
            repo,
            number,
            status,
            branch: None,
            last_checked: Utc::now() - last_checked_ago,
        },
    )
    .expect("seed cache row");
}

#[test]
fn a_merged_pr_completes_the_plan() {
    let home = HomeFixture::new("pr-sync-complete");
    let conn = open_fixture_db(&home);
    let mut plan = plan_with(PlanStatus::Review, &[("Build", VerificationStatus::Pass)]);
    plan.prs = vec![PR_7.to_string()];
    let folder = home.write_plan("00010-Upstream", &plan);
    let fake = FakeGitHub::new().with_pr(PR_7, PrState::Merged, Some("tendril/00010"));

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| fake.fetch(o, r),
        Utc::now(),
        ten_minutes(),
    )
    .expect("sync must not fail");

    assert_eq!(report.tracked, 1);
    assert_eq!(report.checked, 1);
    assert_eq!(report.completed_plans, vec!["00010-Upstream".to_string()]);
    assert!(report.refused_completions.is_empty());
    assert_eq!(plan_state(&folder), "Completed");
    assert!(report.changed());

    let cached = get_pr_status(&conn, PR_7).unwrap().expect("cached row");
    assert_eq!(cached.status, PrState::Merged);
    assert_eq!(cached.branch.as_deref(), Some("tendril/00010"));
}

#[test]
fn an_open_pr_stays_open_and_does_not_complete_the_plan() {
    let home = HomeFixture::new("pr-sync-open");
    let conn = open_fixture_db(&home);
    let mut plan = plan_with(PlanStatus::Review, &[("Build", VerificationStatus::Pass)]);
    plan.prs = vec![PR_7.to_string()];
    let folder = home.write_plan("00008-Waiting", &plan);
    let fake = FakeGitHub::new().with_pr(PR_7, PrState::Open, Some("tendril/00008-Waiting"));

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| fake.fetch(o, r),
        Utc::now(),
        ten_minutes(),
    )
    .unwrap();

    assert_eq!(
        plan_state(&folder),
        "Review",
        "an open PR is not a delivery"
    );
    assert!(report.completed_plans.is_empty());
    assert!(report.refused_completions.is_empty());

    let cached = get_pr_status(&conn, PR_7).unwrap().expect("cached row");
    assert_eq!(cached.status, PrState::Open);
    assert_eq!(cached.branch.as_deref(), Some("tendril/00008-Waiting"));
}

/// A PR closed without merging is not a delivery either, so the plan stays where it is.
#[test]
fn a_closed_unmerged_pr_does_not_complete_the_plan() {
    let home = HomeFixture::new("pr-sync-closed-unmerged");
    let conn = open_fixture_db(&home);
    let mut plan = plan_with(PlanStatus::Review, &[("Build", VerificationStatus::Pass)]);
    plan.prs = vec![PR_7.to_string()];
    let folder = home.write_plan("00009-Abandoned", &plan);
    let fake = FakeGitHub::new().with_pr(PR_7, PrState::Closed, Some("tendril/00009-Abandoned"));

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| fake.fetch(o, r),
        Utc::now(),
        ten_minutes(),
    )
    .unwrap();

    assert_eq!(plan_state(&folder), "Review");
    assert!(report.completed_plans.is_empty());
    assert!(report.refused_completions.is_empty());
    assert_eq!(
        get_pr_status(&conn, PR_7).unwrap().unwrap().status,
        PrState::Closed
    );
}

#[test]
fn a_closed_pr_cannot_move_a_completed_plan_off_completed() {
    let home = HomeFixture::new("pr-sync-closed-completed");
    let conn = open_fixture_db(&home);
    let mut plan = plan_with(PlanStatus::Completed, &[]);
    plan.prs = vec![PR_7.to_string()];
    let folder = home.write_plan("00011-Done", &plan);
    let fake = FakeGitHub::new().with_pr(PR_7, PrState::Closed, None);

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| fake.fetch(o, r),
        Utc::now(),
        ten_minutes(),
    )
    .unwrap();

    // The status is still recorded — only the plan state is off limits.
    assert_eq!(report.checked, 1);
    assert_eq!(
        get_pr_status(&conn, PR_7).unwrap().unwrap().status,
        PrState::Closed
    );
    assert_eq!(plan_state(&folder), "Completed");
    assert!(report.completed_plans.is_empty());
}

#[test]
fn a_merged_pr_cannot_revive_a_skipped_plan() {
    let home = HomeFixture::new("pr-sync-skipped");
    let conn = open_fixture_db(&home);
    let mut plan = plan_with(PlanStatus::Skipped, &[]);
    plan.prs = vec![PR_7.to_string()];
    let folder = home.write_plan("00012-Skipped", &plan);
    let fake = FakeGitHub::new().with_pr(PR_7, PrState::Merged, None);

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| fake.fetch(o, r),
        Utc::now(),
        ten_minutes(),
    )
    .unwrap();

    assert_eq!(plan_state(&folder), "Skipped");
    assert!(report.completed_plans.is_empty());
}

#[test]
fn a_merged_pr_cannot_complete_a_plan_with_a_failed_verification() {
    let home = HomeFixture::new("pr-sync-failed-verification");
    let conn = open_fixture_db(&home);
    let mut plan = plan_with(PlanStatus::Review, &[("Build", VerificationStatus::Fail)]);
    plan.prs = vec![PR_7.to_string()];
    let folder = home.write_plan("00013-Failing", &plan);
    let fake = FakeGitHub::new().with_pr(PR_7, PrState::Merged, None);

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| fake.fetch(o, r),
        Utc::now(),
        ten_minutes(),
    )
    .unwrap();

    assert_ne!(plan_state(&folder), "Completed");
    assert!(report.completed_plans.is_empty());
    assert_eq!(report.refused_completions.len(), 1);
    assert!(
        report.refused_completions[0].contains("00013-Failing"),
        "the refusal should name the plan: {:?}",
        report.refused_completions
    );
}

#[test]
fn an_executing_plan_is_left_alone_even_when_its_pr_merges() {
    let home = HomeFixture::new("pr-sync-executing");
    let conn = open_fixture_db(&home);
    let mut plan = plan_with(PlanStatus::Executing, &[]);
    plan.prs = vec![PR_7.to_string()];
    let folder = home.write_plan("00014-InFlight", &plan);
    let fake = FakeGitHub::new().with_pr(PR_7, PrState::Merged, None);

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| fake.fetch(o, r),
        Utc::now(),
        ten_minutes(),
    )
    .unwrap();

    assert_eq!(plan_state(&folder), "Executing", "a job owns this plan");
    assert!(report.completed_plans.is_empty());
    assert!(report.refused_completions.is_empty());
    assert_eq!(report.checked, 1, "the status is still cached");
}

#[test]
fn an_already_merged_pr_is_not_re_fetched() {
    let home = HomeFixture::new("pr-sync-skip-merged");
    let conn = open_fixture_db(&home);
    let mut plan = plan_with(PlanStatus::Completed, &[]);
    plan.prs = vec![PR_7.to_string()];
    home.write_plan("00015-Merged", &plan);
    // Old enough that only the merged-guard can be keeping it out of the fetch.
    cache_row(&conn, PR_7, PrState::Merged, Duration::days(30));

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &never_called_fetcher,
        Utc::now(),
        ten_minutes(),
    )
    .unwrap();

    assert_eq!(report.skipped_merged, 1);
    assert_eq!(report.checked, 0);
    assert!(!report.changed());
}

#[test]
fn a_recently_checked_pr_is_not_re_fetched() {
    let home = HomeFixture::new("pr-sync-skip-fresh");
    let conn = open_fixture_db(&home);
    let mut plan = plan_with(PlanStatus::Review, &[]);
    plan.prs = vec![PR_7.to_string()];
    home.write_plan("00016-Fresh", &plan);
    cache_row(&conn, PR_7, PrState::Open, Duration::seconds(30));

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &never_called_fetcher,
        Utc::now(),
        ten_minutes(),
    )
    .unwrap();

    assert_eq!(report.skipped_fresh, 1);
    assert_eq!(report.checked, 0);
}

#[test]
fn prs_across_two_repos_cost_one_call_each() {
    let home = HomeFixture::new("pr-sync-buckets");
    let conn = open_fixture_db(&home);
    let mut plan = plan_with(PlanStatus::Review, &[]);
    plan.prs = vec![
        PR_7.to_string(),
        PR_8.to_string(),
        PR_OTHER_REPO.to_string(),
    ];
    home.write_plan("00017-ThreePrs", &plan);
    let fake = FakeGitHub::new()
        .with_pr(PR_7, PrState::Open, None)
        .with_pr(PR_8, PrState::Merged, None)
        .with_pr(PR_OTHER_REPO, PrState::Open, None);

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| fake.fetch(o, r),
        Utc::now(),
        ten_minutes(),
    )
    .unwrap();

    assert_eq!(report.tracked, 3);
    assert_eq!(report.checked, 3);
    assert_eq!(
        fake.call_count(),
        2,
        "three PRs in two repositories are two calls, not three"
    );
}

#[test]
fn a_fetch_failure_is_reported_not_returned() {
    let home = HomeFixture::new("pr-sync-fetch-failure");
    let conn = open_fixture_db(&home);
    let mut plan = plan_with(PlanStatus::Review, &[]);
    plan.prs = vec![PR_7.to_string()];
    let folder = home.write_plan("00018-Unreachable", &plan);
    let fake = FakeGitHub::new().failing("acme", "widgets");

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| fake.fetch(o, r),
        Utc::now(),
        ten_minutes(),
    )
    .expect("an unreachable GitHub is not a failed pass");

    assert_eq!(report.errors.len(), 1);
    assert!(
        report.errors[0].contains("acme/widgets"),
        "the error should name the repository: {:?}",
        report.errors
    );
    assert_eq!(report.checked, 0);
    assert!(
        get_pr_status(&conn, PR_7).unwrap().is_none(),
        "a failed fetch must not write a guessed status"
    );
    assert_eq!(plan_state(&folder), "Review");
}

#[test]
fn a_tracked_pr_missing_from_the_response_is_recorded_unknown() {
    let home = HomeFixture::new("pr-sync-missing");
    let conn = open_fixture_db(&home);
    let mut plan = plan_with(PlanStatus::Review, &[]);
    plan.prs = vec![PR_7.to_string()];
    home.write_plan("00019-Phantom", &plan);
    // The repository answers, but this PR is outside the window it returned.
    let fake = FakeGitHub::new().with_empty_repo("acme", "widgets");

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| fake.fetch(o, r),
        Utc::now(),
        ten_minutes(),
    )
    .unwrap();

    assert_eq!(
        get_pr_status(&conn, PR_7).unwrap().unwrap().status,
        PrState::Unknown,
        "a missing PR is Unknown, never a guessed Open"
    );
    assert_eq!(report.transitions.len(), 1);
    assert_eq!(report.transitions[0].to, PrState::Unknown);
    assert_eq!(report.transitions[0].from, None);
}

#[test]
fn unblocking_costs_no_github_calls() {
    let home = HomeFixture::new("pr-sync-unblock-free");
    let conn = open_fixture_db(&home);

    let mut upstream = plan_with(PlanStatus::Completed, &[]);
    upstream.prs = vec![PR_7.to_string()];
    home.write_plan("00020-Upstream", &upstream);

    let mut dependent = plan_with(PlanStatus::Blocked, &[]);
    dependent.depends_on = vec!["00020-Upstream".to_string()];
    let dependent_folder = home.write_plan("00021-Dependent", &dependent);

    // The upstream PR is cached as merged, so the pass has nothing to fetch and the gate reads the
    // cache instead of `gh`.
    cache_row(&conn, PR_7, PrState::Merged, Duration::days(3));

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &never_called_fetcher,
        Utc::now(),
        ten_minutes(),
    )
    .unwrap();

    assert_eq!(report.unblocked_plans, vec!["00021-Dependent".to_string()]);
    assert_eq!(plan_state(&dependent_folder), "Draft");
}

#[test]
fn a_pr_url_recorded_with_a_files_suffix_is_the_same_pr() {
    let home = HomeFixture::new("pr-sync-canonical");
    let conn = open_fixture_db(&home);

    let mut one = plan_with(PlanStatus::Review, &[]);
    one.prs = vec![PR_7.to_string()];
    home.write_plan("00022-One", &one);

    let mut two = plan_with(PlanStatus::Review, &[]);
    two.prs = vec![format!("{}/files", PR_7)];
    home.write_plan("00023-Two", &two);

    let fake = FakeGitHub::new().with_pr(PR_7, PrState::Merged, None);
    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| fake.fetch(o, r),
        Utc::now(),
        ten_minutes(),
    )
    .unwrap();

    assert_eq!(report.tracked, 1, "two spellings of one PR are one PR");
    assert_eq!(report.checked, 1);
    assert_eq!(fake.call_count(), 1);
    // Both plans see the merge.
    assert_eq!(report.completed_plans.len(), 2);
}

#[test]
fn merging_a_dependency_pr_unblocks_the_dependent() {
    let home = HomeFixture::new("pr-sync-unblock");
    let conn = open_fixture_db(&home);

    let mut upstream = plan_with(PlanStatus::Review, &[]);
    upstream.prs = vec![PR_7.to_string()];
    let upstream_folder = home.write_plan("00024-Upstream", &upstream);

    let mut dependent = plan_with(PlanStatus::Blocked, &[]);
    dependent.depends_on = vec!["00024-Upstream".to_string()];
    let dependent_folder = home.write_plan("00025-Dependent", &dependent);

    // Pass 1: the PR is open, so nothing moves.
    let open = FakeGitHub::new().with_pr(PR_7, PrState::Open, Some("tendril/00024"));
    let first = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| open.fetch(o, r),
        Utc::now(),
        ten_minutes(),
    )
    .unwrap();
    assert!(first.completed_plans.is_empty());
    assert!(first.unblocked_plans.is_empty());
    assert_eq!(plan_state(&dependent_folder), "Blocked");

    // Pass 2, after the freshness window: the PR has merged, so the upstream completes and the
    // dependent goes back to Draft in the same pass.
    let merged = FakeGitHub::new().with_pr(PR_7, PrState::Merged, Some("tendril/00024"));
    let later = Utc::now() + ten_minutes() + Duration::seconds(1);
    let second = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| merged.fetch(o, r),
        later,
        ten_minutes(),
    )
    .unwrap();

    assert_eq!(second.completed_plans, vec!["00024-Upstream".to_string()]);
    assert_eq!(second.unblocked_plans, vec!["00025-Dependent".to_string()]);
    assert_eq!(plan_state(&upstream_folder), "Completed");
    assert_eq!(plan_state(&dependent_folder), "Draft");
    assert_eq!(second.transitions.len(), 1);
    assert_eq!(second.transitions[0].from, Some(PrState::Open));
    assert_eq!(second.transitions[0].to, PrState::Merged);
}

/// A plan folder whose `plan.yaml` cannot be parsed must not take the whole pass down with it.
#[test]
fn an_unreadable_plan_is_skipped() {
    let home = HomeFixture::new("pr-sync-unreadable");
    let conn = open_fixture_db(&home);
    let mut plan = plan_with(PlanStatus::Review, &[]);
    plan.prs = vec![PR_7.to_string()];
    home.write_plan("00026-Good", &plan);

    let broken = home.plans_dir().join("00027-Broken");
    std::fs::create_dir_all(&broken).unwrap();
    std::fs::write(broken.join("plan.yaml"), "state: [unterminated\n").unwrap();

    let fake = FakeGitHub::new().with_pr(PR_7, PrState::Open, None);
    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &|o, r| fake.fetch(o, r),
        Utc::now(),
        ten_minutes(),
    )
    .expect("one bad plan must not fail the pass");

    assert_eq!(report.tracked, 1);
    assert_eq!(report.checked, 1);
}

/// Nothing tracked means no calls, no writes and nothing reported as changed.
#[test]
fn a_plan_set_with_no_prs_costs_nothing() {
    let home = HomeFixture::new("pr-sync-empty");
    let conn = open_fixture_db(&home);
    home.write_plan("00028-NoPrs", &plan_with(PlanStatus::Draft, &[]));

    let report = sync_pr_statuses_with(
        &conn,
        &home.plans_dir(),
        &never_called_fetcher,
        Utc.with_ymd_and_hms(2026, 9, 14, 12, 0, 0).unwrap(),
        ten_minutes(),
    )
    .unwrap();

    assert_eq!(report.tracked, 0);
    assert_eq!(report.checked, 0);
    assert!(!report.changed());
}
