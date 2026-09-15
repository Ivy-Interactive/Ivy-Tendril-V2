use anyhow::{bail, Result};
use std::path::{Path, PathBuf};
use tendril_server::TlsOptions;

pub async fn handle_serve(
    tendril_home: &Path,
    port: u16,
    host: Option<String>,
    tls_cert: Option<PathBuf>,
    tls_key: Option<PathBuf>,
) -> Result<()> {
    let tls = resolve_tls(tls_cert, tls_key)?;
    tendril_server::run_server(port, tendril_home.to_path_buf(), host, tls).await
}

/// A certificate without a key (or the reverse) is a typo, not a request for a plaintext server: it
/// would otherwise silently start one and every https client would fail to connect.
fn resolve_tls(cert: Option<PathBuf>, key: Option<PathBuf>) -> Result<Option<TlsOptions>> {
    match (cert, key) {
        (Some(cert), Some(key)) => Ok(Some(TlsOptions { cert, key })),
        (None, None) => Ok(None),
        (Some(_), None) => bail!("--tls-cert also needs --tls-key"),
        (None, Some(_)) => bail!("--tls-key also needs --tls-cert"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tls_needs_both_paths_or_neither() {
        let cert = || Some(PathBuf::from("localhost.crt"));
        let key = || Some(PathBuf::from("localhost.key"));

        let both = resolve_tls(cert(), key()).unwrap().expect("TLS is enabled");
        assert_eq!(both.cert, PathBuf::from("localhost.crt"));
        assert_eq!(both.key, PathBuf::from("localhost.key"));

        assert!(
            resolve_tls(None, None).unwrap().is_none(),
            "no flags means the plaintext listener, as before"
        );
        assert!(resolve_tls(cert(), None).is_err());
        assert!(resolve_tls(None, key()).is_err());
    }
}
