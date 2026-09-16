//! `tendril hash-password` end-to-end, through the real binary.
//!
//! This is the command that produces the two values a user pastes into `config.yaml`'s `auth` block,
//! so the contract is security-relevant on three counts, and each gets a test here:
//!
//! 1. The printed hash must be verifiable by the server's verifier under the printed pepper, and by
//!    nothing else — a hash the daemon cannot verify locks the user out of their own instance.
//! 2. The encoded parameters must stay `$argon2i$v=19$m=65536,t=3,p=1$`, because the original C# app
//!    (and every hash already on disk) reads them back out of the string.
//! 3. Both values must reach stdout. The pepper is Argon2's secret input and is deliberately *not*
//!    part of the PHC string, so a user who only copies the hash can never log in again.
//!
//! The salt is random per invocation, so "reproducible" here means "verifies under the same
//! password and pepper", not "byte-identical" — see [`the_same_password_and_secret_stay_verifiable`].
//! The byte-for-byte determinism check (same salt, same secret, same output as the C# app) lives with
//! the golden vector in `src/commands/hash_password.rs`, where the salt can be pinned.
//!
//! Every invocation gets its own temp `--home`, even though this command reads nothing from it: the
//! ambient `TENDRIL_HOME` on a developer machine points at a real installation.

use std::path::PathBuf;
use std::process::Command;
use tendril_core::auth::password::verify_password;

/// A base64 pepper used where an explicit one is wanted. Any 32 bytes will do; this is the same
/// value the golden vector in `hash_password.rs` uses, so the two tests talk about the same pepper.
const EXPLICIT_SECRET: &str = "R29sZGVuVmVjdG9yU2VjcmV0S2V5Rm9yVGVuZHJpbDEyMw==";
const PASSWORD: &str = "correct horse battery staple";

/// A throwaway `--home`, removed on drop. Created empty and never populated: part of the contract is
/// that hashing a password touches no state at all.
struct Fixture {
    home: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let home = std::env::temp_dir().join(format!(
            "tendril-cli-hash-password-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        assert!(home.starts_with(std::env::temp_dir()));
        std::fs::create_dir_all(&home).expect("create fixture home");
        Self { home }
    }

    /// Runs `tendril --home <fixture> hash-password <args...>`.
    fn run(&self, args: &[&str]) -> (bool, String, String) {
        let output = Command::new(env!("CARGO_BIN_EXE_tendril"))
            .arg("--home")
            .arg(&self.home)
            .arg("hash-password")
            .args(args)
            // The ambient value points at a real home; `--home` already wins, but leaving it set
            // would make that the only thing keeping this test off it.
            .env_remove("TENDRIL_HOME")
            .env_remove("TENDRIL_CONFIG")
            .output()
            .expect("run tendril hash-password");

        (
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).to_string(),
            String::from_utf8_lossy(&output.stderr).to_string(),
        )
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.home.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

/// The hash and the pepper, pulled out of the command's four printed blocks.
struct Printed {
    phc: String,
    secret: String,
}

/// Parses stdout, asserting the exact shape as it goes. Anything that reads this output by line
/// number — the security setup view did in V1 — depends on this layout.
fn parse(stdout: &str) -> Printed {
    let lines: Vec<&str> = stdout.lines().collect();
    assert_eq!(lines.len(), 5, "unexpected output shape: {:?}", lines);
    assert_eq!(lines[0], "Password hash:");
    assert_eq!(lines[2], "", "a blank line separates the two blocks");
    assert_eq!(lines[3], "Hash secret (if newly generated):");
    assert!(
        stdout.ends_with('\n'),
        "the last value must be newline terminated so a shell `$(...)` capture is clean"
    );

    Printed {
        phc: lines[1].to_string(),
        secret: lines[4].to_string(),
    }
}

fn hash(fixture: &Fixture, args: &[&str]) -> Printed {
    let (ok, stdout, stderr) = fixture.run(args);
    assert!(ok, "hash-password failed: {}{}", stdout, stderr);
    assert_eq!(stderr, "", "nothing belongs on stderr on success");
    parse(&stdout)
}

/// The printed pair has to be usable as `auth.password` + `auth.hashSecret`, which means the
/// server's verifier — the one the login route calls — accepts it.
#[test]
fn the_printed_pair_verifies_and_only_that_pair_does() {
    let fixture = Fixture::new("verifies");
    let printed = hash(&fixture, &[PASSWORD]);

    assert!(
        verify_password(&printed.phc, PASSWORD, &printed.secret),
        "the printed hash must verify under the printed pepper"
    );
    assert!(
        !verify_password(&printed.phc, "not-the-password", &printed.secret),
        "a wrong password must not verify"
    );

    // The pepper is Argon2's secret key, so the hash is worthless without exactly the right one.
    let other = hash(&fixture, &[PASSWORD]);
    assert!(
        !verify_password(&printed.phc, PASSWORD, &other.secret),
        "the wrong pepper must not verify: this is why both values have to be stored"
    );
    assert!(
        !verify_password(&printed.phc, PASSWORD, ""),
        "an empty pepper must not verify either"
    );
}

/// Both values are printed, and neither can be recovered from the other. A user who copies only the
/// hash into `config.yaml` has locked themselves out, which is why the pepper is on stdout at all.
#[test]
fn both_values_are_printed_because_the_pepper_is_not_part_of_the_hash() {
    let fixture = Fixture::new("both-values");
    let printed = hash(&fixture, &[PASSWORD]);

    assert!(!printed.phc.is_empty() && !printed.secret.is_empty());
    assert!(
        !printed.phc.contains(&printed.secret),
        "the pepper must not be embedded in the PHC string: {}",
        printed.phc
    );
    // Nor is the plaintext anywhere in the output.
    assert!(
        !printed.phc.contains(PASSWORD) && !printed.secret.contains(PASSWORD),
        "the plaintext password must not appear in the output"
    );

    // The salt inside the PHC string is not the pepper: 16 base64 characters' worth, not 44.
    let salt = printed
        .phc
        .split('$')
        .nth(4)
        .expect("the PHC string has a salt");
    assert_ne!(salt, printed.secret.trim_end_matches('='));
}

/// With an explicit pepper the pepper is echoed back unchanged and the hash stays verifiable, run
/// after run. The hash itself is *not* byte-stable, because each run draws a fresh salt — a repeated
/// salt across runs would be the bug.
#[test]
fn the_same_password_and_secret_stay_verifiable() {
    let fixture = Fixture::new("explicit-secret");

    let first = hash(&fixture, &[PASSWORD, EXPLICIT_SECRET]);
    let second = hash(&fixture, &[PASSWORD, EXPLICIT_SECRET]);

    assert_eq!(
        first.secret, EXPLICIT_SECRET,
        "a supplied pepper is echoed back verbatim, so the caller can see what was used"
    );
    assert_eq!(second.secret, EXPLICIT_SECRET);

    assert!(verify_password(&first.phc, PASSWORD, EXPLICIT_SECRET));
    assert!(verify_password(&second.phc, PASSWORD, EXPLICIT_SECRET));
    assert!(
        verify_password(&second.phc, PASSWORD, &first.secret),
        "re-running with the same pepper produces a hash the same config verifies"
    );

    assert_ne!(
        first.phc, second.phc,
        "each run must draw a fresh random salt; identical hashes would mean it does not"
    );
    let salt = |phc: &str| phc.split('$').nth(4).unwrap_or_default().to_string();
    assert_ne!(salt(&first.phc), salt(&second.phc), "the salt is per-run");
}

/// With no pepper argument a fresh 32-byte one is generated, and a fresh one every time.
#[test]
fn a_generated_pepper_is_32_random_bytes_and_differs_between_runs() {
    use base64::Engine;

    let fixture = Fixture::new("generated-secret");
    let mut seen: Vec<String> = Vec::new();

    for _ in 0..5 {
        let printed = hash(&fixture, &[PASSWORD]);

        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&printed.secret)
            .expect("the printed pepper is standard padded base64");
        assert_eq!(bytes.len(), 32, "pepper: {}", printed.secret);
        assert_eq!(
            printed.secret.len(),
            44,
            "32 bytes are 44 padded characters: {}",
            printed.secret
        );
        assert!(printed.secret.ends_with('='), "{}", printed.secret);

        assert!(
            !seen.contains(&printed.secret),
            "a generated pepper repeated across runs: {}",
            printed.secret
        );
        seen.push(printed.secret);
    }
}

/// The parameters the original C# app reads back out of the string. Changing any of them stops
/// `Ivy.Tendril` verifying hashes this command writes, so they are a compatibility contract.
#[test]
fn the_encoded_hash_carries_the_parameters_the_original_app_expects() {
    let fixture = Fixture::new("parameters");

    for args in [vec![PASSWORD], vec![PASSWORD, EXPLICIT_SECRET]] {
        let printed = hash(&fixture, &args);

        assert!(
            printed.phc.starts_with("$argon2i$v=19$m=65536,t=3,p=1$"),
            "unexpected parameters: {}",
            printed.phc
        );
        // `$argon2i$v=..$m=..$salt$hash` is a leading empty segment plus five fields.
        let fields: Vec<&str> = printed.phc.split('$').collect();
        assert_eq!(fields.len(), 6, "unexpected segment count: {}", printed.phc);
        assert_eq!(fields[0], "");
        assert_eq!(fields[1], "argon2i", "argon2i, not argon2id or argon2d");

        // 16-byte salt and 32-byte output, unpadded base64 as PHC requires.
        assert_eq!(fields[4].len(), 22, "16-byte salt: {}", printed.phc);
        assert_eq!(fields[5].len(), 43, "32-byte hash: {}", printed.phc);
        assert!(
            !fields[4].contains('=') && !fields[5].contains('='),
            "the PHC salt and digest are unpadded base64: {}",
            printed.phc
        );
    }
}

/// A password with characters a shell or YAML would treat specially still round-trips.
#[test]
fn awkward_passwords_round_trip() {
    let fixture = Fixture::new("awkward");

    for password in [
        "with spaces and 'quotes' and \"more\"",
        "unicode: pässwörd — 密码",
        "$argon2i$looks-like-a-hash",
        "%TENDRIL_HOME%",
        "-",
    ] {
        let printed = hash(&fixture, &["--", password]);
        assert!(
            verify_password(&printed.phc, password, &printed.secret),
            "{} did not round-trip",
            password
        );
        assert!(
            !verify_password(&printed.phc, "something else", &printed.secret),
            "{} verified the wrong plaintext",
            password
        );
    }
}

/// A pepper that is not base64 cannot be decoded, and hashing with a silently-wrong key would write
/// a hash nothing can ever verify. So it fails, before anything reaches stdout.
#[test]
fn a_pepper_that_is_not_base64_fails_without_printing_a_hash() {
    let fixture = Fixture::new("bad-secret");

    let (ok, stdout, stderr) = fixture.run(&[PASSWORD, "not base64 !!!"]);
    assert!(
        !ok,
        "a bad pepper must exit non-zero, got stdout: {}",
        stdout
    );
    assert!(
        stdout.is_empty(),
        "no half-written pair may reach stdout: {}",
        stdout
    );
    assert!(
        stderr.contains("base64"),
        "the error says what is wrong: {}",
        stderr
    );
}

/// Surrounding whitespace is trimmed, because the pepper is usually pasted out of a config file.
#[test]
fn a_pepper_is_trimmed_before_use() {
    let fixture = Fixture::new("trim");
    let padded = format!("  {}\n", EXPLICIT_SECRET);

    let printed = hash(&fixture, &[PASSWORD, &padded]);
    assert_eq!(printed.secret, EXPLICIT_SECRET, "the echo is trimmed too");
    assert!(
        verify_password(&printed.phc, PASSWORD, EXPLICIT_SECRET),
        "the untrimmed and trimmed peppers must hash to the same thing"
    );
}

/// Hashing is a pure function of its arguments: no config is read, no database is opened, nothing is
/// written. A user runs this before the home exists, and it must not create half of one.
#[test]
fn nothing_in_the_tendril_home_is_touched() {
    let fixture = Fixture::new("no-side-effects");
    let _ = hash(&fixture, &[PASSWORD]);

    let entries: Vec<String> = std::fs::read_dir(&fixture.home)
        .expect("the fixture home exists")
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    assert!(
        entries.is_empty(),
        "hash-password must not write to the home: {:?}",
        entries
    );

    // Nor does it need one to exist.
    let missing = fixture.home.join("never-created");
    let output = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .arg("--home")
        .arg(&missing)
        .args(["hash-password", PASSWORD])
        .env_remove("TENDRIL_HOME")
        .output()
        .expect("run tendril hash-password");
    assert!(output.status.success(), "a missing home is not an error");
    assert!(!missing.exists(), "and it is not created either");
}

/// An empty password produces a hash that nothing can ever verify, so it locks the user out of their
/// own instance: `AuthConfig::is_active` only looks at whether `auth.password` and `auth.hashSecret`
/// are non-empty, so the hash *does* switch authentication on, but
/// `verify_password_with_secret` refuses an empty plaintext up front and every login therefore fails.
///
/// Ignored because it asserts the behaviour this command *should* have, not the behaviour it has:
/// today `tendril hash-password ""` exits 0 and prints a usable-looking pair. The fix is a guard in
/// `handle_hash_password` refusing an empty password; it is left out here so that changing the
/// command's exit codes stays a deliberate decision rather than a side effect of adding tests.
#[test]
#[ignore = "product bug: an empty password is hashed happily and yields a config nobody can log into"]
fn an_empty_password_is_refused() {
    let fixture = Fixture::new("empty-password");

    let (ok, stdout, stderr) = fixture.run(&["--", ""]);
    assert!(
        !ok,
        "an empty password must not produce a hash: {}{}",
        stdout, stderr
    );
    assert!(
        stdout.is_empty(),
        "no pair may be printed for an empty password: {}",
        stdout
    );

    // The verifier's side of the same fact, which holds today: whatever is printed for an empty
    // password cannot be verified, so the config it produces is unusable.
    let printed = hash(&fixture, &["--", ""]);
    assert!(
        !verify_password(&printed.phc, "", &printed.secret),
        "an empty password is not verifiable, which is why hashing one is pointless"
    );
}

#[test]
fn the_password_argument_is_required() {
    let fixture = Fixture::new("usage");

    let (ok, stdout, stderr) = fixture.run(&[]);
    assert!(!ok, "a missing password must be a usage error: {}", stdout);
    assert!(
        stderr.contains("PASSWORD"),
        "the usage error names the argument: {}",
        stderr
    );

    // A third positional is not a second pepper or a typo to ignore.
    let (ok, _, _) = fixture.run(&[PASSWORD, EXPLICIT_SECRET, "extra"]);
    assert!(!ok, "an unexpected third argument must be rejected");
}

/// `--help` has to explain that both printed values need storing, because the pepper's absence from
/// the hash is the one thing about this command that is not self-evident.
#[test]
fn help_explains_that_both_values_must_be_stored() {
    let output = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .args(["hash-password", "--help"])
        .env_remove("TENDRIL_HOME")
        .output()
        .expect("run tendril hash-password --help");
    assert!(output.status.success());

    let help = String::from_utf8_lossy(&output.stdout);
    for expected in ["auth.password", "auth.hashSecret", "Argon2i"] {
        assert!(
            help.contains(expected),
            "--help omits {}: {}",
            expected,
            help
        );
    }
}
