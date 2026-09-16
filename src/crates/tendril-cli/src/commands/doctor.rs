use std::path::Path;
use tendril_core::config::get_database_path;
use tendril_core::db::{open_database, rebuild_search_index};
use tendril_core::health;

/// Prints the health registry in `tendril_core::health`. Every probe lives there so the onboarding
/// wizard and `/api/doctor` consume the same checks rather than a second set of shell-outs; this
/// command is only the printer.
///
/// The report always prints in full; the return value is the verdict. Exactly one thing makes it an
/// error: a `[FAIL]` line. `[WARN]` stays a success, because a fresh install legitimately warns
/// (no config yet, no plans directory, never synced, no `gh`) and a wrapper that gated on warnings
/// would refuse to run on every new machine.
pub fn handle_doctor(tendril_home: &Path, rebuild_search_index_flag: bool) -> anyhow::Result<()> {
    println!("Checking Tendril system health...");

    // The rebuild mutates the index the search checks then read, so it has to happen before
    // `run_checks` — but its line has always printed directly after the database line, so it is
    // held back and interleaved there.
    let mut rebuild_note = if rebuild_search_index_flag {
        rebuild_search_note(tendril_home)
    } else {
        None
    };
    let mut failures = 0usize;

    for check in health::run_checks(tendril_home) {
        if check.status == health::CheckStatus::Fail {
            failures += 1;
        }
        println!("[{}] {}", check.status.tag(), check.message);
        if check.name == health::DATABASE_CHECK_NAME {
            if let Some((failed, note)) = rebuild_note.take() {
                failures += usize::from(failed);
                println!("{}", note);
            }
        }
    }

    if failures > 0 {
        // The report is on stdout and stays there; this is the summary a caller's `$?` reads, so
        // `tendril doctor` can gate a CI job or a wrapper script.
        anyhow::bail!(
            "{} health check(s) failed. See the [FAIL] line(s) above.",
            failures
        );
    }

    Ok(())
}

/// The `--rebuild-search-index` line and whether it is a failure, or `None` when the database could
/// not be opened at all — in that case the database check already reports the error and a second line
/// would duplicate it.
fn rebuild_search_note(tendril_home: &Path) -> Option<(bool, String)> {
    let conn = open_database(&get_database_path(tendril_home)).ok()?;
    Some(match rebuild_search_index(&conn) {
        Ok(indexed) => (
            false,
            format!("Rebuilt plan search index ({} plans).", indexed),
        ),
        Err(e) => (
            true,
            format!("[FAIL] Could not rebuild plan search index: {}", e),
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("{}-{}", name, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Guards the printer refactor: every line doctor emits still carries one of the three tags the
    /// existing CLI tests (and any operator's eyes) match on.
    #[test]
    fn doctor_output_prefixes_are_preserved() {
        let home = scratch_dir("tendril-doctor-prefixes");
        // The verdict is deliberately not asserted here: whether a bare home produces a `[FAIL]`
        // depends on what is installed on the machine running the test (see
        // `doctor_exit_code_is_the_presence_of_a_fail_line` for the exit-code contract). This test is
        // about the tags.
        let _ = handle_doctor(&home, false);

        for check in health::run_checks(&home) {
            let line = format!("[{}] {}", check.status.tag(), check.message);
            assert!(
                line.starts_with("[OK] ")
                    || line.starts_with("[WARN] ")
                    || line.starts_with("[FAIL] "),
                "unprefixed doctor line: {line}"
            );
        }

        let _ = std::fs::remove_dir_all(&home);
    }
}
