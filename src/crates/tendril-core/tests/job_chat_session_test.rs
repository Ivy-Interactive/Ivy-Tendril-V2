//! The link between a job and the conversation that started it.
//!
//! This is what makes the chat's header list the jobs it set running, and what lets the daemon tell
//! that conversation when one finishes. V1 carries it as `Jobs.ChatSessionId`
//! (`Migration_026_JobsInboxFileAndChatSessionId`), fed by `tendril job start --chat-session` with a
//! `TENDRIL_CHAT_SESSION_ID` fallback, and inherited from the plan a job names when neither was given.
//!
//! Before this existed the only mechanism was scraping the agent's stdout for `Job started: <id>`, so a
//! job started any other way — through the MCP tool, from the interactive terminal, or on a request
//! whose confirmation was lost — was invisible to the conversation that asked for it.
//!
//! Nothing here launches an agent: no `Promptwares` folder is written, so an accepted job stops at the
//! promptware gate, and the spec builder panics if the launch path is ever reached.

mod common;

use common::{plan_with, HomeFixture};
use std::path::Path;
use std::sync::Arc;
use tendril_core::config::{get_database_path, TendrilSettings};
use tendril_core::db::jobs::{get_job, insert_job, list_jobs_for_chat_session};
use tendril_core::db::open_database;
use tendril_core::jobs::manager::{JobManager, SpecBuilder, StartOptions};
use tendril_core::models::{
    CreatePlanArgs, ExecutePlanArgs, JobArgs, JobItem, JobStatus, PlanStatus,
};

fn panicking_spec_builder() -> SpecBuilder {
    Arc::new(|_provider, _config| panic!("no agent process may be spawned for this job"))
}

fn manager_for(home: &HomeFixture) -> JobManager {
    JobManager::new(
        home.path.clone(),
        TendrilSettings {
            max_concurrent_jobs: 2,
            ..Default::default()
        },
    )
    .with_spec_builder(panicking_spec_builder())
    .with_plans_dir(Some(home.plans_dir()))
}

fn execute(folder: &Path) -> JobArgs {
    JobArgs::ExecutePlan(ExecutePlanArgs {
        folder_path: folder.to_string_lossy().to_string(),
        note: None,
    })
}

fn create_plan(description: &str) -> JobArgs {
    JobArgs::CreatePlan(CreatePlanArgs {
        description: description.to_string(),
        project: "FixtureProject".to_string(),
        priority: 0,
        force: false,
        source_path: None,
        upload_session_id: None,
    })
}

fn from_chat(chat_session_id: &str) -> StartOptions {
    StartOptions {
        chat_session_id: Some(chat_session_id.to_string()),
        ..Default::default()
    }
}

fn row_of(home: &HomeFixture, id: &str) -> JobItem {
    let conn = open_database(&get_database_path(&home.path)).expect("open fixture database");
    get_job(&conn, id)
        .expect("query job row")
        .expect("job row exists")
}

fn jobs_of_session(home: &HomeFixture, chat_session_id: &str) -> Vec<JobItem> {
    let conn = open_database(&get_database_path(&home.path)).expect("open fixture database");
    list_jobs_for_chat_session(&conn, chat_session_id).expect("list jobs for chat session")
}

/// A plan that already belongs to a conversation, which is what a plan's own side-panel chat leaves
/// behind and what `CreatePlan` now stamps onto the plan it produces.
fn plan_owned_by(
    home: &HomeFixture,
    folder_name: &str,
    chat_session_id: &str,
) -> std::path::PathBuf {
    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.chat_session_id = Some(chat_session_id.to_string());
    home.write_plan(folder_name, &plan)
}

#[tokio::test]
async fn a_job_started_from_a_chat_records_that_conversation() {
    let home = HomeFixture::new("chat-session-records");
    let manager = manager_for(&home);

    let id = manager
        .start_job_with(create_plan("Add a login form"), from_chat("sess-alpha"))
        .await
        .expect("start CreatePlan from a chat");

    assert_eq!(
        row_of(&home, &id).chat_session_id.as_deref(),
        Some("sess-alpha"),
        "the conversation that started the job should be on its row"
    );

    let listed = jobs_of_session(&home, "sess-alpha");
    assert_eq!(
        listed.iter().map(|j| j.id.clone()).collect::<Vec<_>>(),
        vec![id],
        "the job should be findable by its conversation without knowing its id"
    );
}

/// The case the scrape could never cover: a `CreatePlan` has no plan to inherit from, so this is the
/// only route by which the conversation is known.
#[tokio::test]
async fn a_job_started_outside_a_chat_records_no_conversation() {
    let home = HomeFixture::new("chat-session-absent");
    let manager = manager_for(&home);

    let id = manager
        .start_job(create_plan("Add a logout form"))
        .await
        .expect("start CreatePlan from a terminal");

    assert_eq!(
        row_of(&home, &id).chat_session_id,
        None,
        "a job nobody started from a chat has no conversation to report to"
    );
    assert!(
        jobs_of_session(&home, "sess-alpha").is_empty(),
        "an unlinked job must not be attributed to some other conversation"
    );
}

/// V1's `JobService.ResolvePlanChatSessionId`. This is what links `tendril job start ExecutePlan 00007`
/// typed by an agent that forgot the flag, when the plan is already the subject of a conversation.
#[tokio::test]
async fn a_job_naming_a_plan_inherits_that_plans_conversation() {
    let home = HomeFixture::new("chat-session-inherit");
    let folder = plan_owned_by(&home, "00007-PortTheChat", "sess-plan");
    let manager = manager_for(&home);

    let id = manager
        .start_job(execute(&folder))
        .await
        .expect("start ExecutePlan with no chat session of its own");

    assert_eq!(
        row_of(&home, &id).chat_session_id.as_deref(),
        Some("sess-plan"),
        "a job on a plan that belongs to a conversation belongs to it too"
    );
}

#[tokio::test]
async fn an_explicit_conversation_wins_over_the_plans() {
    let home = HomeFixture::new("chat-session-explicit-wins");
    let folder = plan_owned_by(&home, "00008-PortTheChat", "sess-plan");
    let manager = manager_for(&home);

    let id = manager
        .start_job_with(execute(&folder), from_chat("sess-caller"))
        .await
        .expect("start ExecutePlan from a different chat");

    assert_eq!(
        row_of(&home, &id).chat_session_id.as_deref(),
        Some("sess-caller"),
        "the conversation that actually asked for the job is the one it reports to"
    );
}

#[tokio::test]
async fn listing_a_conversations_jobs_leaves_out_other_conversations_and_cleared_rows() {
    let home = HomeFixture::new("chat-session-listing");
    let conn = open_database(&get_database_path(&home.path)).expect("open fixture database");

    let seed = |id: &str, chat: Option<&str>, cleared: bool| {
        let mut job = JobItem::new(
            id.to_string(),
            "CreatePlan".to_string(),
            String::new(),
            "FixtureProject".to_string(),
        );
        job.status = JobStatus::Completed;
        job.chat_session_id = chat.map(str::to_string);
        job.cleared = cleared;
        insert_job(&conn, &job).expect("insert seeded job row");
    };

    seed("00001", Some("sess-alpha"), false);
    seed("00002", Some("sess-beta"), false);
    seed("00003", None, false);
    // Cleared is the user having dismissed the job from the list; it should not come back in a header.
    seed("00004", Some("sess-alpha"), true);
    seed("00005", Some("sess-alpha"), false);

    let listed: Vec<String> = list_jobs_for_chat_session(&conn, "sess-alpha")
        .expect("list jobs for chat session")
        .into_iter()
        .map(|j| j.id)
        .collect();

    assert_eq!(
        listed,
        vec!["00001".to_string(), "00005".to_string()],
        "only this conversation's uncleared jobs, oldest first"
    );
}

/// A status write carries no chat session, and must not be able to erase one — the reason the upsert
/// coalesces this column instead of taking `excluded`.
#[tokio::test]
async fn a_later_write_cannot_clear_an_established_link() {
    let home = HomeFixture::new("chat-session-preserved");
    let manager = manager_for(&home);

    let id = manager
        .start_job_with(create_plan("Add a signup form"), from_chat("sess-alpha"))
        .await
        .expect("start CreatePlan from a chat");

    manager
        .update_job_status(&id, "still working", Some("00042"), Some("Some Plan"))
        .await
        .expect("report job status");

    let row = row_of(&home, &id);
    assert_eq!(
        row.chat_session_id.as_deref(),
        Some("sess-alpha"),
        "a status report must leave the conversation link alone"
    );
    assert_eq!(row.reported_plan_id.as_deref(), Some("00042"));
}

/// The wire name the app reads. `chatSessionId` is what `JobDto`/`Job` expect, and a mismatch here
/// would leave the header with no way to tell whose job it is.
#[test]
fn the_link_travels_as_chat_session_id() {
    let mut job = JobItem::new(
        "00042".to_string(),
        "CreatePlan".to_string(),
        String::new(),
        "FixtureProject".to_string(),
    );
    job.chat_session_id = Some("sess-alpha".to_string());

    let wire = serde_json::to_value(&job).expect("serialize job");
    assert_eq!(wire["chatSessionId"], "sess-alpha");

    let back: JobItem = serde_json::from_value(wire).expect("deserialize job");
    assert_eq!(back.chat_session_id.as_deref(), Some("sess-alpha"));

    // Absent rather than null for a job with no conversation, so an older client sees no new key.
    job.chat_session_id = None;
    let wire = serde_json::to_value(&job).expect("serialize job");
    assert!(wire.get("chatSessionId").is_none());
}
