//! Setting, changing and clearing the session password recorded in `config.yaml`'s `auth:` block.
//!
//! The port of `Apps/Settings/SecuritySetupView.cs`'s Save button — the only place the original writes
//! a credential from the UI. It hashes the new password with Argon2 and assigns
//! `config.Settings.Auth = new AuthConfig { Password = hash, HashSecret = secret }`, and it verifies the
//! *current* password first whenever one is already configured.
//!
//! V1 can do that in-process because its UI and its server are one process. V2's UI is a separate
//! process that must not learn the credential format, so the write lives here and
//! `PUT`/`DELETE /api/auth/password` is its only caller. See `tendril_server::routes::auth`.
//!
//! # What gets written
//!
//! [`crate::auth::password::hash_password`] — the workspace's single Argon2 hasher, parameter-identical
//! to the original's Isopoh call (`argon2i`, `v=19`, `m=65536`, `t=3`, `p=1`, a 16-byte random salt, a
//! 32-byte output, and `auth.hashSecret` fed in as Argon2's secret key `K`). There is deliberately no
//! second hasher here: the hash this writes is the hash `/api/auth/login`, `auth_middleware`'s Basic
//! path and the original C# app all read, and that is only true while there is exactly one
//! implementation of it.
//!
//! Note for anyone reading a spec that says "Argon2id": the original selects
//! `Argon2Type.DataIndependentAddressing`, which is Argon2**i**, and `tendril-cli`'s
//! `hash_password_cli_test` pins the encoded prefix to `$argon2i$v=19$m=65536,t=3,p=1$` precisely so a
//! hash stays readable by both apps. [`crate::auth::password::verify_password`] takes the algorithm out
//! of the stored string rather than from a constant, so an `$argon2id$` hash written by some future
//! writer would still verify — but writing one *here* would be a silent format fork.
//!
//! # Three departures from V1
//!
//! - **The pepper is rotated on every set.** V1 reuses `Auth.HashSecret` when one already exists. That
//!   pepper is also the HS256 signing key for the session tokens `/api/auth/login` issues
//!   (`tendril_server::auth::issue_session_token`), so reusing it would leave every token minted under
//!   the *old* password valid after a change. Rotating it makes changing a password a revocation, which
//!   is the only useful reading of changing a password.
//! - **Every other key in the block survives.** The write is a read-modify-write of the YAML mapping, so
//!   `username`, `rateLimit` and any key this build does not know about are preserved. V1 replaces the
//!   whole `AuthConfig` object and loses anything its DTO does not model.
//! - **Clearing removes the `auth` key outright** rather than leaving an empty block behind, so
//!   [`crate::config::AuthConfig::is_active`] has nothing to be half-true about.
//!
//! Nothing in this module logs, returns or stores a plaintext password, and no error variant echoes
//! what was submitted.

use crate::auth::password::{generate_hash_secret, hash_password, verify_password};
use crate::config::AuthConfig;
use crate::fs_lock::{write_atomic, FileLock};
use std::path::Path;

/// The `auth` key in `config.yaml`.
const AUTH_KEY: &str = "auth";

/// Why a password change was refused.
///
/// Each variant's message is safe to hand to an HTTP client verbatim: none of them distinguishes
/// anything an owner-authenticated caller could not already read from `GET /api/auth/status`, and none
/// quotes the submitted password.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CredentialError {
    /// A password is already configured and the caller did not present it. V1's
    /// `VerifyCurrentPassword` returns `false` for a blank current password when `Auth != null`, which
    /// lands the user on the same refusal.
    #[error("The current password is required to change or clear password protection")]
    CurrentPasswordRequired,

    /// V1's literal `"Current password is incorrect"`.
    #[error("Current password is incorrect")]
    CurrentPasswordIncorrect,

    /// V1's Save button is disabled for a blank new password (`!string.IsNullOrWhiteSpace`), so this is
    /// the same rule expressed as a refusal rather than a disabled control.
    #[error("A new password is required")]
    NewPasswordEmpty,

    /// Clearing when nothing is configured. Reported rather than silently succeeding, so a UI that
    /// thinks a password is set learns that its view is stale.
    #[error("Password protection is not enabled")]
    NotConfigured,

    /// The file could not be read, parsed or written, or hashing failed. Carries the underlying
    /// message, which never includes the password.
    #[error("{0}")]
    Config(String),
}

/// The `auth` block as of now, or `None` when there is none. Never an error: an unreadable config is
/// "no password configured" for the purpose of *reading* status, exactly as
/// [`crate::config::load_config`]'s callers treat it elsewhere.
pub fn current_auth(config_path: &Path) -> Option<AuthConfig> {
    crate::config::load_config(config_path).ok()?.auth
}

/// Whether password protection is configured *and usable*, which is what
/// `GET /api/auth/status` reports and what the full-access tunnel is gated on.
pub fn is_password_active(config_path: &Path) -> bool {
    current_auth(config_path).is_some_and(|auth| auth.is_active())
}

/// Sets or changes the session password.
///
/// `current` must be the existing password whenever one is already active — V1's
/// `if (hasAuthConfigured && !VerifyCurrentPassword(...)) { error }`. It is ignored when no password is
/// configured yet, because there is nothing to prove.
pub fn set_password(
    config_path: &Path,
    current: Option<&str>,
    new_password: &str,
) -> Result<(), CredentialError> {
    if new_password.trim().is_empty() {
        return Err(CredentialError::NewPasswordEmpty);
    }

    // Hash outside the lock: Argon2 at `m=65536, t=3` takes long enough that holding the config lock
    // across it would stall every other writer for no reason.
    let hash_secret = generate_hash_secret();
    let phc = hash_password(new_password, &hash_secret)
        .map_err(|err| CredentialError::Config(err.to_string()))?;

    with_config(config_path, |root| {
        let existing = read_auth(root);
        verify_current(existing.as_ref(), current)?;

        // Preserve `username`, `rateLimit` and unknown keys; replace only the two that make up the
        // credential.
        let mut block = match root.get(AUTH_KEY) {
            Some(serde_yaml::Value::Mapping(map)) => map.clone(),
            _ => serde_yaml::Mapping::new(),
        };
        block.insert(
            serde_yaml::Value::String("password".to_string()),
            serde_yaml::Value::String(phc.clone()),
        );
        block.insert(
            serde_yaml::Value::String("hashSecret".to_string()),
            serde_yaml::Value::String(hash_secret.clone()),
        );
        // The snake_case alias `hash_secret` is *accepted* on read, so a config carrying it would keep
        // shadowing the camelCase key we just wrote depending on map order. Remove it.
        block.remove(serde_yaml::Value::String("hash_secret".to_string()));

        root.insert(
            serde_yaml::Value::String(AUTH_KEY.to_string()),
            serde_yaml::Value::Mapping(block),
        );
        Ok(())
    })
}

/// Removes password protection, V1's `config.Settings.Auth = null` path.
///
/// The current password is still required, so somebody who walks up to an unlocked session cannot turn
/// the lock off without knowing it.
pub fn clear_password(config_path: &Path, current: Option<&str>) -> Result<(), CredentialError> {
    with_config(config_path, |root| {
        let existing = read_auth(root);
        match existing.as_ref() {
            Some(auth) if auth.is_active() => {}
            // A block that exists but is not usable (the inherited `auth: {enabled: true}` shape) is
            // still removable, and asking for a password nothing can verify would strand the operator.
            Some(_) => {
                root.remove(serde_yaml::Value::String(AUTH_KEY.to_string()));
                return Ok(());
            }
            None => return Err(CredentialError::NotConfigured),
        }
        verify_current(existing.as_ref(), current)?;
        root.remove(serde_yaml::Value::String(AUTH_KEY.to_string()));
        Ok(())
    })
}

/// V1's `SecuritySetupView.VerifyCurrentPassword`, including its "no `Auth` at all means nothing to
/// prove" opening.
fn verify_current(
    existing: Option<&AuthConfig>,
    presented: Option<&str>,
) -> Result<(), CredentialError> {
    let Some(auth) = existing.filter(|auth| auth.is_active()) else {
        return Ok(());
    };
    let presented = presented.unwrap_or_default();
    if presented.is_empty() {
        return Err(CredentialError::CurrentPasswordRequired);
    }
    if !verify_password(&auth.password, presented, &auth.hash_secret) {
        return Err(CredentialError::CurrentPasswordIncorrect);
    }
    Ok(())
}

/// The `auth` block of an already-parsed root mapping. A malformed block reads as `None`, which
/// [`verify_current`] treats as "nothing to prove" — the same fail-open-to-*replacement* choice V1
/// makes, and the reason [`clear_password`] handles an inactive block separately.
fn read_auth(root: &serde_yaml::Mapping) -> Option<AuthConfig> {
    let value = root.get(AUTH_KEY)?;
    serde_yaml::from_value::<AuthConfig>(value.clone()).ok()
}

/// Read-modify-write of `config.yaml` under its file lock.
///
/// The lock is the same one [`crate::config::update_config_raw`] takes, so a `PUT /api/config` landing
/// at the same moment cannot interleave with this and lose one of the two writes. `write_atomic` is
/// used directly rather than `save_config`, which would re-acquire the lock and deadlock.
fn with_config<T>(
    config_path: &Path,
    mutate: impl FnOnce(&mut serde_yaml::Mapping) -> Result<T, CredentialError>,
) -> Result<T, CredentialError> {
    let _lock = FileLock::acquire(config_path).map_err(|err| {
        CredentialError::Config(format!("Could not lock {}: {err}", config_path.display()))
    })?;

    let raw = if config_path.exists() {
        std::fs::read_to_string(config_path).map_err(|err| {
            CredentialError::Config(format!("Could not read {}: {err}", config_path.display()))
        })?
    } else {
        String::new()
    };

    let mut root = if raw.trim().is_empty() {
        serde_yaml::Mapping::new()
    } else {
        match serde_yaml::from_str::<serde_yaml::Value>(&raw) {
            Ok(serde_yaml::Value::Mapping(map)) => map,
            // A config that is not a mapping cannot have an `auth` block merged into it without
            // discarding whatever it does hold, and discarding an operator's config to set a password
            // is never the right trade.
            Ok(_) => {
                return Err(CredentialError::Config(format!(
                    "{} is not a YAML mapping",
                    config_path.display()
                )))
            }
            Err(err) => {
                return Err(CredentialError::Config(format!(
                    "Could not parse {}: {err}",
                    config_path.display()
                )))
            }
        }
    };

    let outcome = mutate(&mut root)?;

    let yaml = serde_yaml::to_string(&serde_yaml::Value::Mapping(root))
        .map_err(|err| CredentialError::Config(format!("Could not serialise config: {err}")))?;
    // The same validation `update_config_raw` performs: a write that produces a config the daemon
    // cannot parse would take the install down on its next read.
    serde_yaml::from_str::<crate::config::TendrilSettings>(&yaml).map_err(|err| {
        CredentialError::Config(format!("The updated config would not parse: {err}"))
    })?;

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            CredentialError::Config(format!("Could not create {}: {err}", parent.display()))
        })?;
    }
    write_atomic(config_path, yaml.as_bytes())
        .map_err(|err| CredentialError::Config(err.to_string()))?;
    restrict_permissions(config_path);
    Ok(outcome)
}

/// `config.yaml` now holds a password hash and its pepper, so it is tightened to `0o600` the way
/// `.master` and `.share-tunnel.json` already are. Only ever narrowed, never widened, and a failure is
/// a warning rather than a refusal — a config that saved but could not be chmod'ed is still saved.
#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let Ok(metadata) = std::fs::metadata(path) else {
        return;
    };
    let mode = metadata.permissions().mode();
    if mode & 0o077 == 0 {
        return;
    }
    if let Err(err) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode & 0o700))
    {
        tracing::warn!(
            "Could not restrict permissions on {}: {err}",
            path.display()
        );
    }
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Home(PathBuf);

    impl Home {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "tendril-credentials-{label}-{}",
                uuid::Uuid::new_v4().simple()
            ));
            std::fs::create_dir_all(&path).expect("create fixture home");
            Self(path)
        }

        fn config(&self) -> PathBuf {
            self.0.join("config.yaml")
        }

        fn write(&self, yaml: &str) {
            std::fs::write(self.config(), yaml).expect("write config");
        }

        fn read(&self) -> String {
            std::fs::read_to_string(self.config()).expect("read config")
        }
    }

    impl Drop for Home {
        fn drop(&mut self) {
            assert!(self.0.starts_with(std::env::temp_dir()));
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_first_password_needs_no_current_one_and_verifies_afterwards() {
        let home = Home::new("first");
        home.write("codingAgent: claude\n");

        set_password(&home.config(), None, "correct horse battery").expect("set");

        let auth = current_auth(&home.config()).expect("auth block written");
        assert!(auth.is_active());
        assert!(verify_password(
            &auth.password,
            "correct horse battery",
            &auth.hash_secret
        ));
        assert!(!verify_password(&auth.password, "wrong", &auth.hash_secret));
        assert!(
            auth.password.starts_with("$argon2i$v=19$m=65536,t=3,p=1$"),
            "the format both apps read: {}",
            auth.password
        );
    }

    #[test]
    fn the_plaintext_is_never_written_to_the_file() {
        let home = Home::new("no-plaintext");
        home.write("codingAgent: claude\n");
        set_password(&home.config(), None, "a-very-distinctive-plaintext").expect("set");
        assert!(
            !home.read().contains("a-very-distinctive-plaintext"),
            "config.yaml must hold only the hash"
        );
    }

    #[test]
    fn changing_requires_the_current_password() {
        let home = Home::new("change");
        home.write("codingAgent: claude\n");
        set_password(&home.config(), None, "first-password").expect("set");

        assert_eq!(
            set_password(&home.config(), None, "second-password"),
            Err(CredentialError::CurrentPasswordRequired)
        );
        assert_eq!(
            set_password(&home.config(), Some("not-it"), "second-password"),
            Err(CredentialError::CurrentPasswordIncorrect)
        );

        let unchanged = current_auth(&home.config()).expect("still configured");
        assert!(verify_password(
            &unchanged.password,
            "first-password",
            &unchanged.hash_secret
        ));

        set_password(&home.config(), Some("first-password"), "second-password").expect("change");
        let changed = current_auth(&home.config()).expect("still configured");
        assert!(verify_password(
            &changed.password,
            "second-password",
            &changed.hash_secret
        ));
        assert!(!verify_password(
            &changed.password,
            "first-password",
            &changed.hash_secret
        ));
    }

    /// The pepper is the session-token signing key, so a password change has to invalidate it.
    #[test]
    fn a_change_rotates_the_pepper() {
        let home = Home::new("rotate");
        home.write("codingAgent: claude\n");
        set_password(&home.config(), None, "first-password").expect("set");
        let before = current_auth(&home.config()).unwrap().hash_secret;

        set_password(&home.config(), Some("first-password"), "second-password").expect("change");
        let after = current_auth(&home.config()).unwrap().hash_secret;

        assert_ne!(
            before, after,
            "every issued session token must stop working"
        );
    }

    #[test]
    fn a_blank_new_password_is_refused() {
        let home = Home::new("blank");
        home.write("codingAgent: claude\n");
        assert_eq!(
            set_password(&home.config(), None, "   "),
            Err(CredentialError::NewPasswordEmpty)
        );
        assert!(current_auth(&home.config()).is_none());
    }

    #[test]
    fn clearing_requires_the_current_password_and_removes_the_block() {
        let home = Home::new("clear");
        home.write("codingAgent: claude\n");
        set_password(&home.config(), None, "the-password").expect("set");

        assert_eq!(
            clear_password(&home.config(), None),
            Err(CredentialError::CurrentPasswordRequired)
        );
        assert_eq!(
            clear_password(&home.config(), Some("nope")),
            Err(CredentialError::CurrentPasswordIncorrect)
        );
        assert!(is_password_active(&home.config()));

        clear_password(&home.config(), Some("the-password")).expect("clear");
        assert!(!is_password_active(&home.config()));
        assert!(
            !home.read().contains("hashSecret"),
            "the whole block goes, not just the hash: {}",
            home.read()
        );
        assert_eq!(
            clear_password(&home.config(), Some("the-password")),
            Err(CredentialError::NotConfigured)
        );
    }

    #[test]
    fn the_rest_of_the_auth_block_and_the_rest_of_the_config_survive() {
        let home = Home::new("preserve");
        home.write(
            "codingAgent: claude\nauth:\n  username: Alice\n  rateLimit:\n    threshold: 7\n",
        );

        set_password(&home.config(), None, "the-password").expect("set");

        let settings = crate::config::load_config(&home.config()).expect("parse");
        assert_eq!(settings.coding_agent, "claude");
        let auth = settings.auth.expect("auth block");
        assert_eq!(auth.username.as_deref(), Some("Alice"));
        assert_eq!(auth.effective_rate_limit().threshold, 7);
        assert!(auth.is_active());
    }

    /// An `auth: {enabled: true}` block with no credential locks nobody out (`is_active` is false), and
    /// it must be removable without a password nothing can verify.
    #[test]
    fn an_inactive_block_is_clearable_without_a_password() {
        let home = Home::new("inactive");
        home.write("auth:\n  enabled: true\n");
        assert!(!is_password_active(&home.config()));
        clear_password(&home.config(), None).expect("clear an unusable block");
        assert!(crate::config::load_config(&home.config())
            .unwrap()
            .auth
            .is_none());
    }

    /// A missing file is a fresh install, not a failure.
    #[test]
    fn a_missing_config_is_created() {
        let home = Home::new("missing");
        assert!(!home.config().exists());
        set_password(&home.config(), None, "the-password").expect("set");
        assert!(is_password_active(&home.config()));
    }

    #[cfg(unix)]
    #[test]
    fn the_config_is_not_world_readable_once_it_holds_a_hash() {
        use std::os::unix::fs::PermissionsExt;
        let home = Home::new("perms");
        home.write("codingAgent: claude\n");
        std::fs::set_permissions(home.config(), std::fs::Permissions::from_mode(0o644)).unwrap();

        set_password(&home.config(), None, "the-password").expect("set");

        let mode = std::fs::metadata(home.config())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0, "mode {mode:o} exposes the hash and pepper");
    }

    /// `hash_secret` is *accepted* on read as an alias for `hashSecret`, so a config carrying the
    /// snake_case spelling would end up with both keys and whichever serde saw last would win.
    #[test]
    fn a_snake_case_pepper_is_replaced_rather_than_left_to_shadow_the_new_one() {
        let home = Home::new("snake");
        home.write("codingAgent: claude\n");
        set_password(&home.config(), None, "first-password").expect("set");
        // Rewrite the pepper under its alias, as an inherited config would spell it.
        home.write(&home.read().replace("hashSecret:", "hash_secret:"));
        assert!(is_password_active(&home.config()), "the alias still reads");

        set_password(&home.config(), Some("first-password"), "second-password").expect("change");

        assert!(
            !home.read().contains("hash_secret"),
            "the alias would shadow the key we wrote: {}",
            home.read()
        );
        let auth = current_auth(&home.config()).unwrap();
        assert!(verify_password(
            &auth.password,
            "second-password",
            &auth.hash_secret
        ));
    }

    /// The one refusal that is a dead end by design: a `password` that is not a parseable hash makes the
    /// block *active* (so nothing is accidentally open) but unverifiable, so it can only be repaired by
    /// editing `config.yaml`. Such an install cannot log in either, so this route is not what is broken.
    #[test]
    fn a_corrupt_hash_is_not_treated_as_no_password_at_all() {
        let home = Home::new("corrupt-hash");
        home.write("auth:\n  password: 'not-a-hash'\n  hashSecret: 'AAAA'\n");
        assert!(is_password_active(&home.config()));
        assert_eq!(
            set_password(&home.config(), None, "new-password"),
            Err(CredentialError::CurrentPasswordRequired),
            "an unverifiable hash must not become a free replacement"
        );
        assert_eq!(
            set_password(&home.config(), Some("guess"), "new-password"),
            Err(CredentialError::CurrentPasswordIncorrect)
        );
    }
}
