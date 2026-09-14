use super::traits::{PlanMigration, PlanMigrationContext};
use crate::error::Result;
use regex::Regex;

pub struct PlanMigration003NormalizeYamlStructure;

impl PlanMigration for PlanMigration003NormalizeYamlStructure {
    fn version(&self) -> i32 {
        3
    }

    fn description(&self) -> &'static str {
        "Normalize/repair plan.yaml structure"
    }

    fn apply(&self, ctx: &PlanMigrationContext) -> Result<String> {
        let mut repaired = ctx.yaml.to_string();

        // Strip leading YAML document separator
        let sep_re = Regex::new(r"(?m)^---[ \t]*(\r?\n|$)").unwrap();
        repaired = sep_re.replace_all(&repaired, "").to_string();

        // Convert object-style repos with name & path to simple path strings
        let repo_obj_re1 = Regex::new(
            r"(?m)^(\s*)-\s+name:\s*.+\r?\n\s+path:\s*(.+?)(?:\r?\n\s+(?:branch|prRule):\s*.+)*$",
        )
        .unwrap();
        repaired = repo_obj_re1.replace_all(&repaired, "$1- $2").to_string();

        let repo_obj_re2 =
            Regex::new(r"(?m)^(\s*)-\s+path:\s*(.+?)(?:\r?\n\s+(?:prRule|branch):\s*.+)*$")
                .unwrap();
        repaired = repo_obj_re2.replace_all(&repaired, "$1- $2").to_string();

        // Convert object-style commits with hash to simple commit hash strings
        let commit_obj_re =
            Regex::new(r"(?m)^(\s*)-\s+hash:\s*(.+?)(?:\r?\n\s+(?:repo|message):\s*.+)*$").unwrap();
        repaired = commit_obj_re.replace_all(&repaired, "$1- $2").to_string();

        // Convert object-style notes
        let note_obj_re = Regex::new(r"(?m)^(\s*)-\s+note:\s*(.+)$").unwrap();
        repaired = note_obj_re.replace_all(&repaired, "$1- $2").to_string();

        Ok(repaired)
    }
}
