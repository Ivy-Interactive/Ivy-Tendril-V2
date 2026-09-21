//! The accepted values the plan CLI validates its arguments against, and advertises back in its
//! error messages: the states `--state` takes, the `--format` values `plan list` renders, the
//! fields `plan set` can write, and the states `plan cleanup` treats as terminal.
//!
//! They live together because the tests below hold them to each other and to `tendril-core`'s own
//! spellings — a list that drifts from the parser rejects input the parser could in fact honour.

use tendril_core::models::PlanStatus;

/// The plan states `--state`/`--status` accept, in the order `GET /api/plans` reports them in its
/// `supportedStates` list on a 400. Kept in step with `PlanStatus::from_str_loose` by
/// `every_supported_state_parses` below.
pub const SUPPORTED_PLAN_STATES: &[&str] = &[
    "Draft",
    "Creating",
    "Updating",
    "Executing",
    "Completed",
    "Failed",
    "Review",
    "Skipped",
    "Icebox",
    "Blocked",
];

/// The `--format` values `plan list` can render. Anything else is a typo, not a request for the
/// default table.
pub const PLAN_LIST_FORMATS: &[&str] = &["table", "ids", "folders", "json"];

/// The fields `plan set` can write. A subset of
/// [`SUPPORTED_PLAN_FIELDS`](tendril_core::plans::SUPPORTED_PLAN_FIELDS): `id`, `created`,
/// `updated` and the list fields are read-only through `plan set` (the lists have their own
/// `add-*`/`remove-*` verbs), so naming one of those is an error rather than a silent no-op.
pub const SETTABLE_PLAN_FIELDS: &[&str] = &[
    "state",
    "title",
    "level",
    "project",
    "executionProfile",
    "initialPrompt",
    "sourceUrl",
    "priority",
];

/// The plan states `plan cleanup` will destroy worktrees for without `--force`. A plan outside this
/// set may have a running agent inside those worktrees.
pub const TERMINAL_PLAN_STATES: &[PlanStatus] = &[
    PlanStatus::Completed,
    PlanStatus::Failed,
    PlanStatus::Skipped,
    PlanStatus::Icebox,
];

#[cfg(test)]
mod tests {
    use super::*;
    use tendril_core::plans::SUPPORTED_PLAN_FIELDS;

    /// The list the `--state` and `plan set state` errors advertise has to be the list the parser
    /// actually accepts, spelled the way `PlanStatus` spells it. A state that has been added to the
    /// enum but not here would be rejected by a filter that can in fact honour it.
    #[test]
    fn every_supported_state_parses_and_round_trips() {
        for name in SUPPORTED_PLAN_STATES {
            let parsed = PlanStatus::from_str_loose(name)
                .unwrap_or_else(|| panic!("advertised state '{}' does not parse", name));
            assert_eq!(
                parsed.as_str(),
                *name,
                "advertised state '{}' is not the canonical spelling",
                name
            );
        }
    }

    /// `plan set` must not advertise a field `plan get` cannot read back: an agent that writes a
    /// field and then verifies its own write has to be able to.
    #[test]
    fn every_settable_field_is_also_readable() {
        for field in SETTABLE_PLAN_FIELDS {
            assert!(
                SUPPORTED_PLAN_FIELDS
                    .iter()
                    .any(|f| f.eq_ignore_ascii_case(field)),
                "settable field '{}' is not in SUPPORTED_PLAN_FIELDS, so `plan get` would reject it",
                field
            );
        }
    }

    #[test]
    fn terminal_states_are_the_four_states_cleanup_allows() {
        for state in [
            PlanStatus::Draft,
            PlanStatus::Creating,
            PlanStatus::Updating,
            PlanStatus::Executing,
            PlanStatus::Review,
            PlanStatus::Blocked,
        ] {
            assert!(
                !TERMINAL_PLAN_STATES.contains(&state),
                "{:?} is not terminal and must need --force",
                state
            );
        }
        assert_eq!(TERMINAL_PLAN_STATES.len(), 4);
    }
}
