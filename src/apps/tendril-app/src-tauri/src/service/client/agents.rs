//! Agent queries, the provider model catalog, and per-agent connectivity and usage.

use super::{urlencoding, TendrilClient};
use crate::error::BridgeError;
use crate::models::{AgentOptionDto, ModelCatalogStatusDto};

impl TendrilClient {
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

    /// Runs V1's Test Agent checks against one agent, via `POST /api/agents/{agent}/test`.
    ///
    /// The generous client timeout this inherits is load-bearing: the daemon gives Claude and
    /// Copilot thirty seconds per model, so a three-model test on a slow provider legitimately runs
    /// past a minute. A transport timeout here would report "the service is down" for an agent that
    /// is merely thinking.
    pub async fn test_agent(
        &self,
        agent: &str,
        request: serde_json::Value,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/agents/{}/test", self.base_url, urlencoding(agent));
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
            // The daemon redacts credentials from everything this route produces, so the body is
            // safe to carry through - and a stale daemon predating the route answers 404, which is
            // the one failure the operator can actually act on.
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::with_details(
                "TEST_AGENT_FAILED",
                format!("The service could not test this agent ({status})"),
                text,
            ));
        }

        Ok(resp.json().await?)
    }

    /// The rate-limit windows behind the settings pane's usage strip.
    ///
    /// `Ok(null)` for an agent whose provider publishes no usage. That is the common case for four
    /// of the seven agents and is not an error.
    pub async fn get_agent_usage(&self, agent: &str) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/agents/{}/usage", self.base_url, urlencoding(agent));
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_AGENT_USAGE_FAILED",
                format!("Failed to read agent usage ({status}): {text}"),
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

    /// How to install and sign in to each agent, via `GET /api/agents/hints`.
    ///
    /// Passed through as `serde_json::Value` rather than a typed DTO for the same reason
    /// `test_agent` is: the shape is the daemon's, the webview is what renders it, and a redeclared
    /// struct here would be a third copy of the thing this endpoint exists to stop duplicating.
    pub async fn get_agent_hints(&self) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/agents/hints", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_AGENT_HINTS_FAILED",
                format!("Failed to read agent hints ({status}): {text}"),
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
}
