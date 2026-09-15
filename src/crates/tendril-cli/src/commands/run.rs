use std::net::TcpListener;
use std::path::Path;
use tendril_core::config::get_database_path;
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
