//! `tendril generate-certs` end-to-end, through the real binary.
//!
//! The point of the command is that `tendril serve --tls-cert/--tls-key` can read what it wrote, so
//! these tests parse the files exactly as the TLS listener does (`rustls_pemfile`, the same parser
//! behind `RustlsConfig::from_pem_file`) and check that the certificate and the key belong to each
//! other. No socket is opened and no TLS handshake happens: serving is `serve`'s contract, not this
//! command's.
//!
//! The other half of the contract is the file *format*. Earlier versions wrote a PKCS#12 `.pfx`
//! bundle for Kestrel; rustls cannot read one, so a `.pfx` reappearing here would silently make
//! `--tls-cert` unusable.

use std::path::{Path, PathBuf};
use std::process::Command;

const CERT_FILE: &str = "localhost.crt";
const KEY_FILE: &str = "localhost.key";

/// The names the certificate has to cover: the daemon and its clients are always on the same machine.
const EXPECTED_NAMES: [&str; 3] = ["localhost", "127.0.0.1", "::1"];

/// A throwaway working directory, removed on drop.
struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "tendril-cli-generate-certs-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        assert!(root.starts_with(std::env::temp_dir()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        Self { root }
    }

    fn home(&self) -> PathBuf {
        self.root.join("home")
    }

    /// Runs `tendril --home <fixture> generate-certs <args...>`.
    fn run(&self, args: &[&str]) -> (bool, String, String) {
        let output = Command::new(env!("CARGO_BIN_EXE_tendril"))
            .arg("--home")
            .arg(self.home())
            .arg("generate-certs")
            .args(args)
            // `--home` already wins, but the ambient value points at a real installation.
            .env_remove("TENDRIL_HOME")
            .current_dir(&self.root)
            .output()
            .expect("run tendril generate-certs");

        (
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).to_string(),
            String::from_utf8_lossy(&output.stderr).to_string(),
        )
    }

    fn generate(&self, dir: &Path) -> String {
        let (ok, stdout, stderr) = self.run(&[&dir.to_string_lossy()]);
        assert!(ok, "generate-certs failed: {}{}", stdout, stderr);
        stdout
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.root.starts_with(std::env::temp_dir()));
        // A read-only fixture directory has to be made writable again before it can be removed.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for entry in walkdir::WalkDir::new(&self.root).into_iter().flatten() {
                if entry.file_type().is_dir() {
                    let _ = std::fs::set_permissions(
                        entry.path(),
                        std::fs::Permissions::from_mode(0o700),
                    );
                }
            }
        }
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// The DER bytes behind a PEM file, via the parser the TLS listener uses.
fn cert_der(path: &Path) -> Vec<u8> {
    let mut reader = std::io::BufReader::new(std::fs::File::open(path).expect("open the cert"));
    let certs: Vec<_> = rustls_pemfile::certs(&mut reader)
        .collect::<std::result::Result<_, _>>()
        .expect("the certificate parses as PEM");
    assert_eq!(certs.len(), 1, "exactly one certificate is written");
    certs[0].to_vec()
}

fn key_der(path: &Path) -> Vec<u8> {
    let mut reader = std::io::BufReader::new(std::fs::File::open(path).expect("open the key"));
    let key = rustls_pemfile::private_key(&mut reader)
        .expect("the key parses as PEM")
        .expect("a private key is present");
    key.secret_der().to_vec()
}

/// Both files exist, parse as PEM, and are the only things written.
#[test]
fn writes_exactly_the_pem_pair_and_nothing_else() {
    let fixture = Fixture::new("pair");
    let dir = fixture.root.join("certs");

    fixture.generate(&dir);

    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .expect("the output directory exists")
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    assert_eq!(
        names,
        vec![CERT_FILE.to_string(), KEY_FILE.to_string()],
        "only the PEM pair is written"
    );

    let cert = std::fs::read_to_string(dir.join(CERT_FILE)).unwrap();
    let key = std::fs::read_to_string(dir.join(KEY_FILE)).unwrap();

    assert!(cert.starts_with("-----BEGIN CERTIFICATE-----"), "{}", cert);
    assert!(
        cert.trim_end().ends_with("-----END CERTIFICATE-----"),
        "{}",
        cert
    );
    assert!(
        key.starts_with("-----BEGIN PRIVATE KEY-----"),
        "the key must be unencrypted PKCS#8, which is what rustls reads: {}",
        key.lines().next().unwrap_or_default()
    );
    assert!(
        !key.contains("ENCRYPTED"),
        "an encrypted key cannot be loaded unattended"
    );

    // The bytes come back out through the listener's own parser.
    assert!(!cert_der(&dir.join(CERT_FILE)).is_empty());
    assert!(!key_der(&dir.join(KEY_FILE)).is_empty());
}

/// The certificate covers the three loopback identities a client can use to reach the daemon. A
/// missing one is a handshake failure for whichever URL the client happened to be configured with.
///
/// The subjectAltName values are checked in the DER rather than through an X.509 parser, which would
/// mean a new dependency: a DNS name is stored as its ASCII bytes and an IP address as its raw
/// network-order bytes, so each is a byte pattern that has to be present.
#[test]
fn the_certificate_covers_localhost_and_both_loopback_addresses() {
    let fixture = Fixture::new("names");
    let dir = fixture.root.join("certs");
    fixture.generate(&dir);

    let der = cert_der(&dir.join(CERT_FILE));

    assert!(
        contains(&der, b"localhost"),
        "the DNS name `localhost` is missing from the certificate"
    );
    assert!(
        contains(&der, &[127, 0, 0, 1]),
        "the IPv4 loopback address is missing from the certificate"
    );
    let ipv6_loopback: Vec<u8> = std::iter::repeat_n(0u8, 15).chain([1u8]).collect();
    assert!(
        contains(&der, &ipv6_loopback),
        "the IPv6 loopback address (::1) is missing from the certificate"
    );

    // And nothing beyond loopback: no CA would issue for these, and a wider name would be a mistake
    // rather than a convenience.
    for wider in ["ivy.app", "tendril-api", ".com"] {
        assert!(
            !contains(&der, wider.as_bytes()),
            "the certificate should be loopback-only, found {}",
            wider
        );
    }

    // The command says which names it covered, so a user knows what to trust.
    let stdout = fixture.generate(&dir);
    for name in EXPECTED_NAMES {
        assert!(stdout.contains(name), "stdout omits {}: {}", name, stdout);
    }
}

/// The two files have to be each other's halves. rustls rejects a mismatched pair at load time, which
/// on a real start is a daemon that will not come up; here the shared public key is checked directly.
///
/// A PKCS#8 EC key carries its public point alongside the private scalar, and the certificate carries
/// the same point in its SubjectPublicKeyInfo, so exactly one 65-byte uncompressed point (`0x04` and
/// 64 bytes of coordinates) must appear in both files.
#[test]
fn the_key_belongs_to_the_certificate() {
    let fixture = Fixture::new("pairing");
    let dir = fixture.root.join("certs");
    fixture.generate(&dir);

    let cert = cert_der(&dir.join(CERT_FILE));
    let key = key_der(&dir.join(KEY_FILE));

    let shared = shared_public_points(&key, &cert);
    assert_eq!(
        shared, 1,
        "the key's public point must appear in the certificate exactly once"
    );

    // A second, independent pair must not cross-validate, or the check above proves nothing.
    let other = fixture.root.join("other");
    fixture.generate(&other);
    let other_cert = cert_der(&other.join(CERT_FILE));
    assert_eq!(
        shared_public_points(&key, &other_cert),
        0,
        "each run must generate a fresh key pair"
    );
}

/// How many 65-byte uncompressed EC points in `key` also occur in `cert`.
fn shared_public_points(key: &[u8], cert: &[u8]) -> usize {
    (0..key.len())
        .filter(|start| {
            let window = &key[*start..];
            window.len() >= 65 && window[0] == 0x04 && contains(cert, &window[..65])
        })
        .count()
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// The output is the `serve` invocation a user can copy, with absolute paths, and it says plainly
/// that this is not the `.pfx` earlier versions wrote.
#[test]
fn stdout_hands_back_the_serve_command_to_copy() {
    let fixture = Fixture::new("stdout");
    let dir = fixture.root.join("certs");
    let stdout = fixture.generate(&dir);

    // Canonicalized, because the command canonicalizes and on macOS `/tmp` is a symlink.
    let resolved = std::fs::canonicalize(&dir).expect("canonicalize the output directory");
    assert!(
        stdout.contains(&format!(
            "tendril serve --tls-cert {} --tls-key {}",
            resolved.join(CERT_FILE).display(),
            resolved.join(KEY_FILE).display()
        )),
        "stdout must name the flags `serve` takes, with absolute paths: {}",
        stdout
    );
    assert!(
        stdout.contains(&format!(
            "Successfully generated certificates at: {}",
            resolved.display()
        )),
        "{}",
        stdout
    );
    assert!(
        stdout.contains("not the .pfx bundle earlier versions wrote"),
        "the format change has to be called out: {}",
        stdout
    );
    assert!(
        stdout.contains("self-signed"),
        "a self-signed certificate has to be advertised as one: {}",
        stdout
    );

    // The `.pfx` is a documented non-goal, so make sure none is written.
    assert!(
        !std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().ends_with(".pfx")),
        "no PKCS#12 bundle may be written"
    );
}

/// A directory that does not exist yet is created, including intermediate levels, and a relative path
/// resolves against the working directory.
#[test]
fn a_missing_output_directory_is_created() {
    let fixture = Fixture::new("mkdir");

    let nested = fixture.root.join("a").join("b").join("c");
    assert!(!nested.exists());
    fixture.generate(&nested);
    assert!(nested.join(CERT_FILE).is_file() && nested.join(KEY_FILE).is_file());

    // `generate-certs certs-here` from the fixture root.
    let (ok, stdout, stderr) = fixture.run(&["relative-certs"]);
    assert!(
        ok,
        "a relative output directory failed: {}{}",
        stdout, stderr
    );
    assert!(
        fixture
            .root
            .join("relative-certs")
            .join(CERT_FILE)
            .is_file(),
        "a relative path resolves against the working directory"
    );
}

/// Re-running overwrites the pair rather than failing or leaving a stale half behind.
#[test]
fn a_second_run_replaces_the_pair() {
    let fixture = Fixture::new("overwrite");
    let dir = fixture.root.join("certs");

    fixture.generate(&dir);
    let first = std::fs::read_to_string(dir.join(CERT_FILE)).unwrap();

    fixture.generate(&dir);
    let second = std::fs::read_to_string(dir.join(CERT_FILE)).unwrap();

    assert_ne!(first, second, "a re-run issues a new certificate");
    assert_eq!(
        shared_public_points(
            &key_der(&dir.join(KEY_FILE)),
            &cert_der(&dir.join(CERT_FILE))
        ),
        1,
        "the pair on disk after a re-run is still a matching pair"
    );
}

/// The key is the one file here that must not be world-readable: on a shared machine the default
/// mode hands the daemon's TLS identity to every other account.
#[cfg(unix)]
#[test]
fn the_private_key_is_readable_only_by_its_owner() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = Fixture::new("perms");
    let dir = fixture.root.join("certs");
    fixture.generate(&dir);

    let mode = std::fs::metadata(dir.join(KEY_FILE))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600, "unexpected key mode: {:o}", mode);
}

/// An output directory that cannot be written to is an error naming the path, not a silent success
/// that leaves `serve --tls-cert` pointing at nothing.
#[cfg(unix)]
#[test]
fn an_unwritable_output_directory_fails_with_the_path() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = Fixture::new("unwritable");
    let locked = fixture.root.join("locked");
    std::fs::create_dir_all(&locked).unwrap();
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o500)).unwrap();

    // Root ignores the mode bits, so there is nothing to assert when the suite runs as root.
    if std::fs::write(locked.join(".probe"), b"x").is_ok() {
        eprintln!("skipping: this user can write to a mode-500 directory (running as root?)");
        return;
    }

    // Writing *into* the read-only directory: the directory exists, so `create_dir_all` succeeds and
    // the failure surfaces on the write.
    let (ok, stdout, stderr) = fixture.run(&[&locked.to_string_lossy()]);
    assert!(
        !ok,
        "an unwritable directory must exit non-zero: {}",
        stdout
    );
    assert!(
        stderr.contains(&locked.join(CERT_FILE).display().to_string()),
        "the error names the file it could not write: {}",
        stderr
    );

    // And a directory that cannot even be created fails on creation.
    let child = locked.join("child");
    let (ok, stdout, stderr) = fixture.run(&[&child.to_string_lossy()]);
    assert!(
        !ok,
        "an uncreatable directory must exit non-zero: {}",
        stdout
    );
    assert!(
        stderr.contains("could not create the output directory")
            && stderr.contains(&child.display().to_string()),
        "the error names the directory it could not create: {}",
        stderr
    );
    assert!(
        !child.exists(),
        "nothing is left behind when the directory cannot be made"
    );
}

/// The output directory is required: `generate-certs` with no argument must not quietly pick one.
#[test]
fn the_output_directory_is_required() {
    let fixture = Fixture::new("usage");

    let (ok, stdout, stderr) = fixture.run(&[]);
    assert!(
        !ok,
        "a missing output directory must be a usage error: {}",
        stdout
    );
    assert!(
        stderr.contains("OUTPUT_DIR"),
        "the usage error names the argument: {}",
        stderr
    );
}
