//! Plan lifecycle, per-plan git state, and the recommendation / verification / revision
//! sub-resources the plan editor writes.

use super::{path_segment, urlencoding, TendrilClient};
use crate::error::BridgeError;
use crate::models::{
    PlanDetailDto, PlanGitDto, PlanQueryDto, PlanSummaryDto, RepoStatusDto, RevisionResultDto,
};
use crate::service::plan_mapping::{map_plan_detail, map_plan_summary};
use serde_json::json;

impl TendrilClient {
    pub async fn list_plans(
        &self,
        query: Option<PlanQueryDto>,
    ) -> Result<Vec<PlanSummaryDto>, BridgeError> {
        let mut url = format!("{}/api/plans", self.base_url);
        if let Some(q) = query {
            let mut params = Vec::new();
            if let Some(st) = q.status {
                params.push(format!("status={}", urlencoding(&st)));
            }
            if let Some(pj) = q.project {
                params.push(format!("project={}", urlencoding(&pj)));
            }
            if let Some(search) = q.q {
                params.push(format!("q={}", urlencoding(&search)));
            }
            if !params.is_empty() {
                url = format!("{}?{}", url, params.join("&"));
            }
        }

        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_PLANS_FAILED",
                format!("Failed to list plans ({status}): {text}"),
            ));
        }

        let raw_plans: Vec<serde_json::Value> = resp.json().await?;
        let summaries = raw_plans
            .iter()
            .map(|val| map_plan_summary(val, ""))
            .collect();

        Ok(summaries)
    }

    pub async fn get_plan(&self, plan_id: &str) -> Result<PlanDetailDto, BridgeError> {
        let url = format!("{}/api/plans/{}", self.base_url, urlencoding(plan_id));
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(BridgeError::not_found(format!(
                "Plan '{plan_id}' not found"
            )));
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_PLAN_FAILED",
                format!("Failed to get plan '{plan_id}' ({status}): {text}"),
            ));
        }

        let val: serde_json::Value = resp.json().await?;
        Ok(map_plan_detail(&val, plan_id))
    }

    pub async fn create_plan(
        &self,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/plans", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CREATE_PLAN_FAILED",
                format!("Failed to create plan ({status}): {text}"),
            ));
        }

        let created_val = resp.json().await?;
        Ok(created_val)
    }

    pub async fn update_plan_field(
        &self,
        id: &str,
        field: &str,
        value: &str,
        allow_failed: bool,
    ) -> Result<(), BridgeError> {
        let url = format!("{}/api/plans/{}", self.base_url, urlencoding(id));
        let body = json!({
            "field": field,
            "value": value,
            "allowFailedVerifications": allow_failed
        });

        let resp = self
            .client
            .put(&url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "UPDATE_FIELD_FAILED",
                format!("Failed to update plan field ({status}): {text}"),
            ));
        }

        Ok(())
    }

    /// Reset a plan to Draft and remove its worktrees
    /// (`POST /api/plans/:id/reset`).
    ///
    /// A `409 CONFLICT` — a Completed/Skipped plan, or one a job is still
    /// holding — comes back as a `CONFLICT` rejection carrying the service's own
    /// message, so the dialog can show the operator why nothing happened rather
    /// than pretending the reset landed.
    pub async fn reset_plan(&self, plan_id: &str) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/plans/{}/reset",
            self.base_url,
            path_segment(plan_id)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .send()
            .await?;
        Self::expect_success(
            resp,
            "RESET_PLAN_FAILED",
            &format!("reset plan '{plan_id}'"),
        )
        .await
    }

    /// Permanently delete a plan folder (`DELETE /api/plans/:id`).
    ///
    /// Irreversible, and refused with `409 CONFLICT` while a job is in flight.
    pub async fn delete_plan(&self, plan_id: &str) -> Result<(), BridgeError> {
        let url = format!("{}/api/plans/{}", self.base_url, path_segment(plan_id));
        let resp = self
            .client
            .delete(&url)
            .headers(self.headers())
            .send()
            .await?;
        Self::expect_success(
            resp,
            "DELETE_PLAN_FAILED",
            &format!("delete plan '{plan_id}'"),
        )
        .await
    }

    /// Uncommitted-change status of a plan's repos
    /// (`GET /api/plans/:id/repo-status`), the data source of the dirty-repo
    /// pre-execution guard.
    pub async fn get_repo_status(&self, plan_id: &str) -> Result<Vec<RepoStatusDto>, BridgeError> {
        let url = format!(
            "{}/api/plans/{}/repo-status",
            self.base_url,
            path_segment(plan_id)
        );
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::with_details(
                "REPO_STATUS_FAILED",
                format!("Failed to read repo status for plan '{plan_id}' ({status})"),
                text,
            ));
        }

        #[derive(serde::Deserialize)]
        struct RepoStatusResponse {
            #[serde(default)]
            repos: Vec<RepoStatusDto>,
        }

        let body: RepoStatusResponse = resp.json().await?;
        Ok(body.repos)
    }

    /// A plan's worktrees, its commits grouped under them, and the reachability verdict for the
    /// commits no worktree accounts for (`GET /api/plans/:id/git`) — the Git tab's data source.
    pub async fn get_plan_git(&self, plan_id: &str) -> Result<PlanGitDto, BridgeError> {
        let url = format!("{}/api/plans/{}/git", self.base_url, path_segment(plan_id));
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::with_details(
                "PLAN_GIT_FAILED",
                format!("Failed to read git state for plan '{plan_id}' ({status})"),
                text,
            ));
        }

        Ok(resp.json().await?)
    }

    /// Accept or decline one of a plan's recommendations.
    ///
    /// Recommendations are keyed by title, matching `set_recommendation_state`
    /// in tendril-core and the `tendril plan rec accept|decline` CLI, both of
    /// which look the entry up by title rather than by index.
    ///
    /// The route is live in `tendril-server` (shipped in Plan 00068 via
    /// `PUT /api/plans/:id/recommendations/:title`). The desktop app delegates
    /// mutation to the daemon rather than writing `plan.yaml` behind its back.
    ///
    /// `notes` and `decline_reason` are distinct fields: the app used to smuggle
    /// accept notes through `declineReason` because the recommendation model had
    /// nowhere else to put them.
    pub async fn update_recommendation(
        &self,
        plan_id: &str,
        title: &str,
        state: &str,
        decline_reason: Option<&str>,
        notes: Option<&str>,
    ) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/plans/{}/recommendations/{}",
            self.base_url,
            path_segment(plan_id),
            path_segment(title)
        );
        let body = json!({ "state": state, "declineReason": decline_reason, "notes": notes });

        let resp = self
            .client
            .put(&url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::with_details(
                "RECOMMENDATION_UPDATE_FAILED",
                format!("Failed to set recommendation '{title}' to {state} ({status})"),
                text,
            ));
        }

        Ok(())
    }

    /// Set verification status for a plan.
    ///
    /// The route is live in tendril-server (shipped in Plan 00068 via
    /// PUT /api/plans/:id/verifications/:name).
    pub async fn update_verification(
        &self,
        plan_id: &str,
        name: &str,
        status: &str,
    ) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/plans/{}/verifications/{}",
            self.base_url,
            path_segment(plan_id),
            path_segment(name)
        );
        let body = json!({ "status": status });

        let resp = self
            .client
            .put(&url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status_code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::with_details(
                "VERIFICATION_UPDATE_FAILED",
                format!("Failed to set verification '{name}' to {status} ({status_code})"),
                text,
            ));
        }

        Ok(())
    }

    pub async fn get_revision(&self, id: &str, number: Option<i32>) -> Result<String, BridgeError> {
        let mut url = format!("{}/api/plans/{}/revisions", self.base_url, urlencoding(id));
        if let Some(num) = number {
            url = format!("{url}?number={num}");
        }

        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_REVISION_FAILED",
                format!("Failed to get revision for plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.text().await.unwrap_or_default())
    }

    pub async fn write_revision(
        &self,
        id: &str,
        content: &str,
    ) -> Result<RevisionResultDto, BridgeError> {
        let url = format!("{}/api/plans/{}/revisions", self.base_url, urlencoding(id));
        let body = json!({ "content": content });

        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "WRITE_REVISION_FAILED",
                format!("Failed to write revision ({status}): {text}"),
            ));
        }

        let result: serde_json::Value = resp.json().await?;
        let rev_num = result.get("revision").and_then(|r| r.as_i64()).unwrap_or(1) as i32;
        let message = result
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Revision written")
            .to_string();

        Ok(RevisionResultDto {
            revision: rev_num,
            message,
        })
    }

    /// Overwrite the newest revision in place, keeping its number.
    ///
    /// `PUT /api/plans/{id}/revisions/latest`, and deliberately not the `POST` above. Answering a
    /// question is not a new revision of the plan, it is filling in a blank the plan left — V1 routes
    /// answers through `IPlanReaderService.UpdateLatestRevision` for exactly that reason. Appending
    /// instead would claim the agent produced a new plan, and it would inflate `revisionCount`, which
    /// the app's unfolded-answer guard reads as `revisionCount === 1`: one answer would switch that
    /// guard off.
    ///
    /// The returned `revision` is the number that did **not** move, so a caller can assert as much.
    pub async fn update_latest_revision(
        &self,
        id: &str,
        content: &str,
    ) -> Result<RevisionResultDto, BridgeError> {
        let url = format!(
            "{}/api/plans/{}/revisions/latest",
            self.base_url,
            urlencoding(id)
        );
        let body = json!({ "content": content });

        let resp = self
            .client
            .put(&url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::with_details(
                "UPDATE_LATEST_REVISION_FAILED",
                format!("Failed to update the latest revision of plan '{id}' ({status})"),
                text,
            ));
        }

        let result: serde_json::Value = resp.json().await?;
        // No `unwrap_or(1)` here, unlike `write_revision`: a response the service answered without a
        // revision number is one this call cannot report anything true about, and 1 would be a
        // fabricated "revision 001 was updated". 0 is not a revision number, so it reads as unknown.
        let rev_num = result.get("revision").and_then(|r| r.as_i64()).unwrap_or(0) as i32;
        let message = result
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Revision updated")
            .to_string();

        Ok(RevisionResultDto {
            revision: rev_num,
            message,
        })
    }
}
