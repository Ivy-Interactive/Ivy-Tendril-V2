//! Typed event contexts, mirroring the original's `ITelemetryService` records.
//!
//! A property set is a compile-time decision, not a loose map: a new event gets a context struct
//! here rather than a caller assembling arbitrary keys. Every field is a count, a duration, an enum
//! name, a version string, a boolean or (via `plan_id`) something the client salts and hashes before
//! it leaves the process — see `docs/TELEMETRY.md` for the classification rules.
//!
//! `plan_id` is deliberately the **raw** plan id in these structs. Call sites pass it in and
//! [`crate::telemetry::Telemetry`] derives `plan_uuid` from it, so the raw counter cannot reach
//! PostHog even from a call site that is unaware of the rule.

/// `app_started`. Emitted once per daemon, after the master lock is held.
#[derive(Debug, Clone)]
pub struct AppStartContext {
    pub version: String,
    pub project_count: i64,
    pub llm_configured: bool,
}

/// `onboarding_completed`. Defined but not wired: V2 has no onboarding flow, so a later plan adds a
/// call site rather than a schema.
#[derive(Debug, Clone)]
pub struct OnboardingCompletedContext {
    pub project_count: i64,
    pub agent: Option<String>,
}

/// `project_created`. Defined but not wired: project creation happens in the CLI process, where no
/// client is installed.
///
/// `stack_hash` is usually `None` — SetupProject assigns it after the project exists.
#[derive(Debug, Clone)]
pub struct ProjectCreatedContext {
    pub repo_count: i64,
    pub stack_hash: Option<String>,
}

/// `job_created`.
#[derive(Debug, Clone)]
pub struct JobCreatedContext {
    pub job_type: String,
    pub agent: Option<String>,
    pub plan_id: Option<String>,
}

/// `job_completed`.
#[derive(Debug, Clone)]
pub struct JobCompletedContext {
    pub job_type: String,
    pub status: String,
    pub duration_seconds: Option<i64>,
    pub agent: Option<String>,
    pub plan_id: Option<String>,
}

/// `plan_created`.
#[derive(Debug, Clone)]
pub struct PlanCreatedContext {
    pub level: String,
    pub duration_seconds: Option<i64>,
    pub agent: Option<String>,
    pub stack_hash: Option<String>,
    pub plan_id: Option<String>,
}

/// `pr_created`.
#[derive(Debug, Clone)]
pub struct PrCreatedContext {
    pub duration_seconds: Option<i64>,
    pub agent: Option<String>,
    pub plan_id: Option<String>,
}

/// `plan_state_transition`.
#[derive(Debug, Clone)]
pub struct PlanStateTransitionContext {
    pub from_state: String,
    pub to_state: String,
    pub plan_id: Option<String>,
}
