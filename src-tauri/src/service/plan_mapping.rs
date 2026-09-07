//! Mapping from the service's `PlanFile` JSON onto the app's plan DTOs.
//!
//! `GET /api/plans` and `GET /api/plans/:id` both return a `PlanFile`
//! (tendril-core `models/plan.rs`), so one mapper serves both and the list and
//! detail views cannot drift apart. The shape matters in detail:
//!
//! * `PlanFile` and `PlanMetadata` carry no `rename_all`, so their fields are
//!   serialized **snake_case** (`latest_revision_content`, `initial_prompt`,
//!   `depends_on`, ...) — not camelCase.
//! * `PlanMetadata.id` is an `i32`, not a string.
//! * `PlanMetadata` has no `priority`, `executionProfile` or `recommendations`.
//!   Those live only in `plan.yaml`, which the response exposes verbatim as
//!   `yaml_raw`, so they are parsed back out of that.

use crate::models::{PlanDetailDto, PlanSummaryDto, PlanVerificationDto, RecommendationDto};
use serde::Deserialize;
use serde_json::Value;

/// The `plan.yaml` fields that `PlanMetadata` drops on the way through the API.
#[derive(Debug, Clone, Default, Deserialize)]
struct PlanYamlExtras {
    #[serde(default)]
    priority: Option<i32>,
    #[serde(rename = "executionProfile", default)]
    execution_profile: Option<String>,
    #[serde(default)]
    recommendations: Option<Vec<RecommendationDto>>,
}

impl PlanYamlExtras {
    fn parse(yaml_raw: Option<&str>) -> Self {
        yaml_raw
            .and_then(|raw| serde_yaml::from_str::<Self>(raw).ok())
            .unwrap_or_default()
    }
}

/// Plan ids are addressed as zero-padded 5-digit strings everywhere in Tendril,
/// but `PlanMetadata.id` is a number. Accept either and normalize.
fn plan_id(metadata: &Value, fallback: &str) -> String {
    if let Some(n) = metadata.get("id").and_then(|v| v.as_i64()) {
        return format!("{n:05}");
    }
    metadata
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn string_field(source: &Value, key: &str) -> Option<String> {
    source
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn string_list(source: &Value, key: &str) -> Vec<String> {
    source
        .get(key)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn verifications(metadata: &Value) -> Vec<PlanVerificationDto> {
    metadata
        .get("verifications")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let name = item.get("name").and_then(|n| n.as_str())?.to_string();
                    let status = item
                        .get("status")
                        .and_then(|s| s.as_str())
                        .unwrap_or("Pending")
                        .to_string();
                    Some(PlanVerificationDto { name, status })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Map one `PlanFile` JSON value to a list-view summary.
///
/// `fallback_id` is used only when the payload has no usable `metadata.id`.
pub fn map_plan_summary(value: &Value, fallback_id: &str) -> PlanSummaryDto {
    let metadata = value.get("metadata").unwrap_or(value);
    let extras = PlanYamlExtras::parse(value.get("yaml_raw").and_then(|v| v.as_str()));

    PlanSummaryDto {
        id: plan_id(metadata, fallback_id),
        title: string_field(metadata, "title").unwrap_or_default(),
        state: string_field(metadata, "state").unwrap_or_else(|| "Draft".to_string()),
        project: string_field(metadata, "project").unwrap_or_default(),
        level: string_field(metadata, "level").unwrap_or_else(|| "Feature".to_string()),
        priority: extras.priority,
        created: string_field(metadata, "created"),
        updated: string_field(metadata, "updated"),
        verifications: verifications(metadata),
    }
}

/// Map one `PlanFile` JSON value to the detail DTO backing `PlanDetailView`.
pub fn map_plan_detail(value: &Value, fallback_id: &str) -> PlanDetailDto {
    let metadata = value.get("metadata").unwrap_or(value);
    let extras = PlanYamlExtras::parse(value.get("yaml_raw").and_then(|v| v.as_str()));

    PlanDetailDto {
        id: plan_id(metadata, fallback_id),
        title: string_field(metadata, "title").unwrap_or_default(),
        state: string_field(metadata, "state").unwrap_or_else(|| "Draft".to_string()),
        project: string_field(metadata, "project").unwrap_or_default(),
        level: string_field(metadata, "level").unwrap_or_else(|| "Feature".to_string()),
        priority: extras.priority,
        execution_profile: extras.execution_profile,
        initial_prompt: string_field(metadata, "initial_prompt"),
        source_url: string_field(metadata, "source_url"),
        created: string_field(metadata, "created"),
        updated: string_field(metadata, "updated"),
        repos: string_list(metadata, "repos"),
        verifications: verifications(metadata),
        depends_on: string_list(metadata, "depends_on"),
        related_plans: string_list(metadata, "related_plans"),
        commits: string_list(metadata, "commits"),
        prs: string_list(metadata, "prs"),
        latest_revision_content: string_field(value, "latest_revision_content"),
        folder_path: string_field(value, "folder_path"),
        revision_count: value
            .get("revision_count")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32,
        recommendations: extras.recommendations.unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A `PlanFile` exactly as `tendril-server` serializes it: snake_case
    /// throughout, numeric `metadata.id`, and `plan.yaml` verbatim in
    /// `yaml_raw`.
    fn plan_file_payload() -> Value {
        json!({
            "metadata": {
                "id": 21,
                "project": "Tendril-App",
                "level": "Feature",
                "title": "Build Desktop Operator Experience",
                "state": "Review",
                "repos": ["/repos/Tendril-App"],
                "commits": ["abc1234", "def5678"],
                "prs": ["https://github.com/SpaceCorps/Tendril-App/pull/2"],
                "verifications": [
                    { "name": "RustClippy", "status": "Pass" },
                    { "name": "RustTest", "status": "Fail" }
                ],
                "related_plans": ["00022-Bootstrap"],
                "depends_on": ["00019-Contract"],
                "created": "2026-09-05T18:20:26Z",
                "updated": "2026-09-07T10:41:11Z",
                "initial_prompt": "Build the operator experience",
                "source_url": "https://github.com/SpaceCorps/Tendril-App/issues/7",
                "partial_delivery": false
            },
            "latest_revision_content": "# Build Desktop Operator Experience\n\n## Problem\n",
            "folder_path": "/home/op/.tendril/Plans/00021-BuildDesktopOperator",
            "folder_name": "00021-BuildDesktopOperator",
            "revision_count": 4,
            "yaml_raw": "state: Review\npriority: 15\nexecutionProfile: deep\nrecommendations:\n  - title: Tauri WebDriver E2E Automation\n    description: Add WebDriver smoke tests.\n    state: Pending\n    impact: Medium\n  - title: Deep Link Protocol Handler\n    description: Register tendril:// links.\n    state: Declined\n    declineReason: Not now\n    impact: Small\n"
        })
    }

    #[test]
    fn maps_numeric_metadata_id_to_zero_padded_plan_id() {
        let detail = map_plan_detail(&plan_file_payload(), "fallback");
        assert_eq!(detail.id, "00021");

        let summary = map_plan_summary(&plan_file_payload(), "fallback");
        assert_eq!(summary.id, "00021");
    }

    #[test]
    fn maps_snake_case_metadata_fields() {
        let detail = map_plan_detail(&plan_file_payload(), "fallback");

        assert_eq!(detail.title, "Build Desktop Operator Experience");
        assert_eq!(detail.state, "Review");
        assert_eq!(
            detail.initial_prompt.as_deref(),
            Some("Build the operator experience")
        );
        assert_eq!(
            detail.source_url.as_deref(),
            Some("https://github.com/SpaceCorps/Tendril-App/issues/7")
        );
        assert_eq!(detail.depends_on, vec!["00019-Contract".to_string()]);
        assert_eq!(detail.related_plans, vec!["00022-Bootstrap".to_string()]);
        assert_eq!(detail.commits.len(), 2);
        assert_eq!(detail.repos, vec!["/repos/Tendril-App".to_string()]);
    }

    #[test]
    fn maps_latest_revision_content_and_revision_count() {
        let detail = map_plan_detail(&plan_file_payload(), "fallback");

        assert_eq!(detail.revision_count, 4);
        assert!(detail
            .latest_revision_content
            .as_deref()
            .unwrap_or_default()
            .starts_with("# Build Desktop Operator Experience"));
        assert_eq!(
            detail.folder_path.as_deref(),
            Some("/home/op/.tendril/Plans/00021-BuildDesktopOperator")
        );
    }

    #[test]
    fn recovers_priority_profile_and_recommendations_from_yaml_raw() {
        let detail = map_plan_detail(&plan_file_payload(), "fallback");

        assert_eq!(detail.priority, Some(15));
        assert_eq!(detail.execution_profile.as_deref(), Some("deep"));
        assert_eq!(detail.recommendations.len(), 2);

        let first = &detail.recommendations[0];
        assert_eq!(first.title, "Tauri WebDriver E2E Automation");
        assert_eq!(first.state, "Pending");
        assert_eq!(first.impact.as_deref(), Some("Medium"));

        let second = &detail.recommendations[1];
        assert_eq!(second.state, "Declined");
        assert_eq!(second.decline_reason.as_deref(), Some("Not now"));

        let summary = map_plan_summary(&plan_file_payload(), "fallback");
        assert_eq!(summary.priority, Some(15));
    }

    #[test]
    fn preserves_verification_statuses_including_fail() {
        let detail = map_plan_detail(&plan_file_payload(), "fallback");

        assert_eq!(detail.verifications.len(), 2);
        assert_eq!(detail.verifications[0].status, "Pass");
        assert_eq!(detail.verifications[1].name, "RustTest");
        assert_eq!(detail.verifications[1].status, "Fail");
    }

    #[test]
    fn tolerates_a_plan_without_recommendations_or_yaml() {
        let payload = json!({
            "metadata": { "id": 7, "title": "Bare", "state": "Draft" },
            "revision_count": 1
        });

        let detail = map_plan_detail(&payload, "00007");
        assert_eq!(detail.id, "00007");
        assert!(detail.recommendations.is_empty());
        assert_eq!(detail.priority, None);
        assert_eq!(detail.revision_count, 1);
        assert!(detail.latest_revision_content.is_none());
    }

    #[test]
    fn falls_back_to_the_requested_id_when_metadata_has_none() {
        let payload = json!({ "metadata": { "title": "No id" } });
        let detail = map_plan_detail(&payload, "00042");
        assert_eq!(detail.id, "00042");
    }
}
