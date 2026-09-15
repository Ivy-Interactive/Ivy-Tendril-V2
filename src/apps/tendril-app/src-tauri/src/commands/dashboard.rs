//! Dashboard analytics commands. Thin pass-throughs: the windows, the SQL and the projection all
//! live in the daemon, so there is nothing here to get out of step with it.

use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::{
    AgentCostBreakdownDto, DashboardActivityDto, RecentMergedPrDto, RecentPlanCostDto,
    ShippedFeatureDayDto,
};

#[tauri::command]
pub async fn cmd_get_dashboard_activity(
    months: Option<i32>,
) -> Result<DashboardActivityDto, BridgeError> {
    get_client_from_master()?
        .get_dashboard_activity(months)
        .await
}

#[tauri::command]
pub async fn cmd_get_shipped_features(
    days: Option<i64>,
) -> Result<Vec<ShippedFeatureDayDto>, BridgeError> {
    get_client_from_master()?.get_shipped_features(days).await
}

#[tauri::command]
pub async fn cmd_get_recent_merged_prs(
    limit: Option<i64>,
) -> Result<Vec<RecentMergedPrDto>, BridgeError> {
    get_client_from_master()?.get_recent_merged_prs(limit).await
}

#[tauri::command]
pub async fn cmd_get_recent_plan_costs(
    days: Option<i64>,
) -> Result<Vec<RecentPlanCostDto>, BridgeError> {
    get_client_from_master()?.get_recent_plan_costs(days).await
}

#[tauri::command]
pub async fn cmd_get_agent_cost_breakdown(
    days: Option<i64>,
) -> Result<Vec<AgentCostBreakdownDto>, BridgeError> {
    get_client_from_master()?
        .get_agent_cost_breakdown(days)
        .await
}
