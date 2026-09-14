//! Tool allowlist merging: additive at every layer, deduped case-insensitively, tokens expanded,
//! and denials subtracted.

use std::collections::HashMap;
use tendril_core::agents::resolution::{resolve_agent, AgentResolution, BASE_TOOLS};
use tendril_core::config::TendrilSettings;

fn settings(yaml: &str) -> TendrilSettings {
    serde_yaml::from_str(yaml).expect("settings should parse")
}

fn tools(settings: &TendrilSettings, promptware: &str) -> AgentResolution {
    resolve_agent(settings, "claude", promptware, None, &HashMap::new())
}

fn tools_with_context(
    settings: &TendrilSettings,
    promptware: &str,
    context: &[(&str, &str)],
) -> AgentResolution {
    let job_context: HashMap<String, String> = context
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    resolve_agent(settings, "claude", promptware, None, &job_context)
}

#[test]
fn an_unconfigured_promptware_gets_exactly_the_base_tools() {
    let s = TendrilSettings::default();
    let r = tools(&s, "CreatePlan");
    assert_eq!(r.allowed_tools, BASE_TOOLS.map(|t| t.to_string()).to_vec());
    assert!(r.denied_tools.is_empty());
}

#[test]
fn write_promptwares_get_write_and_edit_and_others_do_not() {
    let s = TendrilSettings::default();

    for promptware in ["ExecutePlan", "RetryPlan", "IvyFrameworkVerification"] {
        let r = tools(&s, promptware);
        assert!(
            r.allowed_tools.contains(&"Write".to_string()),
            "{promptware} should allow Write"
        );
        assert!(
            r.allowed_tools.contains(&"Edit".to_string()),
            "{promptware} should allow Edit"
        );
    }

    for promptware in ["CreatePlan", "ReviewPlan", ""] {
        let r = tools(&s, promptware);
        assert!(
            !r.allowed_tools.contains(&"Write".to_string()),
            "{promptware:?} should not allow Write"
        );
        assert!(
            !r.allowed_tools.contains(&"Edit".to_string()),
            "{promptware:?} should not allow Edit"
        );
    }

    // Promptware names come from folder names, so matching must not care about case.
    let r = tools(&s, "executeplan");
    assert!(r.allowed_tools.contains(&"Write".to_string()));
}

#[test]
fn configured_allowed_tools_are_added_and_nothing_is_dropped() {
    let s = settings(
        r#"
promptwares:
  _default:
    allowedTools:
    - Bash(tendril *)
  ExecutePlan:
    allowedTools:
    - Bash(cargo *)
    - NotebookEdit
"#,
    );

    let r = tools(&s, "ExecutePlan");

    // The regression this guards: treating `allowedTools` as a replacement stripped Read and Bash
    // and failed every configured job.
    for base in BASE_TOOLS {
        assert!(
            r.allowed_tools.contains(&base.to_string()),
            "{base} must survive"
        );
    }
    assert_eq!(
        r.allowed_tools,
        vec![
            "Read",
            "Glob",
            "Grep",
            "Bash",
            "WebFetch",
            "WebSearch",
            "Write",
            "Edit",
            "Bash(tendril *)",
            "Bash(cargo *)",
            "NotebookEdit",
        ]
        .into_iter()
        .map(|t| t.to_string())
        .collect::<Vec<_>>()
    );
}

#[test]
fn a_default_entry_applies_to_a_promptware_with_no_entry_of_its_own() {
    let s = settings(
        r#"
promptwares:
  _default:
    allowedTools:
    - Bash(tendril *)
"#,
    );

    let r = tools(&s, "SomePromptwareNobodyConfigured");
    assert_eq!(r.allowed_tools.last().unwrap(), "Bash(tendril *)");
}

#[test]
fn duplicates_are_removed_case_insensitively_keeping_the_first() {
    let s = settings(
        r#"
promptwares:
  _default:
    allowedTools:
    - read
    - Bash(Cargo *)
  ExecutePlan:
    allowedTools:
    - READ
    - bash(cargo *)
    - Write
"#,
    );

    let r = tools(&s, "ExecutePlan");
    assert_eq!(
        r.allowed_tools
            .iter()
            .filter(|t| t.eq_ignore_ascii_case("read"))
            .count(),
        1
    );
    // The base spelling wins because it came first.
    assert!(r.allowed_tools.contains(&"Read".to_string()));
    assert!(!r.allowed_tools.contains(&"read".to_string()));
    assert_eq!(
        r.allowed_tools
            .iter()
            .filter(|t| t.eq_ignore_ascii_case("bash(cargo *)"))
            .count(),
        1
    );
    assert!(r.allowed_tools.contains(&"Bash(Cargo *)".to_string()));
    assert_eq!(
        r.allowed_tools
            .iter()
            .filter(|t| t.eq_ignore_ascii_case("write"))
            .count(),
        1
    );
}

#[test]
fn job_context_tokens_are_expanded_in_tool_rules() {
    let s = settings(
        r#"
promptwares:
  ExecutePlan:
    allowedTools:
    - Write(%PLAN_DIR%/**)
    - Read(%PLANS_DIR%/**)
    - Edit(%PROMPTWARE_DIR%/Memory/**)
    - Read(%TENDRIL_HOME%/config.yaml)
"#,
    );

    let r = tools_with_context(
        &s,
        "ExecutePlan",
        &[
            ("PLAN_DIR", "/home/t/Plans/00553-X"),
            ("PLANS_DIR", "/home/t/Plans"),
            ("PROMPTWARE_DIR", "/home/t/Promptwares/ExecutePlan"),
            ("TENDRIL_HOME", "/home/t"),
        ],
    );

    assert!(r
        .allowed_tools
        .contains(&"Write(/home/t/Plans/00553-X/**)".to_string()));
    assert!(r
        .allowed_tools
        .contains(&"Read(/home/t/Plans/**)".to_string()));
    assert!(r
        .allowed_tools
        .contains(&"Edit(/home/t/Promptwares/ExecutePlan/Memory/**)".to_string()));
    assert!(r
        .allowed_tools
        .contains(&"Read(/home/t/config.yaml)".to_string()));
}

#[test]
fn token_names_are_matched_without_regard_to_case() {
    let s = settings(
        r#"
promptwares:
  ExecutePlan:
    allowedTools:
    - Write(%plan_dir%/**)
    - Read(%Plan_Dir%/Verification/**)
"#,
    );

    let r = tools_with_context(&s, "ExecutePlan", &[("PLAN_DIR", "/home/t/Plans/00553-X")]);
    assert!(r
        .allowed_tools
        .contains(&"Write(/home/t/Plans/00553-X/**)".to_string()));
    assert!(r
        .allowed_tools
        .contains(&"Read(/home/t/Plans/00553-X/Verification/**)".to_string()));
}

#[test]
fn expanded_backslashes_become_forward_slashes() {
    let s = settings(
        r#"
promptwares:
  ExecutePlan:
    allowedTools:
    - Write(%PLAN_DIR%\**)
"#,
    );

    let r = tools_with_context(
        &s,
        "ExecutePlan",
        &[("PLAN_DIR", r"C:\Users\t\Plans\00553-X")],
    );
    assert!(r
        .allowed_tools
        .contains(&"Write(C:/Users/t/Plans/00553-X/**)".to_string()));
}

#[test]
fn an_unknown_token_is_left_verbatim_rather_than_emptied() {
    // Collapsing `%NOPE%` to nothing would turn `Write(%NOPE%/**)` into `Write(/**)`, which widens
    // the rule to the whole filesystem.
    let s = settings(
        r#"
promptwares:
  ExecutePlan:
    allowedTools:
    - Write(%NOPE%/**)
"#,
    );

    let r = tools_with_context(&s, "ExecutePlan", &[("PLAN_DIR", "/home/t/Plans/00553-X")]);
    assert!(r.allowed_tools.contains(&"Write(%NOPE%/**)".to_string()));
}

#[test]
fn denied_tools_are_reported_and_removed_from_the_allowlist() {
    let s = settings(
        r#"
promptwares:
  ExecutePlan:
    allowedTools:
    - Bash(cargo *)
    deniedTools:
    - WebSearch
"#,
    );

    let r = tools(&s, "ExecutePlan");
    assert_eq!(r.denied_tools, vec!["WebSearch".to_string()]);
    assert!(!r.allowed_tools.contains(&"WebSearch".to_string()));
    // Only the denied one goes.
    assert!(r.allowed_tools.contains(&"WebFetch".to_string()));
    assert!(r.allowed_tools.contains(&"Bash(cargo *)".to_string()));
}

#[test]
fn a_bare_denial_covers_every_parameterised_rule_of_that_tool() {
    let s = settings(
        r#"
promptwares:
  ExecutePlan:
    allowedTools:
    - Bash(cargo *)
    - Bash(git *)
    deniedTools:
    - bash
"#,
    );

    let r = tools(&s, "ExecutePlan");
    assert!(!r
        .allowed_tools
        .iter()
        .any(|t| t.to_ascii_lowercase().starts_with("bash")));
    assert!(r.allowed_tools.contains(&"Read".to_string()));
}

#[test]
fn a_parameterised_denial_only_removes_that_exact_rule() {
    let s = settings(
        r#"
promptwares:
  ExecutePlan:
    allowedTools:
    - Bash(cargo *)
    - Bash(git push *)
    deniedTools:
    - Bash(git push *)
"#,
    );

    let r = tools(&s, "ExecutePlan");
    assert!(r.allowed_tools.contains(&"Bash".to_string()));
    assert!(r.allowed_tools.contains(&"Bash(cargo *)".to_string()));
    assert!(!r.allowed_tools.contains(&"Bash(git push *)".to_string()));
}

#[test]
fn denials_from_default_and_the_promptware_are_unioned() {
    // A denial is a safety statement, so a promptware entry adds to `_default` instead of replacing
    // it.
    let s = settings(
        r#"
promptwares:
  _default:
    deniedTools:
    - WebSearch
  ExecutePlan:
    deniedTools:
    - WebFetch
"#,
    );

    let r = tools(&s, "ExecutePlan");
    assert_eq!(
        r.denied_tools,
        vec!["WebSearch".to_string(), "WebFetch".to_string()]
    );
    assert!(!r.allowed_tools.contains(&"WebSearch".to_string()));
    assert!(!r.allowed_tools.contains(&"WebFetch".to_string()));
    assert!(r.allowed_tools.contains(&"Read".to_string()));
}

#[test]
fn tokens_are_expanded_in_denials_too() {
    let s = settings(
        r#"
promptwares:
  ExecutePlan:
    deniedTools:
    - Write(%PLAN_DIR%/plan.yaml)
"#,
    );

    let r = tools_with_context(&s, "ExecutePlan", &[("PLAN_DIR", "/home/t/Plans/00553-X")]);
    assert_eq!(
        r.denied_tools,
        vec!["Write(/home/t/Plans/00553-X/plan.yaml)".to_string()]
    );
}
