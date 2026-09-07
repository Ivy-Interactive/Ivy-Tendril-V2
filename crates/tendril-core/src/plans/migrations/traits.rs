use crate::error::Result;
use std::path::Path;

pub struct PlanMigrationContext<'a> {
    pub plan_folder: &'a Path,
    pub folder_name: &'a str,
    pub yaml: &'a str,
    pub state: &'a str,
}

pub trait PlanMigration: Send + Sync {
    fn version(&self) -> i32;
    fn description(&self) -> &'static str;
    fn apply(&self, ctx: &PlanMigrationContext) -> Result<String>;
}
