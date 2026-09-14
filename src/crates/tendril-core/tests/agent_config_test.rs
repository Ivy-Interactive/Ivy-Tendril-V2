//! `codingAgents` and `promptwares` schema: both real-world shapes parse, garbage degrades to empty
//! rather than failing the load, and unknown keys survive a load/save round-trip.

use tendril_core::config::{load_config, save_config, TendrilSettings};

fn parse(yaml: &str) -> TendrilSettings {
    serde_yaml::from_str(yaml).expect("settings should parse")
}

#[test]
fn coding_agents_sequence_form_parses() {
    let settings = parse(
        r#"
codingAgent: claude
codingAgents:
- name: claude
  arguments: ''
  environmentVariables: {}
  profiles:
  - name: deep
    model: opus
    effort: max
    arguments: ''
  - name: balanced
    model: sonnet
    effort: high
    arguments: ''
"#,
    );

    assert_eq!(settings.coding_agents.len(), 1);
    let agent = &settings.coding_agents[0];
    assert_eq!(agent.name, "claude");
    assert_eq!(agent.profiles.len(), 2);
    assert_eq!(agent.profiles[0].name, "deep");
    assert_eq!(agent.profiles[0].model, "opus");
    assert_eq!(agent.profiles[0].effort, "max");
}

#[test]
fn coding_agents_mapping_form_parses_with_name_from_key() {
    let settings = parse(
        r#"
codingAgents:
  custom-agent:
    arguments: --flag
    profiles:
    - name: deep
      model: big-model
"#,
    );

    assert_eq!(settings.coding_agents.len(), 1);
    assert_eq!(settings.coding_agents[0].name, "custom-agent");
    assert_eq!(settings.coding_agents[0].arguments, "--flag");
    assert_eq!(settings.coding_agents[0].profiles[0].model, "big-model");
}

#[test]
fn coding_agents_garbage_degrades_to_empty_without_error() {
    // A malformed section must leave Tendril working on built-in defaults, not refuse to start.
    for yaml in [
        "codingAgents: not-a-list",
        "codingAgents: 42",
        "codingAgents:\n",
        "codingAgents: []",
    ] {
        let settings = parse(yaml);
        assert!(
            settings.coding_agents.is_empty(),
            "expected no agents from {yaml:?}"
        );
    }
}

#[test]
fn coding_agents_skips_only_the_unparseable_entries() {
    let settings = parse(
        r#"
codingAgents:
- name: claude
- just-a-string
"#,
    );

    assert_eq!(settings.coding_agents.len(), 1);
    assert_eq!(settings.coding_agents[0].name, "claude");
}

#[test]
fn promptwares_mapping_parses_with_default_as_an_ordinary_entry() {
    let settings = parse(
        r#"
promptwares:
  _default:
    profile: balanced
    allowedTools: []
  ExecutePlan:
    profile: deep
    allowedTools:
    - Bash(tendril *)
    deniedTools:
    - WebSearch
    customInstructions: Be brief.
"#,
    );

    assert_eq!(settings.promptwares.len(), 2);
    assert_eq!(settings.promptwares["_default"].profile, "balanced");
    let execute = &settings.promptwares["ExecutePlan"];
    assert_eq!(execute.profile, "deep");
    assert_eq!(execute.allowed_tools, vec!["Bash(tendril *)".to_string()]);
    assert_eq!(execute.denied_tools, vec!["WebSearch".to_string()]);
    assert_eq!(execute.custom_instructions.as_deref(), Some("Be brief."));
}

#[test]
fn promptwares_non_mapping_entry_is_skipped_not_fatal() {
    let settings = parse(
        r#"
promptwares:
  ExecutePlan:
    profile: deep
  Broken: "just a string"
"#,
    );

    assert_eq!(settings.promptwares.len(), 1);
    assert!(settings.promptwares.contains_key("ExecutePlan"));
}

#[test]
fn promptwares_non_mapping_section_degrades_to_empty() {
    let settings = parse("promptwares: nope");
    assert!(settings.promptwares.is_empty());
}

#[test]
fn unknown_keys_inside_agents_profiles_and_promptwares_survive_round_trip() {
    let temp_dir = std::env::temp_dir().join(format!(
        "tendril-test-agent-config-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let config_path = temp_dir.join("config.yaml");

    std::fs::write(
        &config_path,
        r#"
codingAgent: claude
codingAgents:
- name: claude
  arguments: ''
  agentOnlyKey: keep-me
  profiles:
  - name: deep
    model: opus
    profileOnlyKey: keep-me-too
promptwares:
  ExecutePlan:
    profile: deep
    promptwareOnlyKey: also-keep-me
"#,
    )
    .unwrap();

    let settings = load_config(&config_path).expect("load_config should succeed");
    assert_eq!(
        settings.coding_agents[0].extra.get("agentOnlyKey"),
        Some(&serde_json::Value::String("keep-me".to_string()))
    );
    assert_eq!(
        settings.coding_agents[0].profiles[0]
            .extra
            .get("profileOnlyKey"),
        Some(&serde_json::Value::String("keep-me-too".to_string()))
    );
    assert_eq!(
        settings.promptwares["ExecutePlan"]
            .extra
            .get("promptwareOnlyKey"),
        Some(&serde_json::Value::String("also-keep-me".to_string()))
    );

    save_config(&config_path, &settings).expect("save_config should succeed");
    let reloaded = load_config(&config_path).expect("reload should succeed");

    assert_eq!(
        reloaded.coding_agents[0].extra.get("agentOnlyKey"),
        settings.coding_agents[0].extra.get("agentOnlyKey")
    );
    assert_eq!(
        reloaded.coding_agents[0].profiles[0]
            .extra
            .get("profileOnlyKey"),
        settings.coding_agents[0].profiles[0]
            .extra
            .get("profileOnlyKey")
    );
    assert_eq!(
        reloaded.promptwares["ExecutePlan"]
            .extra
            .get("promptwareOnlyKey"),
        settings.promptwares["ExecutePlan"]
            .extra
            .get("promptwareOnlyKey")
    );

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn project_mcp_servers_parse() {
    let settings = parse(
        r#"
projects:
- name: Widgets
  repos: []
  mcpServers:
  - name: docs
    command: node
    arguments: ["%TENDRIL_HOME%/mcp/docs.js"]
    environment:
      TOKEN: abc
  - name: off
    command: node
    disabled: true
"#,
    );

    let project = &settings.projects[0];
    assert_eq!(project.mcp_servers.len(), 2);
    assert_eq!(project.mcp_servers[0].name, "docs");
    assert_eq!(
        project.mcp_servers[0].arguments,
        vec!["%TENDRIL_HOME%/mcp/docs.js".to_string()]
    );
    assert_eq!(
        project.mcp_servers[0].environment.get("TOKEN"),
        Some(&"abc".to_string())
    );
    assert!(!project.mcp_servers[0].disabled);
    assert!(project.mcp_servers[1].disabled);
}

#[test]
fn project_skills_parse() {
    let settings = parse(
        r#"
projects:
- name: Widgets
  repos: []
  skills:
  - name: docs
    description: Docs helper
    path: "%TENDRIL_HOME%/mcp/docs-skill"
  - name: inline
    instructions: Read the docs first.
  - name: off
    disabled: true
"#,
    );

    let project = &settings.projects[0];
    assert_eq!(project.skills.len(), 3);
    assert_eq!(project.skills[0].name, "docs");
    assert_eq!(project.skills[0].description, "Docs helper");
    assert_eq!(
        project.skills[0].path,
        Some("%TENDRIL_HOME%/mcp/docs-skill".to_string())
    );
    assert!(!project.skills[0].disabled);
    assert_eq!(
        project.skills[1].instructions,
        Some("Read the docs first.".to_string())
    );
    assert!(project.skills[2].disabled);
}

#[test]
fn project_skills_survive_a_save_and_load_round_trip() {
    let temp_dir = std::env::temp_dir().join(format!(
        "tendril-test-project-skills-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let config_path = temp_dir.join("config.yaml");

    std::fs::write(
        &config_path,
        r#"
projects:
- name: Widgets
  repos: []
  skills:
  - name: docs
    description: Docs helper
    instructions: Read the docs first.
"#,
    )
    .unwrap();

    let settings = load_config(&config_path).expect("load_config should succeed");
    assert_eq!(settings.projects[0].skills.len(), 1);

    save_config(&config_path, &settings).expect("save_config should succeed");
    let reloaded = load_config(&config_path).expect("reload should succeed");

    assert_eq!(reloaded.projects[0].skills.len(), 1);
    assert_eq!(reloaded.projects[0].skills[0].name, "docs");
    assert_eq!(
        reloaded.projects[0].skills[0].instructions,
        Some("Read the docs first.".to_string())
    );

    let _ = std::fs::remove_dir_all(&temp_dir);
}
