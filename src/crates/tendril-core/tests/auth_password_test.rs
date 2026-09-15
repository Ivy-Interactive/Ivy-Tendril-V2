use tendril_core::auth::password::{generate_hash_secret, hash_password, verify_password};

/// Fixture generated once by the original C# app, so an existing `config.yaml` password keeps
/// working after the port:
///
/// ```text
/// dotnet run --project /Users/rorychatt/git/ivy-tendril/src/Ivy.Tendril -- \
///   hash-password "correct horse battery staple" "7j5qrrWKV+LDtSvw69hJsFL6PAMLoopSw+wwcYaEhbc="
/// ```
const CSHARP_PHC: &str =
    "$argon2i$v=19$m=65536,t=3,p=1$P8t92wX6eex/RAw7oehYUg$DGzy1xumFbKc9jzRsnUyQa9vSz9poA4t3wTVnzdpmiI";
const CSHARP_SECRET: &str = "7j5qrrWKV+LDtSvw69hJsFL6PAMLoopSw+wwcYaEhbc=";
const CSHARP_PASSWORD: &str = "correct horse battery staple";

#[test]
fn test_hash_verify_round_trip() {
    let secret = generate_hash_secret();
    let hash = hash_password("s3cret-pass", &secret).expect("hashing succeeds");

    assert!(verify_password(&hash, "s3cret-pass", &secret));
    assert!(!verify_password(&hash, "s3cret-pas", &secret));
    assert!(!verify_password(&hash, "S3cret-Pass", &secret));
}

/// The pepper really is fed to Argon2 as its secret key (`K`): the same password under a different
/// `hashSecret` must not verify. If the secret were being ignored, this would pass and stolen
/// `config.yaml` hashes would be crackable without it.
#[test]
fn test_same_password_different_hash_secret_fails() {
    let secret_a = generate_hash_secret();
    let secret_b = generate_hash_secret();
    assert_ne!(secret_a, secret_b);

    let hash = hash_password("shared-password", &secret_a).expect("hashing succeeds");

    assert!(verify_password(&hash, "shared-password", &secret_a));
    assert!(!verify_password(&hash, "shared-password", &secret_b));
}

/// Parameter parity with the C# hasher: Argon2i, version 19, m=65536, t=3, p=1.
#[test]
fn test_emitted_phc_matches_original_parameters() {
    let secret = generate_hash_secret();
    let hash = hash_password("whatever", &secret).expect("hashing succeeds");

    assert!(
        hash.starts_with("$argon2i$v=19$m=65536,t=3,p=1$"),
        "unexpected PHC prefix: {hash}"
    );
}

/// The test that proves an existing install's password still works: a hash written by the original
/// C# app verifies here, under the same `hashSecret`.
#[test]
fn test_csharp_generated_hash_verifies() {
    assert!(
        verify_password(CSHARP_PHC, CSHARP_PASSWORD, CSHARP_SECRET),
        "a hash produced by the original app must verify in Rust"
    );
    assert!(!verify_password(
        CSHARP_PHC,
        "wrong password",
        CSHARP_SECRET
    ));
    // Wrong pepper, right password.
    assert!(!verify_password(
        CSHARP_PHC,
        CSHARP_PASSWORD,
        &generate_hash_secret()
    ));
}

#[test]
fn test_malformed_input_returns_false_without_panicking() {
    let secret = generate_hash_secret();
    let valid = hash_password("pw", &secret).expect("hashing succeeds");

    // Empty or whitespace stored hash.
    assert!(!verify_password("", "pw", &secret));
    assert!(!verify_password("   ", "pw", &secret));
    // Empty password.
    assert!(!verify_password(&valid, "", &secret));
    // Not a PHC string at all.
    assert!(!verify_password("not-a-hash", "pw", &secret));
    // Truncated PHC string.
    assert!(!verify_password(
        "$argon2i$v=19$m=65536,t=3,p=1$",
        "pw",
        &secret
    ));
    assert!(!verify_password(&valid[..valid.len() - 8], "pw", &secret));
    // Non-base64 hashSecret.
    assert!(!verify_password(&valid, "pw", "not base64 !!!"));
    // Unknown algorithm.
    assert!(!verify_password(
        "$scrypt$v=19$m=65536,t=3,p=1$c2FsdA$aGFzaA",
        "pw",
        &secret
    ));
}

#[test]
fn test_hash_password_rejects_bad_hash_secret() {
    assert!(hash_password("pw", "not base64 !!!").is_err());
}

#[test]
fn test_generate_hash_secret_is_32_random_bytes() {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    let a = generate_hash_secret();
    let b = generate_hash_secret();
    assert_ne!(a, b);
    assert_eq!(STANDARD.decode(&a).expect("valid base64").len(), 32);
}
