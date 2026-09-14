use super::traits::{PlanMigration, PlanMigrationContext};
use crate::error::Result;
use regex::Regex;

pub struct PlanMigration001RenameLegacyStateNames;

impl PlanMigration for PlanMigration001RenameLegacyStateNames {
    fn version(&self) -> i32 {
        1
    }

    fn description(&self) -> &'static str {
        "Rename legacy plan state names (Building -> Creating, ReadyForReview -> Review)"
    }

    fn apply(&self, ctx: &PlanMigrationContext) -> Result<String> {
        let re = Regex::new(r"(?m)^state:\s*(.+)$").unwrap();
        if let Some(caps) = re.captures(ctx.yaml) {
            let state = caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            let new_state = match state {
                s if s.eq_ignore_ascii_case("Building") => "Creating",
                s if s.eq_ignore_ascii_case("ReadyForReview") => "Review",
                _ => return Ok(ctx.yaml.to_string()),
            };
            let line_re = Regex::new(r"(?m)^state:\s*.*$").unwrap();
            return Ok(line_re
                .replace(ctx.yaml, format!("state: {}", new_state))
                .to_string());
        }
        Ok(ctx.yaml.to_string())
    }
}
