//! The assigned-issue sweep's decisions: what an issue becomes, and the three ways it gets skipped.
//!
//! Everything here drives `plan_sweep_actions` with fixture data, so `gh` is never invoked and no
//! database or job manager is needed. That is the reason the decision was factored out of
//! `run_assigned_issues_sweep` in the first place.

use chrono::Utc;
use tendril_core::git::issues::GitHubIssue;
use tendril_core::inbox::{
    build_proposal_description, plan_sweep_actions, resolve_issue_url, try_acquire_sweep_permit,
    InboxProposal, ProposalState, SkipReason, SweepAction, SweptIssue,
};
use tendril_core::models::{
    CreatePlanArgs, JobArgs, JobItem, JobStatus, PlanFile, PlanMetadata, PlanStatus,
};

const NOW: &str = "2026-01-01T00:00:00Z";
const REPO: &str = "Ivy-Interactive/Ivy-Tendril-V2";

fn issue(number: u64) -> GitHubIssue {
    GitHubIssue {
        number,
        title: format!("Something is broken ({})", number),
        body: Some("Steps to reproduce.".to_string()),
        labels: Vec::new(),
        assignees: vec!["me".to_string()],
        repository: Some(REPO.to_string()),
        url: Some(format!("https://github.com/{}/issues/{}", REPO, number)),
        updated_at: None,
        head_ref_name: None,
    }
}

fn swept(number: u64) -> SweptIssue {
    SweptIssue {
        issue: issue(number),
        project: "Ivy-Tendril-V2".to_string(),
    }
}

fn existing_proposal(number: u64, repository: &str, state: ProposalState) -> InboxProposal {
    InboxProposal {
        id: 1,
        number,
        repository: repository.to_string(),
        title: "Already known".to_string(),
        body: String::new(),
        issue_url: format!("https://github.com/{}/issues/{}", repository, number),
        project: "Ivy-Tendril-V2".to_string(),
        state,
        job_id: None,
        discovered: NOW.to_string(),
        updated: NOW.to_string(),
    }
}

fn create_plan_job(description: &str) -> JobItem {
    let mut job = JobItem::new(
        "00001".to_string(),
        "CreatePlan".to_string(),
        String::new(),
        "Ivy-Tendril-V2".to_string(),
    );
    job.status = JobStatus::Running;
    job.typed_args = Some(JobArgs::CreatePlan(CreatePlanArgs {
        description: description.to_string(),
        project: "Ivy-Tendril-V2".to_string(),
        priority: 0,
        force: false,
        source_path: None,
        upload_session_id: None,
    }));
    job
}

fn plan_with(source_url: Option<&str>, initial_prompt: Option<&str>) -> PlanFile {
    let now = Utc::now();
    PlanFile {
        metadata: PlanMetadata {
            id: 604,
            project: "Ivy-Tendril-V2".to_string(),
            level: "Feature".to_string(),
            title: "An existing plan".to_string(),
            state: PlanStatus::Draft,
            repos: Vec::new(),
            commits: Vec::new(),
            prs: Vec::new(),
            verifications: Vec::new(),
            related_plans: Vec::new(),
            depends_on: Vec::new(),
            created: now,
            updated: now,
            initial_prompt: initial_prompt.map(str::to_string),
            source_url: source_url.map(str::to_string),
            partial_delivery: false,
            chat_session_id: None,
        },
        latest_revision_content: String::new(),
        folder_path: "/plans/00604-Existing".to_string(),
        folder_name: "00604-Existing".to_string(),
        yaml_raw: String::new(),
        revision_count: 1,
    }
}

/// The common case: nothing known about the issue yet.
fn plan_one(swept_issues: &[SweptIssue], auto_accept: bool) -> SweepAction {
    let mut actions = plan_sweep_actions(swept_issues, &[], &[], &[], auto_accept, NOW);
    assert_eq!(actions.len(), 1, "one issue in, one action out");
    actions.remove(0)
}

#[test]
fn with_auto_accept_off_a_new_issue_becomes_a_proposal() {
    // The behaviour the whole plan turns on: an unattended sweep must not create plans.
    match plan_one(&[swept(7)], false) {
        SweepAction::Propose(proposal) => {
            assert_eq!(proposal.number, 7);
            assert_eq!(proposal.repository, REPO);
            assert_eq!(proposal.project, "Ivy-Tendril-V2");
            assert_eq!(proposal.state, ProposalState::Pending);
            assert_eq!(proposal.job_id, None);
            assert_eq!(proposal.id, 0, "the id is the table's to assign");
            assert_eq!(proposal.discovered, NOW);
            assert_eq!(proposal.updated, NOW);
            assert_eq!(
                proposal.issue_url,
                format!("https://github.com/{}/issues/7", REPO)
            );
        }
        other => panic!("expected Propose with auto-accept off, got {other:?}"),
    }
}

#[test]
fn with_auto_accept_on_a_new_issue_becomes_a_job() {
    match plan_one(&[swept(7)], true) {
        SweepAction::StartJob(proposal) => {
            assert_eq!(proposal.number, 7);
            assert_eq!(
                proposal.state,
                ProposalState::Pending,
                "the row lands Pending; only a started job moves it to Accepted"
            );
        }
        other => panic!("expected StartJob with auto-accept on, got {other:?}"),
    }
}

#[test]
fn an_issue_with_no_resolvable_url_is_skipped() {
    let mut no_url = swept(7);
    no_url.issue.url = None;
    no_url.issue.repository = None;

    match plan_one(&[no_url], false) {
        SweepAction::Skip { number, reason, .. } => {
            assert_eq!(number, 7);
            assert_eq!(reason, SkipReason::NoIssueUrl);
        }
        other => panic!("expected a NoIssueUrl skip, got {other:?}"),
    }
}

#[test]
fn an_existing_row_blocks_the_issue_in_every_state() {
    // Including Dismissed — that is what the durable row is for.
    for state in [
        ProposalState::Pending,
        ProposalState::Accepted,
        ProposalState::Dismissed,
    ] {
        let existing = [existing_proposal(7, REPO, state)];
        let actions = plan_sweep_actions(&[swept(7)], &existing, &[], &[], false, NOW);

        match &actions[0] {
            SweepAction::Skip { reason, .. } => assert_eq!(
                *reason,
                SkipReason::ExistingProposal,
                "a {state} row must block a re-import"
            ),
            other => panic!("expected a skip for a {state} row, got {other:?}"),
        }
    }
}

#[test]
fn an_existing_row_blocks_the_issue_despite_a_repo_casing_difference() {
    let existing = [existing_proposal(
        7,
        "ivy-interactive/ivy-tendril-v2",
        ProposalState::Dismissed,
    )];
    let actions = plan_sweep_actions(&[swept(7)], &existing, &[], &[], false, NOW);

    assert!(
        matches!(
            actions[0],
            SweepAction::Skip {
                reason: SkipReason::ExistingProposal,
                ..
            }
        ),
        "GitHub repo names are case-insensitive, got {:?}",
        actions[0]
    );
}

#[test]
fn an_active_create_plan_job_mentioning_the_url_blocks_the_issue() {
    let jobs = [create_plan_job(&build_proposal_description(
        &issue(7),
        "Ivy-Tendril-V2",
    ))];
    let actions = plan_sweep_actions(&[swept(7)], &[], &jobs, &[], false, NOW);

    match &actions[0] {
        SweepAction::Skip { reason, .. } => assert_eq!(*reason, SkipReason::ActiveJob),
        other => panic!("expected an ActiveJob skip, got {other:?}"),
    }
}

#[test]
fn an_active_create_plan_job_mentioning_only_the_number_blocks_the_issue() {
    // A plan created by hand from an issue may only carry `#7` in its description.
    let jobs = [create_plan_job("Fix the thing described in #7")];
    let actions = plan_sweep_actions(&[swept(7)], &[], &jobs, &[], false, NOW);

    match &actions[0] {
        SweepAction::Skip { reason, .. } => assert_eq!(*reason, SkipReason::ActiveJob),
        other => panic!("expected an ActiveJob skip, got {other:?}"),
    }
}

#[test]
fn an_unrelated_active_job_does_not_block_the_issue() {
    let jobs = [
        create_plan_job("Something else entirely"),
        // A non-CreatePlan job's args are never searched, whatever they contain.
        {
            let mut job = create_plan_job("ignored");
            job.typed_args = None;
            job.job_type = "ExecutePlan".to_string();
            job
        },
    ];
    let actions = plan_sweep_actions(&[swept(7)], &[], &jobs, &[], false, NOW);

    assert!(
        matches!(actions[0], SweepAction::Propose(_)),
        "an unrelated job must not suppress an import, got {:?}",
        actions[0]
    );
}

#[test]
fn a_plan_whose_source_url_is_the_issue_blocks_it() {
    let plans = [plan_with(
        Some(&format!("https://github.com/{}/issues/7", REPO)),
        None,
    )];
    let actions = plan_sweep_actions(&[swept(7)], &[], &[], &plans, false, NOW);

    match &actions[0] {
        SweepAction::Skip { reason, .. } => assert_eq!(*reason, SkipReason::ExistingPlan),
        other => panic!("expected an ExistingPlan skip, got {other:?}"),
    }
}

#[test]
fn a_plan_source_url_matches_across_trailing_slash_and_casing() {
    for source_url in [
        format!("https://github.com/{}/issues/7/", REPO),
        format!("https://GITHUB.com/{}/issues/7", REPO.to_lowercase()),
    ] {
        let plans = [plan_with(Some(&source_url), None)];
        let actions = plan_sweep_actions(&[swept(7)], &[], &[], &plans, false, NOW);

        assert!(
            matches!(
                actions[0],
                SweepAction::Skip {
                    reason: SkipReason::ExistingPlan,
                    ..
                }
            ),
            "{source_url} must match the issue URL, got {:?}",
            actions[0]
        );
    }
}

#[test]
fn a_plan_whose_prompt_quotes_the_issue_url_blocks_it() {
    let plans = [plan_with(
        None,
        Some(&format!(
            "Please look at https://github.com/{}/issues/7 and fix it",
            REPO
        )),
    )];
    let actions = plan_sweep_actions(&[swept(7)], &[], &[], &plans, false, NOW);

    match &actions[0] {
        SweepAction::Skip { reason, .. } => assert_eq!(*reason, SkipReason::ExistingPlan),
        other => panic!("expected an ExistingPlan skip, got {other:?}"),
    }
}

#[test]
fn an_unrelated_plan_does_not_block_the_issue() {
    let plans = [plan_with(
        Some(&format!("https://github.com/{}/issues/8", REPO)),
        Some("A plan about issue 8"),
    )];
    let actions = plan_sweep_actions(&[swept(7)], &[], &[], &plans, false, NOW);

    assert!(
        matches!(actions[0], SweepAction::Propose(_)),
        "issue 8's plan must not suppress issue 7, got {:?}",
        actions[0]
    );
}

#[test]
fn the_first_matching_channel_is_the_one_reported() {
    // All three channels match at once. The reason on the skip is what a log line and a test read, so
    // it must be the deterministic first one rather than whichever check happened to run.
    let existing = [existing_proposal(7, REPO, ProposalState::Pending)];
    let jobs = [create_plan_job("about #7")];
    let plans = [plan_with(
        Some(&format!("https://github.com/{}/issues/7", REPO)),
        None,
    )];
    let actions = plan_sweep_actions(&[swept(7)], &existing, &jobs, &plans, false, NOW);

    match &actions[0] {
        SweepAction::Skip { reason, .. } => assert_eq!(*reason, SkipReason::ExistingProposal),
        other => panic!("expected an ExistingProposal skip, got {other:?}"),
    }
}

#[test]
fn a_mixed_batch_yields_one_action_per_issue_in_order() {
    let existing = [existing_proposal(2, REPO, ProposalState::Dismissed)];
    let mut urlless = swept(3);
    urlless.issue.url = None;
    urlless.issue.repository = None;

    let actions = plan_sweep_actions(
        &[swept(1), swept(2), urlless, swept(4)],
        &existing,
        &[],
        &[],
        false,
        NOW,
    );

    assert_eq!(actions.len(), 4);
    assert!(matches!(&actions[0], SweepAction::Propose(p) if p.number == 1));
    assert!(matches!(
        &actions[1],
        SweepAction::Skip {
            number: 2,
            reason: SkipReason::ExistingProposal,
            ..
        }
    ));
    assert!(matches!(
        &actions[2],
        SweepAction::Skip {
            number: 3,
            reason: SkipReason::NoIssueUrl,
            ..
        }
    ));
    assert!(matches!(&actions[3], SweepAction::Propose(p) if p.number == 4));
}

#[test]
fn no_issues_means_no_actions() {
    assert!(plan_sweep_actions(&[], &[], &[], &[], true, NOW).is_empty());
}

#[test]
fn resolve_issue_url_prefers_the_given_url_then_builds_one() {
    let mut with_url = issue(7);
    with_url.url = Some("  https://example.com/i/7  ".to_string());
    assert_eq!(
        resolve_issue_url(&with_url).as_deref(),
        Some("https://example.com/i/7"),
        "a supplied URL wins, trimmed"
    );

    let mut blank_url = issue(7);
    blank_url.url = Some("   ".to_string());
    assert_eq!(
        resolve_issue_url(&blank_url).as_deref(),
        Some(format!("https://github.com/{}/issues/7", REPO).as_str()),
        "a blank URL falls back to one built from the repo"
    );

    let mut nothing = issue(7);
    nothing.url = None;
    nothing.repository = Some("  ".to_string());
    assert_eq!(
        resolve_issue_url(&nothing),
        None,
        "no URL and no repo means nothing to dedup on"
    );
}

#[test]
fn the_description_carries_project_front_matter_and_a_link_to_the_issue() {
    let rendered = build_proposal_description(&issue(7), "Ivy-Tendril-V2");

    assert_eq!(
        rendered,
        format!(
            "---\nproject: Ivy-Tendril-V2\n---\n[GitHub Issue #7](https://github.com/{}/issues/7)\n\nSteps to reproduce.",
            REPO
        ),
        "CreatePlan reads the project from the front matter and sourceUrl from the link"
    );
}

#[test]
fn the_description_falls_back_to_a_heading_when_no_url_resolves() {
    let mut nothing = issue(7);
    nothing.url = None;
    nothing.repository = None;
    let rendered = build_proposal_description(&nothing, "Ivy-Tendril-V2");

    assert_eq!(
        rendered,
        "---\nproject: Ivy-Tendril-V2\n---\n# Issue #7: Something is broken (7)\n\nSteps to reproduce."
    );
}

#[test]
fn accepting_a_proposal_later_builds_the_same_description_as_auto_accepting_now() {
    // The two paths must not drift: the job a user accepts by hand tomorrow is the job the sweep
    // would have started today.
    let at_sweep_time = build_proposal_description(&issue(7), "Ivy-Tendril-V2");

    let proposal = match plan_one(&[swept(7)], false) {
        SweepAction::Propose(p) => p,
        other => panic!("expected Propose, got {other:?}"),
    };

    assert_eq!(proposal.description(), at_sweep_time);
}

#[test]
fn the_overlap_guard_admits_one_holder_at_a_time() {
    let first =
        try_acquire_sweep_permit().expect("the guard must be free at the start of this test");
    assert!(
        try_acquire_sweep_permit().is_none(),
        "a second sweep must be turned away rather than run concurrently"
    );

    drop(first);
    assert!(
        try_acquire_sweep_permit().is_some(),
        "the permit must come back once the first holder is done"
    );
}
