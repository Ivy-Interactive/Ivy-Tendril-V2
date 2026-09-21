//! Dashboard analytics — activity, shipped features, merged PRs and cost rollups.

use super::TendrilClient;
use crate::error::BridgeError;
use crate::models::{
    AgentCostBreakdownDto, DashboardActivityDto, RecentMergedPrDto, RecentPlanCostDto,
    ShippedFeatureDayDto,
};

impl TendrilClient {
    // --- dashboard analytics -------------------------------------------------
    //
    // Every window default is the daemon's, not ours: omitting the query
    // parameter is how a caller asks for it, so each one lives in one place.

    pub async fn get_dashboard_activity(
        &self,
        months: Option<i32>,
    ) -> Result<DashboardActivityDto, BridgeError> {
        let mut url = format!("{}/api/dashboard/activity", self.base_url);
        if let Some(m) = months {
            url = format!("{url}?months={m}");
        }
        let resp = self.client.get(&url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_DASHBOARD_ACTIVITY_FAILED",
                format!("Failed to get dashboard activity ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn get_shipped_features(
        &self,
        days: Option<i64>,
    ) -> Result<Vec<ShippedFeatureDayDto>, BridgeError> {
        let mut url = format!("{}/api/dashboard/shipped-features", self.base_url);
        if let Some(d) = days {
            url = format!("{url}?days={d}");
        }
        let resp = self.client.get(&url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_SHIPPED_FEATURES_FAILED",
                format!("Failed to get shipped features ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn get_recent_merged_prs(
        &self,
        limit: Option<i64>,
    ) -> Result<Vec<RecentMergedPrDto>, BridgeError> {
        let mut url = format!("{}/api/dashboard/merged-prs", self.base_url);
        if let Some(l) = limit {
            url = format!("{url}?limit={l}");
        }
        let resp = self.client.get(&url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_MERGED_PRS_FAILED",
                format!("Failed to get merged PRs ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn get_recent_plan_costs(
        &self,
        days: Option<i64>,
    ) -> Result<Vec<RecentPlanCostDto>, BridgeError> {
        let mut url = format!("{}/api/dashboard/plan-costs", self.base_url);
        if let Some(d) = days {
            url = format!("{url}?days={d}");
        }
        let resp = self.client.get(&url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_PLAN_COSTS_FAILED",
                format!("Failed to get plan costs ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn get_agent_cost_breakdown(
        &self,
        days: Option<i64>,
    ) -> Result<Vec<AgentCostBreakdownDto>, BridgeError> {
        let mut url = format!("{}/api/dashboard/agent-costs", self.base_url);
        if let Some(d) = days {
            url = format!("{url}?days={d}");
        }
        let resp = self.client.get(&url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_AGENT_COSTS_FAILED",
                format!("Failed to get agent cost breakdown ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }
}
