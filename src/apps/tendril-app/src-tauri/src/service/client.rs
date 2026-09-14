use crate::error::BridgeError;
use crate::models::{
    AgentCostBreakdownDto, AgentOptionDto, ChatQueuedItemDto, ChatSessionDto, CreateProjectDto,
    CreateSessionDto, DashboardActivityDto, DoctorCheckDto, DraftCommentDto, EnqueueItemDto,
    ExecuteTurnDto, JobDetailDto, JobDto, ModelCatalogStatusDto, OnboardingStatusDto,
    PlanDetailDto, PlanQueryDto, PlanSummaryDto, PostMessageDto, PrStatusDto, PrSyncReportDto,
    ProjectSummaryDto, RecentMergedPrDto, RecentPlanCostDto, RepoStatusDto, ReviewActionDto,
    RevisionResultDto, ShippedFeatureDayDto, StartJobResponseDto, TendrilConfigDto,
};
use crate::service::plan_mapping::{map_plan_detail, map_plan_summary};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde_json::json;

#[derive(Debug, Clone)]
pub struct TendrilClient {
    base_url: String,
    secret: Option<String>,
    client: reqwest::Client,
}

impl TendrilClient {
    pub fn new(base_url: impl Into<String>, secret: Option<String>) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            base_url,
            secret,
            client,
        }
    }

    fn headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(ref sec) = self.secret {
            if let Ok(val) = HeaderValue::from_str(&format!("Bearer {sec}")) {
                headers.insert(AUTHORIZATION, val);
            }
        }
        headers
    }

    pub async fn ping(&self) -> Result<String, BridgeError> {
        let url = format!("{}/api/ping", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            return Err(BridgeError::new(
                "PING_FAILED",
                format!("Ping failed with status {}", resp.status()),
            ));
        }

        Ok(resp.text().await.unwrap_or_else(|_| "pong".to_string()))
    }

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

    /// Turn a non-2xx response into a `BridgeError`, mapping `409 CONFLICT` onto
    /// a `CONFLICT` code and the service's `error` message verbatim. The
    /// lifecycle dialogs render that message, so it must survive the trip.
    async fn expect_success(
        resp: reqwest::Response,
        failure_code: &str,
        action: &str,
    ) -> Result<(), BridgeError> {
        if resp.status().is_success() {
            return Ok(());
        }

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let service_message = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.as_str())
                    .map(|s| s.to_string())
            });

        if status == reqwest::StatusCode::CONFLICT {
            return Err(BridgeError::new(
                "CONFLICT",
                service_message.unwrap_or_else(|| format!("Could not {action} ({status})")),
            ));
        }

        Err(BridgeError::with_details(
            failure_code,
            service_message.unwrap_or_else(|| format!("Could not {action} ({status})")),
            text,
        ))
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

    pub async fn list_jobs(
        &self,
        status: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Vec<JobDto>, BridgeError> {
        let mut url = format!("{}/api/jobs", self.base_url);
        let mut params = Vec::new();
        if let Some(st) = status {
            params.push(format!("status={}", urlencoding(st)));
        }
        if let Some(lim) = limit {
            params.push(format!("limit={lim}"));
        }
        if !params.is_empty() {
            url = format!("{}?{}", url, params.join("&"));
        }

        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status_code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_JOBS_FAILED",
                format!("Failed to list jobs ({status_code}): {text}"),
            ));
        }

        let raw_jobs: Vec<serde_json::Value> = resp.json().await?;
        let jobs = raw_jobs
            .into_iter()
            .map(|val| {
                let id = val
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let job_type = val
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let plan_id = val
                    .get("reportedPlanId")
                    .or_else(|| val.get("planId"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let plan_title = val
                    .get("reportedPlanTitle")
                    .or_else(|| val.get("planTitle"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let project = val
                    .get("project")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let status = val
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Pending")
                    .to_string();
                let status_message = val
                    .get("statusMessage")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let started_at = val
                    .get("startedAt")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let completed_at = val
                    .get("completedAt")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let cost = val.get("cost").and_then(|v| v.as_f64());
                let tokens = val.get("tokens").and_then(|v| v.as_i64());

                JobDto {
                    id,
                    job_type,
                    plan_id,
                    plan_title,
                    project,
                    status,
                    status_message,
                    started_at,
                    completed_at,
                    cost,
                    tokens,
                }
            })
            .collect();

        Ok(jobs)
    }

    pub async fn get_job(&self, job_id: &str) -> Result<JobDetailDto, BridgeError> {
        let url = format!("{}/api/jobs/{}", self.base_url, urlencoding(job_id));
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_JOB_FAILED",
                format!("Failed to get job '{job_id}' ({status}): {text}"),
            ));
        }

        let val: serde_json::Value = resp.json().await?;
        let details = val.get("details").unwrap_or(&val);

        let id = details
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or(job_id)
            .to_string();
        let job_type = details
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string();
        let plan_id = details
            .get("reportedPlanId")
            .or_else(|| details.get("planId"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let plan_title = details
            .get("reportedPlanTitle")
            .or_else(|| details.get("planTitle"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let project = details
            .get("project")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let status = details
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("Pending")
            .to_string();
        let status_message = details
            .get("statusMessage")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let args = details
            .get("args")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let working_directory = details
            .get("workingDirectory")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let started_at = details
            .get("startedAt")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let completed_at = details
            .get("completedAt")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let cost = details.get("cost").and_then(|v| v.as_f64());
        let tokens = details.get("tokens").and_then(|v| v.as_i64());
        let reported_failure_reason = details
            .get("reportedFailureReason")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(JobDetailDto {
            id,
            job_type,
            plan_id,
            plan_title,
            project,
            status,
            status_message,
            args,
            working_directory,
            started_at,
            completed_at,
            cost,
            tokens,
            reported_failure_reason,
        })
    }

    pub async fn start_job(
        &self,
        args: serde_json::Value,
    ) -> Result<StartJobResponseDto, BridgeError> {
        let url = format!("{}/api/jobs", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&args)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "START_JOB_FAILED",
                format!("Failed to start job ({status}): {text}"),
            ));
        }

        let val: serde_json::Value = resp.json().await?;
        let job_id = val
            .get("jobId")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let status = val
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("Started")
            .to_string();

        Ok(StartJobResponseDto { job_id, status })
    }

    pub async fn update_job_status(
        &self,
        job_id: &str,
        message: &str,
        plan_id: Option<&str>,
        plan_title: Option<&str>,
    ) -> Result<(), BridgeError> {
        let url = format!("{}/api/jobs/{}/status", self.base_url, urlencoding(job_id));
        let body = json!({
            "message": message,
            "planId": plan_id,
            "planTitle": plan_title,
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
                "UPDATE_JOB_STATUS_FAILED",
                format!("Failed to update job status ({status}): {text}"),
            ));
        }

        Ok(())
    }

    pub async fn report_job_failure(
        &self,
        job_id: &str,
        message: &str,
        stop: bool,
    ) -> Result<(), BridgeError> {
        let url = format!("{}/api/jobs/{}/fail", self.base_url, urlencoding(job_id));
        let body = json!({
            "message": message,
            "stop": stop,
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
                "REPORT_JOB_FAILURE_FAILED",
                format!("Failed to report job failure ({status}): {text}"),
            ));
        }

        Ok(())
    }

    pub async fn cancel_job(&self, job_id: &str, message: Option<&str>) -> Result<(), BridgeError> {
        let url = format!("{}/api/jobs/{}/cancel", self.base_url, urlencoding(job_id));
        let body = json!({ "message": message });

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
                "CANCEL_JOB_FAILED",
                format!("Failed to cancel job ({status}): {text}"),
            ));
        }

        Ok(())
    }

    pub async fn add_log(
        &self,
        job_id: &str,
        action: &str,
        summary: Option<&str>,
    ) -> Result<String, BridgeError> {
        let url = format!("{}/api/jobs/{}/logs", self.base_url, urlencoding(job_id));
        let body = json!({
            "action": action,
            "summary": summary,
        });

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
                "ADD_LOG_FAILED",
                format!("Failed to add log ({status}): {text}"),
            ));
        }

        let val: serde_json::Value = resp.json().await?;
        let msg = val
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Log added")
            .to_string();
        Ok(msg)
    }

    pub async fn list_pull_requests(&self) -> Result<Vec<PrStatusDto>, BridgeError> {
        let url = format!("{}/api/pull-requests", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_PULL_REQUESTS_FAILED",
                format!("Failed to list pull requests ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn sync_pull_requests(&self) -> Result<PrSyncReportDto, BridgeError> {
        let url = format!("{}/api/pull-requests/sync", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .send()
            .await?;

        // A pass already in flight is not a failure — the caller just re-reads the list when the
        // running pass broadcasts its result.
        if resp.status() == reqwest::StatusCode::CONFLICT {
            return Err(BridgeError::new(
                "PR_SYNC_IN_PROGRESS",
                "A pull request sync is already running",
            ));
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "SYNC_PULL_REQUESTS_FAILED",
                format!("Failed to sync pull requests ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn list_projects(&self) -> Result<Vec<ProjectSummaryDto>, BridgeError> {
        let url = format!("{}/api/projects", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_PROJECTS_FAILED",
                format!("Failed to list projects ({status}): {text}"),
            ));
        }

        let raw_projects: Vec<serde_json::Value> = resp.json().await?;
        let summaries = raw_projects
            .into_iter()
            .map(|val| {
                let name = val
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let repos = val
                    .get("repos")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|r| {
                                r.as_str().map(|s| s.to_string()).or_else(|| {
                                    r.get("path")
                                        .and_then(|p| p.as_str())
                                        .map(|p| p.to_string())
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                let verifications = val
                    .get("verifications")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|item| {
                                item.as_str().map(|s| s.to_string()).or_else(|| {
                                    item.get("name")
                                        .and_then(|n| n.as_str())
                                        .map(|n| n.to_string())
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                let review_actions = val
                    .get("reviewActions")
                    .or_else(|| val.get("review_actions"))
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|item| {
                                serde_json::from_value::<ReviewActionDto>(item.clone()).ok()
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                ProjectSummaryDto {
                    name,
                    repos,
                    verifications,
                    review_actions,
                }
            })
            .collect();

        Ok(summaries)
    }

    pub async fn execute_review_action(
        &self,
        project_name: &str,
        action_name: &str,
        plan_id: Option<&str>,
        worktree: Option<&str>,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!(
            "{}/api/projects/{}/review-actions/{}/execute",
            self.base_url,
            path_segment(project_name),
            path_segment(action_name)
        );
        let body = json!({
            "planId": plan_id,
            "worktree": worktree,
        });

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
                "EXECUTE_REVIEW_ACTION_FAILED",
                format!("Failed to execute review action '{action_name}' ({status}): {text}"),
            ));
        }

        let result = resp.json().await.unwrap_or(json!({ "status": "ok" }));
        Ok(result)
    }

    pub async fn get_config(&self) -> Result<TendrilConfigDto, BridgeError> {
        let url = format!("{}/api/config", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_CONFIG_FAILED",
                format!("Failed to get config ({status}): {text}"),
            ));
        }

        let val: serde_json::Value = resp.json().await?;
        let coding_agent = val
            .get("codingAgent")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let job_timeout = val.get("jobTimeout").and_then(|v| v.as_u64());
        let max_concurrent_jobs = val
            .get("maxConcurrentJobs")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize);
        let plan_template = val
            .get("planTemplate")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let theme = val
            .get("theme")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(TendrilConfigDto {
            coding_agent,
            job_timeout,
            max_concurrent_jobs,
            plan_template,
            theme,
            raw: val,
        })
    }

    /// Merges a single top-level key into `config.yaml`. `PUT /api/config` takes the patch as a JSON
    /// *object* and rejects anything else, so the value is wrapped here — an earlier version sent the
    /// bare value with the key as a query parameter, which the server never read.
    pub async fn put_config(&self, key: &str, value: serde_json::Value) -> Result<(), BridgeError> {
        let url = format!("{}/api/config", self.base_url);
        let patch = json!({ key: value });
        let resp = self
            .client
            .put(&url)
            .headers(self.headers())
            .json(&patch)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "PUT_CONFIG_FAILED",
                format!("Failed to put config key '{key}' ({status}): {text}"),
            ));
        }

        Ok(())
    }

    pub async fn get_onboarding_status(&self) -> Result<OnboardingStatusDto, BridgeError> {
        let url = format!("{}/api/onboarding", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_ONBOARDING_STATUS_FAILED",
                format!("Failed to get onboarding status ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn complete_onboarding(&self) -> Result<(), BridgeError> {
        self.post_onboarding("complete", "COMPLETE_ONBOARDING_FAILED")
            .await
    }

    pub async fn dismiss_onboarding(&self) -> Result<(), BridgeError> {
        self.post_onboarding("dismiss", "DISMISS_ONBOARDING_FAILED")
            .await
    }

    async fn post_onboarding(&self, action: &str, code: &str) -> Result<(), BridgeError> {
        let url = format!("{}/api/onboarding/{}", self.base_url, action);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&json!({}))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                code,
                format!("Failed to {action} onboarding ({status}): {text}"),
            ));
        }

        Ok(())
    }

    pub async fn run_doctor(&self) -> Result<Vec<DoctorCheckDto>, BridgeError> {
        let url = format!("{}/api/doctor", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "RUN_DOCTOR_FAILED",
                format!("Failed to run health checks ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    /// Creates a project. A duplicate name comes back as 409, which surfaces here as a
    /// `CREATE_PROJECT_FAILED` error carrying the server's message.
    pub async fn create_project(
        &self,
        request: CreateProjectDto,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/projects", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&request)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CREATE_PROJECT_FAILED",
                format!("Failed to create project ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn get_models_status(&self) -> Result<ModelCatalogStatusDto, BridgeError> {
        let url = format!("{}/api/models/status", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_MODELS_STATUS_FAILED",
                format!("Failed to get models status ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn refresh_models(&self) -> Result<ModelCatalogStatusDto, BridgeError> {
        let url = format!("{}/api/models/refresh", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "REFRESH_MODELS_FAILED",
                format!("Failed to refresh models ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn post_inbox(
        &self,
        title: &str,
        description: &str,
        project: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/inbox", self.base_url);
        let body = json!({
            "title": title,
            "description": description,
            "project": project,
        });

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
                "POST_INBOX_FAILED",
                format!("Failed to post to inbox ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn list_chat_sessions(&self) -> Result<Vec<ChatSessionDto>, BridgeError> {
        let url = format!("{}/api/chat/sessions", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_CHAT_SESSIONS_FAILED",
                format!("Failed to list chat sessions ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn create_chat_session(
        &self,
        req: CreateSessionDto,
    ) -> Result<ChatSessionDto, BridgeError> {
        let url = format!("{}/api/chat/sessions", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&req)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CREATE_CHAT_SESSION_FAILED",
                format!("Failed to create chat session ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn get_chat_session(&self, id: &str) -> Result<ChatSessionDto, BridgeError> {
        let url = format!("{}/api/chat/sessions/{}", self.base_url, path_segment(id));
        let resp = self.client.get(&url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_CHAT_SESSION_FAILED",
                format!("Failed to get chat session '{id}' ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn update_chat_session(
        &self,
        id: &str,
        title: &str,
    ) -> Result<ChatSessionDto, BridgeError> {
        let url = format!("{}/api/chat/sessions/{}", self.base_url, path_segment(id));
        let resp = self
            .client
            .put(&url)
            .headers(self.headers())
            .json(&json!({ "title": title }))
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "UPDATE_CHAT_SESSION_FAILED",
                format!("Failed to update chat session '{id}' ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn delete_chat_session(&self, id: &str) -> Result<(), BridgeError> {
        let url = format!("{}/api/chat/sessions/{}", self.base_url, path_segment(id));
        let resp = self
            .client
            .delete(&url)
            .headers(self.headers())
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "DELETE_CHAT_SESSION_FAILED",
                format!("Failed to delete chat session '{id}' ({status}): {text}"),
            ));
        }
        Ok(())
    }

    pub async fn post_chat_message(
        &self,
        id: &str,
        req: PostMessageDto,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/messages",
            self.base_url,
            path_segment(id)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&req)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "POST_CHAT_MESSAGE_FAILED",
                format!("Failed to post chat message ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn execute_chat_turn(
        &self,
        id: &str,
        req: ExecuteTurnDto,
    ) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/execute",
            self.base_url,
            path_segment(id)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&req)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "EXECUTE_CHAT_TURN_FAILED",
                format!("Failed to execute chat turn ({status}): {text}"),
            ));
        }
        Ok(())
    }

    pub async fn cancel_chat_turn(&self, id: &str) -> Result<bool, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/cancel",
            self.base_url,
            path_segment(id)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CANCEL_CHAT_TURN_FAILED",
                format!("Failed to cancel chat turn ({status}): {text}"),
            ));
        }
        let val: serde_json::Value = resp.json().await?;
        Ok(val
            .get("cancelled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true))
    }

    pub async fn answer_chat_questions(
        &self,
        session_id: &str,
        message_id: &str,
        answers: std::collections::HashMap<String, Vec<String>>,
    ) -> Result<ChatSessionDto, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/messages/{}/answers",
            self.base_url,
            path_segment(session_id),
            path_segment(message_id)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&json!({ "answers": answers }))
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "ANSWER_CHAT_QUESTIONS_FAILED",
                format!("Failed to answer chat questions ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn get_chat_queue(&self, id: &str) -> Result<Vec<ChatQueuedItemDto>, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/queue",
            self.base_url,
            path_segment(id)
        );
        let resp = self.client.get(&url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_CHAT_QUEUE_FAILED",
                format!("Failed to get chat queue ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn enqueue_chat_message(
        &self,
        id: &str,
        req: EnqueueItemDto,
    ) -> Result<ChatQueuedItemDto, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/queue",
            self.base_url,
            path_segment(id)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&req)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "ENQUEUE_CHAT_MESSAGE_FAILED",
                format!("Failed to enqueue chat message ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn clear_chat_queue(&self, id: &str) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/queue",
            self.base_url,
            path_segment(id)
        );
        let resp = self
            .client
            .delete(&url)
            .headers(self.headers())
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CLEAR_CHAT_QUEUE_FAILED",
                format!("Failed to clear chat queue ({status}): {text}"),
            ));
        }
        Ok(())
    }

    pub async fn delete_queued_chat_item(
        &self,
        session_id: &str,
        item_id: &str,
    ) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/queue/{}",
            self.base_url,
            path_segment(session_id),
            path_segment(item_id)
        );
        let resp = self
            .client
            .delete(&url)
            .headers(self.headers())
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "DELETE_QUEUED_CHAT_ITEM_FAILED",
                format!("Failed to delete queued chat item ({status}): {text}"),
            ));
        }
        Ok(())
    }

    // --- Draft diff comments ---
    //
    // Every mutation returns the plan's new list, so the caller never has to re-fetch and stays
    // correct even when the WebSocket bridge is down.

    fn diff_comments_url(&self, id: &str) -> String {
        format!(
            "{}/api/plans/{}/diff-comments",
            self.base_url,
            path_segment(id)
        )
    }

    pub async fn list_diff_comments(&self, id: &str) -> Result<Vec<DraftCommentDto>, BridgeError> {
        let resp = self
            .client
            .get(self.diff_comments_url(id))
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_DIFF_COMMENTS_FAILED",
                format!("Failed to list diff comments for plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn upsert_diff_comment(
        &self,
        id: &str,
        comment: &DraftCommentDto,
    ) -> Result<Vec<DraftCommentDto>, BridgeError> {
        let resp = self
            .client
            .post(self.diff_comments_url(id))
            .headers(self.headers())
            .json(comment)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "UPSERT_DIFF_COMMENT_FAILED",
                format!("Failed to save diff comment on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn replace_diff_comments(
        &self,
        id: &str,
        comments: &[DraftCommentDto],
    ) -> Result<Vec<DraftCommentDto>, BridgeError> {
        let resp = self
            .client
            .put(self.diff_comments_url(id))
            .headers(self.headers())
            .json(&json!({ "comments": comments }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "REPLACE_DIFF_COMMENTS_FAILED",
                format!("Failed to replace diff comments on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn delete_diff_comment(
        &self,
        id: &str,
        file_path: &str,
        change_key: &str,
    ) -> Result<Vec<DraftCommentDto>, BridgeError> {
        let url = format!(
            "{}?filePath={}&changeKey={}",
            self.diff_comments_url(id),
            urlencoding(file_path),
            urlencoding(change_key)
        );
        let resp = self
            .client
            .delete(url)
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "DELETE_DIFF_COMMENT_FAILED",
                format!("Failed to delete diff comment on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    /// Drop a plan's whole review — no query string means clear-all.
    pub async fn clear_diff_comments(&self, id: &str) -> Result<(), BridgeError> {
        let resp = self
            .client
            .delete(self.diff_comments_url(id))
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CLEAR_DIFF_COMMENTS_FAILED",
                format!("Failed to clear diff comments on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(())
    }

    pub async fn update_queued_chat_item(
        &self,
        session_id: &str,
        item_id: &str,
        prompt: &str,
    ) -> Result<ChatQueuedItemDto, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/queue/{}",
            self.base_url,
            path_segment(session_id),
            path_segment(item_id)
        );
        let resp = self
            .client
            .put(&url)
            .headers(self.headers())
            .json(&serde_json::json!({ "prompt": prompt }))
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "UPDATE_QUEUED_CHAT_ITEM_FAILED",
                format!("Failed to update queued chat item ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn list_agents(&self) -> Result<Vec<AgentOptionDto>, BridgeError> {
        let url = format!("{}/api/agents", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_AGENTS_FAILED",
                format!("Failed to list agents ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

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

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// Percent-encode one path segment.
///
/// `urlencoding` is form encoding, which turns a space into `+`. That is correct
/// in a query string and wrong in a path: `+` is a literal plus there, so a
/// recommendation titled "Deep Link Protocol Handler" would be looked up as
/// "Deep+Link+Protocol+Handler" and never found. Plan and job ids are digits, so
/// only the title-keyed recommendation route is affected.
fn path_segment(s: &str) -> String {
    let mut encoded = String::with_capacity(s.len());
    for byte in s.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(*byte as char)
            }
            other => encoded.push_str(&format!("%{other:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_segment_encodes_spaces_as_percent_20_not_plus() {
        assert_eq!(
            path_segment("Deep Link Protocol Handler"),
            "Deep%20Link%20Protocol%20Handler"
        );
        // A `+` in the title survives as a `+`, which form encoding would have
        // turned into a space on the way back out.
        assert_eq!(path_segment("C++ bindings"), "C%2B%2B%20bindings");
        assert_eq!(path_segment("00021"), "00021");
        assert_eq!(path_segment("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[test]
    fn a_path_segment_cannot_smuggle_in_extra_path_or_query() {
        assert_eq!(path_segment("../../etc/passwd"), "..%2F..%2Fetc%2Fpasswd");
        assert_eq!(path_segment("title?admin=1"), "title%3Fadmin%3D1");
    }

    #[test]
    fn a_path_segment_encodes_non_ascii_as_utf8_bytes() {
        assert_eq!(path_segment("résumé"), "r%C3%A9sum%C3%A9");
    }
}
