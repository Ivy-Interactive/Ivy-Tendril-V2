//! Repo scanning behind `tendril project import-mcp`.
//!
//! Temp directories only: the scanner reads config files and never runs anything it finds.

mod common;

use common::HomeFixture;
use std::path::{Path, PathBuf};
use tendril_core::mcp::discovery::{scan_repo_mcp_servers, to_project_ref};

/// Writes `relative_file` under `repo`, creating parent directories.
fn write_config(repo: &Path, relative_file: &str, contents: &str) {
    let path: PathBuf = relative_file
        .split('/')
        .fold(repo.to_path_buf(), |acc, s| acc.join(s));
    std::fs::create_dir_all(path.parent().expect("config file has a parent"))
        .expect("create config dir");
    std::fs::write(&path, contents).expect("write config file");
}

fn repo_dir(home: &HomeFixture, label: &str) -> PathBuf {
    let repo = home.path.join(label);
    std::fs::create_dir_all(&repo).expect("create repo dir");
    repo
}

#[test]
fn all_three_wrapper_shapes_parse() {
    let home = HomeFixture::new("mcp-shapes");

    let wrapped = repo_dir(&home, "wrapped");
    write_config(
        &wrapped,
        ".mcp.json",
        r#"{ "mcpServers": { "docs": { "command": "npx" } } }"#,
    );
    let servers = scan_repo_mcp_servers(&wrapped);
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].name, "docs");
    assert_eq!(servers[0].command, "npx");

    let vscode_shape = repo_dir(&home, "vscode-shape");
    write_config(
        &vscode_shape,
        ".mcp.json",
        r#"{ "servers": { "lint": { "command": "uvx" } } }"#,
    );
    let servers = scan_repo_mcp_servers(&vscode_shape);
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].name, "lint");

    let bare = repo_dir(&home, "bare");
    write_config(&bare, ".mcp.json", r#"{ "search": { "command": "rg" } }"#);
    let servers = scan_repo_mcp_servers(&bare);
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].name, "search");
    assert_eq!(servers[0].command, "rg");
}

#[test]
fn args_and_env_carry_through_and_commandless_entries_are_skipped() {
    let home = HomeFixture::new("mcp-args");
    let repo = repo_dir(&home, "args");
    write_config(
        &repo,
        ".mcp.json",
        r#"{
            "mcpServers": {
                "full": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem"],
                    "env": { "ROOT": "/tmp", "IGNORED": 7 }
                },
                "no-command": { "args": ["--help"] },
                "blank-command": { "command": "   " }
            }
        }"#,
    );

    let servers = scan_repo_mcp_servers(&repo);

    assert_eq!(servers.len(), 1, "only the complete entry should survive");
    let server = &servers[0];
    assert_eq!(server.name, "full");
    assert_eq!(
        server.arguments,
        vec!["-y", "@modelcontextprotocol/server-filesystem"]
    );
    assert_eq!(
        server.environment.get("ROOT").map(String::as_str),
        Some("/tmp")
    );
    // A non-string env value is dropped rather than stringified: the agent would export it verbatim.
    assert!(!server.environment.contains_key("IGNORED"));
    assert_eq!(server.source_file, ".mcp.json");

    let imported = to_project_ref(server);
    assert_eq!(imported.name, "full");
    assert_eq!(imported.command, "npx");
    assert!(!imported.disabled);
}

#[test]
fn the_earlier_file_wins_a_duplicate_name() {
    let home = HomeFixture::new("mcp-duplicate");
    let repo = repo_dir(&home, "duplicate");
    write_config(
        &repo,
        ".mcp.json",
        r#"{ "mcpServers": { "shared": { "command": "first" } } }"#,
    );
    write_config(
        &repo,
        "mcp.json",
        r#"{ "mcpServers": { "SHARED": { "command": "second" } } }"#,
    );

    let servers = scan_repo_mcp_servers(&repo);

    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].command, "first");
    assert_eq!(servers[0].source_file, ".mcp.json");
}

#[test]
fn malformed_json_and_an_empty_repo_yield_no_servers() {
    let home = HomeFixture::new("mcp-malformed");

    let broken = repo_dir(&home, "broken");
    write_config(&broken, ".mcp.json", "{ this is not json");
    assert!(scan_repo_mcp_servers(&broken).is_empty());

    let empty = repo_dir(&home, "empty");
    assert!(scan_repo_mcp_servers(&empty).is_empty());

    assert!(scan_repo_mcp_servers(&home.path.join("missing")).is_empty());
}

#[test]
fn editor_specific_config_locations_are_found() {
    let home = HomeFixture::new("mcp-editors");

    let vscode = repo_dir(&home, "vscode");
    write_config(
        &vscode,
        ".vscode/mcp.json",
        r#"{ "servers": { "vscode-server": { "command": "node" } } }"#,
    );
    let servers = scan_repo_mcp_servers(&vscode);
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].source_file, ".vscode/mcp.json");

    let claude = repo_dir(&home, "claude");
    write_config(
        &claude,
        ".claude/mcp.json",
        r#"{ "mcpServers": { "claude-server": { "command": "node" } } }"#,
    );
    let servers = scan_repo_mcp_servers(&claude);
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].source_file, ".claude/mcp.json");
}
