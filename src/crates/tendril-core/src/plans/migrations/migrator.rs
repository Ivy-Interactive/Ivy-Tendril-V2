use super::schema_version::PlanSchemaVersion;
use super::traits::{PlanMigration, PlanMigrationContext};
use super::v001_rename_legacy_state_names::PlanMigration001RenameLegacyStateNames;
use super::v002_title_case_subfolders::PlanMigration002TitleCaseSubfolders;
use super::v003_normalize_yaml_structure::PlanMigration003NormalizeYamlStructure;
use crate::error::{Result, TendrilError};
use regex::Regex;
use std::path::Path;

pub struct PlanMigrator {
    migrations: Vec<Box<dyn PlanMigration>>,
}

impl Default for PlanMigrator {
    fn default() -> Self {
        Self::new()
    }
}

impl PlanMigrator {
    pub fn new() -> Self {
        let migrations: Vec<Box<dyn PlanMigration>> = vec![
            Box::new(PlanMigration001RenameLegacyStateNames),
            Box::new(PlanMigration002TitleCaseSubfolders),
            Box::new(PlanMigration003NormalizeYamlStructure),
        ];
        Self::with_migrations(migrations).expect("Built-in plan migrations must be valid")
    }

    pub fn with_migrations(mut migrations: Vec<Box<dyn PlanMigration>>) -> Result<Self> {
        migrations.sort_by_key(|m| m.version());
        Self::validate_migration_sequence(&migrations)?;
        Ok(Self { migrations })
    }

    pub fn latest_version(&self) -> i32 {
        self.migrations
            .iter()
            .map(|m| m.version())
            .max()
            .unwrap_or(0)
    }

    pub fn migrate_plan(
        &self,
        plan_folder: &Path,
        on_plan_changed: Option<&dyn Fn(&str)>,
    ) -> Result<bool> {
        let plan_yaml_path = plan_folder.join("plan.yaml");
        if !plan_yaml_path.exists() {
            return Ok(false);
        }

        let yaml = std::fs::read_to_string(&plan_yaml_path)?;

        let state_re = Regex::new(r"(?m)^state:\s*(.+)$").unwrap();
        let state = if let Some(caps) = state_re.captures(&yaml) {
            caps.get(1)
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_default()
        } else {
            String::new()
        };

        if state.eq_ignore_ascii_case("Completed") || state.eq_ignore_ascii_case("Skipped") {
            return Ok(false);
        }

        let current_version = PlanSchemaVersion::read(&yaml);
        if current_version >= self.latest_version() {
            return Ok(false);
        }

        let folder_name = plan_folder
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        let mut migrated = yaml;
        for migration in self
            .migrations
            .iter()
            .filter(|m| m.version() > current_version)
        {
            let ctx = PlanMigrationContext {
                plan_folder,
                folder_name,
                yaml: &migrated,
                state: &state,
            };
            migrated = migration.apply(&ctx)?;
        }

        migrated = PlanSchemaVersion::stamp(&migrated, self.latest_version());
        std::fs::write(&plan_yaml_path, migrated)?;

        if let Some(cb) = on_plan_changed {
            cb(folder_name);
        }

        Ok(true)
    }

    pub fn migrate_plans(
        &self,
        plans_dir: &Path,
        on_plan_changed: Option<&dyn Fn(&str)>,
    ) -> Result<usize> {
        if !plans_dir.exists() {
            return Ok(0);
        }

        let mut count = 0;
        for entry in std::fs::read_dir(plans_dir)? {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            if let Ok(ft) = entry.file_type() {
                if ft.is_dir() {
                    match self.migrate_plan(&entry.path(), on_plan_changed) {
                        Ok(true) => count += 1,
                        Ok(false) => {}
                        Err(e) => {
                            tracing::warn!(
                                "Failed to migrate plan in {}: {}",
                                entry.path().display(),
                                e
                            );
                        }
                    }
                }
            }
        }

        Ok(count)
    }

    fn validate_migration_sequence(migrations: &[Box<dyn PlanMigration>]) -> Result<()> {
        if migrations.is_empty() {
            return Ok(());
        }

        for (i, m) in migrations.iter().enumerate() {
            let expected = (i + 1) as i32;
            let actual = m.version();
            if actual != expected {
                return Err(TendrilError::Plan(format!(
                    "Plan migration sequence is invalid. Expected version {}, found {}. Migrations must be numbered sequentially starting from 1.",
                    expected, actual
                )));
            }
        }

        Ok(())
    }
}
