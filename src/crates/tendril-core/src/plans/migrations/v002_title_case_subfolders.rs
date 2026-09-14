use super::traits::{PlanMigration, PlanMigrationContext};
use crate::error::Result;

pub struct PlanMigration002TitleCaseSubfolders;

impl PlanMigration for PlanMigration002TitleCaseSubfolders {
    fn version(&self) -> i32 {
        2
    }

    fn description(&self) -> &'static str {
        "Title-case plan subfolders (revisions -> Revisions, logs -> Logs, ...)"
    }

    fn apply(&self, ctx: &PlanMigrationContext) -> Result<String> {
        let title_case = [
            ("revisions", "Revisions"),
            ("logs", "Logs"),
            ("artifacts", "Artifacts"),
            ("verification", "Verification"),
            ("worktrees", "Worktrees"),
        ];

        if let Ok(entries) = std::fs::read_dir(ctx.plan_folder) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_dir() {
                        let path = entry.path();
                        if let Some(name_str) = path.file_name().and_then(|n| n.to_str()) {
                            for (lower, title) in &title_case {
                                if name_str.eq_ignore_ascii_case(lower) && name_str != *title {
                                    // Two-step move via a temporary name so rename works safely across case-insensitive filesystems
                                    let tmp_path =
                                        ctx.plan_folder.join(format!("{}_tmp", name_str));
                                    let target_path = ctx.plan_folder.join(title);
                                    if std::fs::rename(&path, &tmp_path).is_ok() {
                                        let _ = std::fs::rename(&tmp_path, &target_path);
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(ctx.yaml.to_string())
    }
}
