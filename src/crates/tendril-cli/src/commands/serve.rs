use std::path::Path;

pub async fn handle_serve(
    tendril_home: &Path,
    port: u16,
    host: Option<String>,
) -> anyhow::Result<()> {
    tendril_server::run_server(port, tendril_home.to_path_buf(), host).await
}
