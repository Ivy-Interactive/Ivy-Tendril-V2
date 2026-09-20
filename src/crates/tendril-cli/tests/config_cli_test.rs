use std::path::PathBuf;
use tendril_cli::commands::config::{handle_config_command, ConfigCommands};
use tendril_core::config::{get_config_path, load_config};

/// A scratch `TENDRIL_HOME` seeded with a minimal `config.yaml`, removed when the guard drops.
struct ConfigFixture {
    dir: PathBuf,
}

impl ConfigFixture {
    fn new(tag: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "tendril-cli-config-test-{tag}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("config.yaml"),
            r##"
codingAgent: claude
jobTimeout: 30
maxConcurrentJobs: 20
planTemplate: "# Plan Template"
theme: default
"##,
        )
        .unwrap();
        Self { dir }
    }

    fn set(&self, key: &str, value: &str) -> anyhow::Result<()> {
        handle_config_command(
            ConfigCommands::Set {
                key: key.to_string(),
                value: value.to_string(),
            },
            &self.dir,
        )
    }

    fn get(&self, key: &str) -> anyhow::Result<()> {
        handle_config_command(
            ConfigCommands::Get {
                key: key.to_string(),
            },
            &self.dir,
        )
    }

    fn raw_yaml(&self) -> String {
        std::fs::read_to_string(get_config_path(&self.dir)).unwrap()
    }

    fn count_key_occurrences(&self, key: &str) -> usize {
        // A crude but sufficient top-level-key counter: YAML keys start at column 0.
        let needle = format!("{key}:");
        self.raw_yaml()
            .lines()
            .filter(|line| line.starts_with(&needle))
            .count()
    }
}

impl Drop for ConfigFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// Setting any newly-modeled boolean field must update the struct field, not `extra` — and must
/// not leave the key duplicated in the saved YAML (the corruption this plan fixes).
#[test]
fn test_set_modeled_bool_fields_does_not_duplicate() {
    let fx = ConfigFixture::new("bool-fields");

    for (key, serialized_key) in [
        ("telemetry", "telemetry"),
        ("beta", "beta"),
        ("desktopNotifications", "desktopNotifications"),
        ("enrichModels", "enrichModels"),
    ] {
        fx.set(key, "true").expect(key);
        assert_eq!(
            fx.count_key_occurrences(serialized_key),
            1,
            "'{key}' must appear exactly once in config.yaml after being set, got:\n{}",
            fx.raw_yaml()
        );
    }

    let settings = load_config(&get_config_path(&fx.dir)).expect("reload must not error");
    assert_eq!(settings.telemetry, Some(true));
    assert!(settings.beta);
    assert!(settings.desktop_notifications);
    assert!(settings.enrich_models);
    assert!(
        settings.extra.is_empty(),
        "modeled fields must not land in extra: {:?}",
        settings.extra
    );
}

/// Re-saving and re-loading after setting several modeled fields must never error with
/// "duplicate field" — the exact symptom described in the plan.
#[test]
fn test_reload_after_setting_modeled_fields_does_not_error() {
    let fx = ConfigFixture::new("reload");

    fx.set("telemetry", "true").unwrap();
    fx.set("beta", "true").unwrap();
    fx.set("worktreeReaperInterval", "45").unwrap();
    fx.set("theme", "dark").unwrap();

    // `load_config` returning Ok at all is the assertion: a duplicated key makes serde_yaml
    // error with "duplicate field '<key>'".
    let settings = load_config(&get_config_path(&fx.dir)).expect("reload must not error");
    assert_eq!(settings.theme, "dark");
    assert_eq!(settings.worktree_reaper_interval, 45);
}

/// Setting modeled integer fields updates the struct field and stays duplicate-free.
#[test]
fn test_set_modeled_integer_fields() {
    let fx = ConfigFixture::new("int-fields");

    fx.set("daemonRequestTimeout", "7").unwrap();
    fx.set("worktreeReaperInterval", "15").unwrap();
    fx.set("modelCacheWarnAgeDays", "3").unwrap();

    assert_eq!(fx.count_key_occurrences("daemonRequestTimeout"), 1);
    assert_eq!(fx.count_key_occurrences("worktreeReaperInterval"), 1);
    assert_eq!(fx.count_key_occurrences("modelCacheWarnAgeDays"), 1);

    let settings = load_config(&get_config_path(&fx.dir)).expect("reload must not error");
    assert_eq!(settings.daemon_request_timeout, 7);
    assert_eq!(settings.worktree_reaper_interval, 15);
    assert_eq!(settings.model_cache_warn_age_days, 3);
    assert!(settings.extra.is_empty());
}

/// `config get` on the newly-supported modeled fields succeeds (does not bail "Unknown config
/// key") once the field has been set.
#[test]
fn test_get_newly_supported_modeled_fields() {
    let fx = ConfigFixture::new("get-fields");

    fx.set("telemetry", "true").unwrap();
    fx.set("beta", "true").unwrap();
    fx.set("worktreeReaperInterval", "45").unwrap();

    fx.get("telemetry").expect("telemetry should be gettable");
    fx.get("beta").expect("beta should be gettable");
    fx.get("worktreeReaperInterval")
        .expect("worktreeReaperInterval should be gettable");
    // Case-insensitive, matching `set`.
    fx.get("WORKTREEREAPERINTERVAL")
        .expect("get should be case-insensitive");
}

/// A truly unmodeled key still round-trips through `extra` exactly as before, and setting a
/// modeled field alongside it never touches the unrelated extra entry.
#[test]
fn test_unmodeled_keys_still_use_extra() {
    let fx = ConfigFixture::new("extra");

    fx.set("myCustomSetting", "hello").unwrap();
    let settings = load_config(&get_config_path(&fx.dir)).expect("reload must not error");
    assert_eq!(
        settings.extra.get("myCustomSetting"),
        Some(&serde_json::json!("hello"))
    );

    fx.set("telemetry", "true").unwrap();
    let settings = load_config(&get_config_path(&fx.dir)).expect("reload must not error");
    assert_eq!(settings.telemetry, Some(true));
    assert_eq!(
        settings.extra.get("myCustomSetting"),
        Some(&serde_json::json!("hello")),
        "setting a modeled field must not disturb an unrelated extra entry"
    );
}

/// A config already corrupted by the pre-fix behavior — a modeled key sitting in `extra`, not yet
/// duplicated on the struct side because the field's `skip_serializing_if` omitted it — must be
/// healed rather than made worse the next time the same key is set.
#[test]
fn test_set_heals_a_stale_extra_entry_for_a_modeled_key() {
    let fx = ConfigFixture::new("heal");
    std::fs::write(
        get_config_path(&fx.dir),
        r##"
codingAgent: claude
jobTimeout: 30
theme: default
telemetry: true
"##,
    )
    .unwrap();

    // Simulate the corruption directly: a stale `extra` entry for a now-modeled key, with the
    // struct field still at its default. This is the state a pre-fix `Set` on a field with
    // `skip_serializing_if` would have produced without yet duplicating anything.
    let cfg_path = get_config_path(&fx.dir);
    let mut settings = load_config(&cfg_path).unwrap();
    settings.telemetry = None;
    settings
        .extra
        .insert("telemetry".to_string(), serde_json::json!(true));
    tendril_core::config::save_config(&cfg_path, &settings).unwrap();
    assert_eq!(fx.count_key_occurrences("telemetry"), 1);

    // Now set it the correct way. The stale extra entry must be stripped, not left alongside the
    // freshly-written struct field.
    fx.set("telemetry", "false").unwrap();
    assert_eq!(
        fx.count_key_occurrences("telemetry"),
        1,
        "healing a stale extra entry must not duplicate the key:\n{}",
        fx.raw_yaml()
    );
    let settings = load_config(&cfg_path).expect("reload must not error");
    assert_eq!(settings.telemetry, Some(false));
    assert!(!settings.extra.contains_key("telemetry"));
}

/// `llm` is modeled as a struct; `config set llm '<json>'` must merge into it (not clobber other
/// fields) and round-trip without polluting `extra`.
#[test]
fn test_set_llm_merges_json_fields() {
    let fx = ConfigFixture::new("llm");

    fx.set(
        "llm",
        r#"{"model":"claude-3-7-sonnet","provider":"anthropic"}"#,
    )
    .unwrap();
    fx.set("llm", r#"{"endpoint":"https://api.example.com"}"#)
        .unwrap();

    let settings = load_config(&get_config_path(&fx.dir)).expect("reload must not error");
    let llm = settings.llm.expect("llm should be modeled after set");
    assert_eq!(llm.model, "claude-3-7-sonnet");
    assert_eq!(llm.endpoint, "https://api.example.com");
    assert_eq!(
        llm.extra.get("provider"),
        Some(&serde_json::json!("anthropic"))
    );
    assert!(settings.extra.is_empty());
    assert_eq!(fx.count_key_occurrences("llm"), 1);
}

/// Setting an unrecognised value for a boolean field must error clearly rather than silently
/// coercing or panicking.
#[test]
fn test_set_bool_field_rejects_invalid_value() {
    let fx = ConfigFixture::new("bad-bool");
    let err = fx
        .set("beta", "yes")
        .expect_err("non-bool value must be rejected");
    assert!(err.to_string().contains("true"), "{err}");
}

/// Structured (list/map) modeled fields are rejected with an informative error by both `get` and
/// `set`, instead of silently falling through to `extra`.
#[test]
fn test_structured_fields_are_rejected_not_pushed_into_extra() {
    let fx = ConfigFixture::new("structured");

    let set_err = fx
        .set("projects", "[]")
        .expect_err("structured field must not be settable via config set");
    assert!(set_err.to_string().contains("structured"), "{set_err}");

    let get_err = fx
        .get("verifications")
        .expect_err("structured field must not be gettable via config get");
    assert!(get_err.to_string().contains("structured"), "{get_err}");

    let settings = load_config(&get_config_path(&fx.dir)).expect("reload must not error");
    assert!(settings.extra.is_empty());
}

/// `coAuthor` is the identity Tendril stamps onto the commits it creates, and it reaches the agent
/// only through `git::coauthor_hooks::coauthor_env`, which returns early — installing no hook at all
/// — when the key is unset. So "unset" and "set to empty" have to be the same state here as they are
/// there: a blank identity stored as `coAuthor: ""` would be a trailer reading `Co-Authored-By: `.
///
/// It is also a modeled key, which is the half that was missing: before it was listed in
/// `MODELED_PRIMITIVE_KEYS` a `config set coauthor` landed in `extra` and `save_config` emitted the
/// key twice, which is the corruption `test_set_heals_a_stale_extra_entry_for_a_modeled_key` covers
/// for the other fields.
#[test]
fn test_set_coauthor_round_trips_and_empty_clears_it() {
    let fixture = ConfigFixture::new("coauthor");

    // Unset is readable and empty rather than an "unknown key" error.
    fixture.get("coAuthor").unwrap();
    assert_eq!(load_config(&get_config_path(&fixture.dir)).unwrap().co_author, None);

    fixture.set("coAuthor", "ivy-tendril <tendril@ivy.app>").unwrap();
    let settings = load_config(&get_config_path(&fixture.dir)).unwrap();
    assert_eq!(
        settings.co_author.as_deref(),
        Some("ivy-tendril <tendril@ivy.app>"),
        "the identity must land on the modeled field"
    );
    assert_eq!(
        settings.co_author_identity(),
        Some("ivy-tendril <tendril@ivy.app>"),
        "and be visible to the one reader that installs the hook"
    );

    // Modeled, so it is written once and never mirrored into `extra`.
    assert_eq!(fixture.count_key_occurrences("coAuthor"), 1);
    assert!(
        !settings.extra.keys().any(|k| k.eq_ignore_ascii_case("coauthor")),
        "a modeled key must not also sit in extra"
    );

    // Whitespace is trimmed rather than stored, so a stray space cannot produce a malformed trailer.
    fixture.set("coAuthor", "  ivy-tendril <tendril@ivy.app>  ").unwrap();
    assert_eq!(
        load_config(&get_config_path(&fixture.dir)).unwrap().co_author.as_deref(),
        Some("ivy-tendril <tendril@ivy.app>")
    );

    // Empty clears the key outright: `skip_serializing_if` then keeps it out of the file entirely,
    // which is what "no trailer and no hook install" means on disk.
    fixture.set("coAuthor", "").unwrap();
    assert_eq!(load_config(&get_config_path(&fixture.dir)).unwrap().co_author, None);
    assert_eq!(
        fixture.count_key_occurrences("coAuthor"),
        0,
        "clearing must remove the key, not leave an empty identity behind"
    );
}
