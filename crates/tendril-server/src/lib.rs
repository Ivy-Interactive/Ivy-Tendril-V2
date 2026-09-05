pub mod master;
pub mod routes;
pub mod state;

pub use master::*;
pub use routes::*;
pub use state::*;

use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;

pub async fn run_server(port: u16, tendril_home: PathBuf) -> anyhow::Result<()> {
    let state = Arc::new(AppState::new(tendril_home.clone()));
    let app = create_router(state);

    let addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr).await?;
    println!(">>> Tendril Server running on http://127.0.0.1:{}", port);

    let _master = MasterGuard::acquire(&tendril_home, port, "local-secret")?;

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
        if let Ok(mut sig) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
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

