use tendril_core::models::{ProjectConfig, ReviewActionConfig};

fn action(name: &str, paths: &[&str]) -> ReviewActionConfig {
    ReviewActionConfig {
        name: name.to_string(),
        condition: String::new(),
        command: String::new(),
        paths: paths.iter().map(|p| p.to_string()).collect(),
    }
}

fn project(review_actions: Vec<ReviewActionConfig>) -> ProjectConfig {
    ProjectConfig {
        name: "Test".to_string(),
        color: String::new(),
        repos: vec![],
        verifications: vec![],
        context: String::new(),
        stack_hash: None,
        review_actions,
        build_dependencies: vec![],
        mcp_servers: vec![],
    }
}

fn names<'a>(ranked: &[&'a ReviewActionConfig]) -> Vec<&'a str> {
    ranked.iter().map(|a| a.name.as_str()).collect()
}

#[test]
fn scoped_action_covering_all_changed_files_ranks_first() {
    let proj = project(vec![
        action("App", &[]),
        action("Storybook", &["src/packages/components"]),
    ]);

    let changed = vec!["src/packages/components/src/stories/dialog.stories.tsx".to_string()];
    let ranked = proj.rank_review_actions(&changed);

    assert_eq!(names(&ranked), vec!["Storybook", "App"]);
}

#[test]
fn changed_file_outside_scope_drops_action_behind_unscoped_fallback() {
    let proj = project(vec![
        action("App", &[]),
        action("Storybook", &["src/packages/components"]),
    ]);

    let changed = vec![
        "src/packages/components/src/stories/dialog.stories.tsx".to_string(),
        "src/apps/tendril-app/src/main.tsx".to_string(),
    ];
    let ranked = proj.rank_review_actions(&changed);

    // Storybook doesn't cover every changed file, so it falls back to configured order.
    assert_eq!(names(&ranked), vec!["App", "Storybook"]);
}

#[test]
fn overlapping_scopes_longest_prefix_wins() {
    let proj = project(vec![
        action("Packages", &["src/packages"]),
        action("Components", &["src/packages/components"]),
    ]);

    let changed = vec!["src/packages/components/src/index.ts".to_string()];
    let ranked = proj.rank_review_actions(&changed);

    assert_eq!(names(&ranked), vec!["Components", "Packages"]);
}

#[test]
fn empty_changed_files_returns_configured_order_unchanged() {
    let proj = project(vec![
        action("App", &[]),
        action("Storybook", &["src/packages/components"]),
        action("Server", &[]),
    ]);

    let ranked = proj.rank_review_actions(&[]);
    assert_eq!(names(&ranked), vec!["App", "Storybook", "Server"]);
}

#[test]
fn all_unscoped_configs_return_configured_order() {
    let proj = project(vec![action("App", &[]), action("Server", &[])]);

    let changed = vec!["src/apps/tendril-app/src/main.tsx".to_string()];
    let ranked = proj.rank_review_actions(&changed);
    assert_eq!(names(&ranked), vec!["App", "Server"]);
}

#[test]
fn prefix_boundary_does_not_match_sibling_with_shared_prefix() {
    let proj = project(vec![
        action("App", &[]),
        action("Components", &["src/packages/components"]),
    ]);

    let changed = vec!["src/packages/components-extra/index.ts".to_string()];
    let ranked = proj.rank_review_actions(&changed);

    // "components-extra" is not under "components", so Components must not cover this file.
    assert_eq!(names(&ranked), vec!["App", "Components"]);
}

#[test]
fn trailing_glob_and_backslash_separators_normalize() {
    let proj = project(vec![
        action("App", &[]),
        action("SlashStar", &["src/packages/components/*"]),
        action("DoubleStar", &["src/packages/other/**"]),
        action("Trailing", &["src/packages/third/"]),
        action("Backslash", &[r"src\packages\fourth"]),
    ]);

    for (scoped, file) in [
        ("SlashStar", "src/packages/components/index.ts"),
        ("DoubleStar", "src/packages/other/deep/index.ts"),
        ("Trailing", "src/packages/third/index.ts"),
        ("Backslash", "src/packages/fourth/index.ts"),
    ] {
        let changed = vec![file.to_string()];
        let ranked = proj.rank_review_actions(&changed);
        assert_eq!(
            ranked[0].name, scoped,
            "expected '{}' to cover '{}'",
            scoped, file
        );
    }
}
