//! `tendril serve`, run as a process, because that is where these three bugs only ever showed up.
//!
//! - #138: no subscriber was installed, so all 37 `tracing::{info,warn,error}!` sites in the daemon
//!   went nowhere, even under `RUST_LOG=debug`.
//! - #128: `.master` was written after the bind, so the recorded port could not be the bound one.
//! - #127: with a stream open, SIGTERM never returned and the daemon had to be SIGKILLed — which
//!   skips `MasterGuard::drop` and leaves a stale `.master` behind.
//!
//! Unix only: the test signals with `kill -TERM`, and Windows has no equivalent for a console app.
#![cfg(unix)]

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// The daemon's own shutdown grace is 10s (`tendril_server::SHUTDOWN_GRACE`); this has to be
/// comfortably longer without being "forever".
const EXIT_TIMEOUT: Duration = Duration::from_secs(30);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

/// A throwaway `TENDRIL_HOME`, removed on drop, with the daemon killed if a test failed early.
struct DaemonFixture {
    home: PathBuf,
    child: Child,
}

impl DaemonFixture {
    /// Starts `tendril serve --port 0` against a fresh home.
    ///
    /// `Promptwares` is deliberately a *file*: startup promptware deployment then fails, which is the
    /// cheapest way to force a real `tracing::warn!` from inside the daemon — the exact warning that
    /// tells an operator why every job is about to fail.
    fn start() -> Self {
        let home = std::env::temp_dir().join(format!(
            "tendril-serve-daemon-{}",
            uuid::Uuid::new_v4().simple()
        ));
        assert!(home.starts_with(std::env::temp_dir()));
        std::fs::create_dir_all(&home).expect("create the fixture home");
        std::fs::write(home.join("Promptwares"), "not a directory\n")
            .expect("block promptware deployment");

        let stdout = std::fs::File::create(home.join("stdout.log")).expect("stdout log");
        let stderr = std::fs::File::create(home.join("stderr.log")).expect("stderr log");

        let child = Command::new(env!("CARGO_BIN_EXE_tendril"))
            .args(["serve", "--port", "0", "--host", "127.0.0.1"])
            .env("TENDRIL_HOME", &home)
            // The daemon must never touch the operator's real home, whatever the ambient env says.
            .env("TENDRIL_TEST_ISOLATION", "1")
            // Unset on purpose: the default filter is what a real operator gets, and it is what has
            // to carry the daemon's warnings.
            .env_remove("RUST_LOG")
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .expect("spawn tendril serve");

        Self { home, child }
    }

    fn stdout(&self) -> String {
        std::fs::read_to_string(self.home.join("stdout.log")).unwrap_or_default()
    }

    fn stderr(&self) -> String {
        std::fs::read_to_string(self.home.join("stderr.log")).unwrap_or_default()
    }

    /// The claim, once it names a real bound port.
    fn wait_for_master(&self) -> tendril_core::config::MasterInfo {
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        while Instant::now() < deadline {
            if let Some(info) = tendril_core::config::read_master(&self.home) {
                if info.port != 0 {
                    return info;
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        panic!(
            "the daemon never published a bound port.\nstdout:\n{}\nstderr:\n{}",
            self.stdout(),
            self.stderr()
        );
    }

    fn signal_term(&self) {
        let status = Command::new("kill")
            .args(["-TERM", &self.child.id().to_string()])
            .status()
            .expect("run kill");
        assert!(status.success(), "kill -TERM failed");
    }

    /// Waits for the process to exit of its own accord.
    fn wait_for_exit(&mut self, timeout: Duration) -> Option<Duration> {
        let started = Instant::now();
        while started.elapsed() < timeout {
            match self.child.try_wait().expect("try_wait") {
                Some(_) => return Some(started.elapsed()),
                None => std::thread::sleep(Duration::from_millis(100)),
            }
        }
        None
    }
}

impl Drop for DaemonFixture {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        assert!(self.home.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

/// Opens `/api/changes/events` and reads the response head, so the stream is provably in flight. The
/// returned socket has to stay alive: it is the connection the daemon used to hang on.
fn open_change_stream(info: &tendril_core::config::MasterInfo) -> TcpStream {
    let mut socket = TcpStream::connect((info.host.as_str(), info.port)).expect("connect");
    socket
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("read timeout");
    let request = format!(
        "GET /api/changes/events HTTP/1.1\r\nHost: {}:{}\r\nAuthorization: Bearer {}\r\nAccept: text/event-stream\r\n\r\n",
        info.host, info.port, info.secret
    );
    socket
        .write_all(request.as_bytes())
        .expect("send the SSE request");

    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        let n = socket.read(&mut byte).expect("read the response head");
        assert!(n > 0, "the daemon closed the SSE connection");
        head.extend_from_slice(&byte);
    }
    let head = String::from_utf8_lossy(&head).to_string();
    assert!(
        head.starts_with("HTTP/1.1 200"),
        "the SSE stream must be established (is the bearer secret right?): {head}"
    );

    socket
}

#[test]
fn the_daemon_logs_to_stderr_publishes_its_bound_port_and_exits_on_sigterm() {
    let mut daemon = DaemonFixture::start();
    let info = daemon.wait_for_master();

    // #128: the claim names the port that was actually bound, not the 0 that was asked for.
    assert_ne!(info.port, 0);
    assert_eq!(info.pid, daemon.child.id());
    let stdout = daemon.stdout();
    assert!(
        stdout.contains(&format!(
            ">>> Tendril Server running on http://127.0.0.1:{}",
            info.port
        )),
        "the announcement must name the bound port, got stdout:\n{stdout}"
    );

    // #138: the daemon's diagnostics reach stderr with no RUST_LOG set at all.
    let stderr = daemon.stderr();
    assert!(
        stderr.contains("Could not deploy promptwares"),
        "the daemon's warning about a failed promptware deploy must be visible, got stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("WARN"),
        "log lines must be formatted with their level, got stderr:\n{stderr}"
    );
    // And never on stdout: `mcp` speaks JSON-RPC there and `project-analyzer` writes a report.
    assert!(
        !stdout.contains("Could not deploy promptwares") && !stdout.contains("WARN"),
        "no log line may land on stdout, got stdout:\n{stdout}"
    );

    // #127: a stream with no terminal event, open across the signal — what the desktop app holds.
    let _stream = open_change_stream(&info);

    daemon.signal_term();
    let elapsed = daemon.wait_for_exit(EXIT_TIMEOUT).unwrap_or_else(|| {
        panic!(
            "the daemon did not exit within {:?} of SIGTERM with an SSE stream open.\nstderr:\n{}",
            EXIT_TIMEOUT,
            daemon.stderr()
        )
    });
    println!("daemon exited {elapsed:?} after SIGTERM");

    assert!(
        daemon
            .stdout()
            .contains("Shutting down Tendril Server gracefully"),
        "the shutdown signal must have been the reason it left, got stdout:\n{}",
        daemon.stdout()
    );
    // The point of exiting rather than being SIGKILLed: `MasterGuard::drop` runs, so the next start
    // does not have to clean up after this one.
    assert!(
        !daemon.home.join(".master").exists(),
        ".master must be released by a graceful shutdown"
    );
}
