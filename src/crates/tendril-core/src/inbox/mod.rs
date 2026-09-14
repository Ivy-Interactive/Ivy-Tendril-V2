//! Auto-import of GitHub issues assigned to the user.
//!
//! A sweep asks `gh` for the open issues assigned to `@me`, filters them to the repos the configured
//! projects actually own, and lands each new one as a row in `InboxProposals`. What happens next is
//! `inbox.autoAcceptAssignedIssues`: a `CreatePlan` job when it is on, a proposal waiting for a human
//! when it is off.
//!
//! Ported from the original's `AssignedIssuesAutoImportService`, with three deliberate differences:
//!
//! - The master check reads `.master` ([`crate::config::is_master`]) rather than a
//!   `TENDRIL_NOT_MASTER` environment variable, so it is right even for a process that lost the
//!   election after starting.
//! - `autoAcceptAssignedIssues == false` no longer aborts the sweep. The original imported nothing
//!   at all with the flag off; here the flag picks the landing mode, so a disabled flag still
//!   collects issues — it just refuses to plan them without a human.
//! - A `Dismissed` row is durable, so an issue the user said no to never comes back. The original's
//!   inbox file could simply be deleted, and the next pass re-imported it.

use crate::config::{is_master, TendrilSettings};
use crate::db::{get_plans, insert_proposal, list_proposals, open_database, set_proposal_state};
use crate::error::Result;
use crate::git::issues::{
    query_project_issues, resolve_project_github_repos, GitHubIssue, IssueCategory,
    IssueFilterParams,
};
use crate::jobs::JobManager;
use crate::models::{CreatePlanArgs, JobArgs, JobItem, PlanFile};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{Semaphore, SemaphorePermit};

/// Where a proposal stands. Every value is durable, `Dismissed` included — see the module docs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ProposalState {
    #[default]
    Pending,
    Accepted,
    Dismissed,
}

impl ProposalState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "Pending",
            Self::Accepted => "Accepted",
            Self::Dismissed => "Dismissed",
        }
    }

    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s
            .trim()
            .to_ascii_lowercase()
            .replace(['-', '_'], "")
            .as_str()
        {
            "pending" => Some(Self::Pending),
            "accepted" => Some(Self::Accepted),
            "dismissed" => Some(Self::Dismissed),
            _ => None,
        }
    }
}

impl std::fmt::Display for ProposalState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One swept issue, as stored. `id` is `0` until the row is inserted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxProposal {
    pub id: i64,
    pub number: u64,
    pub repository: String,
    pub title: String,
    pub body: String,
    pub issue_url: String,
    pub project: String,
    pub state: ProposalState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    pub discovered: String,
    pub updated: String,
}

impl InboxProposal {
    /// The `CreatePlan` description this proposal turns into. Identical to what
    /// [`build_proposal_description`] produced for the issue it came from, so accepting later is the
    /// same job as auto-accepting at sweep time — there is no second format to keep in sync.
    pub fn description(&self) -> String {
        render_description(
            self.number,
            &self.title,
            &self.body,
            Some(self.issue_url.as_str()),
            &self.project,
        )
    }
}

/// Why a sweep did nothing, or that it ran.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SweepOutcome {
    Ran,
    NotMaster,
    AlreadyRunning,
}

impl SweepOutcome {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ran => "Ran",
            Self::NotMaster => "NotMaster",
            Self::AlreadyRunning => "AlreadyRunning",
        }
    }
}

/// What one pass did.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepReport {
    /// New rows this pass.
    pub imported: Vec<InboxProposal>,
    /// Of those, the ones that started a `CreatePlan` job.
    pub accepted: usize,
    /// Already known: a proposal row in any state, an active job, or an existing plan.
    pub skipped: usize,
    /// Per-project `gh` failures and per-issue landing failures. Never fatal.
    pub errors: Vec<String>,
    pub outcome: SweepOutcome,
}

impl SweepReport {
    fn with_outcome(outcome: SweepOutcome) -> Self {
        Self {
            imported: Vec::new(),
            accepted: 0,
            skipped: 0,
            errors: Vec::new(),
            outcome,
        }
    }
}

/// An issue the fetch found, paired with the project whose repos it belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SweptIssue {
    pub issue: GitHubIssue,
    pub project: String,
}

/// Why an issue was skipped. Carried on [`SweepAction::Skip`] so a caller (and a test) can tell the
/// three dedup channels apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// A row already exists for this `(repository, number)`, in any state.
    ExistingProposal,
    /// A non-terminal `CreatePlan` job is already working on it.
    ActiveJob,
    /// A plan already records this issue as its source.
    ExistingPlan,
    /// No issue URL could be resolved, so there is nothing to dedup on.
    NoIssueUrl,
}

/// What to do about one swept issue. The decision is pure, so it can be tested without `gh`, a
/// database, or a job manager — see `plan_sweep_actions`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SweepAction {
    /// Insert a `Pending` row and stop there.
    Propose(InboxProposal),
    /// Insert a `Pending` row, then start a `CreatePlan` job and mark it `Accepted`.
    StartJob(InboxProposal),
    Skip {
        repository: String,
        number: u64,
        reason: SkipReason,
    },
}

/// The issue's canonical URL: what GitHub gave us, else one built from the repo and number, else
/// nothing at all. Ported from the original's `InboxApp.ResolveIssueUrl`.
pub fn resolve_issue_url(issue: &GitHubIssue) -> Option<String> {
    if let Some(url) = issue.url.as_deref() {
        if !url.trim().is_empty() {
            return Some(url.trim().to_string());
        }
    }
    let repo = issue.repository.as_deref()?.trim();
    if repo.is_empty() {
        return None;
    }
    Some(format!(
        "https://github.com/{}/issues/{}",
        repo, issue.number
    ))
}

fn render_description(
    number: u64,
    title: &str,
    body: &str,
    issue_url: Option<&str>,
    project: &str,
) -> String {
    let heading = match issue_url {
        Some(url) if !url.is_empty() => format!("[GitHub Issue #{}]({})", number, url),
        _ => format!("# Issue #{}: {}", number, title),
    };
    format!("---\nproject: {}\n---\n{}\n\n{}", project, heading, body)
}

/// The markdown a swept issue becomes, ported from the original's `InboxApp.BuildInboxFileContent`:
/// project front matter, a link to the issue (or a plain heading when no URL resolves), then the
/// body. CreatePlan extracts `sourceUrl` from that link itself, so no extra `CreatePlanArgs` field
/// is needed.
pub fn build_proposal_description(issue: &GitHubIssue, project: &str) -> String {
    render_description(
        issue.number,
        &issue.title,
        issue.body.as_deref().unwrap_or_default(),
        resolve_issue_url(issue).as_deref(),
        project,
    )
}

/// One permit, held for the length of a sweep. The direct analogue of the original's
/// `await _syncLock.WaitAsync(0)`, and — unlike an `AtomicBool` — released on panic by the permit's
/// `Drop`.
static SWEEP_IN_FLIGHT: Semaphore = Semaphore::const_new(1);

/// Takes the sweep's overlap permit, or `None` when a sweep is already in flight. Public so a test
/// can hold the permit and prove the guard bites; the sweep itself takes it the same way.
pub fn try_acquire_sweep_permit() -> Option<SemaphorePermit<'static>> {
    SWEEP_IN_FLIGHT.try_acquire().ok()
}

fn urls_equal(a: &str, b: &str) -> bool {
    a.trim_end_matches('/')
        .eq_ignore_ascii_case(b.trim_end_matches('/'))
}

/// Decides what to do about each swept issue, given everything already known. Pure: no `gh`, no
/// database, no job manager, so the dedup and landing rules are directly testable.
pub fn plan_sweep_actions(
    issues: &[SweptIssue],
    existing_proposals: &[InboxProposal],
    active_jobs: &[JobItem],
    plans: &[PlanFile],
    auto_accept: bool,
    now: &str,
) -> Vec<SweepAction> {
    let mut actions = Vec::with_capacity(issues.len());

    for swept in issues {
        let issue = &swept.issue;
        let repository = issue.repository.clone().unwrap_or_default();

        let Some(issue_url) = resolve_issue_url(issue) else {
            actions.push(SweepAction::Skip {
                repository,
                number: issue.number,
                reason: SkipReason::NoIssueUrl,
            });
            continue;
        };

        // 1. A row in any state — `Dismissed` included, which is the whole point of keeping it.
        if existing_proposals
            .iter()
            .any(|p| p.number == issue.number && p.repository.eq_ignore_ascii_case(&repository))
        {
            actions.push(SweepAction::Skip {
                repository,
                number: issue.number,
                reason: SkipReason::ExistingProposal,
            });
            continue;
        }

        // 2. A non-terminal CreatePlan job already describing this issue.
        let number_token = format!("#{}", issue.number);
        if active_jobs.iter().any(|job| match &job.typed_args {
            Some(JobArgs::CreatePlan(args)) => {
                args.description.contains(&issue_url) || args.description.contains(&number_token)
            }
            _ => false,
        }) {
            actions.push(SweepAction::Skip {
                repository,
                number: issue.number,
                reason: SkipReason::ActiveJob,
            });
            continue;
        }

        // 3. A plan already pointing at this issue.
        if plans.iter().any(|plan| {
            plan.metadata
                .source_url
                .as_deref()
                .is_some_and(|url| urls_equal(url, &issue_url))
                || plan
                    .metadata
                    .initial_prompt
                    .as_deref()
                    .is_some_and(|prompt| {
                        prompt
                            .to_ascii_lowercase()
                            .contains(&issue_url.to_ascii_lowercase())
                    })
        }) {
            actions.push(SweepAction::Skip {
                repository,
                number: issue.number,
                reason: SkipReason::ExistingPlan,
            });
            continue;
        }

        let proposal = InboxProposal {
            id: 0,
            number: issue.number,
            repository,
            title: issue.title.clone(),
            body: issue.body.clone().unwrap_or_default(),
            issue_url,
            project: swept.project.clone(),
            state: ProposalState::Pending,
            job_id: None,
            discovered: now.to_string(),
            updated: now.to_string(),
        };

        actions.push(if auto_accept {
            SweepAction::StartJob(proposal)
        } else {
            SweepAction::Propose(proposal)
        });
    }

    actions
}

/// Turns a `Pending` proposal into a `CreatePlan` job and records the job id against it. The single
/// place a proposal becomes a job: the sweep's auto-accept branch and the accept route both go
/// through here, so the two paths cannot drift.
pub async fn accept_proposal(
    conn: &Connection,
    job_manager: &Arc<JobManager>,
    proposal: &InboxProposal,
) -> Result<String> {
    let args = JobArgs::CreatePlan(CreatePlanArgs {
        description: proposal.description(),
        project: proposal.project.clone(),
        priority: 0,
        force: false,
        source_path: None,
        upload_session_id: None,
    });

    let job_id = job_manager.start_job(args).await?;
    set_proposal_state(
        conn,
        proposal.id,
        ProposalState::Accepted,
        Some(job_id.as_str()),
    )?;
    Ok(job_id)
}

/// Fetches the issues assigned to the user across every configured project, pairing each with the
/// project whose repos own it. A project whose `gh` call fails contributes a string to `errors` and
/// does not abort the others.
async fn fetch_assigned_issues(
    tendril_home: &Path,
    settings: &TendrilSettings,
    errors: &mut Vec<String>,
) -> Vec<SweptIssue> {
    let filters = IssueFilterParams {
        category: Some(IssueCategory::MyIssues),
        limit: Some(100),
        ..Default::default()
    };

    let mut swept = Vec::new();
    for project in &settings.projects {
        let repos = resolve_project_github_repos(project, tendril_home);
        if repos.is_empty() {
            continue;
        }

        match query_project_issues(&repos, &filters).await {
            Ok(page) => {
                for issue in page.issues {
                    // `MyIssues` already filtered to this project's repos, so the project is
                    // resolved for free — this is what replaces the original's
                    // `FindProjectForGithubRepo`.
                    swept.push(SweptIssue {
                        issue,
                        project: project.name.clone(),
                    });
                }
            }
            Err(e) => errors.push(format!(
                "Failed to fetch assigned issues for project {}: {}",
                project.name, e
            )),
        }
    }

    swept
}

/// One import pass. Never returns an error: a failure that only affects one project or one issue
/// belongs in `report.errors`, and the caller (a timer or a route) has nothing useful to do with a
/// hard failure anyway.
pub async fn run_assigned_issues_sweep(
    tendril_home: &Path,
    settings: &TendrilSettings,
    job_manager: &Arc<JobManager>,
) -> SweepReport {
    // Inside the sweep rather than only at the spawn site, so the manual-trigger route is covered
    // too — that path is reachable on a daemon that lost the election.
    if !is_master(tendril_home) {
        tracing::debug!("Skipping assigned issues auto-import: this process is not the master.");
        return SweepReport::with_outcome(SweepOutcome::NotMaster);
    }

    let Some(_permit) = try_acquire_sweep_permit() else {
        tracing::debug!("Assigned issues auto-import is already in progress.");
        return SweepReport::with_outcome(SweepOutcome::AlreadyRunning);
    };

    let mut report = SweepReport::with_outcome(SweepOutcome::Ran);

    let db_path = crate::config::get_database_path(tendril_home);
    let conn = match open_database(&db_path) {
        Ok(conn) => conn,
        Err(e) => {
            report
                .errors
                .push(format!("Failed to open database: {}", e));
            return report;
        }
    };

    let issues = fetch_assigned_issues(tendril_home, settings, &mut report.errors).await;
    if issues.is_empty() {
        return report;
    }

    let existing = match list_proposals(&conn, None) {
        Ok(rows) => rows,
        Err(e) => {
            report
                .errors
                .push(format!("Failed to list inbox proposals: {}", e));
            return report;
        }
    };
    let active_jobs = job_manager
        .list_non_terminal_jobs()
        .await
        .unwrap_or_else(|e| {
            report.errors.push(format!(
                "Failed to list active jobs; job-based dedup skipped this pass: {}",
                e
            ));
            Vec::new()
        });
    let plans = get_plans(&conn, None, None, None).unwrap_or_else(|e| {
        report.errors.push(format!(
            "Failed to list plans; plan-based dedup skipped this pass: {}",
            e
        ));
        Vec::new()
    });

    let now = chrono::Utc::now().to_rfc3339();
    let auto_accept = settings.inbox.auto_accept_assigned_issues;

    for action in plan_sweep_actions(&issues, &existing, &active_jobs, &plans, auto_accept, &now) {
        match action {
            SweepAction::Skip {
                repository,
                number,
                reason,
            } => {
                tracing::debug!(
                    "Skipping assigned issue {}#{}: {:?}",
                    repository,
                    number,
                    reason
                );
                report.skipped += 1;
            }
            SweepAction::Propose(mut proposal) => match insert_proposal(&conn, &proposal) {
                Ok(id) => {
                    proposal.id = id;
                    tracing::info!(
                        "Imported assigned issue {}#{} as a proposal for project {}.",
                        proposal.repository,
                        proposal.number,
                        proposal.project
                    );
                    report.imported.push(proposal);
                }
                Err(e) => report.errors.push(format!(
                    "Failed to record proposal for {}#{}: {}",
                    proposal.repository, proposal.number, e
                )),
            },
            SweepAction::StartJob(mut proposal) => {
                let id = match insert_proposal(&conn, &proposal) {
                    Ok(id) => id,
                    Err(e) => {
                        report.errors.push(format!(
                            "Failed to record proposal for {}#{}: {}",
                            proposal.repository, proposal.number, e
                        ));
                        continue;
                    }
                };
                proposal.id = id;

                // A `start_job` failure leaves the row `Pending`: the next pass will not retry it
                // (the row exists), but the user can still accept it by hand.
                match accept_proposal(&conn, job_manager, &proposal).await {
                    Ok(job_id) => {
                        tracing::info!(
                            "Auto-accepted assigned issue {}#{} into job {} for project {}.",
                            proposal.repository,
                            proposal.number,
                            job_id,
                            proposal.project
                        );
                        proposal.state = ProposalState::Accepted;
                        proposal.job_id = Some(job_id);
                        report.accepted += 1;
                    }
                    Err(e) => report.errors.push(format!(
                        "Recorded {}#{} but failed to start its CreatePlan job; accept it manually: {}",
                        proposal.repository, proposal.number, e
                    )),
                }
                report.imported.push(proposal);
            }
        }
    }

    report
}
