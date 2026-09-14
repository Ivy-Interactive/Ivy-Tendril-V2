use serde_json::Value;
use tendril_core::agents::{build_missing_result_lines, find_unclosed_tool_calls};

fn lines(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

#[test]
fn unclosed_eventwire_call_gets_synthetic_result() {
    let input = lines(&[
        r#"{"kind":"tool_call","tool_use_id":"t1","tool_name":"Bash"}"#,
        r#"{"kind":"tool_result","tool_use_id":"t1","output":"ok","is_error":false}"#,
        r#"{"kind":"tool_call","tool_use_id":"t2","tool_name":"Read"}"#,
    ]);

    let synthetic = build_missing_result_lines(&input, "[Cancelled]", true);
    assert_eq!(synthetic.len(), 1);

    let v: Value = serde_json::from_str(&synthetic[0]).unwrap();
    assert_eq!(v["kind"], "tool_result");
    assert_eq!(v["tool_use_id"], "t2");
    assert_eq!(v["tool_name"], "Read");
    assert_eq!(v["is_error"], true);
    assert_eq!(v["output"], "[Cancelled]");
}

#[test]
fn unclosed_provider_form_call_gets_synthetic_result() {
    let input = lines(&[
        r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{}}]}}"#,
    ]);

    let synthetic = build_missing_result_lines(&input, "[Cancelled]", true);
    assert_eq!(synthetic.len(), 1);

    let v: Value = serde_json::from_str(&synthetic[0]).unwrap();
    assert_eq!(v["tool_use_id"], "toolu_1");
    assert_eq!(v["tool_name"], "Bash");
}

#[test]
fn reconciling_twice_is_a_no_op() {
    let input = lines(&[r#"{"kind":"tool_call","tool_use_id":"t1","tool_name":"Bash"}"#]);
    let synthetic = build_missing_result_lines(&input, "[Cancelled]", true);
    assert_eq!(synthetic.len(), 1);

    let mut reconciled = input;
    reconciled.extend(synthetic);
    let second_pass = build_missing_result_lines(&reconciled, "[Cancelled]", true);
    assert!(second_pass.is_empty());
}

#[test]
fn fully_closed_stream_produces_nothing() {
    let input = lines(&[
        r#"{"kind":"tool_call","tool_use_id":"t1","tool_name":"Bash"}"#,
        r#"{"kind":"tool_result","tool_use_id":"t1","output":"ok","is_error":false}"#,
    ]);
    assert!(build_missing_result_lines(&input, "[Cancelled]", true).is_empty());
    assert!(find_unclosed_tool_calls(&input).is_empty());
}

#[test]
fn malformed_and_empty_lines_are_ignored() {
    let input = lines(&[
        "",
        "not json",
        "{",
        r#"{"kind":"tool_call","tool_use_id":"t1","tool_name":"Bash"}"#,
        r#"{"kind":"tool_result","tool_use_id":"t1","output":"ok","is_error":false}"#,
    ]);
    assert!(build_missing_result_lines(&input, "[Cancelled]", true).is_empty());
}

#[test]
fn order_follows_first_appearance() {
    let input = lines(&[
        r#"{"kind":"tool_call","tool_use_id":"t1","tool_name":"Bash"}"#,
        r#"{"kind":"tool_call","tool_use_id":"t2","tool_name":"Read"}"#,
        r#"{"kind":"tool_call","tool_use_id":"t3","tool_name":"Write"}"#,
    ]);
    let synthetic = build_missing_result_lines(&input, "[Cancelled]", true);
    assert_eq!(synthetic.len(), 3);

    let ids: Vec<String> = synthetic
        .iter()
        .map(|l| {
            serde_json::from_str::<Value>(l).unwrap()["tool_use_id"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(ids, vec!["t1", "t2", "t3"]);
}
