use crate::models::PlanYaml;

/// The `?field=` names supported by `GET /api/plans/:id` and `tendril plan get <id> <field>`,
/// matching the original Tendril's `PlanFieldAccessors.Getters` set. `id` is a V2 extra that
/// lives on `PlanMetadata` rather than in `plan.yaml`, so it is resolved by the caller instead
/// of here.
pub const SUPPORTED_PLAN_FIELDS: &[&str] = &[
    "id",
    "title",
    "state",
    "project",
    "level",
    "created",
    "updated",
    "executionProfile",
    "initialPrompt",
    "sourceUrl",
    "priority",
    "partialDelivery",
    // The list fields. Each renders one item per line, so a caller can pipe them into `grep`/`wc`,
    // which is exactly what the CreatePr, CreatePlan and RetryPlan promptwares do.
    "repos",
    "prs",
    "commits",
    "verifications",
    "dependsOn",
    "relatedPlans",
    "recommendations",
];

/// Resolves a case-insensitive `?field=` name against `plan.yaml`. Returns `None` for an
/// unrecognised field (including `id`, which the caller must resolve separately) so the caller
/// can distinguish "unknown field" from "field present but empty".
pub fn get_plan_field(plan: &PlanYaml, field: &str) -> Option<String> {
    match field.to_ascii_lowercase().as_str() {
        "title" => Some(plan.title.clone()),
        "state" => Some(plan.state.clone()),
        "project" => Some(plan.project.clone()),
        "level" => Some(plan.level.clone()),
        "created" => Some(plan.created.to_rfc3339()),
        "updated" => Some(plan.updated.to_rfc3339()),
        "executionprofile" => Some(plan.execution_profile.clone().unwrap_or_default()),
        "initialprompt" => Some(plan.initial_prompt.clone().unwrap_or_default()),
        "sourceurl" => Some(plan.source_url.clone().unwrap_or_default()),
        "priority" => Some(plan.priority.to_string()),
        "partialdelivery" => Some(plan.partial_delivery.to_string()),

        // One item per line. An empty list is an empty string, which is distinct from the `None`
        // that means "no such field" — `CreatePr` reads `verifications` to decide whether the plan
        // can be completed, so "no failing gates" and "I do not know that field" must not look
        // alike. Formats are V1's: bare values, except the two `Name=Status` pairs.
        "repos" => Some(plan.repos.join("\n")),
        "prs" => Some(plan.prs.join("\n")),
        "commits" => Some(plan.commits.join("\n")),
        "verifications" => Some(
            plan.verifications
                .iter()
                .map(|v| format!("{}={}", v.name, v.status))
                .collect::<Vec<_>>()
                .join("\n"),
        ),
        "dependson" => Some(plan.depends_on.join("\n")),
        "relatedplans" => Some(plan.related_plans.join("\n")),
        "recommendations" => Some(
            plan.recommendations
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|r| format!("{}={}", r.title, r.state))
                .collect::<Vec<_>>()
                .join("\n"),
        ),

        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_some_for_every_supported_field_except_id() {
        let plan = PlanYaml::default();
        for field in SUPPORTED_PLAN_FIELDS {
            if *field == "id" {
                continue;
            }
            assert!(
                get_plan_field(&plan, field).is_some(),
                "expected Some for field '{}'",
                field
            );
        }
    }

    #[test]
    fn returns_none_for_unknown_field() {
        let plan = PlanYaml::default();
        assert_eq!(get_plan_field(&plan, "bogus"), None);
    }

    #[test]
    fn renders_partial_delivery_and_priority_on_default_plan() {
        let plan = PlanYaml::default();
        assert_eq!(
            get_plan_field(&plan, "partialDelivery"),
            Some("false".to_string())
        );
        assert_eq!(get_plan_field(&plan, "priority"), Some("0".to_string()));
    }

    #[test]
    fn field_lookup_is_case_insensitive() {
        let plan = PlanYaml::default();
        assert_eq!(
            get_plan_field(&plan, "partialdelivery"),
            get_plan_field(&plan, "partialDelivery")
        );
    }
}
