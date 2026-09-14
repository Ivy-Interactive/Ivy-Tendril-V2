//! The JSON-RPC envelope surface of the MCP server.
//!
//! Every assertion here is on the wire shape a client actually reads: the handshake result, the
//! error codes, and the rule that a notification is never answered.

mod common;

use common::HomeFixture;
use serde_json::{json, Value};
use tendril_core::mcp::auth::McpAuth;
use tendril_core::mcp::protocol::{McpSession, PREFERRED_PROTOCOL_VERSION, SERVER_NAME};

/// A session against a throwaway home with authentication disabled.
fn session(fixture: &HomeFixture) -> McpSession {
    McpSession::new(&fixture.path, McpAuth::from_token(None))
}

async fn send(session: &mut McpSession, request: Value) -> Value {
    let line = session
        .handle_message(&request.to_string())
        .await
        .expect("expected a response");
    serde_json::from_str(&line).expect("response is JSON")
}

fn initialize_request(id: i64, protocol_version: Option<&str>) -> Value {
    let mut params = json!({ "clientInfo": { "name": "test-client", "version": "0.0.0" } });
    if let Some(version) = protocol_version {
        params["protocolVersion"] = json!(version);
    }
    json!({ "jsonrpc": "2.0", "id": id, "method": "initialize", "params": params })
}

#[tokio::test]
async fn initialize_returns_spec_valid_result() {
    let fixture = HomeFixture::new("mcp-initialize");
    let mut session = session(&fixture);

    let response = send(&mut session, initialize_request(7, Some("2025-06-18"))).await;

    assert_eq!(response["jsonrpc"], "2.0");
    assert_eq!(response["id"], 7, "the id must echo the request's");
    assert!(
        response.get("error").is_none(),
        "initialize must not error: {}",
        response
    );

    let result = &response["result"];
    assert_eq!(result["protocolVersion"], PREFERRED_PROTOCOL_VERSION);
    assert_eq!(result["serverInfo"]["name"], SERVER_NAME);
    assert!(
        result["serverInfo"]["version"]
            .as_str()
            .is_some_and(|v| !v.is_empty()),
        "serverInfo.version must be a non-empty string"
    );
    assert!(
        result["capabilities"]["tools"].is_object(),
        "capabilities.tools must be an object, got {}",
        result["capabilities"]["tools"]
    );
    assert_eq!(result["capabilities"]["tools"]["listChanged"], false);
    assert!(
        result["instructions"]
            .as_str()
            .is_some_and(|s| !s.is_empty()),
        "instructions must be a non-empty string"
    );
}

#[tokio::test]
async fn initialize_echoes_supported_client_version() {
    let fixture = HomeFixture::new("mcp-version-echo");
    let mut session = session(&fixture);

    let response = send(&mut session, initialize_request(1, Some("2024-11-05"))).await;

    assert_eq!(response["result"]["protocolVersion"], "2024-11-05");
    assert_eq!(session.negotiated_version(), "2024-11-05");
}

#[tokio::test]
async fn initialize_falls_back_for_unknown_version() {
    let fixture = HomeFixture::new("mcp-version-fallback");
    let mut session = session(&fixture);

    let response = send(&mut session, initialize_request(1, Some("1999-01-01"))).await;

    assert_eq!(
        response["result"]["protocolVersion"], PREFERRED_PROTOCOL_VERSION,
        "an unsupported client version must be answered with ours"
    );
}

#[tokio::test]
async fn initialized_notification_produces_no_response() {
    let fixture = HomeFixture::new("mcp-notification");
    let mut session = session(&fixture);
    send(&mut session, initialize_request(1, Some("2025-06-18"))).await;

    let answered = session
        .handle_message(
            &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string(),
        )
        .await;
    assert!(
        answered.is_none(),
        "a notification carries no id and MUST NOT be answered"
    );
    assert!(session.is_initialized());

    // Any other id-less message is equally a notification.
    for method in ["notifications/cancelled", "notifications/unheard-of"] {
        let answered = session
            .handle_message(&json!({ "jsonrpc": "2.0", "method": method }).to_string())
            .await;
        assert!(answered.is_none(), "{} must not be answered", method);
    }
}

#[tokio::test]
async fn unknown_method_returns_32601() {
    let fixture = HomeFixture::new("mcp-unknown-method");
    let mut session = session(&fixture);

    let response = send(
        &mut session,
        json!({ "jsonrpc": "2.0", "id": 4, "method": "tendril/teleport" }),
    )
    .await;

    assert_eq!(response["id"], 4);
    assert_eq!(response["error"]["code"], -32601);
    assert!(
        response["error"]["message"]
            .as_str()
            .expect("message")
            .contains("tendril/teleport"),
        "the message should name the method: {}",
        response["error"]["message"]
    );
}

#[tokio::test]
async fn malformed_json_returns_32700_with_null_id() {
    let fixture = HomeFixture::new("mcp-parse-error");
    let mut session = session(&fixture);

    let line = session
        .handle_message("{ this is not json")
        .await
        .expect("a parse error is answered");
    let response: Value = serde_json::from_str(&line).expect("response is JSON");
    assert_eq!(response["error"]["code"], -32700);
    assert_eq!(response["error"]["message"], "Parse error");
    assert_eq!(
        response["id"],
        Value::Null,
        "there is no id to echo, so it must be null"
    );
}

#[tokio::test]
async fn bad_jsonrpc_version_returns_32600() {
    let fixture = HomeFixture::new("mcp-bad-envelope");
    let mut session = session(&fixture);

    for request in [
        json!({ "jsonrpc": "1.0", "id": 1, "method": "ping" }),
        json!({ "id": 2, "method": "ping" }),
        json!({ "jsonrpc": "2.0", "id": 3 }),
        json!({ "jsonrpc": "2.0", "id": 4, "method": 12 }),
    ] {
        let response = send(&mut session, request.clone()).await;
        assert_eq!(
            response["error"]["code"], -32600,
            "expected Invalid Request for {}",
            request
        );
        assert_eq!(response["error"]["message"], "Invalid Request");
    }
}

#[tokio::test]
async fn ping_returns_empty_object() {
    let fixture = HomeFixture::new("mcp-ping");
    let mut session = session(&fixture);

    let response = send(
        &mut session,
        json!({ "jsonrpc": "2.0", "id": "abc", "method": "ping" }),
    )
    .await;

    assert_eq!(response["id"], "abc");
    assert_eq!(
        response["result"],
        json!({}),
        "the spec calls for an empty result object, not the string \"pong\""
    );
}

#[tokio::test]
async fn blank_line_is_ignored() {
    let fixture = HomeFixture::new("mcp-blank");
    let mut session = session(&fixture);

    assert!(session.handle_message("").await.is_none());
    assert!(session.handle_message("   \t ").await.is_none());
}
