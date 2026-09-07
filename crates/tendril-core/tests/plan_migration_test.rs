use tendril_core::plans::migrations::{PlanMigrator, PlanSchemaVersion};

const V0_PLAN_YAML: &str = r#"state: Building
project: SampleProject
level: Feature
title: Sample Plan Title
repos:
  - path: /repos/sample
verifications: []
"#;

const COMPLETED_PLAN_YAML: &str = r#"state: Completed
project: SampleProject
level: Feature
title: Completed Plan
repos: []
verifications: []
"#;

const SKIPPED_PLAN_YAML: &str = r#"state: Skipped
project: SampleProject
level: Feature
title: Skipped Plan
repos: []
verifications: []
"#;

#[test]
fn test_plan_migration_v0_to_latest_and_idempotence() {
    let temp_dir = std::env::temp_dir().join(format!(
        "tendril-test-migration-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let plan_folder = temp_dir.join("00001-SamplePlanTitle");
    std::fs::create_dir_all(&plan_folder).unwrap();

    // Version 0 setup: missing schemaVersion, state: Building, lowercase revisions/ subfolder
    let plan_yaml_path = plan_folder.join("plan.yaml");
    std::fs::write(&plan_yaml_path, V0_PLAN_YAML).unwrap();

    let lowercase_rev_dir = plan_folder.join("revisions");
    std::fs::create_dir_all(&lowercase_rev_dir).unwrap();
    std::fs::write(lowercase_rev_dir.join("001.md"), "# Revision 1").unwrap();

    assert_eq!(PlanSchemaVersion::read(V0_PLAN_YAML), 0);

    let migrator = PlanMigrator::new();
    assert_eq!(migrator.latest_version(), 3);

    // Run migration
    let migrated = migrator
        .migrate_plan(&plan_folder, None)
        .expect("migrate_plan should succeed");
    assert!(migrated, "Expected migrate_plan to return true");

    // Read back plan.yaml
    let updated_yaml = std::fs::read_to_string(&plan_yaml_path).unwrap();
    let updated_version = PlanSchemaVersion::read(&updated_yaml);
    assert_eq!(updated_version, 3);

    // Check state is renamed from Building to Creating
    assert!(
        updated_yaml.contains("state: Creating"),
        "Expected state: Creating, but got: {}",
        updated_yaml
    );
    assert!(!updated_yaml.contains("state: Building"));

    // Check revisions folder was renamed to TitleCase
    let titlecase_rev_dir = plan_folder.join("Revisions");
    assert!(
        titlecase_rev_dir.exists(),
        "Expected Revisions/ directory to exist"
    );
    assert!(titlecase_rev_dir.join("001.md").exists());

    // Second run must be an idempotent no-op returning false
    let second_run = migrator
        .migrate_plan(&plan_folder, None)
        .expect("second migrate_plan should succeed");
    assert!(!second_run, "Expected second run to return false (no-op)");

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_plan_migration_skips_terminal_plans() {
    let temp_dir = std::env::temp_dir().join(format!(
        "tendril-test-migration-term-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();

    let migrator = PlanMigrator::new();

    // 1. Completed plan
    let completed_folder = temp_dir.join("00002-CompletedPlan");
    std::fs::create_dir_all(&completed_folder).unwrap();
    let completed_yaml_path = completed_folder.join("plan.yaml");
    std::fs::write(&completed_yaml_path, COMPLETED_PLAN_YAML).unwrap();

    let res_completed = migrator
        .migrate_plan(&completed_folder, None)
        .expect("migrate_plan on completed");
    assert!(!res_completed, "Completed plans must be skipped");
    let after_completed = std::fs::read_to_string(&completed_yaml_path).unwrap();
    assert_eq!(after_completed, COMPLETED_PLAN_YAML);

    // 2. Skipped plan
    let skipped_folder = temp_dir.join("00003-SkippedPlan");
    std::fs::create_dir_all(&skipped_folder).unwrap();
    let skipped_yaml_path = skipped_folder.join("plan.yaml");
    std::fs::write(&skipped_yaml_path, SKIPPED_PLAN_YAML).unwrap();

    let res_skipped = migrator
        .migrate_plan(&skipped_folder, None)
        .expect("migrate_plan on skipped");
    assert!(!res_skipped, "Skipped plans must be skipped");
    let after_skipped = std::fs::read_to_string(&skipped_yaml_path).unwrap();
    assert_eq!(after_skipped, SKIPPED_PLAN_YAML);

    let _ = std::fs::remove_dir_all(&temp_dir);
}
