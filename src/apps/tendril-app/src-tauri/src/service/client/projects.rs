//! Projects and their repositories — the calls that may clone, and so carry their own timeout.

use super::{path_segment, TendrilClient, CLONE_TIMEOUT};
use crate::error::BridgeError;
use crate::models::{CreateProjectDto, ProjectSummaryDto, ReviewActionDto};
use serde_json::json;

impl TendrilClient {
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

    /// Creates a project. A duplicate name comes back as 409, which surfaces here as a
    /// `CREATE_PROJECT_FAILED` error carrying the server's message.
    ///
    /// The shared client's 10s timeout is overridden here because this one route can clone: a repo
    /// given by URL is fetched by the daemon inside this request, and a large one takes minutes. At
    /// 10s the app would report a failure over a clone that then succeeds, leaving a project the UI
    /// says was never created.
    pub async fn create_project(
        &self,
        request: CreateProjectDto,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/projects", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .timeout(CLONE_TIMEOUT)
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

    /// Adds one repository to an existing project, cloning it first when it is a URL
    /// (`POST /api/projects/:name/repos`).
    ///
    /// This has to be the route the settings screen uses, and the alternative is not a style choice.
    /// `PUT /api/config` merges what it is handed and saves it, so a remote added that way is written
    /// into `config.yaml` as the URL itself — which persists any credential the URL carries, and
    /// leaves the project unusable besides, because `resolve_working_directory` only ever picks a
    /// repo whose path is a directory on disk. This route clones first and stores the clone.
    ///
    /// Same `CLONE_TIMEOUT` as [`TendrilClient::create_project`], for the same reason: the clone runs
    /// inside this request and a large repository takes minutes.
    ///
    /// `repo_path` is deliberately absent from the error. The daemon has already put every URL it
    /// mentions through `tendril_core::git::redact_credentials`, so its own message is the safe one
    /// to relay; re-adding the URL here would undo that.
    pub async fn add_project_repo(
        &self,
        project_name: &str,
        repo_path: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!(
            "{}/api/projects/{}/repos",
            self.base_url,
            path_segment(project_name)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .timeout(CLONE_TIMEOUT)
            .json(&json!({ "path": repo_path }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "ADD_PROJECT_REPO_FAILED",
                format!("Failed to add repository ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    /// Renames a project (`PUT /api/projects/:name` with `newName`).
    ///
    /// This route rather than `PUT /api/config`, and not as a matter of taste: `update_config_raw`
    /// merges the `projects` sequence **by name**, so a renamed entry matches nothing and is
    /// appended beside the original — the operator ends up with two projects instead of one
    /// renamed. Only this route renames.
    ///
    /// It also cascades. The daemon rewrites every plan naming the project and updates the Plans,
    /// Jobs and Recommendations tables, none of which `PUT /api/config` would touch. A cascade that
    /// only partly succeeds is logged daemon-side and still answers 200, because the rename itself
    /// did happen; the reply is the renamed project either way.
    ///
    /// 404 when the project is gone, 409 when the new name is taken or the project was renamed out
    /// from under the request, 400 when the name is empty. The daemon's own message is relayed
    /// verbatim — it names projects, never repository URLs.
    pub async fn rename_project(
        &self,
        name: &str,
        new_name: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/projects/{}", self.base_url, path_segment(name));
        let resp = self
            .client
            .put(&url)
            .headers(self.headers())
            .json(&json!({ "newName": new_name }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "RENAME_PROJECT_FAILED",
                format!("Failed to rename project ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    /// Removes a project from `config.yaml` (`DELETE /api/projects/:name`).
    ///
    /// `PUT /api/config` cannot do this at all: omitting a project from the sequence leaves it
    /// exactly as it was, because the merge treats omission as "unchanged" rather than "deleted".
    ///
    /// What this does **not** remove is as important as what it does, and the caller has to say so
    /// before asking: the project's plans, its rows in Plans/Jobs/Recommendations, and any
    /// repository the daemon cloned for it all stay on disk. Only the `config.yaml` entry goes.
    /// [`TendrilClient::delete_project_data`] is the call that removes those.
    pub async fn remove_project(&self, name: &str) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/projects/{}", self.base_url, path_segment(name));
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
                "REMOVE_PROJECT_FAILED",
                format!("Failed to remove project ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    /// Deletes a project and its data (`DELETE /api/projects/:name/data`).
    ///
    /// Everything [`TendrilClient::remove_project`] leaves behind: the plan folders naming the
    /// project, its directory under `<TENDRIL_HOME>/Projects/`, and its Plans/Jobs/Recommendations
    /// rows, with the `config.yaml` entry removed last so a crash partway leaves a project that is
    /// still listed rather than orphaned directories nothing can name.
    ///
    /// `CLONE_TIMEOUT` rather than the shared 10s: this walks the plans directory, cleans a worktree
    /// per plan and then recursively deletes a directory that holds the project's clones. On a large
    /// project that takes minutes, and reporting a failure over a delete that then completes would
    /// leave the operator retrying a project the daemon has already removed.
    ///
    /// The daemon's own message is relayed verbatim. It names projects, plan folders and paths under
    /// `TENDRIL_HOME`, never a repository URL -- so there is no credential in it to redact.
    pub async fn delete_project_data(&self, name: &str) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/projects/{}/data", self.base_url, path_segment(name));
        let resp = self
            .client
            .delete(&url)
            .headers(self.headers())
            .timeout(CLONE_TIMEOUT)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "DELETE_PROJECT_DATA_FAILED",
                format!("Failed to delete project data ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }
}
