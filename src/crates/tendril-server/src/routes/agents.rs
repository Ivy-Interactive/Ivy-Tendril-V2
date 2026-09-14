use axum::response::IntoResponse;
use axum::Json;
use tendril_core::agents::catalog::all_agents;

/// Returns the agent catalog the chat picker is built from: every agent, the models it accepts
/// and the effort levels its CLI understands.
pub async fn get_agents_handler() -> impl IntoResponse {
    Json(all_agents())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::response::Response;

    async fn body_json(response: Response) -> serde_json::Value {
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn serves_the_catalog_as_camel_cased_json() {
        let agents = body_json(get_agents_handler().await.into_response()).await;
        let agents = agents.as_array().expect("expected an array of agents");

        assert!(!agents.is_empty());
        let claude = agents
            .iter()
            .find(|agent| agent["id"] == "claude")
            .expect("claude should be in the catalog");

        assert_eq!(claude["label"], "Claude");
        assert_eq!(claude["supportsEffort"], true);
        assert_eq!(claude["models"][0]["id"], "default");
        assert_eq!(claude["models"][0]["displayName"], "Default");
        assert!(claude["efforts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|effort| effort["id"] == "high"));
    }
}
