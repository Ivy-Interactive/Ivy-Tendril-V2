use std::net::TcpListener;
use std::path::Path;
use tendril_core::config::{get_database_path, is_process_running, read_master};
use tendril_core::db::open_database;

/// True when a TCP listener cannot be bound on loopback at this port.
pub fn is_port_in_use(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_err()
}

/// The multi-line operator advisory printed before exiting, platform-specific in its
/// "find the process" hint.
pub fn port_in_use_message(port: u16) -> String {
    let find_process_hint = if cfg!(windows) {
        format!("netstat -ano | findstr :{port}")
    } else {
        format!("lsof -i :{port}")
    };
    format!(
        "Port {port} is already in use.\nTo find the process using it, run: {find_process_hint}\nTo use a different port, use --port (e.g. tendril run --port 5011)."
    )
}

pub async fn handle_run(tendril_home: &Path, port: u16, host: String) -> anyhow::Result<()> {
    if is_port_in_use(port) {
        eprintln!("{}", port_in_use_message(port));
        anyhow::bail!("port {port} is already in use");
    }

    // Before the database, because the database is what a second instance trips over first. Two
    // daemons started together on one home race on the SQLite file during the WAL conversion, and the
    // loser died with a bare "database is locked" — which names the symptom and not the cause, and
    // never reaches the master election that would have explained itself. A different `--port` makes
    // the port check above miss it entirely, so this is the only place that catches it.
    if let Some(existing) = read_master(tendril_home) {
        if is_process_running(existing.pid) {
            anyhow::bail!(
                "Another Tendril instance is already running on this home (PID {}, {}). \
                 Stop it, or start this one with a different --home.",
                existing.pid,
                existing.base_url()
            );
        }
    }

    println!("Checking database status...");
    let db_path = get_database_path(tendril_home);
    drop(open_database(&db_path)?);
    println!("Database ready.");

    println!("Starting Tendril server on {host}:{port}...");
    crate::commands::serve::handle_serve(tendril_home, port, Some(host), None, None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A second daemon on the same home used to die on `open_database` with a bare "database is
    /// locked" — the symptom, not the cause, and it never reached the master election that would have
    /// explained itself. A different `--port` makes the port check miss the collision entirely, so
    /// this refusal is the only thing that catches it.
    ///
    /// The claim names *this* process, which is by definition alive, so the liveness branch is the one
    /// under test without spawning anything.
    #[tokio::test]
    async fn a_second_instance_on_a_live_home_is_refused_by_name() {
        let home = std::env::temp_dir().join(format!("tendril-run-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&home).unwrap();
        tendril_core::config::write_master(&home, 5093, "secret", "127.0.0.1", "http").unwrap();

        // Port 0 is never "in use", so the earlier guard cannot be what refuses this.
        let err = handle_run(&home, 0, "127.0.0.1".to_string())
            .await
            .expect_err("a live claim on this home must be refused");
        let message = err.to_string();
        assert!(
            message.contains("already running"),
            "should name the cause, got: {message}"
        );
        assert!(
            message.contains(&std::process::id().to_string()),
            "should name the holding pid, got: {message}"
        );
        assert!(
            message.contains("5093"),
            "should name where it is serving, got: {message}"
        );
        // And it must refuse before touching the database, which is what used to fail first.
        assert!(
            !home.join("tendril.db").exists(),
            "refusal must come before the database is opened"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn port_in_use_message_names_the_port_and_the_flag() {
        let message = port_in_use_message(5011);
        assert!(message.contains("5011"));
        assert!(message.contains("--port"));
        if cfg!(windows) {
            assert!(message.contains("netstat"));
        } else {
            assert!(message.contains("lsof"));
        }
    }

    #[test]
    fn is_port_in_use_reflects_a_live_listener() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(is_port_in_use(port));
        drop(listener);

        // On a shared machine, an unrelated process can grab this exact ephemeral port in the
        // instant between the drop above and the check below, so retry briefly rather than
        // asserting on a single sample.
        let freed = (0..20).any(|_| {
            if is_port_in_use(port) {
                std::thread::sleep(std::time::Duration::from_millis(10));
                false
            } else {
                true
            }
        });
        assert!(
            freed,
            "port {port} still reported in use after being dropped"
        );
    }
}
