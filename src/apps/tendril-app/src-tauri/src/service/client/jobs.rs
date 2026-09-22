//! The job queue: listing, detail, lifecycle transitions and log append.

use super::{job_artifact_path, plan_id_from_folder, urlencoding, TendrilClient};
use crate::error::BridgeError;
use crate::models::{JobDetailDto, JobDto, StartJobResponseDto};
use serde_json::json;

impl TendrilClient {
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
                // Which plan this job holds. `reportedPlanId` is what the *agent* reported, so it is
                // empty until the agent has run — and `planId` is not a key the daemon sends at all.
                // So a job dispatched a moment ago had no plan id, and everything keyed on it silently
                // did nothing: the Plans list never dropped the plan a job had just taken
                // (`draftQueueFor`), `hasActiveJob` never disabled Update/Expand/Split, and the failure
                // callout never found its job.
                //
                // `planFile` is the association the daemon always sets from the dispatch arguments. It
                // arrives in two shapes — a bare id (`00681`) or a folder name
                // (`00610-PortTunnelAndShareSubsys`) — so it is normalised to the 5-digit id the app
                // compares against `PlanSummary.id`.
                let plan_id = val
                    .get("reportedPlanId")
                    .or_else(|| val.get("planId"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        val.get("planFile")
                            .and_then(|v| v.as_str())
                            .and_then(plan_id_from_folder)
                    });
                let plan_title = val
                    .get("reportedPlanTitle")
                    .or_else(|| val.get("planTitle"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                // The third thing the Prompt cell can show, and the only one a job has before it has
                // reported a plan. `GET /api/jobs` carries the whole `JobItem`, so the words are read
                // out of its typed args here; `POST /api/jobs/query` has already derived them into
                // `prompt`, so that spelling is accepted first.
                let prompt = val
                    .get("prompt")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        serde_json::from_value::<tendril_core::models::JobArgs>(
                            val.get("typedArgs").cloned()?,
                        )
                        .ok()?
                        .prompt_text()
                        .map(|s| s.to_string())
                    });
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
                let num = |key: &str| val.get(key).and_then(|v| v.as_i64());

                JobDto {
                    id,
                    job_type,
                    plan_id,
                    plan_title,
                    prompt,
                    project,
                    status,
                    status_message,
                    started_at,
                    completed_at,
                    // The Jobs table's Agent Output column counts up from this. The live overlay
                    // replaces each fetched row whole, so a row that arrived without it falls back to
                    // "Starting..." however long the agent has been talking.
                    last_output_at: val
                        .get("lastOutputAt")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    cost,
                    tokens,
                    cost_source: val
                        .get("costSource")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    duration_seconds: num("durationSeconds"),
                    input_tokens: num("inputTokens"),
                    output_tokens: num("outputTokens"),
                    cache_read_tokens: num("cacheReadTokens"),
                    cache_write_tokens: num("cacheWriteTokens"),
                    reasoning_tokens: num("reasoningTokens"),
                    model: val
                        .get("model")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    process_id: num("processId"),
                    chat_session_id: val
                        .get("chatSessionId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    // Absent rather than `false` when the daemon does not say, so "not detached" and
                    // "the list endpoint cannot tell" stay distinguishable.
                    detached: val.get("detached").and_then(|v| v.as_bool()),
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
        // Same fallback as `list_jobs`: `reportedPlanId` is empty until the agent has reported, so a
        // job detail opened right after dispatch would otherwise claim to hold no plan. `plan_folder`
        // below keeps the raw `planFile`; this is the normalised id.
        let plan_id = details
            .get("reportedPlanId")
            .or_else(|| details.get("planId"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .or_else(|| {
                details
                    .get("planFile")
                    .and_then(|v| v.as_str())
                    .and_then(plan_id_from_folder)
            });
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
        let detail_num = |key: &str| details.get(key).and_then(|v| v.as_i64());
        // An unset string arrives as `""` for the fields the daemon serializes unconditionally
        // (`provider` is one), and a debug panel should read that as "not recorded", not as a blank row.
        let detail_text = |key: &str| {
            details
                .get(key)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        let tokens = details.get("tokens").and_then(|v| v.as_i64());
        let reported_failure_reason = details
            .get("reportedFailureReason")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let job_log_path = job_artifact_path(&id, ".md");
        let job_prompt_path = job_artifact_path(&id, ".prompt.md");
        let job_raw_log_path = job_artifact_path(&id, ".raw.jsonl");
        let job_eventwire_path = job_artifact_path(&id, ".eventwire.jsonl");

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
            cost_source: details
                .get("costSource")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            duration_seconds: detail_num("durationSeconds"),
            input_tokens: detail_num("inputTokens"),
            output_tokens: detail_num("outputTokens"),
            cache_read_tokens: detail_num("cacheReadTokens"),
            cache_write_tokens: detail_num("cacheWriteTokens"),
            reasoning_tokens: detail_num("reasoningTokens"),
            model: details
                .get("model")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            process_id: detail_num("processId"),
            detached: details.get("detached").and_then(|v| v.as_bool()),
            permission_denials: details
                .get("permissionDenials")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default(),
            provider: detail_text("provider"),
            cli_command: detail_text("cliCommand"),
            execution_profile: detail_text("executionProfile"),
            // `planFile` is the plan *folder* — see `JobDetailDto::plan_folder`.
            plan_folder: detail_text("planFile"),
            last_output_at: detail_text("lastOutputAt"),
            job_log_path,
            job_prompt_path,
            job_raw_log_path,
            job_eventwire_path,
        })
    }

    /// Removes a job from the list and the database. The daemon keeps its log artifacts.
    pub async fn delete_job(&self, job_id: &str) -> Result<(), BridgeError> {
        let url = format!("{}/api/jobs/{}", self.base_url, urlencoding(job_id));
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
                "DELETE_JOB_FAILED",
                format!("Failed to delete job '{job_id}' ({status}): {text}"),
            ));
        }
        Ok(())
    }

    /// Promotes a blocked or queued job past its gates so it runs next.
    pub async fn force_start_job(&self, job_id: &str) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/jobs/{}/force-start",
            self.base_url,
            urlencoding(job_id)
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
                "FORCE_START_JOB_FAILED",
                format!("Failed to force-start job '{job_id}' ({status}): {text}"),
            ));
        }
        Ok(())
    }

    /// Relaunches a stopped/failed job with optional feedback.
    pub async fn relaunch_job(
        &self,
        job_id: &str,
        feedback: Option<&str>,
    ) -> Result<StartJobResponseDto, BridgeError> {
        let url = format!(
            "{}/api/jobs/{}/relaunch",
            self.base_url,
            urlencoding(job_id)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&json!({ "feedback": feedback }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "RELAUNCH_JOB_FAILED",
                format!("Failed to relaunch job '{job_id}' ({status}): {text}"),
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

    /// Retries the last step of a stopped/failed job with optional feedback.
    pub async fn retry_job(
        &self,
        job_id: &str,
        feedback: Option<&str>,
    ) -> Result<StartJobResponseDto, BridgeError> {
        let url = format!(
            "{}/api/jobs/{}/retry",
            self.base_url,
            urlencoding(job_id)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&json!({ "feedback": feedback }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "RETRY_JOB_FAILED",
                format!("Failed to retry job '{job_id}' ({status}): {text}"),
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

    /// Bulk-clear finished jobs by scope: `POST /api/jobs/clear` with `{ "status": scope }`, answering
    /// how many rows went.
    ///
    /// The scope is passed through rather than checked here. The daemon filters to
    /// `Completed`/`Failed`/`Timeout`/`Stopped` before it reads a row, so a Running or Queued job cannot
    /// be cleared through any caller, and it answers `400` naming the scopes it does accept. A second
    /// check on this side would only be able to disagree with that list.
    ///
    /// The daemon's own `error` string is carried verbatim for exactly that reason: the refusal is the
    /// useful part, and replacing it with a status code turns a helpful sentence into a blank failure.
    pub async fn clear_jobs(&self, status: &str) -> Result<usize, BridgeError> {
        let url = format!("{}/api/jobs/clear", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&json!({ "status": status }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let http_status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            let reason = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|payload| {
                    payload
                        .get("error")
                        .and_then(|error| error.as_str())
                        .map(str::to_string)
                });
            return Err(BridgeError::with_details(
                "CLEAR_JOBS_FAILED",
                reason
                    .unwrap_or_else(|| format!("Failed to clear '{status}' jobs ({http_status})")),
                text,
            ));
        }

        let result: serde_json::Value = resp.json().await?;
        Ok(result.get("cleared").and_then(|v| v.as_u64()).unwrap_or(0) as usize)
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
}
