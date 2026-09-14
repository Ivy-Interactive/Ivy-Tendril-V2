//! The stdio transport for the MCP server.
//!
//! This file is transport only: read a line, hand it to [`McpSession`], write the answer back. The
//! protocol and every tool live in `tendril-core`, so they are unit-testable without a process.
//!
//! stdout is reserved for JSON-RPC — one object per line, nothing else, ever. Logs go to stderr
//! through the subscriber installed here.

use std::io::Write;
use std::path::Path;
use tendril_core::mcp::auth::McpAuth;
use tendril_core::mcp::protocol::McpSession;
use tokio::io::{AsyncBufReadExt, BufReader};
use tracing_subscriber::EnvFilter;

pub async fn handle_mcp(tendril_home: &Path) -> anyhow::Result<()> {
    // Before anything else, so no log line can escape to stdout and corrupt the stream.
    let _ = tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn")),
        )
        .try_init();

    let auth = McpAuth::from_env();
    if let Err(message) = auth.validate_env() {
        // Exit before reading a single line: an unauthenticated client gets no tool surface at all.
        eprintln!("{}", message);
        std::process::exit(1);
    }

    let mut session = McpSession::new(tendril_home, auth);
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = std::io::stdout();

    while let Some(line) = lines.next_line().await? {
        if let Some(response) = session.handle_message(&line).await {
            writeln!(stdout, "{}", response)?;
            stdout.flush()?;
        }
    }

    Ok(())
}
