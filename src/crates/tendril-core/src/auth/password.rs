//! Argon2 password hashing and verification, parameter-compatible with the original Tendril.
//!
//! The original hashes with Isopoh's `Argon2.Hash` using Argon2**i**, version 19 (`0x13`), `t=3`,
//! `m=65536` KiB, `p=1`, a 16-byte random salt and a 32-byte output, feeding the base64-decoded
//! `auth.hashSecret` in as Argon2's secret key (`K`) — see `AuthPasswordHelper.HashPlaintext`,
//! `HashPasswordCommand` and `SecuritySetupView`. Hashes written by the C# app must keep verifying
//! here, which is what [`verify_password`] guarantees by taking the algorithm, version and
//! parameters from the stored PHC string rather than from these constants.

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::RngCore;

use crate::error::{Result, TendrilError};

/// Memory cost in KiB (`MemoryCost = 65536`).
const MEMORY_COST_KIB: u32 = 65536;
/// Time cost / iterations (`TimeCost = 3`).
const TIME_COST: u32 = 3;
/// Lanes / parallelism (`Lanes = 1`).
const LANES: u32 = 1;
/// Output length in bytes (`HashLength = 32`).
const OUTPUT_LEN: usize = 32;
/// Salt length in bytes, matching `new byte[16]` in the C# hasher.
const SALT_LEN: usize = 16;
/// Length of a freshly generated `hashSecret` in bytes, matching `new byte[32]`.
const HASH_SECRET_LEN: usize = 32;

/// A fresh base64 `hashSecret` (32 random bytes), the port of `AuthPasswordHelper.GenerateSecret`.
pub fn generate_hash_secret() -> String {
    let mut bytes = [0u8; HASH_SECRET_LEN];
    rand::thread_rng().fill_bytes(&mut bytes);
    BASE64.encode(bytes)
}

/// Hashes `plaintext` into a PHC string using the original's Argon2 parameters.
///
/// `hash_secret_b64` is the base64 pepper; an invalid base64 value is an error rather than a silent
/// fallback, because hashing with the wrong key would write a hash nothing can ever verify.
pub fn hash_password(plaintext: &str, hash_secret_b64: &str) -> Result<String> {
    let secret = decode_secret(hash_secret_b64)
        .ok_or_else(|| TendrilError::Config("auth.hashSecret is not valid base64".to_string()))?;

    let params = Params::new(MEMORY_COST_KIB, TIME_COST, LANES, Some(OUTPUT_LEN))
        .map_err(|e| TendrilError::Config(format!("Invalid Argon2 parameters: {e}")))?;
    let hasher = Argon2::new_with_secret(&secret, Algorithm::Argon2i, Version::V0x13, params)
        .map_err(|e| TendrilError::Config(format!("Failed to initialise Argon2: {e}")))?;

    let mut salt_bytes = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt = SaltString::encode_b64(&salt_bytes)
        .map_err(|e| TendrilError::Config(format!("Failed to encode salt: {e}")))?;

    hasher
        .hash_password(plaintext.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| TendrilError::Config(format!("Failed to hash password: {e}")))
}

/// Whether `plaintext` matches the stored PHC hash under the given base64 pepper.
///
/// Every failure path returns `false` and none of them panic — a bad base64 secret, an unparseable
/// or truncated hash, an empty password. The original swallows `FormatException` the same way in
/// `AuthPasswordHelper.StoredHashMatchesPlaintext`, and an auth check is the last place that should
/// be able to take the process down.
pub fn verify_password(phc: &str, plaintext: &str, hash_secret_b64: &str) -> bool {
    if phc.trim().is_empty() || plaintext.is_empty() {
        return false;
    }

    let Some(secret) = decode_secret(hash_secret_b64) else {
        return false;
    };

    let Ok(parsed) = PasswordHash::new(phc) else {
        return false;
    };

    // Algorithm, version and cost parameters come from the stored hash, not from the constants
    // above, so a hash written by the C# app (`$argon2i$v=19$...`) verifies, and so would a future
    // `argon2id` hash written by a newer writer.
    let Ok(algorithm) = Algorithm::try_from(parsed.algorithm) else {
        return false;
    };
    let version = parsed
        .version
        .and_then(|v| Version::try_from(v).ok())
        .unwrap_or(Version::V0x13);
    let Ok(params) = Params::try_from(&parsed) else {
        return false;
    };

    let Ok(verifier) = Argon2::new_with_secret(&secret, algorithm, version, params) else {
        return false;
    };

    verifier
        .verify_password(plaintext.as_bytes(), &parsed)
        .is_ok()
}

/// Base64-decodes a `hashSecret`. An empty secret decodes to an empty key, which is what the
/// original does too (`Convert.FromBase64String("")` yields an empty array) — callers gate on
/// [`crate::config::AuthConfig::is_active`] before it can matter.
fn decode_secret(hash_secret_b64: &str) -> Option<Vec<u8>> {
    BASE64.decode(hash_secret_b64.trim()).ok()
}
