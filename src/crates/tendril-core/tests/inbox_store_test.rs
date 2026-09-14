//! `InboxProposals` reads and writes.
//!
//! The table is what makes a decision about an assigned issue stick: a row exists for every issue the
//! importer has ever swept, in every state, and its presence is the sweep's first dedup channel. So
//! these tests care as much about what *survives* a write as about the write itself.

use std::path::PathBuf;
use tendril_core::db::{
    get_proposal, insert_proposal, list_proposals, open_database, proposal_exists,
    set_proposal_state,
};
use tendril_core::inbox::{InboxProposal, ProposalState};

struct TempDir(PathBuf);

impl TempDir {
    fn new(prefix: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("{}-{}", prefix, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    fn path(&self) -> &PathBuf {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn setup_test_db(prefix: &str) -> (TempDir, rusqlite::Connection) {
    let temp_dir = TempDir::new(prefix);
    let db_path = temp_dir.path().join("tendril.db");
    let conn = open_database(&db_path).expect("open database");
    (temp_dir, conn)
}

fn proposal(number: u64, repository: &str) -> InboxProposal {
    InboxProposal {
        id: 0,
        number,
        repository: repository.to_string(),
        title: format!("Issue {}", number),
        body: "Body text.".to_string(),
        issue_url: format!("https://github.com/{}/issues/{}", repository, number),
        project: "FixtureProject".to_string(),
        state: ProposalState::Pending,
        job_id: None,
        discovered: "2026-01-01T00:00:00Z".to_string(),
        updated: "2026-01-01T00:00:00Z".to_string(),
    }
}

#[test]
fn a_fresh_database_carries_the_proposals_table() {
    let (_dir, conn) = setup_test_db("tendril-inbox-schema");

    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='InboxProposals')",
            [],
            |r| r.get(0),
        )
        .expect("query sqlite_master");
    assert!(exists, "a database V2 created must carry InboxProposals");
}

#[test]
fn a_proposal_round_trips_through_insert_and_get() {
    let (_dir, conn) = setup_test_db("tendril-inbox-roundtrip");
    let written = proposal(42, "Ivy-Interactive/Ivy-Tendril-V2");

    let id = insert_proposal(&conn, &written).expect("insert must succeed");
    assert!(id > 0, "the table assigns the id, got {id}");

    let read = get_proposal(&conn, id)
        .expect("get must succeed")
        .expect("the row just inserted must be found");

    assert_eq!(
        read,
        InboxProposal { id, ..written },
        "every field must survive the round trip unchanged"
    );
}

#[test]
fn get_proposal_returns_none_for_an_unknown_id() {
    let (_dir, conn) = setup_test_db("tendril-inbox-missing");

    assert!(
        get_proposal(&conn, 9999)
            .expect("a miss is not an error")
            .is_none(),
        "an id nobody wrote must read as None, which is what the route turns into a 404"
    );
}

#[test]
fn list_proposals_returns_newest_first_and_filters_by_state() {
    let (_dir, conn) = setup_test_db("tendril-inbox-list");
    let first = insert_proposal(&conn, &proposal(1, "acme/one")).expect("insert 1");
    let second = insert_proposal(&conn, &proposal(2, "acme/one")).expect("insert 2");
    let third = insert_proposal(&conn, &proposal(3, "acme/one")).expect("insert 3");

    let all = list_proposals(&conn, None).expect("unfiltered list");
    assert_eq!(
        all.iter().map(|p| p.id).collect::<Vec<_>>(),
        vec![third, second, first],
        "newest first, so the UI shows the most recent sweep at the top"
    );

    set_proposal_state(&conn, second, ProposalState::Dismissed, None).expect("dismiss");

    let pending = list_proposals(&conn, Some(ProposalState::Pending)).expect("pending list");
    assert_eq!(
        pending.iter().map(|p| p.id).collect::<Vec<_>>(),
        vec![third, first]
    );

    let dismissed = list_proposals(&conn, Some(ProposalState::Dismissed)).expect("dismissed list");
    assert_eq!(
        dismissed.iter().map(|p| p.id).collect::<Vec<_>>(),
        vec![second]
    );
}

#[test]
fn inserting_the_same_issue_twice_is_a_no_op_that_returns_the_first_id() {
    // Two sweeps can overlap in principle — a timer pass and a manual trigger on different
    // daemons — and one issue must never become two proposals.
    let (_dir, conn) = setup_test_db("tendril-inbox-dup");
    let first = insert_proposal(&conn, &proposal(7, "acme/repo")).expect("first insert");

    let mut again = proposal(7, "acme/repo");
    again.title = "A title from the second sweep".to_string();
    let second = insert_proposal(&conn, &again).expect("a duplicate insert must not error");

    assert_eq!(second, first, "the existing row's id must come back");
    let rows = list_proposals(&conn, None).expect("list");
    assert_eq!(rows.len(), 1, "still one row for one issue");
    assert_eq!(
        rows[0].title, "Issue 7",
        "the first write wins: a no-op insert must not silently rewrite the row"
    );
}

#[test]
fn the_same_number_in_a_different_repo_is_a_separate_proposal() {
    let (_dir, conn) = setup_test_db("tendril-inbox-two-repos");
    insert_proposal(&conn, &proposal(1, "acme/one")).expect("insert acme/one#1");
    insert_proposal(&conn, &proposal(1, "acme/two")).expect("insert acme/two#1");

    assert_eq!(
        list_proposals(&conn, None).expect("list").len(),
        2,
        "uniqueness is (Repository, Number), not Number alone"
    );
}

#[test]
fn accepting_records_the_job_id_and_dismissing_later_keeps_it() {
    let (_dir, conn) = setup_test_db("tendril-inbox-jobid");
    let id = insert_proposal(&conn, &proposal(11, "acme/repo")).expect("insert");

    set_proposal_state(&conn, id, ProposalState::Accepted, Some("01234")).expect("accept");
    let accepted = get_proposal(&conn, id).expect("get").expect("row exists");
    assert_eq!(accepted.state, ProposalState::Accepted);
    assert_eq!(accepted.job_id.as_deref(), Some("01234"));

    set_proposal_state(&conn, id, ProposalState::Dismissed, None).expect("dismiss");
    let dismissed = get_proposal(&conn, id).expect("get").expect("row exists");
    assert_eq!(dismissed.state, ProposalState::Dismissed);
    assert_eq!(
        dismissed.job_id.as_deref(),
        Some("01234"),
        "a None job id must leave the existing one alone: the job really did run"
    );
}

#[test]
fn a_state_change_stamps_updated_without_touching_discovered() {
    let (_dir, conn) = setup_test_db("tendril-inbox-stamps");
    let id = insert_proposal(&conn, &proposal(12, "acme/repo")).expect("insert");
    let before = get_proposal(&conn, id).expect("get").expect("row exists");

    set_proposal_state(&conn, id, ProposalState::Accepted, None).expect("accept");
    let after = get_proposal(&conn, id).expect("get").expect("row exists");

    assert_eq!(
        after.discovered, before.discovered,
        "when we first saw the issue does not change"
    );
    assert_ne!(
        after.updated, before.updated,
        "the decision time must be recorded"
    );
}

#[test]
fn proposal_exists_matches_regardless_of_repo_casing() {
    let (_dir, conn) = setup_test_db("tendril-inbox-exists");
    insert_proposal(&conn, &proposal(5, "Ivy-Interactive/Ivy-Tendril-V2")).expect("insert");

    assert!(proposal_exists(&conn, "Ivy-Interactive/Ivy-Tendril-V2", 5).expect("exact"));
    assert!(
        proposal_exists(&conn, "ivy-interactive/ivy-tendril-v2", 5).expect("lowercased"),
        "GitHub repo names are case-insensitive; a casing difference must not re-import an issue"
    );
    assert!(!proposal_exists(&conn, "Ivy-Interactive/Ivy-Tendril-V2", 6).expect("other number"));
    assert!(!proposal_exists(&conn, "acme/elsewhere", 5).expect("other repo"));
}

#[test]
fn a_dismissed_row_is_still_there_to_block_the_next_sweep() {
    // The reason the table exists at all. The original wrote a markdown file per issue, so deleting
    // the file brought a rejected issue straight back on the next pass.
    let (dir, conn) = setup_test_db("tendril-inbox-durable");
    let id = insert_proposal(&conn, &proposal(99, "acme/repo")).expect("insert");
    set_proposal_state(&conn, id, ProposalState::Dismissed, None).expect("dismiss");
    drop(conn);

    let reopened = open_database(&dir.path().join("tendril.db")).expect("reopen database");
    assert!(
        proposal_exists(&reopened, "acme/repo", 99).expect("exists"),
        "a dismissal must outlive the process that made it"
    );
    assert_eq!(
        get_proposal(&reopened, id)
            .expect("get")
            .expect("row exists")
            .state,
        ProposalState::Dismissed
    );
}

#[test]
fn a_state_this_version_does_not_know_reads_as_pending() {
    // Forward compatibility: a row written by a later version must still be listable rather than
    // failing the whole read and hiding every other proposal with it.
    let (_dir, conn) = setup_test_db("tendril-inbox-unknown-state");
    let id = insert_proposal(&conn, &proposal(3, "acme/repo")).expect("insert");
    conn.execute(
        "UPDATE InboxProposals SET State = 'Snoozed' WHERE Id = ?1",
        rusqlite::params![id],
    )
    .expect("write an unrecognised state");

    let read = get_proposal(&conn, id)
        .expect("get must not error")
        .expect("row exists");
    assert_eq!(read.state, ProposalState::Pending);
    assert_eq!(list_proposals(&conn, None).expect("list").len(), 1);
}

#[test]
fn proposal_state_parses_loosely_and_prints_canonically() {
    for (input, want) in [
        ("Pending", ProposalState::Pending),
        ("pending", ProposalState::Pending),
        ("  ACCEPTED  ", ProposalState::Accepted),
        ("dis_missed", ProposalState::Dismissed),
        ("dis-missed", ProposalState::Dismissed),
    ] {
        assert_eq!(
            ProposalState::from_str_loose(input),
            Some(want),
            "{input:?} must parse"
        );
    }
    assert!(ProposalState::from_str_loose("snoozed").is_none());

    assert_eq!(ProposalState::Pending.to_string(), "Pending");
    assert_eq!(ProposalState::Accepted.as_str(), "Accepted");
    assert_eq!(ProposalState::default(), ProposalState::Pending);
}
