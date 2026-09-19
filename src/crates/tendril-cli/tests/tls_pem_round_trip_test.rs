//! The seam between `tendril generate-certs` and `tendril serve --tls-cert/--tls-key`.
//!
//! `generate_certs_cli_test` proves the emitted pair parses with `rustls_pemfile` and that the key
//! matches the certificate. That is the format half. This is the *consumer* half: it hands the
//! files to `axum_server::tls_rustls::RustlsConfig::from_pem_file`, the exact call
//! `tendril_server::load_tls_config` makes, so the two crates are pinned against each other rather
//! than each against a parser standing in for the other.
//!
//! Worth its own file because both sides moved at once: rcgen 0.13 -> 0.14 renamed
//! `CertifiedKey::key_pair` to `signing_key` (which is what serialises the key written here), and
//! axum-server 0.7 -> 0.8 swapped `rustls-pemfile` for `rustls-pki-types` underneath
//! `from_pem_file`. Each side's own tests would still pass if the *pair* of them had stopped
//! agreeing on the format, and the failure would surface only as a daemon that refuses to start
//! with TLS.

use std::path::{Path, PathBuf};
use std::process::Command;

const CERT_FILE: &str = "localhost.crt";
const KEY_FILE: &str = "localhost.key";

/// A throwaway working directory, removed on drop.
struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "tendril-cli-tls-round-trip-{}-{}",
            label,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create the fixture root");
        Self { root }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn tendril_bin() -> PathBuf {
    // The integration-test binary sits in target/<profile>/deps, so the CLI is two levels up.
    let mut path = std::env::current_exe().expect("locate the test binary");
    path.pop();
    if path.ends_with("deps") {
        path.pop();
    }
    path.join(if cfg!(windows) {
        "tendril.exe"
    } else {
        "tendril"
    })
}

fn generate_certs_into(dir: &Path) {
    let output = Command::new(tendril_bin())
        .arg("generate-certs")
        .arg(dir)
        .output()
        .expect("run `tendril generate-certs`");
    assert!(
        output.status.success(),
        "generate-certs failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[tokio::test]
async fn the_tls_listener_loads_the_pair_generate_certs_wrote() {
    let fixture = Fixture::new("loads");
    generate_certs_into(&fixture.root);

    // Same install the daemon does before touching `RustlsConfig`; without a process-wide provider
    // `from_pem_file` panics rather than erroring. An `Err` just means someone got here first.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let loaded = axum_server::tls_rustls::RustlsConfig::from_pem_file(
        fixture.root.join(CERT_FILE),
        fixture.root.join(KEY_FILE),
    )
    .await;

    assert!(
        loaded.is_ok(),
        "the TLS listener could not load the pair `generate-certs` wrote: {:?}",
        loaded.err()
    );
}

#[tokio::test]
async fn a_key_from_a_different_pair_is_rejected() {
    // Guards the assertion above against being vacuous: if `from_pem_file` accepted anything, the
    // first test would pass no matter what `generate-certs` emitted.
    let first = Fixture::new("mismatch-a");
    let second = Fixture::new("mismatch-b");
    generate_certs_into(&first.root);
    generate_certs_into(&second.root);

    let _ = rustls::crypto::ring::default_provider().install_default();

    let loaded = axum_server::tls_rustls::RustlsConfig::from_pem_file(
        first.root.join(CERT_FILE),
        second.root.join(KEY_FILE),
    )
    .await;

    assert!(
        loaded.is_err(),
        "a certificate and an unrelated private key were accepted as a pair"
    );
}
