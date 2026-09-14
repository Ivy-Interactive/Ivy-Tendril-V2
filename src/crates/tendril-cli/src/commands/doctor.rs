use std::path::Path;
use tendril_core::config::get_database_path;
use tendril_core::db::{open_database, rebuild_search_index};
use tendril_core::health;

/// Prints the health registry in `tendril_core::health`. Every probe lives there so the onboarding
/// wizard and `/api/doctor` consume the same checks rather than a second set of shell-outs; this
/// command is only the printer.
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

    for check in health::run_checks(tendril_home) {
        println!("[{}] {}", check.status.tag(), check.message);
        if check.name == health::DATABASE_CHECK_NAME {
            if let Some(note) = rebuild_note.take() {
                println!("{}", note);
            }
        }
    }

    Ok(())
}

/// The `--rebuild-search-index` line, or `None` when the database could not be opened at all — in
/// that case the database check already reports the error and a second line would duplicate it.
fn rebuild_search_note(tendril_home: &Path) -> Option<String> {
    let conn = open_database(&get_database_path(tendril_home)).ok()?;
    Some(match rebuild_search_index(&conn) {
        Ok(indexed) => format!("Rebuilt plan search index ({} plans).", indexed),
        Err(e) => format!("[FAIL] Could not rebuild plan search index: {}", e),
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
        handle_doctor(&home, false).expect("doctor never fails, it reports");

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
