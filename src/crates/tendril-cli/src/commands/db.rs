use crate::commands::confirm::{confirm_with, is_exactly_y};
use crate::commands::daemon_guard::refuse_if_daemon_running;
use clap::Subcommand;
use std::path::Path;
use tendril_core::config::get_database_path;
use tendril_core::db::{apply_migrations, get_schema_version, open_database, SCHEMA_VERSION};

#[derive(Subcommand)]
pub enum DbCommands {
    #[command(about = "Show the database schema version")]
    Version,

    #[command(about = "Apply pending schema work (idempotent)")]
    Migrate,

    #[command(about = "Drop every table and re-apply the schema")]
    Reset {
        /// Skip confirmation prompt
        #[arg(long)]
        force: bool,
    },

    #[command(about = "Run PRAGMA integrity_check")]
    Integrity,

    #[command(about = "Reclaim unused space with VACUUM")]
    Vacuum {
        /// Run even while a daemon is reachable
        #[arg(long)]
        force: bool,
    },
}

pub fn handle_db_command(cmd: DbCommands, tendril_home: &Path) -> anyhow::Result<()> {
    let db_path = get_database_path(tendril_home);

    match cmd {
        // `migrate` and `reset` legitimately create the database; everything else needs it to exist.
        DbCommands::Migrate | DbCommands::Reset { .. } => {}
        _ => {
            if !db_path.exists() {
                println!("Database not found: {}", db_path.display());
                std::process::exit(1);
            }
        }
    }

    match cmd {
        DbCommands::Version => {
            // Deliberately a plain `Connection::open` rather than `open_database`, which would apply
            // migrations as a side effect and make this command report its own handiwork.
            let conn = rusqlite::Connection::open(&db_path)?;
            let current = get_schema_version(&conn)?;
            let status = if current == SCHEMA_VERSION {
                "Up to date"
            } else if current > SCHEMA_VERSION {
                "Newer than application"
            } else {
                "Needs migration"
            };

            println!("Database version: {current}");
            println!("Latest version:   {SCHEMA_VERSION}");
            println!("Status:           {status}");
        }

        DbCommands::Migrate => {
            let conn = open_database(&db_path)?;
            println!("Database version: {}", get_schema_version(&conn)?);
        }

        DbCommands::Reset { force } => {
            if refuse_if_daemon_running(tendril_home, force, "resetting the database") {
                std::process::exit(1);
            }

            // The original accepts only an exact `y` here, unlike `tendril reset`'s prompt, and
            // returns 1 rather than 0 on refusal. Both differences are preserved.
            let proceed = confirm_with(
                "WARNING: This will delete all data in the database. Are you sure? [y/n]",
                force,
                false,
                is_exactly_y,
            )?;
            if !proceed {
                println!("Aborted.");
                std::process::exit(1);
            }

            println!("Resetting database...");
            let conn = rusqlite::Connection::open(&db_path)?;

            let tables: Vec<String> = {
                let mut stmt = conn.prepare(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'",
                )?;
                let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };

            println!("  Dropping existing tables");
            for table in &tables {
                conn.execute_batch(&format!("DROP TABLE IF EXISTS \"{table}\";"))?;
            }

            conn.pragma_update(None, "user_version", 0i64)?;
            apply_migrations(&conn)?;

            // Plan YAML on disk is untouched — only the database is rebuilt.
            println!("Database version: {}", get_schema_version(&conn)?);
        }

        DbCommands::Integrity => {
            let conn = rusqlite::Connection::open(&db_path)?;
            let mut stmt = conn.prepare("PRAGMA integrity_check")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            let results = rows.collect::<rusqlite::Result<Vec<_>>>()?;

            for line in &results {
                println!("{line}");
            }

            if results.len() != 1 || results[0] != "ok" {
                std::process::exit(1);
            }
        }

        DbCommands::Vacuum { force } => {
            if refuse_if_daemon_running(tendril_home, force, "vacuuming the database") {
                std::process::exit(1);
            }

            let before = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
            println!("Size before: {before} bytes");

            let conn = rusqlite::Connection::open(&db_path)?;
            conn.execute_batch("VACUUM;")?;
            drop(conn);

            let after = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
            println!("Size after:  {after} bytes");
            println!("Reclaimed:   {} bytes", before.saturating_sub(after));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    /// Wraps the real `DbCommands` so parsing is exercised against the type `main.rs` registers,
    /// not a copy of it.
    #[derive(Parser)]
    #[command(name = "tendril")]
    struct TestCli {
        #[command(subcommand)]
        command: DbCommands,
    }

    fn parse(args: &[&str]) -> DbCommands {
        TestCli::try_parse_from(args).unwrap().command
    }

    #[test]
    fn every_subcommand_parses() {
        assert!(matches!(
            parse(&["tendril", "version"]),
            DbCommands::Version
        ));
        assert!(matches!(
            parse(&["tendril", "migrate"]),
            DbCommands::Migrate
        ));
        assert!(matches!(
            parse(&["tendril", "reset"]),
            DbCommands::Reset { force: false }
        ));
        assert!(matches!(
            parse(&["tendril", "integrity"]),
            DbCommands::Integrity
        ));
        assert!(matches!(
            parse(&["tendril", "vacuum"]),
            DbCommands::Vacuum { force: false }
        ));
    }

    #[test]
    fn force_flags_parse() {
        assert!(matches!(
            parse(&["tendril", "reset", "--force"]),
            DbCommands::Reset { force: true }
        ));
        assert!(matches!(
            parse(&["tendril", "vacuum", "--force"]),
            DbCommands::Vacuum { force: true }
        ));
    }

    #[test]
    fn an_unknown_subcommand_is_rejected() {
        assert!(TestCli::try_parse_from(["tendril", "obliterate"]).is_err());
        assert!(TestCli::try_parse_from(["tendril"]).is_err());
    }
}
