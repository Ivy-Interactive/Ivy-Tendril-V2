//! Per-project skills: config resolution, disk auto-discovery, firmware rendering, repo scanning
//! and import.

mod common;

use common::HomeFixture;
use tendril_core::config::TendrilSettings;
use tendril_core::jobs::firmware_values::resolve_project_skills;
use tendril_core::models::{ProjectConfig, ProjectSkillInfo, ProjectSkillRef};
use tendril_core::promptware::compiler::{compile_firmware, compile_firmware_with_skills};
use tendril_core::skills::{
    import_skill_to_project, parse_skill_markdown, scan_repo_skills, DiscoveredSkill,
};

fn project(name: &str, skills: Vec<ProjectSkillRef>) -> ProjectConfig {
    ProjectConfig {
        name: name.to_string(),
        skills,
        ..Default::default()
    }
}

fn skill(name: &str) -> ProjectSkillRef {
    ProjectSkillRef {
        name: name.to_string(),
        description: String::new(),
        path: None,
        instructions: None,
        disabled: false,
        extra: Default::default(),
    }
}

fn write_disk_skill_dir(home: &HomeFixture, project_name: &str, name: &str, body: &str) {
    let dir = home
        .path
        .join("Projects")
        .join(project_name)
        .join("Skills")
        .join(name);
    std::fs::create_dir_all(&dir).expect("create skill dir");
    std::fs::write(dir.join("SKILL.md"), body).expect("write SKILL.md");
}

fn write_disk_skill_file(home: &HomeFixture, project_name: &str, file_name: &str, body: &str) {
    let dir = home.path.join("Projects").join(project_name).join("Skills");
    std::fs::create_dir_all(&dir).expect("create skills dir");
    std::fs::write(dir.join(file_name), body).expect("write skill md file");
}

#[test]
fn inline_instructions_are_used_as_is() {
    let home = HomeFixture::new("skills-inline");
    let mut s = skill("docs");
    s.description = "Docs helper".to_string();
    s.instructions = Some("Read the docs first.".to_string());

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![s])],
        ..Default::default()
    };

    let skills = resolve_project_skills(&settings, "Widgets", &home.path);
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "docs");
    assert_eq!(skills[0].description, "Docs helper");
    assert_eq!(skills[0].instructions, "Read the docs first.");
}

#[test]
fn path_to_a_file_is_read_as_instructions() {
    let home = HomeFixture::new("skills-path-file");
    let skill_file = home.path.join("custom-skill.md");
    std::fs::write(&skill_file, "Instructions from file.").unwrap();

    let mut s = skill("custom");
    s.instructions = Some("fallback text".to_string());
    s.path = Some(skill_file.to_string_lossy().to_string());

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![s])],
        ..Default::default()
    };

    let skills = resolve_project_skills(&settings, "Widgets", &home.path);
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].instructions, "Instructions from file.");
}

#[test]
fn path_to_a_folder_reads_skill_md() {
    let home = HomeFixture::new("skills-path-folder");
    let dir = home.path.join("custom-folder");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("SKILL.md"), "Folder instructions.").unwrap();

    let mut s = skill("custom");
    s.path = Some(dir.to_string_lossy().to_string());

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![s])],
        ..Default::default()
    };

    let skills = resolve_project_skills(&settings, "Widgets", &home.path);
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].instructions, "Folder instructions.");
}

#[test]
fn tendril_home_in_path_is_expanded() {
    let home = HomeFixture::new("skills-path-expand");
    let target_dir = home
        .path
        .join("Projects")
        .join("Widgets")
        .join("Skills")
        .join("expanded");
    std::fs::create_dir_all(&target_dir).unwrap();
    std::fs::write(target_dir.join("SKILL.md"), "Expanded instructions.").unwrap();

    let mut s = skill("expanded");
    s.path = Some("%TENDRIL_HOME%/Projects/Widgets/Skills/expanded".to_string());

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![s])],
        ..Default::default()
    };

    let skills = resolve_project_skills(&settings, "Widgets", &home.path);
    // The disk-discovery pass would also find this folder; config's own entry must win, not be
    // duplicated, and must carry the expanded-path instructions.
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].instructions, "Expanded instructions.");
}

#[test]
fn disabled_skill_is_excluded() {
    let home = HomeFixture::new("skills-disabled");
    let mut off = skill("off");
    off.disabled = true;

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![skill("on"), off])],
        ..Default::default()
    };

    let skills = resolve_project_skills(&settings, "Widgets", &home.path);
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "on");
}

#[test]
fn missing_path_falls_back_to_inline_text_rather_than_erroring() {
    let home = HomeFixture::new("skills-missing-path");
    let mut s = skill("broken");
    s.instructions = Some("Fallback text.".to_string());
    s.path = Some("/does/not/exist/SKILL.md".to_string());

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![s])],
        ..Default::default()
    };

    let skills = resolve_project_skills(&settings, "Widgets", &home.path);
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].instructions, "Fallback text.");
}

#[test]
fn unknown_project_and_empty_project_name_return_empty() {
    let home = HomeFixture::new("skills-unknown");
    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![skill("docs")])],
        ..Default::default()
    };

    assert!(resolve_project_skills(&settings, "Gadgets", &home.path).is_empty());
    assert!(resolve_project_skills(&settings, "", &home.path).is_empty());
}

#[test]
fn disk_discovery_finds_folder_and_file_skills() {
    let home = HomeFixture::new("skills-disk-discovery");
    write_disk_skill_dir(&home, "Widgets", "alpha", "Alpha instructions.");
    write_disk_skill_file(&home, "Widgets", "beta.md", "Beta instructions.");

    let settings = TendrilSettings::default();
    let skills = resolve_project_skills(&settings, "Widgets", &home.path);

    assert_eq!(skills.len(), 2);
    assert_eq!(skills[0].name, "alpha");
    assert_eq!(skills[0].description, "Disk skill");
    assert_eq!(skills[0].instructions, "Alpha instructions.");
    assert_eq!(skills[1].name, "beta");
    assert_eq!(skills[1].description, "Disk skill");
    assert_eq!(skills[1].instructions, "Beta instructions.");
}

#[test]
fn config_skill_wins_over_disk_skill_of_the_same_name_case_insensitively() {
    let home = HomeFixture::new("skills-collision");
    write_disk_skill_dir(&home, "Widgets", "Docs", "From disk.");

    let mut s = skill("docs");
    s.instructions = Some("From config.".to_string());

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![s])],
        ..Default::default()
    };

    let skills = resolve_project_skills(&settings, "Widgets", &home.path);
    assert_eq!(skills.len(), 1, "a collision must not add the skill twice");
    assert_eq!(skills[0].instructions, "From config.");
}

#[test]
fn a_skills_folder_with_no_skill_md_inside_a_subfolder_is_ignored() {
    let home = HomeFixture::new("skills-no-skill-md");
    let dir = home
        .path
        .join("Projects")
        .join("Widgets")
        .join("Skills")
        .join("empty");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("notes.txt"), "not a skill").unwrap();

    let settings = TendrilSettings::default();
    let skills = resolve_project_skills(&settings, "Widgets", &home.path);
    assert!(skills.is_empty());
}

#[test]
fn disk_discovery_results_are_name_sorted() {
    let home = HomeFixture::new("skills-sorted");
    write_disk_skill_dir(&home, "Widgets", "zebra", "Z");
    write_disk_skill_dir(&home, "Widgets", "alpha", "A");
    write_disk_skill_file(&home, "Widgets", "mango.md", "M");

    let settings = TendrilSettings::default();
    let skills = resolve_project_skills(&settings, "Widgets", &home.path);

    let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["alpha", "mango", "zebra"]);
}

#[test]
fn compile_firmware_with_skills_matches_compile_firmware_when_empty() {
    let dir = std::env::temp_dir().join(format!(
        "tendril-skills-fw-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("Program.md"), "Do the thing.").unwrap();

    let values = std::collections::HashMap::from([(
        "CurrentTime".to_string(),
        "2026-01-01T00:00:00Z".to_string(),
    )]);

    let plain = compile_firmware(&dir, &values).unwrap();
    let with_empty = compile_firmware_with_skills(&dir, &values, &[]).unwrap();
    assert_eq!(plain, with_empty);
    assert!(!plain.contains("Project Skills"));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn compile_firmware_with_skills_renders_a_skill_block_per_skill() {
    let dir = std::env::temp_dir().join(format!(
        "tendril-skills-fw2-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("Program.md"), "Do the thing.").unwrap();

    let values = std::collections::HashMap::from([(
        "CurrentTime".to_string(),
        "2026-01-01T00:00:00Z".to_string(),
    )]);
    let skills = vec![
        ProjectSkillInfo {
            name: "docs".to_string(),
            description: "Docs helper".to_string(),
            instructions: "Line one.\nLine two.".to_string(),
        },
        ProjectSkillInfo {
            name: "bare".to_string(),
            description: String::new(),
            instructions: String::new(),
        },
    ];

    let firmware = compile_firmware_with_skills(&dir, &values, &skills).unwrap();
    assert!(firmware.contains("## Project Skills"));
    assert!(firmware.contains("#### Skill: docs"));
    assert!(firmware.contains("*Docs helper*"));
    assert!(firmware.contains("Line one.\nLine two."));
    assert!(firmware.contains("#### Skill: bare"));
    // A blank description/instructions produces no stray `*` line or dangling paragraph.
    assert!(!firmware.contains("**\n\n#### Skill: bare"));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn scan_repo_skills_honours_frontmatter_and_fallbacks() {
    let dir = std::env::temp_dir().join(format!("tendril-scan-{}", uuid::Uuid::new_v4().simple()));
    let with_frontmatter = dir.join("with-frontmatter");
    std::fs::create_dir_all(&with_frontmatter).unwrap();
    std::fs::write(
        with_frontmatter.join("SKILL.md"),
        "---\nname: custom-name\ndescription: A custom description\n---\n\nBody text.",
    )
    .unwrap();

    let no_frontmatter = dir.join("no-frontmatter");
    std::fs::create_dir_all(&no_frontmatter).unwrap();
    std::fs::write(
        no_frontmatter.join("SKILL.md"),
        "# Heading\nFirst real line of instructions.",
    )
    .unwrap();

    let empty_desc = dir.join("empty-desc");
    std::fs::create_dir_all(&empty_desc).unwrap();
    std::fs::write(empty_desc.join("SKILL.md"), "").unwrap();

    let ignored = dir.join("node_modules").join("nested");
    std::fs::create_dir_all(&ignored).unwrap();
    std::fs::write(ignored.join("SKILL.md"), "Should not be found.").unwrap();

    let long_line_dir = dir.join("long-line");
    std::fs::create_dir_all(&long_line_dir).unwrap();
    let long_line = "x".repeat(150);
    std::fs::write(long_line_dir.join("SKILL.md"), &long_line).unwrap();

    let mut results = scan_repo_skills(&dir);
    results.sort_by(|a, b| a.name.cmp(&b.name));

    let by_name = |n: &str| results.iter().find(|s| s.name == n);

    let custom = by_name("custom-name").expect("frontmatter name honoured");
    assert_eq!(custom.description, "A custom description");
    assert_eq!(custom.instructions, "Body text.");

    let fallback = by_name("no-frontmatter").expect("folder name used as fallback");
    assert_eq!(fallback.description, "First real line of instructions.");

    let empty = by_name("empty-desc").expect("empty file still discovered");
    assert_eq!(empty.description, "Custom skill empty-desc");

    let long = by_name("long-line").expect("long first line discovered");
    assert_eq!(long.description.len(), 100);
    assert!(long.description.ends_with("..."));

    assert!(
        !results.iter().any(|s| s.name == "nested"),
        "node_modules must not be walked"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn scan_repo_skills_respects_depth_cap_and_dedupes_case_insensitively() {
    let dir = std::env::temp_dir().join(format!(
        "tendril-scan-depth-{}",
        uuid::Uuid::new_v4().simple()
    ));

    // A skill 8 levels deep exceeds the max_depth: 6 cap and must not be found.
    let mut deep = dir.clone();
    for i in 0..8 {
        deep = deep.join(format!("level{}", i));
    }
    std::fs::create_dir_all(&deep).unwrap();
    std::fs::write(deep.join("SKILL.md"), "Too deep.").unwrap();

    // Two differently-cased "Docs" folders: the first one found (by name order) wins.
    let docs_a = dir.join("Docs");
    std::fs::create_dir_all(&docs_a).unwrap();
    std::fs::write(docs_a.join("SKILL.md"), "A").unwrap();
    let docs_b = dir.join("docs-dup").join("docs");
    std::fs::create_dir_all(&docs_b).unwrap();
    std::fs::write(docs_b.join("SKILL.md"), "B").unwrap();

    let results = scan_repo_skills(&dir);
    assert!(
        !results
            .iter()
            .any(|s| s.relative_path.starts_with("level0")),
        "a skill past the depth cap must not be discovered"
    );
    assert_eq!(
        results
            .iter()
            .filter(|s| s.name.eq_ignore_ascii_case("docs"))
            .count(),
        1,
        "a case-insensitive name collision must be deduped"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn import_skill_to_project_copies_the_tree_and_returns_the_expanded_path() {
    let home = HomeFixture::new("skills-import-copy");
    let source = std::env::temp_dir().join(format!(
        "tendril-import-src-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&source).unwrap();
    std::fs::write(source.join("SKILL.md"), "Copied instructions.").unwrap();
    std::fs::create_dir_all(source.join("node_modules")).unwrap();
    std::fs::write(source.join("node_modules").join("junk"), "junk").unwrap();

    let discovered = DiscoveredSkill {
        name: "copied".to_string(),
        description: "Copied skill".to_string(),
        instructions: "Copied instructions.".to_string(),
        skill_folder_path: source.to_string_lossy().to_string(),
        relative_path: "copied".to_string(),
    };

    let ref_ = import_skill_to_project(&home.path, "Widgets", &discovered, true).unwrap();
    assert_eq!(
        ref_.path,
        Some("%TENDRIL_HOME%/Projects/Widgets/Skills/copied".to_string())
    );

    let target = home
        .path
        .join("Projects")
        .join("Widgets")
        .join("Skills")
        .join("copied");
    assert!(target.join("SKILL.md").is_file());
    assert!(
        !target.join("node_modules").exists(),
        "ignored directories must be skipped when copying"
    );

    let settings = TendrilSettings {
        projects: vec![project("Widgets", vec![ref_])],
        ..Default::default()
    };
    let resolved = resolve_project_skills(&settings, "Widgets", &home.path);
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0].instructions, "Copied instructions.");

    let _ = std::fs::remove_dir_all(&source);
}

#[test]
fn import_skill_to_project_synthesizes_skill_md_when_not_copying_files() {
    let home = HomeFixture::new("skills-import-synth");
    let discovered = DiscoveredSkill {
        name: "synth".to_string(),
        description: "Synthesized skill".to_string(),
        instructions: "Synthesized instructions.".to_string(),
        skill_folder_path: "/nonexistent/source".to_string(),
        relative_path: "synth".to_string(),
    };

    let ref_ = import_skill_to_project(&home.path, "Widgets", &discovered, false).unwrap();
    let target = home
        .path
        .join("Projects")
        .join("Widgets")
        .join("Skills")
        .join("synth");
    let written = std::fs::read_to_string(target.join("SKILL.md")).expect("synthesized SKILL.md");
    assert!(written.contains("name: synth"));
    assert!(written.contains("description: Synthesized skill"));
    assert!(written.contains("Synthesized instructions."));

    assert_eq!(
        ref_.path,
        Some("%TENDRIL_HOME%/Projects/Widgets/Skills/synth".to_string())
    );
}

#[test]
fn parse_skill_markdown_falls_back_when_frontmatter_is_malformed() {
    let dir = std::env::temp_dir().join(format!("tendril-parse-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("SKILL.md");
    std::fs::write(&file, "---\nname: [unterminated\n---\nBody.").unwrap();

    let (name, description, instructions) = parse_skill_markdown(&file, "fallback-name");
    assert_eq!(name, "fallback-name");
    assert_eq!(description, "Body.");
    assert_eq!(instructions, "Body.");

    let _ = std::fs::remove_dir_all(&dir);
}
