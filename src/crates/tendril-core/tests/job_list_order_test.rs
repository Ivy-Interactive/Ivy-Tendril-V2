//! What the Jobs list shows once there is more history than the limit.
//!
//! The regression these exist for is #145: `list_jobs` ordered by `StartedAt DESC`, and SQLite sorts
//! NULLs last under `DESC`. A `Pending`, `Queued` or `Blocked` job has no `StartedAt` at all, so on
//! any installation with `limit` started jobs the queue was the first thing the cap discarded — the
//! rows a user opens the list in order to act on were the only ones it could not show.

mod common;

use common::HomeFixture;
use tendril_core::config::get_database_path;
use tendril_core::db::jobs::{insert_job, list_jobs};
use tendril_core::db::open_database;
use tendril_core::models::{JobItem, JobStatus};

/// A job row. `started`/`completed` are hour offsets from a fixed instant; `None` means the column is
/// NULL, which is what an unstarted or unfinished job actually has.
fn seed(
    home: &HomeFixture,
    id: &str,
    status: JobStatus,
    started: Option<i64>,
    completed: Option<i64>,
    cleared: bool,
) {
    let base = chrono::DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);

    let mut job = JobItem::new(
        id.to_string(),
        "ExecutePlan".to_string(),
        format!("Plans/{id}"),
        "test-proj".to_string(),
    );
    job.status = status;
    job.started_at = started.map(|h| base + chrono::Duration::hours(h));
    job.completed_at = completed.map(|h| base + chrono::Duration::hours(h));
    job.cleared = cleared;

    let conn = open_database(&get_database_path(&home.path)).expect("open fixture database");
    insert_job(&conn, &job).expect("insert job row");
}

fn ids(home: &HomeFixture, status: Option<JobStatus>, limit: usize) -> Vec<String> {
    let conn = open_database(&get_database_path(&home.path)).expect("open fixture database");
    list_jobs(&conn, status, limit)
        .expect("list job rows")
        .into_iter()
        .map(|j| j.id)
        .collect()
}

#[test]
fn unfinished_jobs_are_never_pushed_past_the_limit_by_finished_ones() {
    let home = HomeFixture::new("job-list-order");

    // Three finished jobs, newest last, all with a StartedAt.
    seed(
        &home,
        "00001",
        JobStatus::Completed,
        Some(1),
        Some(2),
        false,
    );
    seed(
        &home,
        "00002",
        JobStatus::Completed,
        Some(3),
        Some(4),
        false,
    );
    seed(&home, "00003", JobStatus::Failed, Some(5), Some(6), false);
    // Two jobs that have not run: no StartedAt, no CompletedAt. Under `ORDER BY StartedAt DESC` these
    // sorted *last*, so a limit of three returned only the finished three.
    seed(&home, "00004", JobStatus::Queued, None, None, false);
    seed(&home, "00005", JobStatus::Pending, None, None, false);

    let listed = ids(&home, None, 3);

    assert!(
        listed.contains(&"00004".to_string()) && listed.contains(&"00005".to_string()),
        "queued and pending work must survive the cap; got {listed:?}"
    );
    assert_eq!(
        listed,
        vec![
            "00005".to_string(),
            "00004".to_string(),
            "00003".to_string()
        ],
        "unfinished first (newest id first), then finished newest-completed first"
    );
}

#[test]
fn finished_jobs_are_ordered_newest_completion_first() {
    let home = HomeFixture::new("job-list-completed-order");

    seed(
        &home,
        "00010",
        JobStatus::Completed,
        Some(1),
        Some(9),
        false,
    );
    seed(
        &home,
        "00011",
        JobStatus::Completed,
        Some(2),
        Some(3),
        false,
    );
    seed(
        &home,
        "00012",
        JobStatus::Completed,
        Some(3),
        Some(6),
        false,
    );

    // Deliberately not the id order and not the StartedAt order: `CompletedAt` is what the column the
    // user reads is sorted by, and it is what V1 sorted by.
    assert_eq!(
        ids(&home, None, 10),
        vec![
            "00010".to_string(),
            "00012".to_string(),
            "00011".to_string()
        ]
    );
}

#[test]
fn cleared_rows_are_excluded_and_do_not_consume_the_limit() {
    let home = HomeFixture::new("job-list-cleared");

    // V2 clears by deleting the row, so it writes no `Cleared` flag of its own. A home migrated from
    // V1 still holds rows V1 flagged, and without the predicate they took slots in the limit forever
    // while never being shown.
    seed(&home, "00020", JobStatus::Completed, Some(1), Some(2), true);
    seed(&home, "00021", JobStatus::Completed, Some(3), Some(4), true);
    seed(
        &home,
        "00022",
        JobStatus::Completed,
        Some(5),
        Some(6),
        false,
    );

    assert_eq!(ids(&home, None, 2), vec!["00022".to_string()]);
}

#[test]
fn the_status_filter_still_applies_alongside_the_cleared_predicate() {
    let home = HomeFixture::new("job-list-status-filter");

    seed(&home, "00030", JobStatus::Queued, None, None, false);
    seed(&home, "00031", JobStatus::Queued, None, None, true);
    seed(
        &home,
        "00032",
        JobStatus::Completed,
        Some(1),
        Some(2),
        false,
    );

    assert_eq!(
        ids(&home, Some(JobStatus::Queued), 10),
        vec!["00030".to_string()],
        "a cleared row must not come back just because its status was asked for"
    );
}
