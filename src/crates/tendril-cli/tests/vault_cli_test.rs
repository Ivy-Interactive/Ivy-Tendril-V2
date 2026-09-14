//! `tendril vault` argument handling.
//!
//! Parsing only: no daemon is started, no vault is created and nothing reaches `gh` or the network. The
//! subcommands themselves are covered by the core and route tests.

use clap::{CommandFactory, Parser};
use tendril_cli::commands::vault::{
    build_export_request, confirm, parse_bool, parse_repo_mappings, parse_reviewers,
    resolve_project_names, PushOptions, VaultCommands,
};

/// A minimal parser so `try_parse_from` can exercise the real derive output.
#[derive(Parser)]
#[command(name = "tendril")]
struct TestCli {
    #[command(subcommand)]
    command: VaultCommands,
}

fn parse(args: &[&str]) -> VaultCommands {
    TestCli::try_parse_from(args).expect("parse").command
}

#[test]
fn the_clap_definition_is_internally_consistent() {
    // Catches conflicting short flags and malformed arg definitions at test time rather than on the
    // user's first `tendril vault --help`.
    TestCli::command().debug_assert();
}

#[test]
fn parse_bool_accepts_the_documented_spellings() {
    for value in ["true", "TRUE", " True ", "1", "yes", "Y"] {
        assert_eq!(parse_bool(value), Some(true), "{:?} should be true", value);
    }
    for value in ["false", "FALSE", "0", "no", "N"] {
        assert_eq!(
            parse_bool(value),
            Some(false),
            "{:?} should be false",
            value
        );
    }
}

#[test]
fn parse_bool_rejects_anything_else() {
    // `2` and `maybe` must be errors rather than silently disabling auto-sync.
    for value in ["invalid", "maybe", "2", "", "  "] {
        assert_eq!(parse_bool(value), None, "{:?} should be rejected", value);
    }
}

#[test]
fn set_auto_sync_reports_the_valid_values_on_a_bad_argument() {
    let VaultCommands::SetAutoSync { enabled, .. } = parse(&["tendril", "set-auto-sync", "maybe"])
    else {
        panic!("expected set-auto-sync");
    };
    assert_eq!(
        parse_bool(&enabled),
        None,
        "clap accepts the string; the command rejects it"
    );
}

#[test]
fn repo_mappings_are_parsed() {
    let mappings = parse_repo_mappings(&[
        "repo1=/git/repo1".to_string(),
        " repo2 = /git/repo2 ".to_string(),
    ])
    .expect("parse mappings");

    assert_eq!(mappings["repo1"], "/git/repo1");
    assert_eq!(mappings["repo2"], "/git/repo2", "both halves are trimmed");
}

#[test]
fn repo_mappings_split_on_the_first_equals_only() {
    // A Windows path or a query string on the right-hand side must survive intact.
    let mappings = parse_repo_mappings(&["repo=C:/a=b".to_string()]).expect("parse mappings");
    assert_eq!(mappings["repo"], "C:/a=b");
}

#[test]
fn malformed_repo_mappings_are_rejected_with_the_expected_form() {
    for entry in ["no-equals-sign", "=path", "name="] {
        let error = parse_repo_mappings(&[entry.to_string()])
            .expect_err(&format!("{:?} should be rejected", entry))
            .to_string();
        assert_eq!(
            error,
            format!(
                "Invalid repo mapping format '{}'. Expected '<repoName>=<localPath>'.",
                entry
            )
        );
    }
}

#[test]
fn reviewers_accept_repeated_flags_and_comma_lists() {
    assert_eq!(
        parse_reviewers(&["x,y".to_string(), "z".to_string()]),
        vec!["x", "y", "z"]
    );
    assert_eq!(
        parse_reviewers(&["a, ,b".to_string()]),
        vec!["a", "b"],
        "blank entries are dropped"
    );
}

#[test]
fn confirm_skips_stdin_when_yes_is_set() {
    // The test harness has no interactive stdin, so this also proves --yes never reads it.
    assert!(confirm("Delete everything?", true).expect("confirm"));
}

#[test]
fn connect_requires_a_repository_url() {
    assert!(
        TestCli::try_parse_from(["tendril", "connect"]).is_err(),
        "a missing repo URL must be a clap error, not an empty-string connect"
    );
}

#[test]
fn import_collects_every_repo_flag() {
    let VaultCommands::Import {
        project_name,
        repo,
        merge,
        no_permissions,
        target_name,
        ..
    } = parse(&[
        "tendril", "import", "Alpha", "--repo", "a=b", "--repo", "c=d",
    ])
    else {
        panic!("expected import");
    };

    assert_eq!(project_name, "Alpha");
    assert_eq!(repo, vec!["a=b", "c=d"]);
    assert!(!merge);
    assert!(!no_permissions);
    assert_eq!(target_name, None);
}

#[test]
fn push_takes_several_projects_and_a_reviewer_list() {
    let VaultCommands::Push {
        projects, reviewer, ..
    } = parse(&["tendril", "push", "A", "B", "--reviewer", "x,y"])
    else {
        panic!("expected push");
    };

    assert_eq!(projects, vec!["A", "B"]);
    assert_eq!(parse_reviewers(&reviewer), vec!["x", "y"]);
}

#[test]
fn push_requires_at_least_one_project() {
    assert!(TestCli::try_parse_from(["tendril", "push"]).is_err());
}

#[test]
fn status_without_an_id_means_the_primary_vault() {
    let VaultCommands::Status { vault_id, json } = parse(&["tendril", "status"]) else {
        panic!("expected status");
    };
    assert_eq!(vault_id, None);
    assert!(!json);

    let VaultCommands::Status { vault_id, json } =
        parse(&["tendril", "status", "abc12345", "--json"])
    else {
        panic!("expected status");
    };
    assert_eq!(vault_id.as_deref(), Some("abc12345"));
    assert!(json);
}

#[test]
fn pull_is_accepted_as_an_alias_of_sync() {
    assert!(matches!(
        parse(&["tendril", "pull"]),
        VaultCommands::Pull { vault_id: None }
    ));
    assert!(matches!(
        parse(&["tendril", "sync"]),
        VaultCommands::Sync { vault_id: None }
    ));
}

#[test]
fn create_defaults_to_a_private_repository() {
    let VaultCommands::Create {
        repo_name,
        public,
        org,
    } = parse(&["tendril", "create", "Tendril-Vault"])
    else {
        panic!("expected create");
    };
    assert_eq!(repo_name, "Tendril-Vault");
    assert!(!public, "--public must be opt-in");
    assert_eq!(org, None);
}

#[test]
fn push_rejects_an_unknown_project_naming_the_available_ones() {
    let settings = settings_with_projects(&["Alpha", "Beta"]);
    let error = resolve_project_names(&settings, &["Gamma".to_string()])
        .expect_err("an unknown project must be rejected")
        .to_string();

    assert!(error.contains("Gamma"), "got: {}", error);
    assert!(
        error.contains("Alpha") && error.contains("Beta"),
        "the error lists the available projects, got: {}",
        error
    );
}

#[test]
fn push_dedupes_project_names_case_insensitively() {
    let settings = settings_with_projects(&["Alpha", "Beta"]);
    let resolved = resolve_project_names(
        &settings,
        &["alpha".to_string(), "ALPHA".to_string(), "Beta".to_string()],
    )
    .expect("resolve names");

    assert_eq!(
        resolved,
        vec!["Alpha", "Beta"],
        "the config's spelling wins and duplicates collapse"
    );
}

#[test]
fn push_defaults_the_version_title_and_body() {
    let settings = settings_with_projects(&["Alpha"]);
    let home = std::env::temp_dir().join(format!(
        "tendril-vault-cli-{}",
        uuid::Uuid::new_v4().simple()
    ));

    let request = build_export_request(
        &home,
        &settings,
        &["Alpha".to_string()],
        PushOptions {
            changelog: Some("Added the rust skill"),
            reviewers: vec!["reviewer".to_string()],
            ..Default::default()
        },
    );

    // `<year>.<month>.<day>.<HHMMSS>`, generated when no --version is given.
    assert!(
        request.version.split('.').count() == 4,
        "unexpected default version: {}",
        request.version
    );
    assert_eq!(
        request.pr_title,
        format!("feat(vault): update Alpha to v{}", request.version)
    );
    assert!(request.pr_body.contains("Added the rust skill"));
    assert!(request.pr_body.contains("- Alpha"));
    assert!(
        request.sync_permissions["Alpha"],
        "permissions.yaml is synced unless --no-permissions is given"
    );
    assert!(
        request.selected_skills.contains_key("Alpha"),
        "every asset kind gets a selection entry, even an empty one"
    );
    assert_eq!(request.reviewers, vec!["reviewer"]);
}

#[test]
fn push_keeps_an_explicit_version_title_and_body() {
    let settings = settings_with_projects(&["Alpha"]);
    let home = std::env::temp_dir().join(format!(
        "tendril-vault-cli-{}",
        uuid::Uuid::new_v4().simple()
    ));

    let request = build_export_request(
        &home,
        &settings,
        &["Alpha".to_string()],
        PushOptions {
            vault_id: Some("abc12345"),
            version: Some("9.9.9"),
            changelog: Some("changelog"),
            title: Some("custom title"),
            body: Some("custom body"),
            reviewers: Vec::new(),
        },
    );

    assert_eq!(request.target_vault_id.as_deref(), Some("abc12345"));
    assert_eq!(request.version, "9.9.9");
    assert_eq!(request.pr_title, "custom title");
    assert_eq!(request.pr_body, "custom body");
}

fn settings_with_projects(names: &[&str]) -> tendril_core::config::TendrilSettings {
    tendril_core::config::TendrilSettings {
        projects: names
            .iter()
            .map(|name| tendril_core::models::ProjectConfig {
                name: name.to_string(),
                color: "Blue".to_string(),
                repos: Vec::new(),
                verifications: Vec::new(),
                context: String::new(),
                stack_hash: None,
                review_actions: Vec::new(),
                build_dependencies: Vec::new(),
                mcp_servers: Vec::new(),
                ..Default::default()
            })
            .collect(),
        ..Default::default()
    }
}
