//! First-run detection for the onboarding wizard.
//!
//! Split into a pure evaluator ([`evaluate`], no filesystem) and a thin IO wrapper ([`status`]) so
//! the precedence rules — which are the whole of the "reliable and non-annoying" requirement — are
//! directly testable.
//!
//! The decision is *persisted*, unlike the original's runtime `NeedsOnboarding` property: a
//! completed or dismissed wizard writes a flag to `config.yaml` and never reappears.

use crate::config::{load_config, update_config_raw, OnboardingConfig, TendrilSettings};
use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Why onboarding is (or is not) needed. Surfaced to the UI so the wizard can explain itself and a
/// support log can say which rule fired.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OnboardingReason {
    /// No `config.yaml` at all.
    FreshInstall,
    /// Config exists but has no projects, and the operator has neither completed nor dismissed.
    NoProjects,
    /// Projects are configured, or the config is present but unreadable — either way, hands off.
    AlreadyConfigured,
    Completed,
    Dismissed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStatus {
    pub needed: bool,
    pub reason: OnboardingReason,
    pub project_count: usize,
    pub config_exists: bool,
    pub tendril_home: String,
}

/// Pure precedence rules. `settings` is `None` when `config.yaml` is absent or unparseable, which is
/// why `config_exists` is passed separately: the two cases must be distinguishable.
///
/// Highest precedence first:
/// 1. completed  → never again
/// 2. dismissed  → never again
/// 3. projects   → already configured
/// 4. no config  → fresh install
/// 5. otherwise  → config present, zero projects
pub fn evaluate(
    config_exists: bool,
    settings: Option<&TendrilSettings>,
) -> (bool, OnboardingReason) {
    if let Some(settings) = settings {
        if settings.onboarding.completed {
            return (false, OnboardingReason::Completed);
        }
        if settings.onboarding.dismissed {
            return (false, OnboardingReason::Dismissed);
        }
        if !settings.projects.is_empty() {
            return (false, OnboardingReason::AlreadyConfigured);
        }
    }

    if !config_exists {
        return (true, OnboardingReason::FreshInstall);
    }

    (true, OnboardingReason::NoProjects)
}

/// Reads `config.yaml` and applies [`evaluate`].
///
/// A config that exists but does not parse is deliberately treated as `AlreadyConfigured`: it is a
/// repair problem for Settings/doctor, not a first-run problem. Showing the wizard over a config the
/// operator painstakingly wrote is the original's failure mode, and it is not ported.
pub fn status(tendril_home: &Path, config_path: &Path) -> OnboardingStatus {
    let config_exists = config_path.exists();
    let settings = if config_exists {
        load_config(config_path).ok()
    } else {
        None
    };

    let (needed, reason) = if config_exists && settings.is_none() {
        (false, OnboardingReason::AlreadyConfigured)
    } else {
        evaluate(config_exists, settings.as_ref())
    };

    OnboardingStatus {
        needed,
        reason,
        project_count: settings.as_ref().map(|s| s.projects.len()).unwrap_or(0),
        config_exists,
        tendril_home: tendril_home.to_string_lossy().to_string(),
    }
}

/// Records that the wizard was completed. `now` is an RFC3339 timestamp.
pub fn mark_completed(config_path: &Path, now: &str) -> Result<()> {
    let mut onboarding = existing_onboarding(config_path);
    onboarding.completed = true;
    onboarding.completed_at = Some(now.to_string());
    write_onboarding(config_path, &onboarding)
}

/// Records that the operator skipped setup. The flag is the only thing written — never a partial
/// project, never a `codingAgent` change.
pub fn mark_dismissed(config_path: &Path) -> Result<()> {
    let mut onboarding = existing_onboarding(config_path);
    onboarding.dismissed = true;
    write_onboarding(config_path, &onboarding)
}

fn existing_onboarding(config_path: &Path) -> OnboardingConfig {
    load_config(config_path)
        .map(|s| s.onboarding)
        .unwrap_or_default()
}

/// Writes **only** the `onboarding` key, through the shallow top-level merge in
/// [`update_config_raw`], which preserves every other key (including `extra`) and re-validates the
/// merged document. Never `save_config` with a fresh `TendrilSettings` — that is what would clobber a
/// populated config.
fn write_onboarding(config_path: &Path, onboarding: &OnboardingConfig) -> Result<()> {
    let patch = serde_json::json!({ "onboarding": onboarding });
    update_config_raw(config_path, &patch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ProjectConfig;

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("{}-{}", name, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn settings() -> TendrilSettings {
        TendrilSettings::default()
    }

    #[test]
    fn fresh_install_needs_onboarding() {
        assert_eq!(
            evaluate(false, None),
            (true, OnboardingReason::FreshInstall)
        );
    }

    #[test]
    fn config_without_projects_needs_onboarding() {
        let s = settings();
        assert!(s.projects.is_empty());
        assert!(!s.onboarding.completed && !s.onboarding.dismissed);
        assert_eq!(
            evaluate(true, Some(&s)),
            (true, OnboardingReason::NoProjects)
        );
    }

    #[test]
    fn populated_config_does_not_need_onboarding() {
        let mut s = settings();
        s.projects.push(ProjectConfig {
            name: "Ivy-Tendril-V2".to_string(),
            ..Default::default()
        });
        assert_eq!(
            evaluate(true, Some(&s)),
            (false, OnboardingReason::AlreadyConfigured)
        );
    }

    #[test]
    fn dismissed_never_needs_onboarding() {
        let mut s = settings();
        s.onboarding.dismissed = true;
        assert_eq!(
            evaluate(true, Some(&s)),
            (false, OnboardingReason::Dismissed)
        );
    }

    #[test]
    fn completed_never_needs_onboarding() {
        let mut s = settings();
        s.onboarding.completed = true;
        assert_eq!(
            evaluate(true, Some(&s)),
            (false, OnboardingReason::Completed)
        );
    }

    #[test]
    fn dismissed_wins_over_empty_projects_and_missing_config() {
        let mut s = settings();
        s.onboarding.dismissed = true;
        assert_eq!(
            evaluate(false, Some(&s)),
            (false, OnboardingReason::Dismissed)
        );
    }

    #[test]
    fn unparseable_config_does_not_trigger_onboarding() {
        let home = scratch_dir("tendril-onboarding-broken-config");
        let config_path = home.join("config.yaml");
        std::fs::write(&config_path, ":\n\tnot yaml").unwrap();

        let st = status(&home, &config_path);
        assert!(
            !st.needed,
            "a broken config is a repair problem, not a first run"
        );
        assert_eq!(st.reason, OnboardingReason::AlreadyConfigured);
        assert!(st.config_exists);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn status_reports_a_fresh_install() {
        let home = scratch_dir("tendril-onboarding-fresh");
        let config_path = home.join("config.yaml");

        let st = status(&home, &config_path);
        assert!(st.needed);
        assert_eq!(st.reason, OnboardingReason::FreshInstall);
        assert!(!st.config_exists);
        assert_eq!(st.project_count, 0);
        assert_eq!(st.tendril_home, home.to_string_lossy());

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn mark_dismissed_preserves_existing_keys() {
        let home = scratch_dir("tendril-onboarding-preserve");
        let config_path = home.join("config.yaml");
        std::fs::write(
            &config_path,
            r#"codingAgent: codex
projects:
  - name: Existing
    color: Blue
    repos:
      - path: /tmp/existing
verifications:
  - name: RustBuild
    prompt: Run cargo build
someUnknownKey: keep-me
"#,
        )
        .unwrap();

        mark_dismissed(&config_path).expect("dismiss writes");

        let reloaded = load_config(&config_path).expect("still parses");
        assert!(reloaded.onboarding.dismissed);
        assert!(!reloaded.onboarding.completed);
        assert_eq!(reloaded.coding_agent, "codex");
        assert_eq!(reloaded.projects.len(), 1);
        assert_eq!(reloaded.projects[0].name, "Existing");
        assert_eq!(reloaded.verifications.len(), 1);
        assert!(
            reloaded.extra.contains_key("someUnknownKey"),
            "unknown keys must survive: {:?}",
            reloaded.extra
        );

        // And the decision sticks.
        assert_eq!(
            status(&home, &config_path).reason,
            OnboardingReason::Dismissed
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn mark_completed_sets_timestamp() {
        let home = scratch_dir("tendril-onboarding-complete");
        let config_path = home.join("config.yaml");
        std::fs::write(&config_path, "codingAgent: claude\n").unwrap();

        mark_completed(&config_path, "2026-09-14T12:00:00Z").expect("complete writes");

        let reloaded = load_config(&config_path).expect("still parses");
        assert!(reloaded.onboarding.completed);
        assert_eq!(
            reloaded.onboarding.completed_at.as_deref(),
            Some("2026-09-14T12:00:00Z")
        );
        assert!(!status(&home, &config_path).needed);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn mark_dismissed_on_missing_config_creates_minimal() {
        let home = scratch_dir("tendril-onboarding-no-config");
        let config_path = home.join("config.yaml");
        assert!(!config_path.exists());

        mark_dismissed(&config_path).expect("dismiss writes");

        assert!(config_path.exists());
        let reloaded = load_config(&config_path).expect("parses");
        assert!(reloaded.onboarding.dismissed);
        assert!(!status(&home, &config_path).needed);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_default_onboarding_key_stays_out_of_serialized_config() {
        let yaml = serde_yaml::to_string(&settings()).expect("serialize");
        assert!(
            !yaml.contains("onboarding"),
            "an untouched onboarding key must not appear in config.yaml: {yaml}"
        );
    }
}
