use tendril_core::config::get_default_tendril_home;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(5010);

    let tendril_home = get_default_tendril_home();
    println!("Starting Tendril-Service on port {} (Home: {})", port, tendril_home.display());

    tendril_server::run_server(port, tendril_home).await
}
