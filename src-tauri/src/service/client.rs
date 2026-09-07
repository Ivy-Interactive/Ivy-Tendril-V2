use crate::error::BridgeError;
use crate::models::{
    ChatQueuedItemDto, ChatSessionDto, CreateSessionDto, EnqueueItemDto, ExecuteTurnDto,
    JobDetailDto, JobDto, PlanDetailDto, PlanQueryDto, PlanSummaryDto, PostMessageDto,
    ProjectSummaryDto, RevisionResultDto, StartJobResponseDto, TendrilConfigDto,
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

    /// Accept or decline one of a plan's recommendations.
    ///
    /// Recommendations are keyed by title, matching `set_recommendation_state`
    /// in tendril-core and the `tendril plan rec accept|decline` CLI, both of
    /// which look the entry up by title rather than by index.
    ///
    /// The route is live in `tendril-server` (shipped in Plan 00068 via
    /// `PUT /api/plans/:id/recommendations/:title`). The desktop app delegates
    /// mutation to the daemon rather than writing `plan.yaml` behind its back.
    pub async fn update_recommendation(
        &self,
        plan_id: &str,
        title: &str,
        state: &str,
        decline_reason: Option<&str>,
    ) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/plans/{}/recommendations/{}",
            self.base_url,
            path_segment(plan_id),
            path_segment(title)
        );
        let body = json!({ "state": state, "declineReason": decline_reason });

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

                ProjectSummaryDto {
                    name,
                    repos,
                    verifications,
                }
            })
            .collect();

        Ok(summaries)
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

    pub async fn put_config(&self, key: &str, value: serde_json::Value) -> Result<(), BridgeError> {
        let url = format!("{}/api/config?key={}", self.base_url, urlencoding(key));
        let resp = self
            .client
            .put(&url)
            .headers(self.headers())
            .json(&value)
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
