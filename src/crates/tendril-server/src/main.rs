use clap::Parser;
use std::path::PathBuf;
use tendril_core::config::get_default_tendril_home;

#[derive(Parser)]
#[command(name = "tendril-server", about = "Tendril API Server Daemon")]
struct ServerCli {
    #[arg(short, long, default_value = "5010", env = "PORT")]
    port: u16,

    #[arg(long, default_value = "127.0.0.1", env = "HOST")]
    host: String,

    #[arg(long, env = "TENDRIL_HOME")]
    home: Option<PathBuf>,

    /// PEM certificate; serves HTTPS instead of HTTP. `tendril generate-certs` writes a pair.
    #[arg(long, value_name = "PATH", requires = "tls_key")]
    tls_cert: Option<PathBuf>,

    /// PEM private key matching --tls-cert.
    #[arg(long, value_name = "PATH", requires = "tls_cert")]
    tls_key: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let cli = ServerCli::parse();
    let tendril_home = cli.home.unwrap_or_else(get_default_tendril_home);

    // `requires` on each flag already rejects one without the other.
    let tls = match (cli.tls_cert, cli.tls_key) {
        (Some(cert), Some(key)) => Some(tendril_server::TlsOptions { cert, key }),
        _ => None,
    };

    println!(
        "Starting Tendril-Service on {}:{} (Home: {})",
        cli.host,
        cli.port,
        tendril_home.display()
    );

    tendril_server::run_server(cli.port, tendril_home, Some(cli.host), tls).await
}
