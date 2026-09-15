//! `tendril generate-certs` — writes a self-signed certificate for local HTTPS.
//!
//! The original wrote a PKCS#12 `.pfx` bundle, which is what Kestrel wanted. This writes a PEM pair
//! instead, because that is what rustls — and therefore `tendril serve --tls-cert/--tls-key` — reads.
//! Anything still expecting the `.pfx` has to be pointed at the PEM files.

use anyhow::{Context, Result};
use std::path::Path;

/// Names the certificate is valid for. Loopback only: this is a development certificate for the
/// daemon talking to clients on the same machine, and no CA would issue one for these anyway.
const SUBJECT_ALT_NAMES: [&str; 3] = ["localhost", "127.0.0.1", "::1"];

pub(crate) const CERT_FILE: &str = "localhost.crt";
pub(crate) const KEY_FILE: &str = "localhost.key";

/// Writes `localhost.crt` and `localhost.key` into `output_dir`, creating it if needed, and returns
/// the canonical directory the pair landed in.
pub(crate) fn generate_certs(output_dir: &Path) -> Result<std::path::PathBuf> {
    std::fs::create_dir_all(output_dir).with_context(|| {
        format!(
            "could not create the output directory {}",
            output_dir.display()
        )
    })?;

    let names: Vec<String> = SUBJECT_ALT_NAMES.iter().map(|s| s.to_string()).collect();
    let generated = rcgen::generate_simple_self_signed(names)
        .context("could not generate a self-signed certificate")?;

    let cert_path = output_dir.join(CERT_FILE);
    let key_path = output_dir.join(KEY_FILE);

    std::fs::write(&cert_path, generated.cert.pem())
        .with_context(|| format!("could not write {}", cert_path.display()))?;
    std::fs::write(&key_path, generated.key_pair.serialize_pem())
        .with_context(|| format!("could not write {}", key_path.display()))?;

    // The private key is written world-readable by default, which on a shared machine hands it to
    // every other account. There is no equivalent on Windows, where the file inherits the
    // directory's ACL.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600))
            .with_context(|| format!("could not restrict permissions on {}", key_path.display()))?;
    }

    // Canonicalized so the printed path is unambiguous when the caller passed something relative.
    Ok(std::fs::canonicalize(output_dir).unwrap_or_else(|_| output_dir.to_path_buf()))
}

pub fn handle_generate_certs(output_dir: &Path) -> Result<()> {
    let resolved = generate_certs(output_dir)?;

    println!(
        "Successfully generated certificates at: {}",
        resolved.display()
    );
    println!("  {} — certificate (PEM)", CERT_FILE);
    println!("  {} — private key (PKCS#8 PEM)", KEY_FILE);
    println!();
    println!(
        "This is a PEM pair, not the .pfx bundle earlier versions wrote. Start the server with:\n  \
         tendril serve --tls-cert {} --tls-key {}",
        resolved.join(CERT_FILE).display(),
        resolved.join(KEY_FILE).display()
    );
    println!(
        "The certificate is self-signed and valid for {} only, so clients must be told to trust it.",
        SUBJECT_ALT_NAMES.join(", ")
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("{}-{}", name, uuid::Uuid::new_v4().simple()))
    }

    #[test]
    fn writes_a_pem_pair_into_a_directory_it_creates() {
        let dir = scratch_dir("generate-certs");
        let resolved = generate_certs(&dir.join("nested")).unwrap();

        let cert = std::fs::read_to_string(resolved.join(CERT_FILE)).unwrap();
        let key = std::fs::read_to_string(resolved.join(KEY_FILE)).unwrap();

        assert!(cert.starts_with("-----BEGIN CERTIFICATE-----"));
        assert!(
            key.starts_with("-----BEGIN PRIVATE KEY-----"),
            "the key must be PKCS#8, which is what rustls reads: {}",
            key.lines().next().unwrap_or_default()
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn the_private_key_is_not_readable_by_other_accounts() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch_dir("generate-certs-perms");
        let resolved = generate_certs(&dir).unwrap();

        let mode = std::fs::metadata(resolved.join(KEY_FILE))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600, "unexpected mode: {:o}", mode);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_pair_is_the_one_the_server_would_load() {
        // The point of the command is that `serve --tls-cert/--tls-key` accepts what it wrote, so
        // this parses the files the same way the TLS listener does. No socket is opened.
        let dir = scratch_dir("generate-certs-parse");
        let resolved = generate_certs(&dir).unwrap();

        let certs: Vec<_> = rustls_pemfile::certs(&mut std::io::BufReader::new(
            std::fs::File::open(resolved.join(CERT_FILE)).unwrap(),
        ))
        .collect::<std::result::Result<_, _>>()
        .unwrap();
        assert_eq!(certs.len(), 1);

        let key = rustls_pemfile::private_key(&mut std::io::BufReader::new(
            std::fs::File::open(resolved.join(KEY_FILE)).unwrap(),
        ))
        .unwrap();
        assert!(key.is_some(), "no private key was parsed back out");

        std::fs::remove_dir_all(&dir).ok();
    }
}
