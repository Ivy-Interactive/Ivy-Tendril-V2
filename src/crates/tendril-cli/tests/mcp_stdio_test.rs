//! The stdio transport, exercised against the real binary.
//!
//! stdout is reserved for JSON-RPC — one object per line, nothing else, ever. A stray `println!`
//! anywhere on the dispatch path corrupts the stream and breaks every MCP client, and no unit test
//! can catch that, so this one runs the process with `RUST_LOG=trace` and reads both pipes.

use serde_json::Value;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

/// A throwaway `TENDRIL_HOME`, removed on drop.
struct HomeFixture {
    path: PathBuf,
}

impl HomeFixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "tendril-mcp-stdio-{}",
            uuid::Uuid::new_v4().simple()
        ));
        assert!(path.starts_with(std::env::temp_dir()));
        std::fs::create_dir_all(path.join("Plans")).expect("create fixture Plans dir");
        std::fs::write(path.join("config.yaml"), "codingAgent: claude\n").expect("write config");
        Self { path }
    }
}

impl Drop for HomeFixture {
    fn drop(&mut self) {
        assert!(self.path.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn stdout_carries_only_jsonrpc() {
    let fixture = HomeFixture::new();

    // Four requests that expect a reply, plus one notification that must not be answered.
    let requests = [
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"stdio-test","version":"0"}}}"#,
        r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#,
        r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tendril_get_plan","arguments":{"plan_id":"99999"}}}"#,
        r#"{"jsonrpc":"2.0","id":4,"method":"tendril/nonsense"}"#,
    ];
    const EXPECTED_REPLIES: usize = 4;

    let mut child = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .arg("mcp")
        .env("TENDRIL_HOME", &fixture.path)
        .env("TENDRIL_PLANS", fixture.path.join("Plans"))
        .env("TENDRIL_CONFIG", fixture.path.join("config.yaml"))
        // Auth off, so the fixture does not depend on the operator's environment.
        .env_remove("TENDRIL_MCP_TOKEN")
        .env_remove("TENDRIL_MCP_CLIENT_TOKEN")
        // Everything the process logs must land on stderr, however verbose.
        .env("RUST_LOG", "trace")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn tendril mcp");

    {
        let stdin = child.stdin.as_mut().expect("stdin is piped");
        for request in requests {
            writeln!(stdin, "{}", request).expect("write request");
        }
        // Closing stdin ends the transport loop, so the process exits on its own.
    }
    child.stdin.take();

    let output = child.wait_with_output().expect("wait for tendril mcp");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        output.status.success(),
        "tendril mcp exited with {:?}\nstderr:\n{}",
        output.status.code(),
        stderr
    );

    let lines: Vec<&str> = stdout.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(
        lines.len(),
        EXPECTED_REPLIES,
        "expected one line per request that wants a reply and nothing else, got:\n{}",
        stdout
    );

    let mut responses = Vec::new();
    for line in &lines {
        let value: Value = serde_json::from_str(line).unwrap_or_else(|e| {
            panic!(
                "stdout line is not JSON ({}): {:?}\nfull stdout:\n{}",
                e, line, stdout
            )
        });
        assert_eq!(
            value["jsonrpc"], "2.0",
            "every stdout line must be a JSON-RPC message: {:?}",
            line
        );
        responses.push(value);
    }

    // The ids answered are exactly the ids asked; the notification got no reply.
    let ids: Vec<u64> = responses
        .iter()
        .map(|r| r["id"].as_u64().expect("every reply echoes its id"))
        .collect();
    assert_eq!(ids, vec![1, 2, 3, 4]);

    assert_eq!(responses[0]["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(responses[0]["result"]["serverInfo"]["name"], "tendril");

    let tools = responses[1]["result"]["tools"]
        .as_array()
        .expect("tools/list returns an array");
    assert!(tools.len() >= 25, "the catalog should be populated");

    // A tool that ran and failed is a result with isError, not a protocol error: the model sees the
    // reason and can adapt.
    assert!(
        responses[2].get("error").is_none(),
        "a failing tool is not a protocol error: {}",
        responses[2]
    );
    assert_eq!(responses[2]["result"]["isError"], true);
    assert_eq!(responses[2]["result"]["content"][0]["type"], "text");

    assert_eq!(responses[3]["error"]["code"], -32601);

    assert!(
        !stderr.trim().is_empty(),
        "RUST_LOG=trace should have produced log output, and it must go to stderr"
    );
}
