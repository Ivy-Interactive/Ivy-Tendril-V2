//! The Jobs table under the server-side query API — the thing that makes a jobs table survive a
//! history nobody ever clears.
//!
//! `list_jobs` can answer exactly one question: "the newest N, in the server's order". A table built
//! on it has to fetch every row it might ever show, so its cost grows with the daemon's whole
//! history; sorting by cost, or opening page four, is only possible client-side. `query_jobs` moves
//! the sort, the filter and the window into SQLite, so what crosses the wire is one page plus a
//! count, whatever the table holds.
//!
//! These run against a real migrated database rather than the query module's in-memory fixture,
//! because the column allowlist is *read from the schema*: a migration that renames a column has to
//! show up here as a resolution failure, not as silently broken SQL.

mod common;

use common::HomeFixture;
use rusqlite::Connection;
use tendril_core::config::get_database_path;
use tendril_core::db::jobs::{insert_job, job_column_values, list_jobs, query_jobs};
use tendril_core::db::open_database;
use tendril_core::db::query::{
    Aggregation, Condition, Filter, FilterGroup, FilterNode, LogicalOperator, SortDirection,
    SortOrder, TableQuery, DEFAULT_LIMIT, MAX_LIMIT,
};
use tendril_core::error::TendrilError;
use tendril_core::models::{JobItem, JobStatus};

const BASE: &str = "2026-01-01T00:00:00Z";

fn base() -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(BASE)
        .unwrap()
        .with_timezone(&chrono::Utc)
}

struct Seed {
    id: &'static str,
    status: JobStatus,
    project: &'static str,
    completed: Option<i64>,
    cost: Option<f64>,
}

fn seed_all(conn: &Connection, rows: &[Seed]) {
    for row in rows {
        let mut job = JobItem::new(
            row.id.to_string(),
            "ExecutePlan".to_string(),
            format!("Plans/{}", row.id),
            row.project.to_string(),
        );
        job.status = row.status;
        job.completed_at = row.completed.map(|h| base() + chrono::Duration::hours(h));
        job.started_at = Some(base());
        job.cost = row.cost;
        insert_job(conn, &job).expect("insert job row");
    }
}

/// Five rows: two finished, two queued, one cleared (which nothing may ever see).
fn fixture() -> (HomeFixture, Connection) {
    let home = HomeFixture::new("job-query");
    let conn = open_database(&get_database_path(&home.path)).expect("open fixture database");
    seed_all(
        &conn,
        &[
            Seed {
                id: "00001",
                status: JobStatus::Completed,
                project: "alpha",
                completed: Some(2),
                cost: Some(1.0),
            },
            Seed {
                id: "00002",
                status: JobStatus::Failed,
                project: "beta",
                completed: Some(4),
                cost: Some(9.5),
            },
            Seed {
                id: "00003",
                status: JobStatus::Queued,
                project: "alpha",
                completed: None,
                cost: None,
            },
            Seed {
                id: "00004",
                status: JobStatus::Running,
                project: "beta",
                completed: None,
                cost: Some(3.25),
            },
        ],
    );
    let mut cleared = JobItem::new(
        "00005".to_string(),
        "ExecutePlan".to_string(),
        "Plans/00005".to_string(),
        "alpha".to_string(),
    );
    cleared.status = JobStatus::Completed;
    cleared.completed_at = Some(base() + chrono::Duration::hours(9));
    cleared.cleared = true;
    insert_job(&conn, &cleared).expect("insert cleared row");
    (home, conn)
}

fn ids(conn: &Connection, query: TableQuery) -> Vec<String> {
    query_jobs(conn, &query)
        .expect("query jobs")
        .rows
        .into_iter()
        .map(|job| job.id)
        .collect()
}

fn condition(column: &str, function: &str, args: Vec<serde_json::Value>) -> Filter {
    Filter {
        node: FilterNode::Condition(Condition {
            column: column.to_string(),
            function: function.to_string(),
            args,
        }),
        negate: false,
    }
}

#[test]
fn the_default_order_is_the_one_list_jobs_uses() {
    // The two must not drift: a view that pages with `query_jobs` and a view that still calls
    // `list_jobs` would otherwise disagree about what "the top of the list" is.
    let (_home, conn) = fixture();
    let legacy: Vec<String> = list_jobs(&conn, None, 50)
        .expect("list jobs")
        .into_iter()
        .map(|job| job.id)
        .collect();
    assert_eq!(ids(&conn, TableQuery::default()), legacy);
    // Unfinished first, then finished newest-first.
    assert_eq!(legacy, vec!["00004", "00003", "00002", "00001"]);
}

#[test]
fn a_cleared_row_is_invisible_to_the_window_and_to_the_count() {
    let (_home, conn) = fixture();
    let page = query_jobs(&conn, &TableQuery::default()).expect("query jobs");
    assert_eq!(page.total_rows, 4);
    assert!(!page.rows.iter().any(|job| job.id == "00005"));

    // Not even by asking for it directly: the base predicate is ANDed ahead of the caller's filter.
    let page = query_jobs(
        &conn,
        &TableQuery {
            filter: Some(condition("id", "equals", vec!["00005".into()])),
            ..Default::default()
        },
    )
    .expect("query jobs");
    assert_eq!(page.total_rows, 0);
}

#[test]
fn paging_walks_the_whole_table_without_repeating_or_skipping_a_row() {
    let (_home, conn) = fixture();
    let mut seen = Vec::new();
    for page_index in 0..2 {
        let page = query_jobs(
            &conn,
            &TableQuery {
                offset: page_index * 2,
                limit: Some(2),
                ..Default::default()
            },
        )
        .expect("query jobs");
        assert_eq!(page.total_rows, 4, "the total is the same on every page");
        assert_eq!(page.row_count, 2);
        seen.extend(page.rows.into_iter().map(|job| job.id));
    }
    assert_eq!(seen, vec!["00004", "00003", "00002", "00001"]);

    // Past the end is an empty page, not an error, and the total still tells the footer where it is.
    let page = query_jobs(
        &conn,
        &TableQuery {
            offset: 400,
            limit: Some(2),
            ..Default::default()
        },
    )
    .expect("query jobs");
    assert!(page.rows.is_empty());
    assert_eq!(page.total_rows, 4);
}

#[test]
fn sorting_uses_the_columns_the_api_exposes_by_their_json_names() {
    let (_home, conn) = fixture();
    // `cost` is a column no client-side sort could reach without holding every row.
    let by_cost = ids(
        &conn,
        TableQuery {
            sort: vec![SortOrder {
                column: "cost".to_string(),
                direction: SortDirection::Desc,
            }],
            ..Default::default()
        },
    );
    assert_eq!(by_cost, vec!["00002", "00004", "00001", "00003"]);

    // Multi-column, with the API's camelCase spelling of a PascalCase column.
    let by_project_then_completed = ids(
        &conn,
        TableQuery {
            sort: vec![
                SortOrder {
                    column: "project".to_string(),
                    direction: SortDirection::Asc,
                },
                SortOrder {
                    column: "completedAt".to_string(),
                    direction: SortDirection::Desc,
                },
            ],
            ..Default::default()
        },
    );
    assert_eq!(
        by_project_then_completed,
        vec!["00001", "00003", "00002", "00004"]
    );
}

#[test]
fn ties_come_back_in_a_stable_order_so_two_windows_are_slices_of_one_sequence() {
    let (_home, conn) = fixture();
    // Every row shares this sort key, so only the tiebreaker decides the order — and without one,
    // paging a large table can show a row twice and never show its neighbour.
    let sort = vec![SortOrder {
        column: "type".to_string(),
        direction: SortDirection::Asc,
    }];
    let mut walked = Vec::new();
    for offset in 0..4 {
        let page = query_jobs(
            &conn,
            &TableQuery {
                sort: sort.clone(),
                offset,
                limit: Some(1),
                ..Default::default()
            },
        )
        .expect("query jobs");
        walked.push(page.rows[0].id.clone());
    }
    assert_eq!(walked, vec!["00004", "00003", "00002", "00001"]);
    let one_shot = ids(
        &conn,
        TableQuery {
            sort,
            ..Default::default()
        },
    );
    assert_eq!(walked, one_shot, "windows must slice the same sequence");
}

#[test]
fn a_status_facet_filters_and_counts_server_side() {
    let (_home, conn) = fixture();
    let page = query_jobs(
        &conn,
        &TableQuery {
            filter: Some(condition(
                "status",
                "inSet",
                vec!["Running".into(), "Queued".into()],
            )),
            limit: Some(1),
            ..Default::default()
        },
    )
    .expect("query jobs");
    assert_eq!(page.row_count, 1, "one row crossed the wire");
    assert_eq!(page.total_rows, 2, "the footer still knows there are two");
}

#[test]
fn a_recursive_filter_arrives_as_json_and_narrows_the_table() {
    let (_home, conn) = fixture();
    let query: TableQuery = serde_json::from_str(
        r#"{
            "filter": {
              "group": {
                "op": "and",
                "filters": [
                  { "condition": { "column": "project", "function": "equals", "args": ["beta"] } },
                  { "group": { "op": "or", "filters": [
                      { "condition": { "column": "cost", "function": "greaterThan", "args": [5] } },
                      { "condition": { "column": "status", "function": "equals",
                                       "args": ["Running"] } }
                  ] } }
                ]
              }
            },
            "sort": [{ "column": "id", "direction": "Ascending" }]
        }"#,
    )
    .expect("parse query body");
    assert_eq!(ids(&conn, query), vec!["00002", "00004"]);
}

#[test]
fn a_free_text_search_is_a_contains_condition() {
    let (_home, conn) = fixture();
    let page = query_jobs(
        &conn,
        &TableQuery {
            filter: Some(condition("planFile", "contains", vec!["00003".into()])),
            ..Default::default()
        },
    )
    .expect("query jobs");
    assert_eq!(page.total_rows, 1);
    assert_eq!(page.rows[0].id, "00003");
}

#[test]
fn aggregations_describe_the_filtered_set_not_the_page() {
    let (_home, conn) = fixture();
    let page = query_jobs(
        &conn,
        &TableQuery {
            limit: Some(1),
            aggregations: vec![
                Aggregation {
                    column: "cost".to_string(),
                    function: "sum".to_string(),
                },
                Aggregation {
                    column: "id".to_string(),
                    function: "count".to_string(),
                },
            ],
            ..Default::default()
        },
    )
    .expect("query jobs");
    assert_eq!(page.row_count, 1);
    assert_eq!(page.aggregations[0].value, Some(serde_json::json!(13.75)));
    assert_eq!(page.aggregations[1].value, Some(serde_json::json!(4)));
}

#[test]
fn a_column_that_is_not_in_the_schema_is_a_validation_error() {
    let (_home, conn) = fixture();
    for column in [
        "secret",
        "Jobs.Status",
        "Status; DROP TABLE Jobs",
        "(SELECT Value FROM Metadata)",
        "*",
    ] {
        let err = query_jobs(
            &conn,
            &TableQuery {
                filter: Some(condition(column, "isNotNull", vec![])),
                ..Default::default()
            },
        )
        .expect_err("a column outside the schema must be refused");
        assert!(
            matches!(err, TendrilError::Validation(_)),
            "expected a 400 for '{column}', got {err}"
        );
    }
    // The same for sort and for aggregation, which are separate code paths.
    assert!(matches!(
        query_jobs(
            &conn,
            &TableQuery {
                sort: vec![SortOrder {
                    column: "Status --".to_string(),
                    direction: SortDirection::Asc,
                }],
                ..Default::default()
            },
        )
        .unwrap_err(),
        TendrilError::Validation(_)
    ));
    assert!(matches!(
        query_jobs(
            &conn,
            &TableQuery {
                aggregations: vec![Aggregation {
                    column: "Cost) FROM Jobs; DROP TABLE Jobs --".to_string(),
                    function: "sum".to_string(),
                }],
                ..Default::default()
            },
        )
        .unwrap_err(),
        TendrilError::Validation(_)
    ));
}

#[test]
fn an_injected_value_is_compared_not_executed() {
    let (_home, conn) = fixture();
    let page = query_jobs(
        &conn,
        &TableQuery {
            filter: Some(condition(
                "project",
                "equals",
                vec!["beta' OR 1=1 --".into()],
            )),
            ..Default::default()
        },
    )
    .expect("query jobs");
    assert_eq!(page.total_rows, 0, "the payload matched no project");

    // And the table is still there, with every row.
    assert_eq!(
        query_jobs(&conn, &TableQuery::default())
            .expect("query jobs")
            .total_rows,
        4
    );
}

#[test]
fn the_window_is_bounded_however_large_a_limit_is_asked_for() {
    let (_home, conn) = fixture();
    let page = query_jobs(
        &conn,
        &TableQuery {
            limit: Some(50_000_000),
            ..Default::default()
        },
    )
    .expect("query jobs");
    assert_eq!(page.limit, MAX_LIMIT);

    let page = query_jobs(&conn, &TableQuery::default()).expect("query jobs");
    assert_eq!(page.limit, DEFAULT_LIMIT);
}

#[test]
fn a_client_paging_a_changing_queue_is_told_its_offsets_moved() {
    let (_home, conn) = fixture();
    let first = query_jobs(&conn, &TableQuery::default()).expect("query jobs");

    let repeat = query_jobs(
        &conn,
        &TableQuery {
            version_token: Some(first.version_token.clone()),
            ..Default::default()
        },
    )
    .expect("query jobs");
    assert!(!repeat.stale);

    seed_all(
        &conn,
        &[Seed {
            id: "00006",
            status: JobStatus::Queued,
            project: "alpha",
            completed: None,
            cost: None,
        }],
    );
    let after = query_jobs(
        &conn,
        &TableQuery {
            version_token: Some(first.version_token),
            ..Default::default()
        },
    )
    .expect("query jobs");
    assert!(after.stale, "a new job shifted every offset below it");
    assert_eq!(after.total_rows, 5);
}

#[test]
fn a_filter_facet_can_list_the_values_it_offers_without_the_rows() {
    let (_home, conn) = fixture();
    let page = job_column_values(&conn, "status", None, None).expect("list values");
    assert_eq!(page.column, "Status");
    assert_eq!(
        page.values,
        vec![
            serde_json::json!("Completed"),
            serde_json::json!("Failed"),
            serde_json::json!("Queued"),
            serde_json::json!("Running"),
        ],
        "the cleared row's status is not offered"
    );

    let page = job_column_values(&conn, "project", Some("BET"), None).expect("list values");
    assert_eq!(page.values, vec![serde_json::json!("beta")]);
}

#[test]
fn every_column_the_reader_maps_is_queryable() {
    // The allowlist is the schema, and the schema is what `row_to_job` reads — so a migration that
    // adds a column makes it filterable and sortable with no second list to update. This is the
    // assertion that keeps that true: if it ever fails, some column became unqueryable.
    let (_home, conn) = fixture();
    let names: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('Jobs')")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert!(
        names.len() > 30,
        "the Jobs table has more columns than that"
    );
    for name in names {
        query_jobs(
            &conn,
            &TableQuery {
                sort: vec![SortOrder {
                    column: name.clone(),
                    direction: SortDirection::Asc,
                }],
                limit: Some(1),
                ..Default::default()
            },
        )
        .unwrap_or_else(|e| panic!("column '{name}' should be sortable: {e}"));
    }
}

#[test]
fn an_empty_filter_group_does_not_widen_the_result() {
    // The framework drops an empty group and returns everything, whichever operator it carried. Here
    // an empty OR still means "none of these", so a half-built facet cannot silently show more rows
    // than the user asked for.
    let (_home, conn) = fixture();
    let page = query_jobs(
        &conn,
        &TableQuery {
            filter: Some(Filter {
                node: FilterNode::Group(FilterGroup {
                    op: LogicalOperator::Or,
                    filters: vec![],
                }),
                negate: false,
            }),
            ..Default::default()
        },
    )
    .expect("query jobs");
    assert_eq!(page.total_rows, 0);
}
