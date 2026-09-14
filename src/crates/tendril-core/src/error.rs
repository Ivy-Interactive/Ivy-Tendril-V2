use thiserror::Error;

#[derive(Error, Debug)]
pub enum TendrilError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("YAML serialization error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Git error: {0}")]
    Git(String),

    #[error("Plan error: {0}")]
    Plan(String),

    #[error("Plan not found: {0}")]
    PlanNotFound(String),

    #[error("Job not found: {0}")]
    JobNotFound(String),

    #[error("Project not found: {0}")]
    ProjectNotFound(String),

    #[error("Plan transition blocked: {0}")]
    TransitionBlocked(String),

    #[error("Dependency unsatisfied: {0}")]
    DependencyUnsatisfied(String),

    /// Another job is already doing something this one would fight over. Maps to HTTP 409.
    #[error("{0}")]
    Conflict(String),

    /// This exact work is already in flight, so the submission is a repeat rather than a new job.
    /// Distinct from [`TendrilError::Conflict`], which is two *different* job types fighting over one
    /// plan, but maps to the same HTTP 409.
    #[error("Duplicate job: {0}")]
    DuplicateJob(String),

    #[error("Config error: {0}")]
    Config(String),

    #[error("Agent error: {0}")]
    Agent(String),

    #[error("Promptware error: {0}")]
    Promptware(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Chat error: {0}")]
    Chat(String),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, TendrilError>;
