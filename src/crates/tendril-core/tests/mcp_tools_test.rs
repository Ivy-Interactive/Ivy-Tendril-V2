//! The tool catalog, `tools/call` dispatch, and the guard that makes a terminal plan read-only.

mod common;

use common::{plan_with, HomeFixture};
use serde_json::{json, Value};
use tendril_core::mcp::dispatch::{McpDispatcher, ToolCallError};
use tendril_core::mcp::tools::get_mcp_tool_definitions;
use tendril_core::mcp::validate::unsupported_keywords;
use tendril_core::models::{PlanStatus, VerificationStatus};

const PLAN_FOLDER: &str = "00042-FixturePlan";

/// A dispatcher pinned to the fixture's plans directory, so no ambient `TENDRIL_PLANS` can reach it.
fn dispatcher(fixture: &HomeFixture) -> McpDispatcher {
    McpDispatcher::with_plans_dir(&fixture.path, &fixture.plans_dir())
}

/// A fixture home holding one plan in the given state.
fn fixture_with_plan(label: &str, state: PlanStatus) -> HomeFixture {
    let fixture = HomeFixture::new(label);
    let plan = plan_with(state, &[("RustBuild", VerificationStatus::Pending)]);
    fixture.write_plan(PLAN_FOLDER, &plan);
    fixture
}

fn plan_yaml_bytes(fixture: &HomeFixture) -> Vec<u8> {
    std::fs::read(fixture.plans_dir().join(PLAN_FOLDER).join("plan.yaml")).expect("read plan.yaml")
}

#[test]
fn tools_list_schemas_are_valid_json_schema() {
    let tools = get_mcp_tool_definitions();
    assert!(
        tools.len() >= 25,
        "the catalog should hold the ported tools, found {}",
        tools.len()
    );

    let mut seen = std::collections::HashSet::new();
    for tool in &tools {
        assert!(
            seen.insert(tool.name.clone()),
            "duplicate tool name {}",
            tool.name
        );
        assert!(
            tool.name.starts_with("tendril_"),
            "{} must keep the legacy prefix so existing client configs work",
            tool.name
        );
        assert!(
            !tool.description.trim().is_empty(),
            "{} has no description",
            tool.name
        );

        let schema = &tool.input_schema;
        assert_eq!(
            schema["type"], "object",
            "{}: inputSchema.type must be \"object\"",
            tool.name
        );
        let properties = schema["properties"]
            .as_object()
            .unwrap_or_else(|| panic!("{}: inputSchema.properties must be an object", tool.name));

        if let Some(required) = schema.get("required").and_then(|r| r.as_array()) {
            for name in required {
                let name = name
                    .as_str()
                    .unwrap_or_else(|| panic!("{}: required entries must be strings", tool.name));
                assert!(
                    properties.contains_key(name),
                    "{}: required names undeclared property '{}'",
                    tool.name,
                    name
                );
            }
        }

        // The advertised schema is the enforced schema: a keyword the validator cannot check would
        // be a rule a client is told about but never held to.
        let unsupported = unsupported_keywords(schema);
        assert!(
            unsupported.is_empty(),
            "{}: schema uses keywords validate.rs cannot enforce: {:?}",
            tool.name,
            unsupported
        );
    }
}

#[tokio::test]
async fn tools_call_dispatches_and_returns_well_formed_result() {
    let fixture = fixture_with_plan("mcp-dispatch", PlanStatus::Draft);
    let dispatcher = dispatcher(&fixture);

    let outcome = dispatcher
        .call("tendril_get_plan", &json!({ "plan_id": "00042" }))
        .await
        .expect("tendril_get_plan is a known tool with valid params");

    assert!(!outcome.is_error, "unexpected error: {}", outcome.text);
    assert!(!outcome.text.is_empty(), "the text block must be non-empty");
    let structured = outcome
        .structured
        .as_ref()
        .expect("plan metadata is a structured payload");
    assert_eq!(structured["folderName"], PLAN_FOLDER);
    assert_eq!(structured["metadata"]["title"], "Fixture Plan");
}

#[tokio::test]
async fn tools_call_unknown_tool_returns_32602() {
    let fixture = HomeFixture::new("mcp-unknown-tool");
    let dispatcher = dispatcher(&fixture);

    let error = dispatcher
        .call("tendril_make_coffee", &json!({}))
        .await
        .expect_err("an unknown tool is a protocol error, not a tool error");

    match error {
        ToolCallError::UnknownTool(name) => assert_eq!(name, "tendril_make_coffee"),
        other => panic!("expected UnknownTool, got {:?}", other),
    }
}

#[tokio::test]
async fn tools_call_invalid_params_returns_32602() {
    let fixture = fixture_with_plan("mcp-invalid-params", PlanStatus::Draft);
    let dispatcher = dispatcher(&fixture);

    let cases: &[(Value, &str)] = &[
        (json!({}), "missing required plan_id"),
        (json!({ "plan_id": 42 }), "plan_id must be a string"),
        (
            json!({ "plan_id": "00042", "recursive": true }),
            "unknown property under additionalProperties: false",
        ),
    ];

    for (arguments, case) in cases {
        let error = dispatcher
            .call("tendril_get_plan", arguments)
            .await
            .expect_err(case);
        match error {
            ToolCallError::InvalidParams(detail) => {
                assert!(!detail.is_empty(), "{}: detail should explain why", case)
            }
            other => panic!("{}: expected InvalidParams, got {:?}", case, other),
        }
    }
}

#[tokio::test]
async fn mutation_tool_refused_on_completed_plan() {
    assert_terminal_plan_is_read_only("mcp-completed", PlanStatus::Completed).await;
}

#[tokio::test]
async fn mutation_tool_refused_on_skipped_plan() {
    assert_terminal_plan_is_read_only("mcp-skipped", PlanStatus::Skipped).await;
}

/// A terminal plan is read-only over MCP, full stop — not only for state transitions.
async fn assert_terminal_plan_is_read_only(label: &str, state: PlanStatus) {
    let fixture = fixture_with_plan(label, state);
    let dispatcher = dispatcher(&fixture);
    let before = plan_yaml_bytes(&fixture);

    let mutations: &[(&str, Value)] = &[
        (
            "tendril_plan_write_revision",
            json!({ "plan_id": "00042", "content": "# Fixture Plan\n\nRewritten.\n" }),
        ),
        (
            "tendril_plan_set",
            json!({ "plan_id": "00042", "field": "state", "value": "Draft" }),
        ),
        (
            "tendril_plan_set_verification",
            json!({ "plan_id": "00042", "name": "RustBuild", "status": "Pass" }),
        ),
        (
            "tendril_plan_add_commit",
            json!({ "plan_id": "00042", "sha": "deadbee" }),
        ),
        (
            "tendril_plan_add_pr",
            json!({ "plan_id": "00042", "url": "https://github.com/o/r/pull/1" }),
        ),
        (
            "tendril_plan_rec_add",
            json!({ "plan_id": "00042", "title": "Do a thing", "description": "Because." }),
        ),
    ];

    for (tool, arguments) in mutations {
        let outcome = dispatcher
            .call(tool, arguments)
            .await
            .unwrap_or_else(|e| panic!("{} should be a tool error, not {:?}", tool, e));
        assert!(
            outcome.is_error,
            "{} must be refused on a {} plan",
            tool, state
        );
        assert!(
            outcome.text.contains(&state.to_string()),
            "{}: the refusal should name the terminal state, got: {}",
            tool,
            outcome.text
        );
    }

    assert_eq!(
        before,
        plan_yaml_bytes(&fixture),
        "plan.yaml must be byte-identical after every refused mutation"
    );
    assert!(
        !fixture
            .plans_dir()
            .join(PLAN_FOLDER)
            .join("Revisions")
            .exists(),
        "a refused write_revision must not create a revision"
    );
}

#[tokio::test]
async fn plan_set_state_completed_blocked_by_failed_verification() {
    let fixture = HomeFixture::new("mcp-failed-verification");
    let plan = plan_with(
        PlanStatus::Draft,
        &[("RustBuild", VerificationStatus::Fail)],
    );
    fixture.write_plan(PLAN_FOLDER, &plan);
    let dispatcher = dispatcher(&fixture);

    let outcome = dispatcher
        .call(
            "tendril_plan_set",
            &json!({ "plan_id": "00042", "field": "state", "value": "Completed" }),
        )
        .await
        .expect("a refused transition is a tool error, not a protocol error");

    assert!(
        outcome.is_error,
        "apply_state must block Completed over a failed verification"
    );
    assert!(
        outcome.text.contains("RustBuild"),
        "the refusal should name the failing verification, got: {}",
        outcome.text
    );
    assert_eq!(
        common::plan_state(&fixture.plans_dir().join(PLAN_FOLDER)),
        "Draft",
        "the plan must stay Draft; allow_failed_verifications is not reachable from a model"
    );
}

#[tokio::test]
async fn plan_set_accepts_a_non_terminal_transition() {
    let fixture = fixture_with_plan("mcp-plan-set", PlanStatus::Draft);
    let dispatcher = dispatcher(&fixture);

    let outcome = dispatcher
        .call(
            "tendril_plan_set",
            &json!({ "plan_id": "00042", "field": "state", "value": "Icebox" }),
        )
        .await
        .expect("known tool, valid params");

    assert!(!outcome.is_error, "unexpected error: {}", outcome.text);
    assert_eq!(
        common::plan_state(&fixture.plans_dir().join(PLAN_FOLDER)),
        "Icebox"
    );
}

#[tokio::test]
async fn plan_set_refuses_a_field_that_is_not_settable() {
    let fixture = fixture_with_plan("mcp-plan-set-field", PlanStatus::Draft);
    let dispatcher = dispatcher(&fixture);

    // `field` is an enum in the schema, so an undeclared field is caught before dispatch.
    let error = dispatcher
        .call(
            "tendril_plan_set",
            &json!({ "plan_id": "00042", "field": "verifications", "value": "[]" }),
        )
        .await
        .expect_err("an out-of-enum field is invalid params");
    assert!(matches!(error, ToolCallError::InvalidParams(_)));
}
