#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BridgeError {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
}

impl std::fmt::Display for BridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for BridgeError {}

impl BridgeError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(
        code: impl Into<String>,
        message: impl Into<String>,
        details: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: Some(details.into()),
        }
    }

    pub fn unauthenticated(message: impl Into<String>) -> Self {
        Self::new("UNAUTHENTICATED", message)
    }

    pub fn disconnected(message: impl Into<String>) -> Self {
        Self::new("DISCONNECTED", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("NOT_FOUND", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("INTERNAL_ERROR", message)
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new("VALIDATION_ERROR", message)
    }
}

impl From<reqwest::Error> for BridgeError {
    fn from(err: reqwest::Error) -> Self {
        Self::with_details(
            "HTTP_ERROR",
            format!("HTTP request failed: {err}"),
            err.to_string(),
        )
    }
}

impl From<std::io::Error> for BridgeError {
    fn from(err: std::io::Error) -> Self {
        Self::with_details(
            "IO_ERROR",
            format!("Filesystem I/O failed: {err}"),
            err.to_string(),
        )
    }
}

impl From<serde_json::Error> for BridgeError {
    fn from(err: serde_json::Error) -> Self {
        Self::with_details(
            "JSON_ERROR",
            format!("JSON serialization failed: {err}"),
            err.to_string(),
        )
    }
}
