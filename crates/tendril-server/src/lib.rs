pub mod auth;
pub mod master;
pub mod routes;
pub mod state;

pub use auth::*;
pub use master::*;
pub use routes::*;
pub use state::*;

use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;

pub async fn run_server(
    port: u16,
    tendril_home: PathBuf,
    host: Option<String>,
) -> anyhow::Result<()> {
    let host = host.unwrap_or_else(|| "127.0.0.1".to_string());
    let is_loopback = host == "127.0.0.1" || host == "::1" || host == "localhost";
    if !is_loopback {
        tracing::warn!(
            "Server binding to non-loopback address: {}. External network access is enabled.",
            host
        );
    }

    let secret = tendril_core::config::generate_bearer_secret();
    let state = Arc::new(AppState::new(tendril_home.clone(), secret.clone()));
    let app = create_router(state);

    let addr = format!("{}:{}", host, port);
    let listener = TcpListener::bind(&addr).await?;
    println!(">>> Tendril Server running on http://{}:{}", host, port);

    let _master = MasterGuard::acquire(&tendril_home, port, &secret, &host)?;

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    println!("Shutting down Tendril Server gracefully...");
}
