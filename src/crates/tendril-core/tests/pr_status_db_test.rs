//! The `PrStatuses` cache: what a write puts in and a read gets back.

mod common;

use chrono::{DateTime, TimeZone, Utc};
use common::HomeFixture;
use rusqlite::{params, Connection};
use tendril_core::config::get_database_path;
use tendril_core::db::open_database;
use tendril_core::db::pr_status::{
    delete_pr_status, get_all_pr_statuses, get_pr_status, get_unmerged_pr_urls, upsert_pr_status,
};
use tendril_core::models::{PrState, PrStatusRecord};

const PR_7: &str = "https://github.com/acme/widgets/pull/7";
const PR_8: &str = "https://github.com/acme/widgets/pull/8";

fn open_fixture_db(home: &HomeFixture) -> Connection {
    open_database(&get_database_path(&home.path)).expect("open fixture database")
}

fn record(url: &str, status: PrState, branch: Option<&str>) -> PrStatusRecord {
    let (owner, repo, number) =
        tendril_core::models::parse_pr_url(url).expect("fixture URL must parse");
    PrStatusRecord {
        pr_url: url.to_string(),
        owner,
        repo,
        number,
        status,
        branch: branch.map(|b| b.to_string()),
        last_checked: Utc.with_ymd_and_hms(2026, 9, 14, 12, 0, 0).unwrap(),
    }
}

#[test]
fn a_written_row_reads_back_unchanged() {
    let home = HomeFixture::new("pr-db-roundtrip");
    let conn = open_fixture_db(&home);
    let rec = record(PR_7, PrState::Open, Some("tendril/00570-Something"));

    upsert_pr_status(&conn, &rec).expect("upsert");

    let read = get_pr_status(&conn, PR_7).expect("read").expect("some row");
    assert_eq!(read, rec);
    assert_eq!(read.number, 7);
}

#[test]
fn a_second_write_updates_in_place() {
    let home = HomeFixture::new("pr-db-update");
    let conn = open_fixture_db(&home);
    upsert_pr_status(&conn, &record(PR_7, PrState::Open, Some("feature"))).unwrap();
    upsert_pr_status(&conn, &record(PR_7, PrState::Merged, Some("feature"))).unwrap();

    let all = get_all_pr_statuses(&conn).expect("read all");
    assert_eq!(all.len(), 1, "the URL is the primary key");
    assert_eq!(all[0].status, PrState::Merged);
}

#[test]
fn a_files_suffix_is_the_same_row() {
    let home = HomeFixture::new("pr-db-canonical");
    let conn = open_fixture_db(&home);
    upsert_pr_status(&conn, &record(PR_7, PrState::Open, None)).unwrap();
    upsert_pr_status(
        &conn,
        &record(
            "https://github.com/acme/widgets/pull/7/files",
            PrState::Merged,
            None,
        ),
    )
    .unwrap();

    let all = get_all_pr_statuses(&conn).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].pr_url, PR_7, "the stored key is canonical");
    assert_eq!(all[0].status, PrState::Merged);

    // A non-canonical URL also finds the row on the way back out.
    let read = get_pr_status(
        &conn,
        "https://github.com/acme/widgets/pull/7#issuecomment-1",
    )
    .unwrap()
    .expect("some row");
    assert_eq!(read.status, PrState::Merged);
}

#[test]
fn an_unknown_url_reads_back_as_none() {
    let home = HomeFixture::new("pr-db-missing");
    let conn = open_fixture_db(&home);
    assert!(get_pr_status(&conn, PR_7).expect("read").is_none());
}

#[test]
fn a_missing_branch_stays_null() {
    let home = HomeFixture::new("pr-db-null-branch");
    let conn = open_fixture_db(&home);
    upsert_pr_status(&conn, &record(PR_7, PrState::Closed, None)).unwrap();

    let read = get_pr_status(&conn, PR_7).unwrap().unwrap();
    assert_eq!(read.branch, None);
}

#[test]
fn only_unmerged_urls_are_listed_for_rechecking() {
    let home = HomeFixture::new("pr-db-unmerged");
    let conn = open_fixture_db(&home);
    upsert_pr_status(&conn, &record(PR_7, PrState::Merged, None)).unwrap();
    upsert_pr_status(&conn, &record(PR_8, PrState::Open, None)).unwrap();

    assert_eq!(
        get_unmerged_pr_urls(&conn).expect("list unmerged"),
        vec![PR_8.to_string()]
    );
}

#[test]
fn deleting_removes_the_row() {
    let home = HomeFixture::new("pr-db-delete");
    let conn = open_fixture_db(&home);
    upsert_pr_status(&conn, &record(PR_7, PrState::Open, None)).unwrap();

    assert_eq!(delete_pr_status(&conn, PR_7).expect("delete"), 1);
    assert!(get_pr_status(&conn, PR_7).unwrap().is_none());
    assert_eq!(delete_pr_status(&conn, PR_7).expect("delete again"), 0);
}

/// A V1 row, or a hand-edited one, can carry a timestamp this build cannot parse. It must read back
/// as stale rather than as an error, so the next pass re-checks it.
#[test]
fn an_unparseable_timestamp_reads_back_as_the_epoch() {
    let home = HomeFixture::new("pr-db-bad-timestamp");
    let conn = open_fixture_db(&home);
    conn.execute(
        "INSERT INTO PrStatuses (PrUrl, Owner, Repo, Status, LastChecked, Branch) \
         VALUES (?1, 'acme', 'widgets', 'Open', 'not a timestamp', NULL)",
        params![PR_7],
    )
    .expect("insert raw row");

    let read = get_pr_status(&conn, PR_7).unwrap().unwrap();
    assert_eq!(read.last_checked, DateTime::<Utc>::from_timestamp_nanos(0));
}

/// A status string the enum does not know is `Unknown` — never a guessed `Open`.
#[test]
fn an_unrecognised_status_reads_back_as_unknown() {
    let home = HomeFixture::new("pr-db-bad-status");
    let conn = open_fixture_db(&home);
    conn.execute(
        "INSERT INTO PrStatuses (PrUrl, Owner, Repo, Status, LastChecked, Branch) \
         VALUES (?1, 'acme', 'widgets', 'DRAFT', '2026-09-14T12:00:00+00:00', NULL)",
        params![PR_7],
    )
    .expect("insert raw row");

    let read = get_pr_status(&conn, PR_7).unwrap().unwrap();
    assert_eq!(read.status, PrState::Unknown);
}
