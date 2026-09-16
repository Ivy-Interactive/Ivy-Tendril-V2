//! `tendril db` end to end, driven through the built binary so exit codes and stdout shape are the
//! real ones.
//!
//! Every test runs against an isolated temp `--home`. The ambient `TENDRIL_HOME` on a developer
//! machine points at a real installation, so `--home` is always passed explicitly and the fixture
//! asserts its own path is under the temp directory before it deletes anything.

use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use tendril_core::db::{get_schema_version, SCHEMA_VERSION};

/// A scratch `TENDRIL_HOME`, removed when the guard drops.
struct Fixture {
    home: PathBuf,
}

impl Fixture {
    fn new(tag: &str) -> Self {
        let home = std::env::temp_dir().join(format!(
            "tendril-cli-db-test-{tag}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&home).unwrap();
        assert!(
            home.starts_with(std::env::temp_dir()),
            "fixture home must be under the temp dir, got {}",
            home.display()
        );
        Self { home }
    }

    fn db_path(&self) -> PathBuf {
        self.home.join("tendril.db")
    }

    fn base_command(&self) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_tendril"));
        cmd.arg("--home")
            .arg(&self.home)
            // `TENDRIL_HOME` is the clap env fallback for `--home`; setting it to the fixture home
            // as well means a dropped `--home` in a future edit still cannot reach a real install.
            .env("TENDRIL_HOME", &self.home)
            .env("TENDRIL_PLANS", self.home.join("Plans"))
            .env_remove("TENDRIL_CONFIG");
        cmd
    }

    /// Runs the CLI with stdin closed, i.e. how a non-interactive caller invokes it.
    fn run(&self, args: &[&str]) -> Output {
        self.base_command()
            .args(args)
            .stdin(Stdio::null())
            .output()
            .expect("run tendril")
    }

    /// Runs the CLI with `answer` piped to stdin, for the confirmation prompts.
    fn run_with_stdin(&self, args: &[&str], answer: &str) -> Output {
        let mut child = self
            .base_command()
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn tendril");
        child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(answer.as_bytes())
            .unwrap();
        child.wait_with_output().expect("wait for tendril")
    }

    fn conn(&self) -> rusqlite::Connection {
        rusqlite::Connection::open(self.db_path()).expect("open fixture database")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.home.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

fn stdout_of(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).to_string()
}

fn stderr_of(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).to_string()
}

fn exit_code(out: &Output) -> i32 {
    out.status
        .code()
        .expect("the CLI must exit, not be signalled")
}

/// Every table and index name in the database, so two schemas can be compared as sets.
fn schema_objects(conn: &rusqlite::Connection) -> BTreeSet<String> {
    let mut stmt = conn
        .prepare(
            "SELECT type || ':' || name FROM sqlite_master \
             WHERE name NOT LIKE 'sqlite_%' ORDER BY 1",
        )
        .unwrap();
    stmt.query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<BTreeSet<_>>>()
        .unwrap()
}

/// Inserts a minimal `Plans` row, filling every `NOT NULL` column the current schema declares.
fn insert_plan(conn: &rusqlite::Connection, id: i64, title: &str) {
    conn.execute(
        "INSERT INTO Plans (Id, Title, Project, Level, State, FolderPath, FolderName, YamlRaw, \
         LatestRevisionContent, Created, Updated) \
         VALUES (?1, ?2, 'P', 'Feature', 'Draft', ?3, ?4, '', '', '2026-01-01T00:00:00Z', \
         '2026-01-01T00:00:00Z')",
        rusqlite::params![
            id,
            title,
            format!("/tmp/plans/{id}-{title}"),
            format!("{id}-{title}")
        ],
    )
    .expect("insert plan row");
}

/// A database as an early version of the app left it: the tables exist, but only with the columns
/// they had before the later migrations added the rest. Mirrors the fixture in
/// `tendril-core/src/db/migrations.rs::a_legacy_database_upgrades_without_losing_its_rows`, so the
/// CLI path is exercised against the same shape as the library regression test.
fn write_legacy_database(path: &Path) {
    let conn = rusqlite::Connection::open(path).unwrap();
    conn.execute_batch(
        r#"
        PRAGMA user_version = 3;
        CREATE TABLE Plans (Id INTEGER PRIMARY KEY, Title TEXT, State TEXT, Project TEXT,
                            Level TEXT, FolderPath TEXT, Created TEXT, Updated TEXT);
        CREATE TABLE Jobs (Id TEXT PRIMARY KEY, Type TEXT, PlanFile TEXT, Project TEXT,
                           Status TEXT);
        CREATE TABLE Costs (Id INTEGER PRIMARY KEY, PlanId INTEGER, Cost REAL);
        CREATE TABLE Recommendations (Id INTEGER PRIMARY KEY, PlanId INTEGER, Title TEXT);
        CREATE TABLE PrStatuses (PrUrl TEXT PRIMARY KEY);
        INSERT INTO Plans VALUES (1,'Legacy plan','Draft','P','Feature','/tmp/x','t','t');
        INSERT INTO Plans VALUES (2,'Second legacy plan','Completed','P','Bug','/tmp/y','t','t');
        INSERT INTO Jobs VALUES ('00001','ExecutePlan','/tmp/x','P','Completed');
        INSERT INTO Costs VALUES (1,1,0.5);
        INSERT INTO Recommendations VALUES (1,1,'Legacy recommendation');
        INSERT INTO PrStatuses VALUES ('https://github.com/o/r/pull/1');
        "#,
    )
    .unwrap();
}

// ---------------------------------------------------------------------------
// version
// ---------------------------------------------------------------------------

/// The three commands that need an existing database refuse rather than creating one, and say which
/// path they looked at.
#[test]
fn commands_that_need_a_database_exit_1_when_it_is_missing() {
    let fx = Fixture::new("missing-db");

    for args in [
        vec!["db", "version"],
        vec!["db", "integrity"],
        vec!["db", "vacuum"],
    ] {
        let out = fx.run(&args);
        assert_eq!(exit_code(&out), 1, "{args:?} must exit 1");
        let stdout = stdout_of(&out);
        assert!(
            stdout.contains("Database not found:") && stdout.contains("tendril.db"),
            "{args:?} must name the missing database, got:\n{stdout}"
        );
        assert!(
            !fx.db_path().exists(),
            "{args:?} must not create the database it was reporting as missing"
        );
    }
}

#[test]
fn db_version_reports_up_to_date_after_a_migrate() {
    let fx = Fixture::new("version-current");
    assert_eq!(exit_code(&fx.run(&["db", "migrate"])), 0);

    let out = fx.run(&["db", "version"]);
    assert_eq!(exit_code(&out), 0);
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains(&format!("Database version: {SCHEMA_VERSION}")),
        "{stdout}"
    );
    assert!(
        stdout.contains(&format!("Latest version:   {SCHEMA_VERSION}")),
        "{stdout}"
    );
    assert!(stdout.contains("Status:           Up to date"), "{stdout}");
}

/// `version` must report what is on disk, not migrate on the way past — otherwise it can never
/// report "Needs migration" at all.
#[test]
fn db_version_reports_needs_migration_without_migrating() {
    let fx = Fixture::new("version-old");
    write_legacy_database(&fx.db_path());

    let out = fx.run(&["db", "version"]);
    assert_eq!(exit_code(&out), 0);
    let stdout = stdout_of(&out);
    assert!(stdout.contains("Database version: 3"), "{stdout}");
    assert!(
        stdout.contains("Status:           Needs migration"),
        "{stdout}"
    );

    assert_eq!(
        get_schema_version(&fx.conn()).unwrap(),
        3,
        "`db version` must be read-only"
    );
}

#[test]
fn db_version_reports_a_database_newer_than_the_application() {
    let fx = Fixture::new("version-newer");
    assert_eq!(exit_code(&fx.run(&["db", "migrate"])), 0);
    fx.conn()
        .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
        .unwrap();

    let stdout = stdout_of(&fx.run(&["db", "version"]));
    assert!(
        stdout.contains(&format!("Database version: {}", SCHEMA_VERSION + 1)),
        "{stdout}"
    );
    assert!(
        stdout.contains("Status:           Newer than application"),
        "{stdout}"
    );
}

// ---------------------------------------------------------------------------
// migrate
// ---------------------------------------------------------------------------

#[test]
fn db_migrate_creates_a_complete_schema_and_reports_the_version() {
    let fx = Fixture::new("migrate-fresh");
    assert!(!fx.db_path().exists());

    let out = fx.run(&["db", "migrate"]);
    assert_eq!(exit_code(&out), 0);
    assert!(
        stdout_of(&out).contains(&format!("Database version: {SCHEMA_VERSION}")),
        "{}",
        stdout_of(&out)
    );
    assert!(fx.db_path().exists(), "migrate must create the database");

    let conn = fx.conn();
    assert_eq!(get_schema_version(&conn).unwrap(), SCHEMA_VERSION);
    for table in ["Plans", "Jobs", "Costs", "Recommendations", "PrStatuses"] {
        assert!(
            schema_objects(&conn).contains(&format!("table:{table}")),
            "{table} must exist after migrate"
        );
    }
}

/// Running `migrate` twice must be a no-op the second time: same schema objects, same version, and
/// no error. This is the property that lets the daemon call it on every open.
#[test]
fn db_migrate_is_idempotent() {
    let fx = Fixture::new("migrate-twice");

    let first = fx.run(&["db", "migrate"]);
    assert_eq!(exit_code(&first), 0);
    let schema_after_first = schema_objects(&fx.conn());
    assert_eq!(get_schema_version(&fx.conn()).unwrap(), SCHEMA_VERSION);

    // A row written between the two runs must survive the second, proving `migrate` is not quietly
    // recreating anything.
    insert_plan(&fx.conn(), 7, "Kept");

    let second = fx.run(&["db", "migrate"]);
    assert_eq!(exit_code(&second), 0, "a second migrate must still succeed");
    assert_eq!(
        stdout_of(&second),
        stdout_of(&first),
        "the second migrate must report the same version as the first"
    );
    assert_eq!(
        schema_objects(&fx.conn()),
        schema_after_first,
        "a second migrate must not add or drop schema objects"
    );
    assert_eq!(get_schema_version(&fx.conn()).unwrap(), SCHEMA_VERSION);

    let title: String = fx
        .conn()
        .query_row("SELECT Title FROM Plans WHERE Id = 7", [], |r| r.get(0))
        .unwrap();
    assert_eq!(title, "Kept");
}

/// The CLI-level equivalent of
/// `tendril-core/src/db/migrations.rs::a_legacy_database_upgrades_without_losing_its_rows`.
///
/// Opening a database created by an older version used to die partway through migration on
/// `CREATE INDEX … ON Jobs(CompletedAt)` — "no such column" — leaving a half-built schema behind.
/// Through the binary that showed up as a non-zero exit and an unusable home.
#[test]
fn a_legacy_database_upgrades_through_the_cli_without_losing_rows() {
    let fx = Fixture::new("legacy-upgrade");
    write_legacy_database(&fx.db_path());

    let out = fx.run(&["db", "migrate"]);
    assert_eq!(
        exit_code(&out),
        0,
        "migrating a legacy database must succeed; stderr:\n{}",
        stderr_of(&out)
    );
    assert!(
        stdout_of(&out).contains(&format!("Database version: {SCHEMA_VERSION}")),
        "{}",
        stdout_of(&out)
    );

    let conn = fx.conn();
    assert_eq!(get_schema_version(&conn).unwrap(), SCHEMA_VERSION);

    // The columns the schema's indexes reference, which is what the migration used to trip over.
    for (table, column) in [
        ("Jobs", "CompletedAt"),
        ("Jobs", "DedupeKey"),
        ("Costs", "Promptware"),
        ("Plans", "SourceUrl"),
        ("Recommendations", "Impact"),
        ("PrStatuses", "Branch"),
    ] {
        conn.query_row(&format!("SELECT {column} FROM {table} LIMIT 1"), [], |_| {
            Ok(())
        })
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(()),
            other => Err(other),
        })
        .unwrap_or_else(|e| panic!("{table}.{column} should exist after upgrade: {e}"));
    }

    // Every pre-existing row survives, unchanged.
    let plan_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM Plans", [], |r| r.get(0))
        .unwrap();
    assert_eq!(plan_count, 2);
    let titles: Vec<String> = {
        let mut stmt = conn.prepare("SELECT Title FROM Plans ORDER BY Id").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    assert_eq!(titles, vec!["Legacy plan", "Second legacy plan"]);

    let status: String = conn
        .query_row("SELECT Status FROM Jobs WHERE Id = '00001'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(status, "Completed");
    let cost: f64 = conn
        .query_row("SELECT Cost FROM Costs WHERE Id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cost, 0.5);
    let rec: String = conn
        .query_row("SELECT Title FROM Recommendations WHERE Id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(rec, "Legacy recommendation");
    let pr: String = conn
        .query_row("SELECT PrUrl FROM PrStatuses", [], |r| r.get(0))
        .unwrap();
    assert_eq!(pr, "https://github.com/o/r/pull/1");
    drop(conn);

    // And the upgraded database passes the CLI's own integrity check.
    let integrity = fx.run(&["db", "integrity"]);
    assert_eq!(exit_code(&integrity), 0);
    assert_eq!(stdout_of(&integrity).trim(), "ok");
}

/// An upgraded legacy database must end up with the same schema a fresh one gets, or the two
/// installations diverge silently.
#[test]
fn an_upgraded_legacy_database_matches_a_fresh_one() {
    let legacy = Fixture::new("legacy-schema");
    write_legacy_database(&legacy.db_path());
    assert_eq!(exit_code(&legacy.run(&["db", "migrate"])), 0);

    let fresh = Fixture::new("fresh-schema");
    assert_eq!(exit_code(&fresh.run(&["db", "migrate"])), 0);

    let upgraded = schema_objects(&legacy.conn());
    let expected = schema_objects(&fresh.conn());
    let missing: Vec<_> = expected.difference(&upgraded).collect();
    assert!(
        missing.is_empty(),
        "an upgraded legacy database is missing schema objects a fresh one has: {missing:?}"
    );
}

/// KNOWN LIMITATION, pinned deliberately: `apply_migrations` is not wrapped in a transaction, so a
/// statement that fails partway leaves the work before it committed and `user_version` unchanged.
///
/// The failure is forced with an object named `Plans` that is a view: the `Jobs` column pass runs
/// first and commits, then the `Plans` pass dies on "Cannot add a column to a view".
///
/// This test asserts the *current* behaviour, not the desired one. The fix — wrapping the upgrade in
/// a transaction — belongs in `tendril-core/src/db/migrations.rs::apply_migrations`, which this test
/// suite does not own. When that fix lands, this test should start failing and be rewritten to
/// assert that nothing at all was changed.
#[test]
fn a_failed_migration_leaves_partial_work_behind() {
    let fx = Fixture::new("partial-migration");
    {
        let conn = fx.conn();
        conn.execute_batch(
            r#"
            PRAGMA user_version = 3;
            CREATE TABLE Jobs (Id TEXT PRIMARY KEY, Type TEXT, Status TEXT);
            CREATE TABLE PlansBacking (Id INTEGER PRIMARY KEY, Title TEXT);
            CREATE VIEW Plans AS SELECT Id, Title FROM PlansBacking;
            "#,
        )
        .unwrap();
    }

    let out = fx.run(&["db", "migrate"]);
    assert_eq!(
        exit_code(&out),
        1,
        "a migration that cannot complete must exit 1"
    );
    assert!(
        stderr_of(&out).contains("Cannot add a column to a view"),
        "the underlying SQLite error must reach the operator, got:\n{}",
        stderr_of(&out)
    );

    let conn = fx.conn();
    assert_eq!(
        get_schema_version(&conn).unwrap(),
        3,
        "the version stamp is only written at the end, so it stays at the old value"
    );

    // The partial work: `Jobs` was altered before the failure and those columns are still there.
    let jobs_columns: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(Jobs)").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    assert!(
        jobs_columns.iter().any(|c| c == "CompletedAt"),
        "current behaviour: the Jobs ALTER pass is committed even though the migration failed, \
         got columns {jobs_columns:?}"
    );
}

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

#[test]
fn db_reset_force_drops_and_recreates_a_complete_schema() {
    let fx = Fixture::new("reset-force");
    assert_eq!(exit_code(&fx.run(&["db", "migrate"])), 0);
    let schema_before = schema_objects(&fx.conn());
    insert_plan(&fx.conn(), 1, "Doomed");

    let out = fx.run(&["db", "reset", "--force"]);
    assert_eq!(exit_code(&out), 0, "stderr:\n{}", stderr_of(&out));
    let stdout = stdout_of(&out);
    assert!(stdout.contains("Resetting database..."), "{stdout}");
    assert!(stdout.contains("Dropping existing tables"), "{stdout}");
    assert!(
        stdout.contains(&format!("Database version: {SCHEMA_VERSION}")),
        "{stdout}"
    );

    let conn = fx.conn();
    assert_eq!(
        schema_objects(&conn),
        schema_before,
        "reset must recreate the full schema, not a subset of it"
    );
    assert_eq!(get_schema_version(&conn).unwrap(), SCHEMA_VERSION);
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM Plans", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 0, "reset must drop the data");
    drop(conn);

    let integrity = fx.run(&["db", "integrity"]);
    assert_eq!(exit_code(&integrity), 0);
    assert_eq!(stdout_of(&integrity).trim(), "ok");
}

/// `db reset` on a home with no database creates one rather than refusing — the arm that skips the
/// existence check.
#[test]
fn db_reset_force_creates_a_missing_database() {
    let fx = Fixture::new("reset-creates");
    assert!(!fx.db_path().exists());

    let out = fx.run(&["db", "reset", "--force"]);
    assert_eq!(exit_code(&out), 0, "stderr:\n{}", stderr_of(&out));
    assert_eq!(get_schema_version(&fx.conn()).unwrap(), SCHEMA_VERSION);
}

/// Without `--force` the prompt decides. Its answer parse is deliberately stricter than
/// `tendril reset`'s: only an exact `y` proceeds, and a refusal exits 1 rather than 0.
#[test]
fn db_reset_prompt_accepts_only_an_exact_y() {
    for (answer, should_proceed) in [
        ("y\n", true),
        ("Y\n", true),
        ("yes\n", false),
        ("n\n", false),
    ] {
        let fx = Fixture::new("reset-prompt");
        assert_eq!(exit_code(&fx.run(&["db", "migrate"])), 0);
        insert_plan(&fx.conn(), 1, "Row");

        let out = fx.run_with_stdin(&["db", "reset"], answer);
        let stdout = stdout_of(&out);
        assert!(
            stdout.contains("WARNING: This will delete all data in the database."),
            "the prompt must warn before deleting: {stdout}"
        );

        let rows: i64 = fx
            .conn()
            .query_row("SELECT COUNT(*) FROM Plans", [], |r| r.get(0))
            .unwrap();

        if should_proceed {
            assert_eq!(exit_code(&out), 0, "{answer:?} must proceed");
            assert_eq!(rows, 0, "{answer:?} must have dropped the data");
        } else {
            assert_eq!(exit_code(&out), 1, "{answer:?} must abort with exit 1");
            assert!(stdout.contains("Aborted."), "{answer:?}: {stdout}");
            assert_eq!(rows, 1, "{answer:?} must leave the data alone");
        }
    }
}

/// A non-interactive run reads EOF as an empty line, which the strict predicate declines — a piped
/// `db reset` never silently wipes a database.
#[test]
fn db_reset_declines_when_stdin_is_closed() {
    let fx = Fixture::new("reset-eof");
    assert_eq!(exit_code(&fx.run(&["db", "migrate"])), 0);

    let out = fx.run(&["db", "reset"]);
    assert_eq!(exit_code(&out), 1);
    assert!(stdout_of(&out).contains("Aborted."), "{}", stdout_of(&out));
    assert_eq!(get_schema_version(&fx.conn()).unwrap(), SCHEMA_VERSION);
}

/// `db reset` only rebuilds the database. Plan YAML on disk is not its business.
#[test]
fn db_reset_leaves_the_plans_directory_alone() {
    let fx = Fixture::new("reset-keeps-plans");
    let plan_folder = fx.home.join("Plans").join("00001-Kept");
    std::fs::create_dir_all(&plan_folder).unwrap();
    std::fs::write(plan_folder.join("plan.yaml"), "title: Kept\n").unwrap();

    assert_eq!(exit_code(&fx.run(&["db", "reset", "--force"])), 0);
    assert!(
        plan_folder.join("plan.yaml").exists(),
        "db reset must not touch plan files"
    );
}

// ---------------------------------------------------------------------------
// integrity / vacuum
// ---------------------------------------------------------------------------

#[test]
fn db_integrity_prints_ok_for_a_healthy_database() {
    let fx = Fixture::new("integrity-ok");
    assert_eq!(exit_code(&fx.run(&["db", "migrate"])), 0);

    let out = fx.run(&["db", "integrity"]);
    assert_eq!(exit_code(&out), 0);
    assert_eq!(
        stdout_of(&out).trim(),
        "ok",
        "a healthy database prints exactly one line: ok"
    );
}

/// A file that is not a SQLite database at all: `integrity` must fail rather than report ok.
#[test]
fn db_integrity_fails_on_a_corrupt_file() {
    let fx = Fixture::new("integrity-corrupt");
    std::fs::write(fx.db_path(), b"this is not a sqlite database").unwrap();

    let out = fx.run(&["db", "integrity"]);
    assert_ne!(exit_code(&out), 0, "a corrupt database must not exit 0");
    assert_ne!(
        stdout_of(&out).trim(),
        "ok",
        "a corrupt database must not be reported as ok"
    );
}

#[test]
fn db_vacuum_reports_the_size_before_and_after() {
    let fx = Fixture::new("vacuum");
    assert_eq!(exit_code(&fx.run(&["db", "migrate"])), 0);

    let out = fx.run(&["db", "vacuum"]);
    assert_eq!(exit_code(&out), 0, "stderr:\n{}", stderr_of(&out));
    let stdout = stdout_of(&out);
    assert!(stdout.contains("Size before: "), "{stdout}");
    assert!(stdout.contains("Size after:  "), "{stdout}");
    assert!(stdout.contains("Reclaimed:   "), "{stdout}");

    // The database is still usable afterwards.
    assert_eq!(exit_code(&fx.run(&["db", "integrity"])), 0);
    assert_eq!(get_schema_version(&fx.conn()).unwrap(), SCHEMA_VERSION);
}

/// `vacuum` never grows the reported figure: `Reclaimed` is a saturating subtraction, so a database
/// that grew reports 0 rather than underflowing.
#[test]
fn db_vacuum_reclaimed_is_never_negative() {
    let fx = Fixture::new("vacuum-saturating");
    assert_eq!(exit_code(&fx.run(&["db", "migrate"])), 0);

    let stdout = stdout_of(&fx.run(&["db", "vacuum"]));
    let reclaimed = stdout
        .lines()
        .find_map(|l| l.strip_prefix("Reclaimed:   "))
        .and_then(|v| v.strip_suffix(" bytes"))
        .unwrap_or_else(|| panic!("no Reclaimed line in:\n{stdout}"))
        .parse::<u64>();
    assert!(
        reclaimed.is_ok(),
        "Reclaimed must be an unsigned byte count: {stdout}"
    );
}

// ---------------------------------------------------------------------------
// safety guard
// ---------------------------------------------------------------------------

/// `db reset` from a test process must refuse the operator's real home. The "real home" here is
/// simulated by pointing `HOME` at a temp directory, so the assertion never depends on — or risks —
/// the developer's actual installation.
#[test]
fn db_reset_refuses_a_home_that_resolves_as_the_real_one() {
    let fx = Fixture::new("guard");
    let fake_user_home = fx.home.join("fake-user");
    let looks_real = fake_user_home.join(".tendril");
    std::fs::create_dir_all(&looks_real).unwrap();
    let db = looks_real.join("tendril.db");
    std::fs::write(&db, b"precious").unwrap();

    let out = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .arg("--home")
        .arg(&looks_real)
        .args(["db", "reset", "--force"])
        .env("HOME", &fake_user_home)
        .env_remove("USERPROFILE")
        .env_remove("TENDRIL_HOME")
        .env_remove("TENDRIL_PLANS")
        .env_remove("TENDRIL_CONFIG")
        // Marks the child as a test process, which is what arms `ensure_not_real_home`.
        .env("TENDRIL_TEST_ISOLATION", "1")
        .stdin(Stdio::null())
        .output()
        .expect("run tendril");

    assert_eq!(exit_code(&out), 1, "the guard must fail the command");
    assert!(
        stderr_of(&out).contains("Refusing to use the real Tendril home"),
        "the refusal must say why, got:\n{}",
        stderr_of(&out)
    );
    assert_eq!(
        std::fs::read(&db).unwrap(),
        b"precious",
        "the guard must fire before anything is dropped"
    );
}

// ---------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------

/// clap uses exit code 2 for a usage error, which is what distinguishes "you typed it wrong" from a
/// runtime failure (1).
#[test]
fn usage_errors_exit_2() {
    let fx = Fixture::new("usage");

    for args in [
        vec!["db", "obliterate"],
        vec!["db", "version", "--bogus"],
        vec!["db", "reset", "--forse"],
        vec!["db"],
    ] {
        let out = fx.run(&args);
        assert_eq!(exit_code(&out), 2, "{args:?} must be a clap usage error");
    }
}

#[test]
fn db_help_lists_every_subcommand() {
    let fx = Fixture::new("help");
    let out = fx.run(&["db", "--help"]);
    assert_eq!(exit_code(&out), 0);
    let stdout = stdout_of(&out);
    for sub in ["version", "migrate", "reset", "integrity", "vacuum"] {
        assert!(
            stdout.contains(sub),
            "`db --help` must list {sub}:\n{stdout}"
        );
    }
}
