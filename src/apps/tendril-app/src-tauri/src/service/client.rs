use crate::error::BridgeError;
use crate::models::{
    AgentCostBreakdownDto, AgentOptionDto, AnnotationDto, ChatQueuedItemDto, ChatSessionDto,
    CreateProjectDto, CreateSessionDto, DashboardActivityDto, DoctorCheckDto, DraftCommentDto,
    EnqueueItemDto, ExecuteTurnDto, JobDetailDto, JobDto, ModelCatalogStatusDto,
    OnboardingStatusDto, PlanDetailDto, PlanGitDto, PlanQueryDto, PlanSummaryDto, PostMessageDto,
    PrStatusDto, PrSyncReportDto, ProjectSummaryDto, RecentMergedPrDto, RecentPlanCostDto,
    RepoStatusDto, ReviewActionDto, RevisionResultDto, ShippedFeatureDayDto, StartJobResponseDto,
    SubscribeOutcomeDto, TendrilConfigDto, VersionInfoDto,
};
use crate::service::plan_mapping::{map_plan_detail, map_plan_summary};
use base64::Engine;
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
                    // Absent rather than `false` when the daemon does not say, so "not detached" and
                    // "the list endpoint cannot tell" stay distinguishable.
                    detached: val.get("detached").and_then(|v| v.as_bool()),
                }
            })
            .collect();

        Ok(jobs)
    }

    /// One `POST` to the daemon's table query API, forwarded whole.
    ///
    /// Every other method here maps the daemon's reply onto a DTO, because a view needs one. This one
    /// must not: the body is the caller's `TableQuery` and the reply is the daemon's page, and both
    /// belong to the table being queried rather than to this client. Keeping it shapeless is what lets
    /// one command serve `/api/jobs/query` and `/api/tables/{table}/query` alike, and what leaves
    /// `api/tableQuery.ts` as the single place a page is decoded — the seam an Arrow encoding would
    /// slot into without any caller knowing.
    ///
    /// `Accept: application/json` is explicit because the daemon negotiates on it and answers 406 for
    /// Arrow: asking for what this side can actually decode is the difference between a clear reply and
    /// a 406 nobody expected.
    pub async fn post_query(
        &self,
        path: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .header(reqwest::header::ACCEPT, "application/json")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            // A 400 from this API names the column or the filter function that was wrong, and that
            // sentence is the entire value of the error to a filter UI. It is carried through verbatim
            // rather than replaced by the status code.
            let reason = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|payload| {
                    payload
                        .get("error")
                        .and_then(|error| error.as_str())
                        .map(str::to_string)
                });
            return Err(BridgeError::with_details(
                "TABLE_QUERY_FAILED",
                reason.unwrap_or_else(|| format!("Query to {path} failed ({status})")),
                text,
            ));
        }

        Ok(resp.json().await?)
    }

    /// Ask the daemon what models a bring-your-own provider serves: `POST /api/agents/models`.
    ///
    /// The path is hard-coded rather than taken from the caller. `post_query` above takes one because it
    /// serves a family of table routes and checks the shape before forwarding; this serves exactly one
    /// route, so there is nothing to parameterise and nothing to check.
    ///
    /// `request` is forwarded and the reply handed back, both untouched. That is deliberate on the way
    /// out as well as in: the body may carry an API key the operator has typed but not yet saved, so
    /// nothing here reads it, records it or puts it in an error. The daemon redacts credentials from
    /// every message this route produces, which is why a failure reason can be carried through at all.
    ///
    /// A refusal is an `Err`; a *reachable* endpoint that rejected the key is not. The route answers
    /// `200` with `{ "status": "apiKeyError", ... }` for that, because "the provider said no" is an
    /// outcome the settings page renders rather than a transport failure.
    pub async fn fetch_provider_models(
        &self,
        request: serde_json::Value,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/agents/models", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .header(reqwest::header::ACCEPT, "application/json")
            .json(&request)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            // The daemon never reflects the request back, so nothing here can be the key. A stale
            // daemon that predates the route answers 404, and saying so is the whole value of this arm.
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::with_details(
                "FETCH_PROVIDER_MODELS_FAILED",
                format!("The service could not look up the provider's models ({status})"),
                text,
            ));
        }

        Ok(resp.json().await?)
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
                /* `ProjectConfig.color` is a defaulted `String`, so an unconfigured project sends
                `""`; the blank is dropped here so the DTO's `Option` means what it says. */
                let color = val
                    .get("color")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string);
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
                    color,
                    repos,
                    verifications,
                    review_actions,
                }
            })
            .collect();

        Ok(summaries)
    }

    /// Starts a review action and hands back the still-open response.
    ///
    /// The body is an SSE stream that lives as long as the process does, so it is deliberately not
    /// consumed here: reading it as JSON would block until the process exited and then throw away
    /// everything it had said. [`super::review_action_bridge`] owns the stream from here.
    pub async fn execute_review_action(
        &self,
        project_name: &str,
        action_name: &str,
        plan_id: Option<&str>,
        worktree: Option<&str>,
    ) -> Result<reqwest::Response, BridgeError> {
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
            .header(reqwest::header::ACCEPT, "text/event-stream")
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

        Ok(resp)
    }

    /// Sends keystrokes to a running review action. `data` is base64 of the raw bytes, because a
    /// control character is most of what a terminal sends.
    pub async fn review_action_input(
        &self,
        project_name: &str,
        action_name: &str,
        session_id: &str,
        data: &str,
    ) -> Result<(), BridgeError> {
        self.post_review_action_control(
            project_name,
            action_name,
            "input",
            json!({ "sessionId": session_id, "data": data }),
        )
        .await
    }

    /// Reports the terminal's size to a running review action.
    pub async fn review_action_resize(
        &self,
        project_name: &str,
        action_name: &str,
        session_id: &str,
        rows: u16,
        cols: u16,
    ) -> Result<(), BridgeError> {
        self.post_review_action_control(
            project_name,
            action_name,
            "resize",
            json!({ "sessionId": session_id, "rows": rows, "cols": cols }),
        )
        .await
    }

    async fn post_review_action_control(
        &self,
        project_name: &str,
        action_name: &str,
        endpoint: &str,
        body: serde_json::Value,
    ) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/projects/{}/review-actions/{}/{}",
            self.base_url,
            path_segment(project_name),
            path_segment(action_name),
            endpoint
        );

        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await?;

        // A `404` means the process has already exited, which a client racing the `end` frame cannot
        // avoid; it is reported rather than retried.
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "REVIEW_ACTION_CONTROL_FAILED",
                format!("Review action {endpoint} failed ({status}): {text}"),
            ));
        }

        Ok(())
    }

    /// Starts an interactive agent for a chat session and returns its SSE stream, unread.
    ///
    /// The chat session id is the only thing that decides what runs: the daemon resolves the agent
    /// from the session and refuses an id it does not know, so this cannot start an arbitrary process
    /// even though it carries the daemon's credential.
    pub async fn start_chat_terminal(
        &self,
        session_id: &str,
        prompt: Option<&str>,
        agent_id: Option<&str>,
        model_id: Option<&str>,
    ) -> Result<reqwest::Response, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/terminal",
            self.base_url,
            path_segment(session_id)
        );
        let body = json!({
            "prompt": prompt,
            "agentId": agent_id,
            "modelId": model_id,
        });

        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "START_CHAT_TERMINAL_FAILED",
                format!("Failed to start a terminal for chat '{session_id}' ({status}): {text}"),
            ));
        }

        Ok(resp)
    }

    /// Sends keystrokes to a chat session's terminal. `data` is base64 of the raw bytes, because a
    /// control character is most of what a terminal sends.
    pub async fn chat_terminal_input(
        &self,
        chat_session_id: &str,
        pty_session_id: &str,
        data: &str,
    ) -> Result<(), BridgeError> {
        self.post_chat_terminal_control(
            chat_session_id,
            "terminal/input",
            json!({ "sessionId": pty_session_id, "data": data }),
        )
        .await
    }

    /// Reports the terminal's size, so the agent redraws its interface to fit.
    pub async fn chat_terminal_resize(
        &self,
        chat_session_id: &str,
        pty_session_id: &str,
        rows: u16,
        cols: u16,
    ) -> Result<(), BridgeError> {
        self.post_chat_terminal_control(
            chat_session_id,
            "terminal/resize",
            json!({ "sessionId": pty_session_id, "rows": rows, "cols": cols }),
        )
        .await
    }

    /// Ends the agent behind a chat terminal. Unlike a review action, whose process has to outlive its
    /// pane, an interactive agent belongs to the pane that opened it.
    pub async fn chat_terminal_close(
        &self,
        chat_session_id: &str,
        pty_session_id: &str,
    ) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/terminal",
            self.base_url,
            path_segment(chat_session_id)
        );
        let resp = self
            .client
            .delete(&url)
            .headers(self.headers())
            .json(&json!({ "sessionId": pty_session_id }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CHAT_TERMINAL_CONTROL_FAILED",
                format!("Chat terminal close failed ({status}): {text}"),
            ));
        }
        Ok(())
    }

    async fn post_chat_terminal_control(
        &self,
        chat_session_id: &str,
        endpoint: &str,
        body: serde_json::Value,
    ) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/{}",
            self.base_url,
            path_segment(chat_session_id),
            endpoint
        );

        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await?;

        // A `404` means the agent has already exited, which a client racing the `end` frame cannot
        // avoid; it is reported rather than retried.
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CHAT_TERMINAL_CONTROL_FAILED",
                format!("Chat terminal {endpoint} failed ({status}): {text}"),
            ));
        }

        Ok(())
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
        let desktop_notifications = val.get("desktopNotifications").and_then(|v| v.as_bool());

        Ok(TendrilConfigDto {
            coding_agent,
            job_timeout,
            max_concurrent_jobs,
            plan_template,
            theme,
            desktop_notifications,
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

    pub async fn subscribe_newsletter(
        &self,
        email: &str,
    ) -> Result<SubscribeOutcomeDto, BridgeError> {
        let url = format!("{}/api/newsletter/subscribe", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&json!({ "email": email }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "SUBSCRIBE_NEWSLETTER_FAILED",
                format!("Failed to subscribe to newsletter ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
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

    pub async fn get_version_info(&self) -> Result<VersionInfoDto, BridgeError> {
        let url = format!("{}/api/version", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_VERSION_INFO_FAILED",
                format!("Failed to get version info ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn check_version_now(&self) -> Result<VersionInfoDto, BridgeError> {
        let url = format!("{}/api/version/check", self.base_url);
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
                "CHECK_VERSION_NOW_FAILED",
                format!("Failed to check version ({status}): {text}"),
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

    /// Forces an assigned-issue sweep. The sweep report is returned for any status the service treats
    /// as success, so the caller can distinguish `Ran` from `AlreadyRunning`; only `NotMaster`
    /// (a `409`) surfaces as an error.
    pub async fn check_inbox(&self) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/inbox/check", self.base_url);
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
                "CHECK_INBOX_FAILED",
                format!("Failed to check for assigned issues ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    /// Swept issues awaiting a decision. `state` of `None` uses the service default (`Pending`).
    pub async fn list_inbox_proposals(
        &self,
        state: Option<&str>,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = match state {
            Some(s) if !s.trim().is_empty() => format!(
                "{}/api/inbox/proposals?state={}",
                self.base_url,
                path_segment(s)
            ),
            _ => format!("{}/api/inbox/proposals", self.base_url),
        };
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_INBOX_PROPOSALS_FAILED",
                format!("Failed to list inbox proposals ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn accept_inbox_proposal(&self, id: i64) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/inbox/proposals/{}/accept", self.base_url, id);
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
                "ACCEPT_INBOX_PROPOSAL_FAILED",
                format!("Failed to accept inbox proposal {id} ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn dismiss_inbox_proposal(&self, id: i64) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/inbox/proposals/{}/dismiss", self.base_url, id);
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
                "DISMISS_INBOX_PROPOSAL_FAILED",
                format!("Failed to dismiss inbox proposal {id} ({status}): {text}"),
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

    /// One `/api/vaults` request, forwarding the JSON body both ways.
    ///
    /// Vault payloads are owned by `tendril_core::vault::models` and consumed directly by the
    /// webview's `types/vault.ts`, so the native side is a transport rather than a third copy of the
    /// schema: a copy here could only drift, and would silently drop fields the UI later needs.
    ///
    /// A failed *vault result* (`{ success: false, message, errorMessage }`) answers 500 while
    /// carrying the text the dialogs must show, so a body that looks like one is returned as `Ok`
    /// and the caller reads `success`. Only a missing thing (404) or an unparseable answer becomes a
    /// `BridgeError`.
    async fn vault_request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}{}", self.base_url, path);
        let mut request = self.client.request(method, &url).headers(self.headers());
        if let Some(body) = body {
            request = request.json(&body);
        }

        let resp = request.send().await?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let parsed = serde_json::from_str::<serde_json::Value>(&text).ok();

        if status.is_success() {
            return parsed.ok_or_else(|| {
                BridgeError::with_details(
                    "VAULT_REQUEST_FAILED",
                    format!("The vault service answered {status} with a non-JSON body"),
                    text,
                )
            });
        }

        if let Some(value) = parsed.as_ref() {
            if value.get("success").and_then(|s| s.as_bool()) == Some(false) {
                return Ok(value.clone());
            }
        }

        let message = parsed
            .as_ref()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()))
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("Vault request to {path} failed ({status})"));

        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(BridgeError::not_found(message));
        }
        Err(BridgeError::with_details(
            "VAULT_REQUEST_FAILED",
            message,
            text,
        ))
    }

    pub async fn list_vaults(&self) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(reqwest::Method::GET, "/api/vaults", None)
            .await
    }

    pub async fn get_vault_status(&self, vault_id: &str) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::GET,
            &format!("/api/vaults/{}", path_segment(vault_id)),
            None,
        )
        .await
    }

    pub async fn get_vault_catalog(
        &self,
        vault_id: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::GET,
            &format!("/api/vaults/{}/catalog", path_segment(vault_id)),
            None,
        )
        .await
    }

    pub async fn list_github_accounts(&self) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(reqwest::Method::GET, "/api/vaults/accounts", None)
            .await
    }

    pub async fn discover_vaults(&self) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(reqwest::Method::GET, "/api/vaults/discover", None)
            .await
    }

    pub async fn create_vault_repo(
        &self,
        repo_name: &str,
        private: bool,
        org: Option<&str>,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::POST,
            "/api/vaults/create",
            Some(json!({ "repoName": repo_name, "private": private, "org": org })),
        )
        .await
    }

    pub async fn connect_vault(
        &self,
        repo_url: &str,
        name: Option<&str>,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::POST,
            "/api/vaults",
            Some(json!({ "repoUrl": repo_url, "name": name })),
        )
        .await
    }

    pub async fn disconnect_vault(&self, vault_id: &str) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::DELETE,
            &format!("/api/vaults/{}", path_segment(vault_id)),
            None,
        )
        .await
    }

    pub async fn set_vault_always_up_to_date(
        &self,
        vault_id: &str,
        always_up_to_date: bool,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::PUT,
            &format!("/api/vaults/{}", path_segment(vault_id)),
            Some(json!({ "alwaysUpToDate": always_up_to_date })),
        )
        .await
    }

    pub async fn pull_vault_latest(
        &self,
        vault_id: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::POST,
            &format!("/api/vaults/{}/pull", path_segment(vault_id)),
            None,
        )
        .await
    }

    pub async fn collect_project_assets(
        &self,
        project_name: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::GET,
            &format!("/api/vaults/project-assets/{}", path_segment(project_name)),
            None,
        )
        .await
    }

    pub async fn push_to_vault(
        &self,
        vault_id: &str,
        request: serde_json::Value,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::POST,
            &format!("/api/vaults/{}/push", path_segment(vault_id)),
            Some(request),
        )
        .await
    }

    /// Import or merge a vault project. Both are `POST /api/vaults/:id/projects`; `merge` picks
    /// between adopting a local project of the same name and creating a new one.
    pub async fn import_vault_project(
        &self,
        vault_id: &str,
        mut request: serde_json::Value,
        merge: bool,
    ) -> Result<serde_json::Value, BridgeError> {
        if let Some(object) = request.as_object_mut() {
            object.insert("merge".to_string(), json!(merge));
        }

        self.vault_request(
            reqwest::Method::POST,
            &format!("/api/vaults/{}/projects", path_segment(vault_id)),
            Some(request),
        )
        .await
    }

    pub async fn delete_vault_project(
        &self,
        vault_id: &str,
        project_name: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::DELETE,
            &format!(
                "/api/vaults/{}/projects/{}",
                path_segment(vault_id),
                path_segment(project_name)
            ),
            None,
        )
        .await
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

    // --- Draft annotations ---
    //
    // Same contract as the diff comments above: every mutation returns the plan's new list.

    fn annotations_url(&self, id: &str) -> String {
        format!(
            "{}/api/plans/{}/annotations",
            self.base_url,
            path_segment(id)
        )
    }

    pub async fn list_annotations(&self, id: &str) -> Result<Vec<AnnotationDto>, BridgeError> {
        let resp = self
            .client
            .get(self.annotations_url(id))
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_ANNOTATIONS_FAILED",
                format!("Failed to list annotations for plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn upsert_annotation(
        &self,
        id: &str,
        annotation: &AnnotationDto,
    ) -> Result<Vec<AnnotationDto>, BridgeError> {
        let resp = self
            .client
            .post(self.annotations_url(id))
            .headers(self.headers())
            .json(annotation)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "UPSERT_ANNOTATION_FAILED",
                format!("Failed to save annotation on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn replace_annotations(
        &self,
        id: &str,
        annotations: &[AnnotationDto],
    ) -> Result<Vec<AnnotationDto>, BridgeError> {
        let resp = self
            .client
            .put(self.annotations_url(id))
            .headers(self.headers())
            .json(&json!({ "annotations": annotations }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "REPLACE_ANNOTATIONS_FAILED",
                format!("Failed to replace annotations on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn delete_annotation(
        &self,
        id: &str,
        annotation_id: &str,
    ) -> Result<Vec<AnnotationDto>, BridgeError> {
        let url = format!(
            "{}?id={}",
            self.annotations_url(id),
            urlencoding(annotation_id)
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
                "DELETE_ANNOTATION_FAILED",
                format!("Failed to delete annotation on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    /// Drop a plan's whole annotation set — no query string means clear-all.
    pub async fn clear_annotations(&self, id: &str) -> Result<(), BridgeError> {
        let resp = self
            .client
            .delete(self.annotations_url(id))
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CLEAR_ANNOTATIONS_FAILED",
                format!("Failed to clear annotations on plan '{id}' ({status}): {text}"),
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

    /// Stages an attached file with the daemon and answers with the absolute path it now lives at,
    /// inside `<TendrilHome>/Attachments/<session_id>/`.
    ///
    /// The bytes travel, not the source path: the daemon owns the Tendril home (and need not be on this
    /// machine), so it is the only thing that can write there, and handing it a path to copy *from*
    /// would give the route a file-reading half it has no business having. See
    /// `tendril_server::routes::attachments`.
    ///
    /// The credential is the ordinary bearer header here — unlike [`Self::get_local_file_data_url`],
    /// nothing about this request is made by the webview, so there is no reason for it to leave the
    /// `Authorization` header.
    pub async fn upload_attachment(
        &self,
        session_id: &str,
        file_name: &str,
        bytes: Vec<u8>,
    ) -> Result<crate::models::ChatAttachmentDto, BridgeError> {
        let url = format!(
            "{}/api/attachments/{}?fileName={}",
            self.base_url,
            path_segment(session_id),
            urlencoding(file_name)
        );

        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/octet-stream"),
        );
        if let Some(ref secret) = self.secret {
            if let Ok(value) = HeaderValue::from_str(&format!("Bearer {secret}")) {
                headers.insert(AUTHORIZATION, value);
            }
        }

        let resp = self
            .client
            .post(&url)
            .headers(headers)
            .body(bytes)
            .send()
            .await?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(BridgeError::unauthenticated(
                "The daemon refused the credential for an attachment upload",
            ));
        }
        if !status.is_success() {
            let detail = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "UPLOAD_ATTACHMENT_FAILED",
                format!("Tendril would not store '{file_name}' ({status}): {detail}"),
            ));
        }

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Stored {
            path: String,
        }
        let stored: Stored = resp.json().await?;
        Ok(crate::models::ChatAttachmentDto {
            // The name the user picked the file by, not the name it was stored under: those differ
            // when the session already held a file of that name, and the chip has to keep reading the
            // way the user chose it.
            name: file_name.to_string(),
            path: stored.path,
            mime_type: None,
        })
    }

    /// Fetches a local file through the daemon's guarded `GET /ivy/local-file` and returns it as a
    /// `data:` URL the webview can put in an `<img src>`.
    ///
    /// The daemon decides what may be read — `tendril-server`'s `local_file_guard` checks the
    /// credential, the extension allowlist and root confinement, and this call carries no opinion of
    /// its own about the path. Nothing is read off the filesystem here, so the app gains no
    /// file-reading surface of its own: it can only ask for what the guard already serves.
    ///
    /// The bytes come back rather than a URL because the guard's own layers make a URL unusable from
    /// the webview: the packaged app's page is `tauri://localhost`, so an `<img>` pointed at
    /// `http://127.0.0.1:<port>` is a cross-site subresource (`Sec-Fetch-Site: cross-site`, layer 3)
    /// whose `Origin` names a different host than the request (layer 2), and the route's `?token=`
    /// would have to be the daemon's bearer secret — the credential `commands::get_client_from_master`
    /// exists to keep out of the webview. Handing over the bytes keeps both invariants.
    pub async fn get_local_file_data_url(&self, path: &str) -> Result<String, BridgeError> {
        /// Enough for a screenshot or a plan attachment, and small enough that a stray large file
        /// cannot be turned into a data URL big enough to wedge the webview.
        const MAX_PREVIEW_BYTES: u64 = 16 * 1024 * 1024;

        let Some(secret) = self.secret.as_deref() else {
            return Err(BridgeError::unauthenticated(
                "No daemon credential is available to read a local file",
            ));
        };

        // The guard reads the credential from `?token=` — it sits outside the bearer middleware
        // because an `<img src>` sends no `Authorization` header. So the secret is in this URL, and
        // the URL must not reach a log, an error message or the webview: every failure below is
        // reported from `path` alone, and `without_url` strips it out of reqwest's own errors, which
        // otherwise print the whole request URL.
        let url = format!(
            "{}/ivy/local-file?path={}&token={}",
            self.base_url,
            urlencoding(path),
            urlencoding(secret)
        );

        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|err| BridgeError::from(err.without_url()))?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(BridgeError::unauthenticated(
                "The daemon refused the credential for a local file read",
            ));
        }
        if !status.is_success() {
            // 403 (host/origin/cross-site) and 404 (extension, or outside every allowed root) are the
            // guard's answers, and it deliberately does not distinguish "outside the roots" from
            // "does not exist" — so neither does this.
            return Err(BridgeError::not_found(format!(
                "Tendril will not serve '{path}' ({status})"
            )));
        }

        if resp
            .content_length()
            .is_some_and(|len| len > MAX_PREVIEW_BYTES)
        {
            return Err(BridgeError::validation(format!(
                "'{path}' is too large to preview"
            )));
        }

        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.split(';').next().unwrap_or(value).trim().to_string())
            .unwrap_or_default();
        // The route only serves the extensions in its allowlist, so this is always an image or a PDF.
        // It is checked anyway: the media type goes into a `data:` URL the webview will load, and
        // nothing else belongs there.
        if !content_type.starts_with("image/") && content_type != "application/pdf" {
            return Err(BridgeError::validation(format!(
                "'{path}' is not a previewable file"
            )));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|err| BridgeError::from(err.without_url()))?;
        if bytes.len() as u64 > MAX_PREVIEW_BYTES {
            return Err(BridgeError::validation(format!(
                "'{path}' is too large to preview"
            )));
        }

        Ok(format!(
            "data:{content_type};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        ))
    }
}

/// Where a job's `suffix` artifact is on this machine, or `None` when it was never written.
///
/// The daemon does not publish these paths, so they are resolved with the daemon's own lookup —
/// `tendril_core::jobs::logger::find_log_file`, which knows both the `Logs/Jobs/<id><suffix>` layout and
/// the prefixed variants it also has to find. Resolving them by hand here would be a second copy of a
/// layout that is not this crate's to know.
///
/// Only an existing file is reported: a debug panel offering a path to a log that was never created
/// sends the reader to an empty `tail`.
fn job_artifact_path(job_id: &str, suffix: &str) -> Option<String> {
    let home = crate::daemon::resolve_tendril_home();
    tendril_core::jobs::logger::find_log_file(&home, job_id, suffix)
        .map(|path| path.to_string_lossy().to_string())
}

/// The 5-digit plan id a job's `planFile` names, or `None` if it names no plan.
///
/// `planFile` is whatever the dispatch passed, so it is a bare id (`00681`) as often as a folder name
/// (`00610-PortTunnelAndShareSubsys`), and occasionally an absolute path. Only the leading digit run
/// matters, zero-padded to five so it compares equal to `PlanSummary.id`.
///
/// Empty is `None` rather than `Some("00000")`: a CreatePlan job holds no plan until it has made one,
/// and a job claiming to hold plan zero would be filtered against a plan that cannot exist.
pub(crate) fn plan_id_from_folder(plan_file: &str) -> Option<String> {
    let name = plan_file
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(plan_file)
        .trim();
    let digits: String = name.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    Some(format!("{:0>5}", digits.parse::<u32>().ok()?))
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
