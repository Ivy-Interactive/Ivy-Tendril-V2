use crate::state::AppState;
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::sync::Arc;

pub async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    req: Request,
    next: Next,
) -> Response {
    let mut authenticated = false;

    if let Some(auth_val) = req.headers().get(axum::http::header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_val.to_str() {
            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                if token == state.secret {
                    authenticated = true;
                }
            }
        }
    }

    // For WebSocket /api/ws, also support ?token=<secret> query parameter
    if !authenticated && req.uri().path() == "/api/ws" {
        if let Some(query) = req.uri().query() {
            for param in query.split('&') {
                if let Some((k, v)) = param.split_once('=') {
                    if k == "token" && v == state.secret {
                        authenticated = true;
                        break;
                    }
                }
            }
        }
    }

    if authenticated {
        next.run(req).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "Unauthorized",
                "message": "Missing or invalid bearer token"
            })),
        )
            .into_response()
    }
}
