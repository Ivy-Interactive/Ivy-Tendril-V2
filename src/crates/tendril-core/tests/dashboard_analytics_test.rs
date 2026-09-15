//! Query-level tests for `db::dashboard`, over a seeded database.
//!
//! Every assertion here is about a decision the original app's SQL makes deliberately, and each one
//! records a bug that was fixed once already: the unpriced-row divisor, the `CostSource` split, the
//! `LogTimestamp` bucketing, the `NOT EXISTS` that keeps the shipped-features arms disjoint, and the
//! `PricedRows` guard that distinguishes "cost nothing" from "cost an unknown amount".

use chrono::{Datelike, Duration, NaiveDate, Utc};
use rusqlite::Connection;
use std::path::PathBuf;
use tendril_core::db::{
    get_activity_stats, get_agent_cost_breakdown, get_recent_merged_prs, get_recent_plan_costs,
    get_shipped_features_by_day, open_database, DAILY_TREND_WINDOW_DAYS,
};

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

fn setup_test_db() -> (TempDir, Connection) {
    let temp_dir = TempDir::new("tendril-dashboard-test");
    let db_path = temp_dir.path().join("tendril.db");
    let conn = open_database(&db_path).expect("open database");
    (temp_dir, conn)
}

fn today() -> NaiveDate {
    Utc::now().date_naive()
}

fn days_ago(n: i64) -> String {
    (today() - Duration::days(n)).format("%Y-%m-%d").to_string()
}

/// `Plans` row. `created`/`updated` are whatever the caller wants SQLite to see — a bare
/// `YYYY-MM-DD` or a full ISO timestamp, since every query compares them as text.
#[allow(clippy::too_many_arguments)]
fn insert_plan(
    conn: &Connection,
    id: i32,
    title: &str,
    state: &str,
    created: &str,
    updated: &str,
    source_url: Option<&str>,
) {
    conn.execute(
        r#"
        INSERT INTO Plans (
            Id, Title, Project, Level, State, FolderPath, FolderName,
            YamlRaw, RevisionCount, LatestRevisionContent, Created, Updated, SourceUrl
        ) VALUES (?1, ?2, 'TestProject', 'Feature', ?3, ?4, ?5, '', 1, '', ?6, ?7, ?8)
        "#,
        rusqlite::params![
            id,
            title,
            state,
            format!("/plans/{:05}-Test", id),
            format!("{:05}-Test", id),
            created,
            updated,
            source_url,
        ],
    )
    .expect("insert plan");
}

fn insert_pr(conn: &Connection, plan_id: i32, pr_url: &str) {
    conn.execute(
        "INSERT INTO PullRequests (PlanId, PrUrl) VALUES (?1, ?2)",
        rusqlite::params![plan_id, pr_url],
    )
    .expect("insert pr");
}

fn insert_repo(conn: &Connection, plan_id: i32, repo_path: &str) {
    conn.execute(
        "INSERT INTO Repos (PlanId, RepoPath) VALUES (?1, ?2)",
        rusqlite::params![plan_id, repo_path],
    )
    .expect("insert repo");
}

fn insert_cost(
    conn: &Connection,
    plan_id: i32,
    tokens: i64,
    cost: Option<f64>,
    log_timestamp: Option<&str>,
    cost_source: Option<&str>,
    agent: Option<&str>,
) {
    conn.execute(
        r#"
        INSERT INTO Costs (PlanId, Promptware, Tokens, Cost, LogTimestamp, CostSource, Agent)
        VALUES (?1, 'ExecutePlan', ?2, ?3, ?4, ?5, ?6)
        "#,
        rusqlite::params![plan_id, tokens, cost, log_timestamp, cost_source, agent],
    )
    .expect("insert cost");
}

// --- get_activity_stats ------------------------------------------------------------------------

#[test]
fn activity_stats_returns_dense_month_list() {
    let (_dir, conn) = setup_test_db();

    // One plan this month only; every other month must still be present, zero-filled.
    insert_plan(
        &conn,
        1,
        "Recent",
        "Completed",
        &days_ago(0),
        &days_ago(0),
        None,
    );

    let stats = get_activity_stats(&conn, 24).expect("activity stats");

    assert_eq!(stats.months.len(), 24, "months_back = 24 yields 24 entries");

    let now = today();
    let last = stats.months.last().expect("last month");
    assert_eq!(
        (last.year, last.month),
        (now.year(), now.month()),
        "newest month is last"
    );
    assert_eq!(last.plans_created, 1);

    // Strictly ascending, with no month skipped.
    let mut previous: Option<(i32, u32)> = None;
    for m in &stats.months {
        if let Some((py, pm)) = previous {
            let expected = if pm == 12 { (py + 1, 1) } else { (py, pm + 1) };
            assert_eq!(
                (m.year, m.month),
                expected,
                "months are contiguous and ascending"
            );
        }
        previous = Some((m.year, m.month));
    }

    // The zero-filled ones really are zero rather than absent.
    let zero_filled = &stats.months[0];
    assert_eq!(zero_filled.plans_created, 0);
    assert_eq!(zero_filled.prs_merged, 0);
    assert_eq!(zero_filled.cost, 0.0);
    assert_eq!(zero_filled.tokens, 0);
}

#[test]
fn activity_stats_excludes_non_terminal_plans_from_monthly_cost() {
    let (_dir, conn) = setup_test_db();

    // The deliberate asymmetry: the monthly rollup is filtered to terminal states, the daily series
    // is not, because money an Executing/Draft plan spent is already spent.
    insert_plan(
        &conn,
        1,
        "Draft plan",
        "Draft",
        &days_ago(1),
        &days_ago(1),
        None,
    );
    insert_cost(
        &conn,
        1,
        100,
        Some(5.0),
        Some(&days_ago(1)),
        Some("agent"),
        None,
    );

    let stats = get_activity_stats(&conn, 24).expect("activity stats");

    let monthly_total: f64 = stats.months.iter().map(|m| m.cost).sum();
    assert_eq!(
        monthly_total, 0.0,
        "a Draft plan's cost is absent from the monthly rollup"
    );

    let daily_total: f64 = stats.daily_costs.iter().map(|d| d.cost).sum();
    assert_eq!(
        daily_total, 5.0,
        "the same cost is present in the daily series"
    );
}

#[test]
fn prev_week_avg_cost_ignores_unpriced_rows() {
    let (_dir, conn) = setup_test_db();

    // The prior-week window is [today-13, today-6).
    let created = days_ago(10);
    insert_plan(&conn, 1, "Priced", "Completed", &created, &created, None);
    insert_plan(&conn, 2, "Unpriced", "Completed", &created, &created, None);

    insert_cost(
        &conn,
        1,
        100,
        Some(8.0),
        Some(&created),
        Some("agent"),
        None,
    );
    // A subscription run: tokens, no charge. Counting it in the divisor would report an average
    // nobody spent.
    insert_cost(&conn, 2, 100, None, Some(&created), None, None);

    let stats = get_activity_stats(&conn, 24).expect("activity stats");

    assert_eq!(
        stats.prev_week_avg_cost, 8.0,
        "divided by the one priced plan, not by both plans"
    );
}

#[test]
fn daily_costs_split_api_and_subsidized() {
    let (_dir, conn) = setup_test_db();

    let day = days_ago(2);
    insert_plan(&conn, 1, "Mixed", "Completed", &day, &day, None);

    // One row per CostSource value, all on the same day.
    insert_cost(&conn, 1, 10, Some(1.0), Some(&day), Some("agent"), None);
    insert_cost(&conn, 1, 20, Some(2.0), Some(&day), Some("computed"), None);
    insert_cost(&conn, 1, 40, Some(4.0), Some(&day), Some("estimated"), None);
    // NULL source with a cost counts as API.
    insert_cost(&conn, 1, 80, Some(8.0), Some(&day), None, None);
    // NULL source without a cost contributes subsidized *tokens* but no subsidized *cost*.
    insert_cost(&conn, 1, 160, None, Some(&day), None, None);

    let stats = get_activity_stats(&conn, 24).expect("activity stats");
    let entry = stats
        .daily_costs
        .iter()
        .find(|d| d.date == day)
        .expect("a bucket for the seeded day");

    assert_eq!(entry.cost, 15.0, "total is every priced row");
    assert_eq!(entry.tokens, 310, "total tokens include the unpriced row");

    assert_eq!(entry.api_cost, 11.0, "agent + computed + NULL-with-cost");
    assert_eq!(entry.api_tokens, 110, "10 + 20 + 80");

    assert_eq!(entry.subsidized_cost, 4.0, "estimated only");
    assert_eq!(
        entry.subsidized_tokens, 200,
        "estimated (40) plus the NULL-source unpriced row (160)"
    );
}

#[test]
fn daily_costs_bucket_on_log_timestamp() {
    let (_dir, conn) = setup_test_db();

    let spent_on = days_ago(5);
    let plan_updated = days_ago(2);
    insert_plan(
        &conn,
        1,
        "Lagging",
        "Completed",
        &spent_on,
        &plan_updated,
        None,
    );
    insert_cost(
        &conn,
        1,
        100,
        Some(3.0),
        Some(&spent_on),
        Some("agent"),
        None,
    );

    let stats = get_activity_stats(&conn, 24).expect("activity stats");

    let dates: Vec<&str> = stats.daily_costs.iter().map(|d| d.date.as_str()).collect();
    assert_eq!(
        dates,
        vec![spent_on.as_str()],
        "spend lands on the day it happened, not the day the plan was last touched"
    );
}

#[test]
fn daily_data_start_clamps_to_window() {
    let (_dir, conn) = setup_test_db();

    // Older than the 736-day window: a record outside the window is not in the series either, so
    // the reported start is the window's own start.
    let ancient = days_ago(DAILY_TREND_WINDOW_DAYS + 100);
    insert_plan(&conn, 1, "Ancient", "Completed", &ancient, &ancient, None);

    let stats = get_activity_stats(&conn, 24).expect("activity stats");

    let expected = days_ago(DAILY_TREND_WINDOW_DAYS - 1);
    assert_eq!(stats.daily_data_start.as_deref(), Some(expected.as_str()));
}

#[test]
fn daily_data_start_is_none_on_empty_db() {
    let (_dir, conn) = setup_test_db();

    let stats = get_activity_stats(&conn, 24).expect("activity stats");

    assert_eq!(
        stats.daily_data_start, None,
        "absent data is None, which is what makes the rolling average render a gap"
    );
}

#[test]
fn daily_data_start_reports_earliest_record_inside_window() {
    let (_dir, conn) = setup_test_db();

    let earliest = days_ago(30);
    insert_plan(&conn, 1, "Older", "Completed", &earliest, &earliest, None);
    let later = days_ago(3);
    insert_plan(&conn, 2, "Newer", "Completed", &later, &later, None);

    let stats = get_activity_stats(&conn, 24).expect("activity stats");

    assert_eq!(stats.daily_data_start.as_deref(), Some(earliest.as_str()));
}

// --- get_shipped_features_by_day ---------------------------------------------------------------

#[test]
fn shipped_features_counts_prs_and_issue_only_plans_once() {
    let (_dir, conn) = setup_test_db();

    let day = days_ago(1);

    // Two PRs *and* an issue source: two features, not three. The NOT EXISTS keeps the arms
    // disjoint.
    insert_plan(
        &conn,
        1,
        "Both",
        "Completed",
        &day,
        &day,
        Some("https://github.com/o/r/issues/42"),
    );
    insert_pr(&conn, 1, "https://github.com/o/r/pull/1");
    insert_pr(&conn, 1, "https://github.com/o/r/pull/2");

    // Issue-sourced with no PR: one feature.
    insert_plan(
        &conn,
        2,
        "Issue only",
        "Completed",
        &day,
        &day,
        Some("https://github.com/o/r/issues/43"),
    );

    let shipped = get_shipped_features_by_day(&conn, 60).expect("shipped features");
    let entry = shipped
        .iter()
        .find(|s| s.date == day)
        .expect("a bucket for the seeded day");

    assert_eq!(entry.count, 3, "2 PRs from plan 1 + 1 issue-only plan");
}

#[test]
fn shipped_features_ignores_incomplete_plans() {
    let (_dir, conn) = setup_test_db();

    let day = days_ago(1);
    insert_plan(&conn, 1, "Executing", "Executing", &day, &day, None);
    insert_pr(&conn, 1, "https://github.com/o/r/pull/1");

    let shipped = get_shipped_features_by_day(&conn, 60).expect("shipped features");

    assert!(
        shipped.is_empty(),
        "only Completed plans have shipped anything"
    );
}

// --- get_recent_merged_prs ---------------------------------------------------------------------

#[test]
fn recent_merged_prs_includes_first_repo_path() {
    let (_dir, conn) = setup_test_db();

    let day = days_ago(1);
    insert_plan(&conn, 1, "With repos", "Completed", &day, &day, None);
    insert_pr(&conn, 1, "https://github.com/o/r/pull/1");
    insert_repo(&conn, 1, "/repos/first");
    insert_repo(&conn, 1, "/repos/second");

    insert_plan(&conn, 2, "No repo", "Completed", &day, &day, None);
    insert_pr(&conn, 2, "https://github.com/o/r/pull/2");

    let prs = get_recent_merged_prs(&conn, 50).expect("merged prs");

    let with_repo = prs
        .iter()
        .find(|p| p.plan_id == 1)
        .expect("plan 1 is listed");
    assert_eq!(with_repo.repo.as_deref(), Some("/repos/first"));
    assert_eq!(with_repo.title, "With repos");

    let without = prs
        .iter()
        .find(|p| p.plan_id == 2)
        .expect("plan 2 is listed");
    assert_eq!(without.repo, None, "no Repos row leaves the column null");
}

#[test]
fn recent_merged_prs_respects_limit() {
    let (_dir, conn) = setup_test_db();

    for id in 1..=5 {
        let day = days_ago(i64::from(id));
        insert_plan(&conn, id, "Plan", "Completed", &day, &day, None);
        insert_pr(&conn, id, &format!("https://github.com/o/r/pull/{}", id));
    }

    let prs = get_recent_merged_prs(&conn, 2).expect("merged prs");

    assert_eq!(prs.len(), 2);
    // Ordered by p.Updated DESC, so the two most recently updated plans.
    assert_eq!(prs[0].plan_id, 1);
    assert_eq!(prs[1].plan_id, 2);
}

// --- get_recent_plan_costs ---------------------------------------------------------------------

#[test]
fn recent_plan_costs_reports_null_cost_for_unpriced_plan() {
    let (_dir, conn) = setup_test_db();

    let day = days_ago(1);
    insert_plan(&conn, 1, "Unpriced", "Completed", &day, &day, None);
    insert_cost(&conn, 1, 500, None, Some(&day), None, None);

    insert_plan(&conn, 2, "Priced", "Completed", &day, &day, None);
    insert_cost(&conn, 2, 300, Some(2.5), Some(&day), Some("agent"), None);

    let costs = get_recent_plan_costs(&conn, 7).expect("plan costs");

    let unpriced = costs.iter().find(|c| c.plan_id == 1).expect("plan 1");
    assert_eq!(
        unpriced.cost, None,
        "no priced rows means None, never Some(0.0)"
    );
    assert_eq!(unpriced.tokens, 500, "tokens are still summed");

    let priced = costs.iter().find(|c| c.plan_id == 2).expect("plan 2");
    assert_eq!(priced.cost, Some(2.5));
    assert_eq!(priced.tokens, 300);
    assert_eq!(priced.state, "Completed");
}

#[test]
fn recent_plan_costs_excludes_non_terminal_plans() {
    let (_dir, conn) = setup_test_db();

    let day = days_ago(1);
    insert_plan(&conn, 1, "Draft", "Draft", &day, &day, None);
    insert_plan(&conn, 2, "Review", "Review", &day, &day, None);

    let costs = get_recent_plan_costs(&conn, 7).expect("plan costs");

    let ids: Vec<i32> = costs.iter().map(|c| c.plan_id).collect();
    assert_eq!(ids, vec![2], "Completed, Failed and Review only");
}

// --- get_agent_cost_breakdown ------------------------------------------------------------------

#[test]
fn agent_cost_breakdown_groups_empty_agent_as_unknown() {
    let (_dir, conn) = setup_test_db();

    let day = days_ago(1);
    insert_plan(&conn, 1, "Plan", "Completed", &day, &day, None);

    insert_cost(&conn, 1, 10, Some(1.0), Some(&day), Some("agent"), Some(""));
    insert_cost(&conn, 1, 20, Some(2.0), Some(&day), Some("agent"), None);

    let breakdown = get_agent_cost_breakdown(&conn, 30).expect("agent costs");

    assert_eq!(breakdown.len(), 1, "empty string and NULL group together");
    assert_eq!(breakdown[0].agent, "Unknown");
    assert_eq!(breakdown[0].cost, 3.0);
    assert_eq!(breakdown[0].tokens, 30);
    assert_eq!(breakdown[0].plan_count, 1);
}

#[test]
fn agent_cost_breakdown_orders_by_cost_desc() {
    let (_dir, conn) = setup_test_db();

    let day = days_ago(1);
    insert_plan(&conn, 1, "One", "Completed", &day, &day, None);
    insert_plan(&conn, 2, "Two", "Completed", &day, &day, None);

    insert_cost(
        &conn,
        1,
        10,
        Some(1.0),
        Some(&day),
        Some("agent"),
        Some("cheap"),
    );
    insert_cost(
        &conn,
        1,
        10,
        Some(9.0),
        Some(&day),
        Some("agent"),
        Some("pricey"),
    );
    insert_cost(
        &conn,
        2,
        10,
        Some(5.0),
        Some(&day),
        Some("agent"),
        Some("pricey"),
    );

    let breakdown = get_agent_cost_breakdown(&conn, 30).expect("agent costs");

    let agents: Vec<&str> = breakdown.iter().map(|b| b.agent.as_str()).collect();
    assert_eq!(agents, vec!["pricey", "cheap"]);

    assert_eq!(breakdown[0].cost, 14.0);
    assert_eq!(
        breakdown[0].plan_count, 2,
        "COUNT(DISTINCT c.PlanId), not a row count"
    );
    assert_eq!(breakdown[1].plan_count, 1);
}
