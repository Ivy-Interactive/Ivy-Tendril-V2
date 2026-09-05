use axum::response::IntoResponse;

pub async fn ping_handler() -> impl IntoResponse {
    "pong"
}
