//! The periodic cost backfill: what it repairs, what it refuses to guess at, and what it leaves alone.
//!
//! Every test drives the real `run_pass` against a fixture `tendril.db` built through the real
//! migration chain and a real plan folder with a `costs.csv`, because the two writes have to agree:
//! a database-only repair is undone by the next `reconcile_plan_costs`.

mod common;

use common::HomeFixture;
use std::path::{Path, PathBuf};
use tendril_core::agents::pricing;
use tendril_core::config;
use tendril_core::db::{get_job, insert_job, open_database};
use tendril_core::jobs::cost_backfill::{self, BackfillReport};
use tendril_core::models::{JobItem, JobStatus};

/// In the static price list, so `model_specs::find` answers and the pass may price against it.
const KNOWN_MODEL: &str = "claude-sonnet-5";

/// Deliberately not in any price list, static or dynamic. The pass must count it rather than reach
/// for `get_model_price`'s hardcoded fallback.
const UNKNOWN_MODEL: &str = "unpriced-fixture-model-zz";

const CSV_HEADER: &str = "Promptware,Tokens,Cost,Model,CostSource,Agent";

const INPUT_TOKENS: i64 = 120_000;
const OUTPUT_TOKENS: i64 = 8_000;
const CACHE_READ_TOKENS: i64 = 40_000;
const CACHE_WRITE_TOKENS: i64 = 10_000;

struct Fixture {
    home: HomeFixture,
    plan_folder: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let home = HomeFixture::new(label);
        let plan_folder = home.plans_dir().join("00042-FixturePlan");
        std::fs::create_dir_all(&plan_folder).expect("create plan folder");
        // Opening once through the real chain leaves a migrated database at the path `run_pass` derives
        // for itself, so the pass and the test are looking at the same file.
        let _ = open_database(&config::get_database_path(&home.path)).expect("migrate fixture db");
        Self { home, plan_folder }
    }

    fn conn(&self) -> rusqlite::Connection {
        open_database(&config::get_database_path(&self.home.path)).expect("open fixture db")
    }

    fn insert(&self, job: &JobItem) {
        insert_job(&self.conn(), job).expect("insert fixture job");
    }

    fn job(&self, id: &str) -> JobItem {
        get_job(&self.conn(), id)
            .expect("read job")
            .unwrap_or_else(|| panic!("job {} should exist", id))
    }

    fn write_csv(&self, rows: &[&str]) {
        let mut content = String::from(CSV_HEADER);
        for row in rows {
            content.push('\n');
            content.push_str(row);
        }
        content.push('\n');
        std::fs::write(self.csv_path(), content).expect("write costs.csv");
    }

    fn csv_path(&self) -> PathBuf {
        self.plan_folder.join("costs.csv")
    }

    fn csv(&self) -> String {
        std::fs::read_to_string(self.csv_path()).expect("read costs.csv")
    }

    fn run(&self) -> BackfillReport {
        cost_backfill::run_pass(&self.home.path)
    }

    /// A job with tokens worth pricing, shaped like a finished agent run.
    fn unpriced_job(&self, id: &str, promptware: &str, model: Option<&str>) -> JobItem {
        let mut job = JobItem::new(
            id.to_string(),
            promptware.to_string(),
            self.plan_folder.to_string_lossy().to_string(),
            "FixtureProject".to_string(),
        );
        job.status = JobStatus::Completed;
        job.model = model.map(str::to_string);
        job.started_at = Some(chrono::Utc::now());
        job.completed_at = Some(chrono::Utc::now());
        job.input_tokens = Some(INPUT_TOKENS);
        job.output_tokens = Some(OUTPUT_TOKENS);
        job.cache_read_tokens = Some(CACHE_READ_TOKENS);
        job.cache_write_tokens = Some(CACHE_WRITE_TOKENS);
        job.tokens = Some(INPUT_TOKENS + OUTPUT_TOKENS);
        job
    }
}

fn expected_cost(model: &str) -> f64 {
    pricing::calculate_cost(
        model,
        INPUT_TOKENS,
        OUTPUT_TOKENS,
        CACHE_READ_TOKENS,
        CACHE_WRITE_TOKENS,
    )
}

/// The field count of a data row, which the pass must never change.
fn row_field_counts(csv: &str) -> Vec<usize> {
    csv.lines()
        .skip(1)
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.split(',').count())
        .collect()
}

// ---------------------------------------------------------------------------------------------
// 6. A NULL cost is filled from the tokens that survived.
// ---------------------------------------------------------------------------------------------

#[test]
fn test_null_cost_is_filled_with_an_estimate() {
    let fx = Fixture::new("backfill-null");
    fx.write_csv(&["ExecutePlan,128000,,,,claude"]);

    let mut job = fx.unpriced_job("03001", "ExecutePlan", Some(KNOWN_MODEL));
    job.cost = None;
    job.cost_source = None;
    fx.insert(&job);

    let report = fx.run();
    assert_eq!(
        report,
        BackfillReport {
            filled: 1,
            unpriced: 0,
            failed: 0
        }
    );

    let filled = fx.job("03001");
    let expected = expected_cost(KNOWN_MODEL);
    assert!(expected > 0.0, "the fixture model must have a real price");
    assert!(
        (filled.cost.expect("cost filled") - expected).abs() < 1e-9,
        "backfilled figure must agree with the path extract_and_record_usage uses"
    );
    assert_eq!(filled.cost_source.as_deref(), Some("estimated"));

    // And the durable record, not just the projection: reconcile_plan_costs rebuilds the Costs table
    // from this file, so a database-only repair would be undone by the next sync.
    let csv = fx.csv();
    assert!(
        csv.contains(&format!("{:.4}", expected)),
        "costs.csv should carry the estimate: {}",
        csv
    );
    assert!(
        csv.contains(KNOWN_MODEL),
        "the blank model column should be filled in: {}",
        csv
    );
}

// ---------------------------------------------------------------------------------------------
// 7. A zero cost is the same case; a cost that came from a bill is not.
// ---------------------------------------------------------------------------------------------

#[test]
fn test_zero_cost_is_filled_but_agent_reported_cost_is_untouched() {
    let fx = Fixture::new("backfill-zero");
    fx.write_csv(&["ExecutePlan,128000,0,,,claude"]);

    let mut estimated = fx.unpriced_job("03002", "ExecutePlan", Some(KNOWN_MODEL));
    estimated.cost = Some(0.0);
    estimated.cost_source = None;
    fx.insert(&estimated);

    // Same zero, but the agent said so. That figure came from a bill and is not ours to overwrite.
    let mut billed = fx.unpriced_job("03003", "CreatePlan", Some(KNOWN_MODEL));
    billed.cost = Some(0.0);
    billed.cost_source = Some("agent".to_string());
    fx.insert(&billed);

    let report = fx.run();
    assert_eq!(
        report,
        BackfillReport {
            filled: 1,
            unpriced: 0,
            failed: 0
        },
        "only the row nobody had charged for should be filled"
    );

    let filled = fx.job("03002");
    assert!(filled.cost.expect("cost filled") > 0.0);
    assert_eq!(filled.cost_source.as_deref(), Some("estimated"));

    let untouched = fx.job("03003");
    assert_eq!(
        untouched.cost,
        Some(0.0),
        "an agent cost must survive a pass"
    );
    assert_eq!(untouched.cost_source.as_deref(), Some("agent"));
}

// ---------------------------------------------------------------------------------------------
// 8. Pricing is allowed to say "I don't know".
// ---------------------------------------------------------------------------------------------

#[test]
fn test_unknown_model_is_counted_unpriced_and_left_null() {
    let fx = Fixture::new("backfill-unknown");
    fx.write_csv(&["ExecutePlan,128000,,,,claude"]);

    let mut job = fx.unpriced_job("03004", "ExecutePlan", Some(UNKNOWN_MODEL));
    job.cost = None;
    fx.insert(&job);

    let report = fx.run();
    assert_eq!(
        report,
        BackfillReport {
            filled: 0,
            unpriced: 1,
            failed: 0
        }
    );

    // The hardcoded 3.00/15.00 fallback in `get_model_price` must not have leaked in: a figure nobody
    // has prices for, stamped `estimated`, is exactly the corruption this service undoes.
    let job = fx.job("03004");
    assert_eq!(job.cost, None, "an unpriceable row stays unpriced");
    assert_eq!(job.cost_source, None);
    let fallback = expected_cost(UNKNOWN_MODEL);
    assert!(
        fallback > 0.0,
        "sanity: get_model_price does invent a figure, which is why the pass gates on find()"
    );

    let csv = fx.csv();
    assert!(
        csv.contains("ExecutePlan,128000,,,,claude"),
        "costs.csv must be left as it was: {}",
        csv
    );

    // A model with no entry is worth re-examining next pass: prices may arrive.
    assert_eq!(fx.run().unpriced, 1);
}

// ---------------------------------------------------------------------------------------------
// 9. Idempotency.
// ---------------------------------------------------------------------------------------------

#[test]
fn test_second_pass_changes_nothing() {
    let fx = Fixture::new("backfill-idempotent");
    fx.write_csv(&["ExecutePlan,128000,,,,claude"]);

    let mut job = fx.unpriced_job("03005", "ExecutePlan", Some(KNOWN_MODEL));
    job.cost = None;
    fx.insert(&job);

    assert_eq!(fx.run().filled, 1);
    let after_first = fx.job("03005");
    let csv_after_first = fx.csv();

    let second = fx.run();
    assert_eq!(
        second,
        BackfillReport::default(),
        "a filled row is no longer a candidate"
    );

    let after_second = fx.job("03005");
    assert_eq!(after_second.cost, after_first.cost);
    assert_eq!(after_second.cost_source, after_first.cost_source);
    assert_eq!(
        fx.csv(),
        csv_after_first,
        "costs.csv must be byte-identical after a no-op pass"
    );

    // The Costs table is never inserted into here, so repeated passes cannot double-count.
    let count: i64 = fx
        .conn()
        .query_row("SELECT COUNT(*) FROM Costs", [], |row| row.get(0))
        .expect("count Costs rows");
    assert_eq!(count, 0, "backfill must not write Costs rows");
}

// ---------------------------------------------------------------------------------------------
// 10. The CSV rule: exactly one match, and never a different shape.
// ---------------------------------------------------------------------------------------------

#[test]
fn test_ambiguous_csv_rows_are_left_alone() {
    let fx = Fixture::new("backfill-ambiguous");
    // Two unpriced ExecutePlan rows: the file cannot say which run this job was, and moving money onto
    // the wrong row is worse than leaving the file as it is.
    fx.write_csv(&[
        "ExecutePlan,128000,,,,claude",
        "ExecutePlan,64000,,,,claude",
    ]);
    let before = fx.csv();

    let mut job = fx.unpriced_job("03006", "ExecutePlan", Some(KNOWN_MODEL));
    job.cost = None;
    fx.insert(&job);

    assert_eq!(fx.run().filled, 1, "the database row is still repairable");
    assert!(
        fx.job("03006").cost.expect("cost filled") > 0.0,
        "an ambiguous file must not block the database repair"
    );
    assert_eq!(fx.csv(), before, "an ambiguous file must be left untouched");
}

#[test]
fn test_single_matching_csv_row_is_rewritten_in_place() {
    let fx = Fixture::new("backfill-single-match");
    // A priced row for the same promptware, an unpriced row for a different one, a legacy three-column
    // row, and the one row that should be rewritten.
    fx.write_csv(&[
        "ExecutePlan,64000,1.2345,claude-opus-5,estimated,claude",
        "CreatePlan,32000,,,,claude",
        "ReviewPlan,16000,",
        "ExecutePlan,128000,,,,claude",
    ]);
    let counts_before = row_field_counts(&fx.csv());

    let mut job = fx.unpriced_job("03007", "ExecutePlan", Some(KNOWN_MODEL));
    job.cost = None;
    fx.insert(&job);

    assert_eq!(fx.run().filled, 1);

    let csv = fx.csv();
    let expected = format!("{:.4}", expected_cost(KNOWN_MODEL));
    let rows: Vec<&str> = csv.lines().collect();
    assert_eq!(rows[0], CSV_HEADER, "the header is not ours to change");
    assert_eq!(
        rows[1], "ExecutePlan,64000,1.2345,claude-opus-5,estimated,claude",
        "a row that already carries a figure is left alone"
    );
    assert_eq!(
        rows[2], "CreatePlan,32000,,,,claude",
        "another promptware's row is not this job's"
    );
    assert_eq!(
        rows[3], "ReviewPlan,16000,",
        "an unrelated legacy row is left alone"
    );
    assert_eq!(
        rows[4],
        format!("ExecutePlan,128000,{},{},,claude", expected, KNOWN_MODEL),
        "the single unpriced match should carry the estimate and the model"
    );

    assert_eq!(
        row_field_counts(&csv),
        counts_before,
        "the pass must not change any row's column count"
    );
    assert!(
        csv.ends_with('\n'),
        "the file should keep its trailing newline"
    );
}

#[test]
fn test_legacy_three_column_row_keeps_its_width() {
    let fx = Fixture::new("backfill-legacy-row");
    // The original widens a pre-v2 row to carry the model. V2's reader is positional and its writer
    // always emits six columns, so a repair pass changing a row's arity would be a shape change made
    // by the one component that has no business making one.
    fx.write_csv(&["ExecutePlan,128000,"]);

    let mut job = fx.unpriced_job("03008", "ExecutePlan", Some(KNOWN_MODEL));
    job.cost = None;
    fx.insert(&job);

    assert_eq!(fx.run().filled, 1);

    let csv = fx.csv();
    assert_eq!(
        csv.lines().nth(1).expect("data row"),
        format!("ExecutePlan,128000,{:.4}", expected_cost(KNOWN_MODEL))
    );
    assert_eq!(row_field_counts(&csv), vec![3]);
}

#[test]
fn test_missing_csv_is_not_an_error() {
    let fx = Fixture::new("backfill-no-csv");

    let mut job = fx.unpriced_job("03009", "ExecutePlan", Some(KNOWN_MODEL));
    job.cost = None;
    fx.insert(&job);

    // No costs.csv at all — a plan folder that predates cost logging, or one a user deleted from. The
    // database repair still happens and the pass still reports success.
    assert_eq!(fx.run().filled, 1);
    assert!(fx.job("03009").cost.expect("cost filled") > 0.0);
    assert!(!fx.csv_path().exists());
}

// ---------------------------------------------------------------------------------------------
// 11. Master gating.
// ---------------------------------------------------------------------------------------------

#[test]
fn test_is_master_is_true_only_for_the_process_that_owns_the_file() {
    let home = HomeFixture::new("backfill-master");

    // No file: nobody owns the home, so nothing may write to what a master owns.
    assert!(
        !config::is_master(&home.path),
        "a missing .master file means not master"
    );

    // Our own pid, written the way MasterGuard::acquire writes it.
    config::write_master(&home.path, 5010, "fixture-secret", "127.0.0.1").expect("write master");
    assert!(config::is_master(&home.path));

    // A foreign pid: we were superseded, or we lost the race. Either way the answer must flip without
    // restarting anything — the backfill loop rechecks per pass, because a daemon can be demoted while
    // running.
    write_foreign_master(&home.path);
    assert!(
        !config::is_master(&home.path),
        "a foreign pid in .master means not master"
    );
}

/// Rewrites `.master` with a pid that is not ours, leaving every other field valid so the file still
/// parses. Chosen well above any live pid so it cannot collide with this process.
fn write_foreign_master(tendril_home: &Path) {
    let mut info = config::read_master(tendril_home).expect("existing master file");
    info.pid = std::process::id().wrapping_add(1_000_000);
    config::write_master_info(tendril_home, &info).expect("write foreign master");
}
