//! Reconciles the `PrStatuses` cache with GitHub, completes plans whose PRs have all merged, and
//! unblocks the plans that were waiting on them.
//!
//! Three guards keep the `gh` call count bounded, in the order they apply:
//!
//! 1. A URL cached as `Merged` is never re-checked — a merge is terminal on GitHub's side.
//! 2. A URL checked within `min_interval` is left alone.
//! 3. The survivors are bucketed by `owner/repo` and cost **one** `gh` call per bucket. The unblock
//!    pass that follows reads the cache and costs none at all.
//!
//! A tracked URL missing from its repository's `--limit 100` window is recorded as `Unknown` rather
//! than defaulting to `Open`: guessing is how a busy repository ends up reporting healthy PRs as
//! phantom, and `Unknown` is exactly what the doctor check exists to investigate on demand.

use crate::db::pr_status::{get_all_pr_statuses, upsert_pr_status};
use crate::error::{Result, TendrilError};
use crate::git::github::{block_on_gh, fetch_repo_pr_statuses, PrInfo};
use crate::jobs::manager::apply_plan_state;
use crate::models::{canonical_pr_url, parse_pr_url, PlanStatus, PrState, PrStatusRecord};
use crate::plans::dependencies::unblock_satisfied_plans_with;
use crate::plans::reader::read_plan_yaml;
use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

/// How long a checked PR stays fresh. Ten minutes, matching the original service's check interval.
pub const DEFAULT_MIN_CHECK_INTERVAL_SECS: i64 = 10 * 60;

pub fn default_min_check_interval() -> Duration {
    Duration::seconds(DEFAULT_MIN_CHECK_INTERVAL_SECS)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrTransition {
    pub pr_url: String,
    pub from: Option<PrState>,
    pub to: PrState,
}

#[derive(Debug, Clone, Default)]
pub struct PrSyncReport {
    /// Valid PR URLs found across all plans, deduped by canonical URL.
    pub tracked: usize,
    /// URLs actually resolved this pass.
    pub checked: usize,
    pub skipped_merged: usize,
    /// `LastChecked` within `min_interval`.
    pub skipped_fresh: usize,
    pub transitions: Vec<PrTransition>,
    /// Folder names moved to `Completed` because every PR on them merged.
    pub completed_plans: Vec<String>,
    /// Folder names a guard refused to complete, with the reason.
    pub refused_completions: Vec<String>,
    pub unblocked_plans: Vec<String>,
    /// Per-repository failures. Never fatal: GitHub being unreachable is not "the pass failed".
    pub errors: Vec<String>,
}

impl PrSyncReport {
    /// Whether this pass changed anything a reader would care about. Drives both the log level and
    /// the `pr_status_changed` broadcast.
    pub fn changed(&self) -> bool {
        !self.transitions.is_empty()
            || !self.completed_plans.is_empty()
            || !self.unblocked_plans.is_empty()
    }
}

/// Injectable batch fetcher, so tests never touch `gh` or the network.
pub type RepoPrFetcher<'a> = &'a dyn Fn(&str, &str) -> Result<HashMap<String, PrInfo>>;

/// One reconciliation pass against the real `gh` CLI.
///
/// Blocking rather than `async`: it holds a `rusqlite::Connection`, which is not `Send`, so an
/// `async fn` over it could never be awaited from an axum handler. Callers on the reactor run it
/// inside `spawn_blocking`; the `gh` calls themselves still go through the one async fetch path (see
/// [`block_on_gh`]).
pub fn sync_pr_statuses(conn: &Connection, plans_dir: &Path) -> Result<PrSyncReport> {
    sync_pr_statuses_with(
        conn,
        plans_dir,
        &gh_repo_fetcher,
        Utc::now(),
        default_min_check_interval(),
    )
}

fn gh_repo_fetcher(owner: &str, repo: &str) -> Result<HashMap<String, PrInfo>> {
    block_on_gh(fetch_repo_pr_statuses(owner, repo))
}

/// One tracked pull request and the plans that record it.
struct TrackedPr {
    owner: String,
    repo: String,
    number: u64,
}

pub fn sync_pr_statuses_with(
    conn: &Connection,
    plans_dir: &Path,
    fetch: RepoPrFetcher,
    now: DateTime<Utc>,
    min_interval: Duration,
) -> Result<PrSyncReport> {
    let mut report = PrSyncReport::default();

    // 1. Collect. An unreadable plan is skipped, never fatal.
    let mut tracked: BTreeMap<String, TrackedPr> = BTreeMap::new();
    let mut plan_prs: BTreeMap<PathBuf, Vec<String>> = BTreeMap::new();
    if plans_dir.exists() {
        for entry in std::fs::read_dir(plans_dir)?.flatten() {
            let folder = entry.path();
            if !folder.is_dir() || !folder.join("plan.yaml").exists() {
                continue;
            }
            let Ok((plan, _)) = read_plan_yaml(&folder) else {
                continue;
            };
            for raw in &plan.prs {
                let Some((owner, repo, number)) = parse_pr_url(raw) else {
                    continue;
                };
                let key = canonical_pr_url(raw).unwrap_or_else(|| raw.clone());
                tracked.entry(key.clone()).or_insert(TrackedPr {
                    owner,
                    repo,
                    number,
                });
                let urls = plan_prs.entry(folder.clone()).or_default();
                if !urls.contains(&key) {
                    urls.push(key);
                }
            }
        }
    }
    report.tracked = tracked.len();

    // 2. Filter: skip terminal (merged) and fresh rows.
    let cached: HashMap<String, PrStatusRecord> = get_all_pr_statuses(conn)?
        .into_iter()
        .map(|rec| (rec.pr_url.clone(), rec))
        .collect();
    let fresh_since = now - min_interval;

    let mut to_check: Vec<String> = Vec::new();
    for url in tracked.keys() {
        match cached.get(url) {
            Some(rec) if rec.status == PrState::Merged => report.skipped_merged += 1,
            Some(rec) if rec.last_checked > fresh_since => report.skipped_fresh += 1,
            _ => to_check.push(url.clone()),
        }
    }

    // 3. Group by repository — one call per bucket, never one per PR.
    let mut buckets: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
    for url in to_check {
        let t = &tracked[&url];
        buckets
            .entry((t.owner.clone(), t.repo.clone()))
            .or_default()
            .push(url);
    }

    for ((owner, repo), urls) in buckets {
        let fetched = match fetch(&owner, &repo) {
            Ok(map) => map,
            Err(e) => {
                report.errors.push(format!("{}/{}: {}", owner, repo, e));
                continue;
            }
        };

        for url in urls {
            // 4. A tracked URL absent from the response is Unknown, not a guessed Open.
            let info = fetched.get(&url).cloned().unwrap_or_else(PrInfo::unknown);
            let previous = cached.get(&url).map(|rec| rec.status);
            if previous != Some(info.status) {
                report.transitions.push(PrTransition {
                    pr_url: url.clone(),
                    from: previous,
                    to: info.status,
                });
            }

            // 5. Upsert with `now` as LastChecked.
            let t = &tracked[&url];
            upsert_pr_status(
                conn,
                &PrStatusRecord {
                    pr_url: url.clone(),
                    owner: t.owner.clone(),
                    repo: t.repo.clone(),
                    number: t.number,
                    status: info.status,
                    branch: info.branch,
                    last_checked: now,
                },
            )?;
            report.checked += 1;
        }
    }

    // The cache as it now stands drives both completion and unblocking.
    let current: HashMap<String, PrState> = get_all_pr_statuses(conn)?
        .into_iter()
        .map(|rec| (rec.pr_url, rec.status))
        .collect();

    // 6. Complete the plans whose every PR has merged.
    for (folder, urls) in &plan_prs {
        if urls.is_empty() {
            continue;
        }
        let Ok((plan, _)) = read_plan_yaml(folder) else {
            continue;
        };
        let state = PlanStatus::from_str_loose(&plan.state);

        // A job owns an in-flight plan right now; a sync pass must not race it.
        if matches!(
            state,
            Some(PlanStatus::Creating | PlanStatus::Updating | PlanStatus::Executing)
        ) {
            continue;
        }
        // Terminal plans are immutable, and one already `Completed` is not a completion event.
        if matches!(state, Some(PlanStatus::Completed | PlanStatus::Skipped)) {
            continue;
        }
        if !urls
            .iter()
            .all(|url| current.get(url) == Some(&PrState::Merged))
        {
            continue;
        }

        let name = folder_name(folder);
        apply_plan_state(folder, PlanStatus::Completed);

        // `apply_plan_state` refuses rather than errors (a failed verification blocks completion), so
        // the state is re-read to find out which happened.
        match read_plan_yaml(folder).ok().map(|(p, _)| p.state) {
            Some(after) if after.eq_ignore_ascii_case(PlanStatus::Completed.as_str()) => {
                report.completed_plans.push(name)
            }
            Some(after) => report.refused_completions.push(format!(
                "{}: completion refused, state is still '{}'",
                name, after
            )),
            None => report
                .refused_completions
                .push(format!("{}: plan.yaml could not be re-read", name)),
        }
    }

    // 7. Unblock, reading PR state from the cache: this pass costs zero gh calls.
    let cached_resolver = |url: &str| -> Result<String> {
        let key = canonical_pr_url(url).unwrap_or_else(|| url.to_string());
        match current.get(&key) {
            Some(state) => Ok(state.as_str().to_uppercase()),
            // A cache miss is an `Err`, which the gate turns into a block rather than a failure.
            None => Err(TendrilError::Git(format!(
                "PR {} has no cached status yet",
                url
            ))),
        }
    };
    report.unblocked_plans = unblock_satisfied_plans_with(plans_dir, &cached_resolver)?;

    Ok(report)
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string()
}
