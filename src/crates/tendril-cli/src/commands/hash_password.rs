//! `tendril hash-password` — produces the Argon2 PHC string and pepper that go into
//! `config.yaml`'s `auth` block.
//!
//! The Argon2 parameters are pinned to the ones the original Tendril used (`HashPasswordCommand.cs`:
//! Isopoh `Argon2Type.DataIndependentAddressing`, `Argon2Version.Nineteen`, `TimeCost 3`,
//! `MemoryCost 65536`, `Lanes 1`, 16-byte salt, 32-byte output) — but they live in
//! [`tendril_core::auth::password`], the workspace's single Argon2 implementation, rather than here,
//! so this command and the server's verifier cannot drift apart. Changing them would not break this
//! command (the verifier reads m/t/p and the salt back out of the encoded string) but it would stop
//! new hashes matching what users already have on disk, so treat them as a compatibility contract
//! rather than a tuning knob.

use anyhow::{Context, Result};
use base64::Engine;
use tendril_core::auth::password::{generate_hash_secret, hash_password_with_secret};

/// Standard base64 with padding, matching .NET's `Convert.ToBase64String`.
fn b64() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

/// A fresh 32-byte pepper, base64-encoded — the original's `GenerateSecret`.
pub(crate) fn generate_secret() -> String {
    generate_hash_secret()
}

pub(crate) fn decode_secret(secret: &str) -> Result<Vec<u8>> {
    b64()
        .decode(secret.trim())
        .context("SECRET must be base64 (the form `tendril hash-password` prints)")
}

/// Hashes `password` with `secret` as the Argon2 secret input (pepper). The pepper is deliberately
/// *not* part of the returned PHC string, so it has to be stored separately in `auth.hashSecret`.
pub(crate) fn hash_password(password: &str, secret: &[u8]) -> Result<String> {
    hash_password_with_secret(password, secret).map_err(Into::into)
}

pub fn handle_hash_password(password: &str, secret: Option<&str>) -> Result<()> {
    let secret = match secret {
        Some(s) => s.trim().to_string(),
        None => generate_secret(),
    };
    let secret_bytes = decode_secret(&secret)?;
    let phc = hash_password(password, &secret_bytes)?;

    // The original's four blocks, unchanged: the label says "if newly generated" but the value is
    // always printed, because a caller that supplied one still needs to see what was used.
    println!("Password hash:");
    println!("{}", phc);
    println!();
    println!("Hash secret (if newly generated):");
    println!("{}", secret);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tendril_server::auth::verify_password;

    /// Length of a freshly generated pepper, in bytes. Owned by
    /// [`tendril_core::auth::password::generate_hash_secret`]; asserted here because the printed
    /// value is what users paste into `auth.hashSecret`.
    const SECRET_LEN: usize = 32;

    /// Produced by a throwaway .NET console app running the original's exact `Argon2Config`
    /// (Isopoh.Cryptography.Argon2 2.0.0, the version `Ivy.Tendril` resolves). This is the
    /// cross-implementation check: a hash the original wrote must still validate here, or every
    /// `auth.password` already sitting in a user's `config.yaml` stops working.
    const V1_PASSWORD: &str = "v1-golden-vector-password";
    const V1_SECRET_B64: &str = "R29sZGVuVmVjdG9yU2VjcmV0S2V5Rm9yVGVuZHJpbDEyMw==";
    const V1_PHC: &str = "$argon2i$v=19$m=65536,t=3,p=1$K9UDN6FZZNVlZrOuQHgOuQ$UL4PysO6B9l6SbeMAugIU5ghXmutXzsXp/PZzXsBgFQ";

    #[test]
    fn round_trips_against_the_servers_verifier() {
        let secret = generate_secret();
        let secret_bytes = decode_secret(&secret).unwrap();
        let phc = hash_password("my-test-password", &secret_bytes).unwrap();

        assert!(
            verify_password(&phc, &secret_bytes, "my-test-password"),
            "the hash this command prints must validate through the server's verifier"
        );
        assert!(
            !verify_password(&phc, &secret_bytes, "not-my-test-password"),
            "a wrong password must not validate"
        );
    }

    #[test]
    fn a_different_pepper_does_not_validate() {
        let secret_bytes = decode_secret(&generate_secret()).unwrap();
        let other_bytes = decode_secret(&generate_secret()).unwrap();
        let phc = hash_password("my-test-password", &secret_bytes).unwrap();

        assert!(verify_password(&phc, &secret_bytes, "my-test-password"));
        assert!(
            !verify_password(&phc, &other_bytes, "my-test-password"),
            "the pepper is part of the input, so the wrong one must fail"
        );
    }

    #[test]
    fn the_encoded_form_pins_the_originals_parameters() {
        let secret_bytes = decode_secret(&generate_secret()).unwrap();
        let phc = hash_password("whatever", &secret_bytes).unwrap();

        assert!(
            phc.starts_with("$argon2i$v=19$m=65536,t=3,p=1$"),
            "unexpected encoded form: {}",
            phc
        );
        // `$argon2i$v=19$m=..$salt$hash` splits into a leading empty segment plus five fields.
        assert_eq!(
            phc.split('$').count(),
            6,
            "unexpected segment count: {}",
            phc
        );
    }

    #[test]
    fn a_generated_secret_is_32_bytes_of_padded_base64() {
        let secret = generate_secret();
        assert_eq!(decode_secret(&secret).unwrap().len(), SECRET_LEN);
        assert!(
            secret.ends_with('='),
            "32 bytes encode to 44 padded characters: {}",
            secret
        );
        assert_eq!(secret.len(), 44);
    }

    #[test]
    fn a_secret_that_is_not_base64_is_rejected() {
        assert!(decode_secret("not base64 !!!").is_err());
    }

    #[test]
    fn the_original_implementations_hash_still_validates() {
        let secret_bytes = decode_secret(V1_SECRET_B64).unwrap();
        assert!(
            verify_password(V1_PHC, &secret_bytes, V1_PASSWORD),
            "a hash written by the original must keep validating"
        );
        assert!(!verify_password(V1_PHC, &secret_bytes, "wrong-password"));
    }

    #[test]
    fn the_original_vector_encodes_the_same_parameters_this_command_writes() {
        let secret_bytes = decode_secret(V1_SECRET_B64).unwrap();
        let ours = hash_password(V1_PASSWORD, &secret_bytes).unwrap();
        let prefix = |s: &str| s.rsplitn(3, '$').last().unwrap().to_string();
        assert_eq!(
            prefix(V1_PHC),
            prefix(&ours),
            "our parameter prefix must match the original's byte for byte"
        );
    }
}
