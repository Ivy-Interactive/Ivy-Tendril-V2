//! The MCP servers a job's agent is launched with: the project's configured servers plus the
//! project's `MCP/mcp.json`.

mod common;

use common::HomeFixture;
use tendril_core::agents::providers::write_mcp_config;
use tendril_core::config::TendrilSettings;
use tendril_core::jobs::firmware_values::resolve_mcp_servers;
use tendril_core::models::{ProjectConfig, ProjectMcpServerRef};

fn project(name: &str, servers: Vec<ProjectMcpServerRef>) -> ProjectConfig {
    ProjectConfig {
        name: name.to_string(),
        color: String::new(),
        repos: vec![],
        verifications: vec![],
        context: String::new(),
        stack_hash: None,
        review_actions: vec![],
        build_dependencies: vec![],
        mcp_servers: servers,
        ..Default::default()
    }
}

fn server(name: &str, command: &str) -> ProjectMcpServerRef {
    ProjectMcpServerRef {
        name: name.to_string(),
        command: command.to_string(),
        arguments: vec![],
        environment: Default::default(),
        disabled: false,
        extra: Default::default(),
    }
}

/// Writes `Projects/<project>/MCP/mcp.json` inside the fixture home.
fn write_mcp_json(home: &HomeFixture, project_name: &str, body: &str) {
    let dir = home.path.join("Projects").join(project_name).join("MCP");
    std::fs::create_dir_all(&dir).expect("create MCP dir");
    std::fs::write(dir.join("mcp.json"), body).expect("write mcp.json");
}

#[test]
fn configured_servers_are_returned_with_tendril_home_expanded() {
    let home = HomeFixture::new("mcp-config");
    let mut docs = server("docs", "%TENDRIL_HOME%/bin/docs");
    docs.arguments = vec![
        "--root".to_string(),
        "%TENDRIL_HOME%/Docs".to_string(),
        "--verbose".to_string(),
    ];
    docs.environment
        .insert("DOCS_HOME".to_string(), "%TENDRIL_HOME%/Docs".to_string());
    docs.environment
        .insert("TOKEN".to_string(), "abc123".to_string());

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![docs])],
        ..Default::default()
    };

    let servers = resolve_mcp_servers(&settings, "Widgets", &home.path);
    let expanded_home = home.path.to_string_lossy().to_string();

    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].name, "docs");
    assert_eq!(servers[0].command, format!("{}/bin/docs", expanded_home));
    assert_eq!(
        servers[0].arguments,
        vec![
            "--root".to_string(),
            format!("{}/Docs", expanded_home),
            "--verbose".to_string(),
        ]
    );
    assert_eq!(
        servers[0].environment.get("DOCS_HOME"),
        Some(&format!("{}/Docs", expanded_home))
    );
    assert_eq!(
        servers[0].environment.get("TOKEN"),
        Some(&"abc123".to_string())
    );
}

#[test]
fn a_disabled_server_is_left_out() {
    let home = HomeFixture::new("mcp-disabled");
    let mut off = server("off", "node");
    off.disabled = true;

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![server("on", "node"), off])],
        ..Default::default()
    };

    let servers = resolve_mcp_servers(&settings, "Widgets", &home.path);
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].name, "on");
}

#[test]
fn an_unknown_project_gets_no_servers() {
    let home = HomeFixture::new("mcp-unknown");
    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![server("docs", "node")])],
        ..Default::default()
    };

    assert!(resolve_mcp_servers(&settings, "Gadgets", &home.path).is_empty());
    assert!(resolve_mcp_servers(&settings, "", &home.path).is_empty());
}

#[test]
fn mcp_json_servers_are_imported() {
    let home = HomeFixture::new("mcp-json");
    write_mcp_json(
        &home,
        "Widgets",
        r#"{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"],
      "env": { "HEADLESS": "1" }
    },
    "bare": {
      "command": "bare-server"
    }
  }
}"#,
    );

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![])],
        ..Default::default()
    };

    let mut servers = resolve_mcp_servers(&settings, "Widgets", &home.path);
    servers.sort_by(|a, b| a.name.cmp(&b.name));

    assert_eq!(servers.len(), 2);
    assert_eq!(servers[0].name, "bare");
    assert_eq!(servers[0].command, "bare-server");
    assert!(servers[0].arguments.is_empty());
    assert!(servers[0].environment.is_empty());
    assert_eq!(servers[1].name, "playwright");
    assert_eq!(servers[1].command, "npx");
    assert_eq!(
        servers[1].arguments,
        vec!["-y".to_string(), "@playwright/mcp".to_string()]
    );
    assert_eq!(
        servers[1].environment.get("HEADLESS"),
        Some(&"1".to_string())
    );
}

#[test]
fn mcp_json_is_read_even_with_no_project_entry_in_config() {
    let home = HomeFixture::new("mcp-json-only");
    write_mcp_json(
        &home,
        "Widgets",
        r#"{ "mcpServers": { "docs": { "command": "node" } } }"#,
    );

    let servers = resolve_mcp_servers(&TendrilSettings::default(), "Widgets", &home.path);
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].name, "docs");
}

#[test]
fn config_wins_over_mcp_json_on_a_name_collision_whatever_the_case() {
    let home = HomeFixture::new("mcp-collision");
    write_mcp_json(
        &home,
        "Widgets",
        r#"{ "mcpServers": { "DOCS": { "command": "from-file" } } }"#,
    );

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![server("docs", "from-config")])],
        ..Default::default()
    };

    let servers = resolve_mcp_servers(&settings, "Widgets", &home.path);
    assert_eq!(
        servers.len(),
        1,
        "a collision must not add the server twice"
    );
    assert_eq!(servers[0].name, "docs");
    assert_eq!(servers[0].command, "from-config");
}

#[test]
fn a_malformed_mcp_json_leaves_the_configured_servers_intact() {
    // A broken side file must never stop a job from launching.
    let home = HomeFixture::new("mcp-malformed");
    write_mcp_json(&home, "Widgets", "{ this is not json");

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![server("docs", "node")])],
        ..Default::default()
    };

    let servers = resolve_mcp_servers(&settings, "Widgets", &home.path);
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].name, "docs");
}

#[test]
fn an_mcp_json_without_the_root_key_contributes_nothing() {
    let home = HomeFixture::new("mcp-no-root");
    write_mcp_json(&home, "Widgets", r#"{ "servers": { "docs": {} } }"#);

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![server("cfg", "node")])],
        ..Default::default()
    };

    let servers = resolve_mcp_servers(&settings, "Widgets", &home.path);
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].name, "cfg");
}

#[test]
fn write_mcp_config_puts_every_server_under_the_mcp_servers_root() {
    let home = HomeFixture::new("mcp-write");
    let mut docs = server("docs", "node");
    docs.arguments = vec!["docs.js".to_string()];
    docs.environment
        .insert("TOKEN".to_string(), "abc".to_string());

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![docs, server("playwright", "npx")])],
        ..Default::default()
    };

    let servers = resolve_mcp_servers(&settings, "Widgets", &home.path);
    let path = write_mcp_config(&servers).expect("a non-empty server list should produce a file");

    let text = std::fs::read_to_string(&path).expect("read the generated mcp config");
    let parsed: serde_json::Value = serde_json::from_str(&text).expect("generated config is JSON");
    let root = parsed
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .expect("mcpServers root object");

    assert_eq!(root.len(), 2);
    assert_eq!(root["docs"]["command"], serde_json::json!("node"));
    assert_eq!(root["docs"]["args"], serde_json::json!(["docs.js"]));
    assert_eq!(root["docs"]["env"]["TOKEN"], serde_json::json!("abc"));
    assert_eq!(root["playwright"]["command"], serde_json::json!("npx"));
    // Empty args and env are omitted rather than written as empty containers.
    assert!(root["playwright"].get("args").is_none());
    assert!(root["playwright"].get("env").is_none());

    let _ = std::fs::remove_file(&path);
}

#[test]
fn write_mcp_config_returns_nothing_when_there_is_nothing_to_write() {
    assert!(write_mcp_config(&[]).is_none());
}
