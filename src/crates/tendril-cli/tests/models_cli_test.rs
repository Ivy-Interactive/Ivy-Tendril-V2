//! `tendril models` end to end.
//!
//! Nothing here touches the network. The cache-freshness branches are driven by writing
//! `<home>/cache/models_cache.json` with a known `fetchedAt`, and the one test that exercises
//! `--refresh` forces the HTTP client's connection to fail by pointing its proxy at a closed local
//! port — so the suite behaves identically on a machine with no internet.

use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use tendril_core::agents::model_specs::{self, ModelSpec};
use tendril_core::agents::resolution::default_profiles;

/// A local address nothing listens on. Discard (port 9) is a reserved port that no process binds, so
/// a proxied request to it fails immediately rather than hanging.
const DEAD_PROXY: &str = "http://127.0.0.1:9";

struct Fixture {
    home: PathBuf,
}

impl Fixture {
    fn new(tag: &str) -> Self {
        let home = std::env::temp_dir().join(format!(
            "tendril-cli-models-test-{tag}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&home).unwrap();
        assert!(home.starts_with(std::env::temp_dir()));
        Self { home }
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_tendril"));
        cmd.arg("--home")
            .arg(&self.home)
            .args(args)
            .env_remove("TENDRIL_HOME")
            .env_remove("TENDRIL_PLANS")
            .env_remove("TENDRIL_CONFIG")
            .stdin(Stdio::null());
        cmd
    }

    fn run(&self, args: &[&str]) -> Output {
        self.command(args).output().expect("run tendril")
    }

    /// Writes the on-disk models.dev cache with an explicit age in days and a single made-up model,
    /// so the cached entry is trivially distinguishable from the static catalogue.
    fn write_cache(&self, age_days: i64) {
        let fetched_at = chrono::Utc::now() - chrono::Duration::days(age_days);
        let cache_dir = self.home.join("cache");
        std::fs::create_dir_all(&cache_dir).unwrap();
        std::fs::write(
            cache_dir.join("models_cache.json"),
            serde_json::json!({
                "fetchedAt": fetched_at.to_rfc3339(),
                "specs": [{
                    "model_id": "cached-only-model",
                    "display_name": "Cached Only Model",
                    "context_window": 123_456u64,
                    "max_output_tokens": 6_543u64,
                    "input_per_million": 1.0,
                    "output_per_million": 2.0,
                    "cache_read_per_million": 0.5,
                    "cache_write_per_million": 1.5,
                }],
            })
            .to_string(),
        )
        .unwrap();
    }

    /// A cache file written before the `fetchedAt` envelope existed: a bare array of specs.
    fn write_legacy_cache(&self) {
        let cache_dir = self.home.join("cache");
        std::fs::create_dir_all(&cache_dir).unwrap();
        std::fs::write(
            cache_dir.join("models_cache.json"),
            serde_json::json!([{
                "model_id": "cached-only-model",
                "display_name": "Cached Only Model",
                "context_window": 1u64,
                "max_output_tokens": 1u64,
                "input_per_million": 0.0,
                "output_per_million": 0.0,
                "cache_read_per_million": 0.0,
                "cache_write_per_million": 0.0,
            }])
            .to_string(),
        )
        .unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.home.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

fn stdout_of(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).to_string()
}

fn stderr_of(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).to_string()
}

fn exit_code(out: &Output) -> i32 {
    out.status
        .code()
        .expect("the CLI must exit, not be signalled")
}

/// The model id in the first column of every table row.
fn listed_model_ids(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .skip_while(|l| !l.starts_with("MODEL "))
        .skip(2) // the header and the rule beneath it
        .take_while(|l| !l.trim().is_empty())
        .filter_map(|l| l.split_whitespace().next().map(|s| s.to_string()))
        .collect()
}

// ---------------------------------------------------------------------------
// the static catalogue
// ---------------------------------------------------------------------------

/// With no cache and no `--refresh`, `models` prints the compiled-in catalogue and says so. This is
/// the offline path, and it is the default.
#[test]
fn models_lists_the_static_catalogue_without_touching_the_network() {
    let fx = Fixture::new("static");
    let out = fx.run(&["models"]);
    assert_eq!(exit_code(&out), 0, "stderr:\n{}", stderr_of(&out));
    let stdout = stdout_of(&out);

    // The header, in the documented column order.
    let header = stdout
        .lines()
        .find(|l| l.starts_with("MODEL "))
        .unwrap_or_else(|| panic!("no table header in:\n{stdout}"));
    for column in [
        "MODEL",
        "CONTEXT",
        "MAX OUTPUT",
        "INPUT/1M",
        "OUTPUT/1M",
        "CACHE READ",
        "CACHE WRITE",
    ] {
        assert!(
            header.contains(column),
            "header must contain {column}: {header}"
        );
    }
    assert!(
        stdout.contains(&"-".repeat(104)),
        "the header rule is 104 dashes wide:\n{stdout}"
    );

    assert!(
        stdout
            .trim_end()
            .ends_with("Source: static ModelSpecs offline fallback"),
        "the source line closes the report:\n{stdout}"
    );

    // Every compiled-in spec is listed, exactly once.
    let listed = listed_model_ids(&stdout);
    assert_eq!(
        listed.len(),
        model_specs::SPECS.len(),
        "every static spec must be listed once; got {} rows for {} specs",
        listed.len(),
        model_specs::SPECS.len()
    );
    for spec in model_specs::SPECS {
        assert!(
            listed.iter().any(|id| id == spec.model_id.as_ref()),
            "{} is missing from the table:\n{stdout}",
            spec.model_id
        );
    }
}

/// Prices and window sizes come out of the table, not out of thin air: one row is checked against
/// the spec it was rendered from.
#[test]
fn models_renders_each_row_from_its_spec() {
    let fx = Fixture::new("row-shape");
    let stdout = stdout_of(&fx.run(&["models"]));

    let spec: &ModelSpec = model_specs::SPECS
        .iter()
        .find(|s| s.model_id == "claude-sonnet-5")
        .expect("claude-sonnet-5 is part of the static catalogue");
    let row = stdout
        .lines()
        .find(|l| l.starts_with("claude-sonnet-5 "))
        .unwrap_or_else(|| panic!("no claude-sonnet-5 row in:\n{stdout}"));

    assert!(row.contains(&spec.context_window.to_string()), "{row}");
    assert!(row.contains(&spec.max_output_tokens.to_string()), "{row}");
    assert!(
        row.contains(&format!("${:.2}", spec.input_per_million)),
        "prices are rendered to two decimals with a leading $: {row}"
    );
    assert!(
        row.contains(&format!("${:.2}", spec.output_per_million)),
        "{row}"
    );
}

/// The three execution-profile tiers pick their models by id, so every model the built-in
/// `deep` / `balanced` / `quick` defaults name has to be resolvable in the catalogue `models` prints.
/// A tier pointing at a model the catalogue has never heard of is exactly what `doctor`'s
/// "not in the model catalog" failure reports at runtime.
#[test]
fn the_catalogue_covers_the_deep_balanced_and_quick_tier_models() {
    let fx = Fixture::new("tiers");
    let stdout = stdout_of(&fx.run(&["models"]));
    let listed = listed_model_ids(&stdout);

    let tiers = default_profiles("claude");
    let names: Vec<&str> = tiers.iter().map(|t| t.tier).collect();
    assert_eq!(
        names,
        vec!["deep", "balanced", "quick"],
        "the tier order is part of the contract"
    );

    for tier in tiers {
        let model = tier
            .model
            .unwrap_or_else(|| panic!("the {} tier must name a model", tier.tier));
        assert!(
            listed.iter().any(|id| id == model),
            "the {} tier resolves to '{model}', which `tendril models` does not list:\n{stdout}",
            tier.tier
        );
        assert!(
            model_specs::find(model).is_some(),
            "the {} tier's model '{model}' must be resolvable in the catalogue",
            tier.tier
        );
    }
}

// ---------------------------------------------------------------------------
// the on-disk cache
// ---------------------------------------------------------------------------

/// A cache younger than the warn threshold is used silently, and the source line says how many
/// models it holds and how old it is.
#[test]
fn models_uses_a_fresh_cache_and_reports_its_age() {
    let fx = Fixture::new("cache-fresh");
    fx.write_cache(0);

    let out = fx.run(&["models"]);
    assert_eq!(exit_code(&out), 0);
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains("Source: models.dev cache (1 models, fetched today)"),
        "{stdout}"
    );
    assert!(
        stderr_of(&out).is_empty(),
        "a fresh cache warns about nothing: {}",
        stderr_of(&out)
    );

    let listed = listed_model_ids(&stdout);
    assert!(
        listed.iter().any(|id| id == "cached-only-model"),
        "the cached model must be listed:\n{stdout}"
    );
    assert!(
        listed.iter().any(|id| id == "claude-sonnet-5"),
        "static specs the cache does not override must still be listed:\n{stdout}"
    );
}

/// A day-old cache reports "1 day ago", not "1 days ago" — the singular case is spelled out in
/// `format_age`.
#[test]
fn models_reports_a_one_day_old_cache_in_the_singular() {
    let fx = Fixture::new("cache-one-day");
    fx.write_cache(1);

    let stdout = stdout_of(&fx.run(&["models"]));
    assert!(
        stdout.contains("Source: models.dev cache (1 models, fetched 1 day ago)"),
        "{stdout}"
    );
}

/// Past the warn threshold the cache is still used, but the staleness goes to stderr so a piped
/// table is unaffected while an operator still sees the nag.
#[test]
fn models_warns_on_stderr_about_a_stale_cache_but_still_uses_it() {
    let fx = Fixture::new("cache-stale");
    fx.write_cache(10); // default warn threshold is 7 days, max is 30

    let out = fx.run(&["models"]);
    assert_eq!(exit_code(&out), 0);
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains("Source: models.dev cache (1 models, fetched 10 days ago)"),
        "{stdout}"
    );
    assert!(
        listed_model_ids(&stdout)
            .iter()
            .any(|id| id == "cached-only-model"),
        "a stale cache is still registered:\n{stdout}"
    );
    assert_eq!(
        stderr_of(&out).trim(),
        "warning: cache is 10 days ago; run 'tendril models --refresh' to update"
    );
}

/// Past the max-age threshold the cache is ignored entirely and the static catalogue takes over —
/// with the source line saying why, so the missing models are not a mystery.
#[test]
fn models_ignores_a_cache_past_the_max_age() {
    let fx = Fixture::new("cache-expired");
    fx.write_cache(40);

    let out = fx.run(&["models"]);
    assert_eq!(exit_code(&out), 0);
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains(
            "Source: static ModelSpecs offline fallback (models.dev cache ignored: 40 days old)"
        ),
        "{stdout}"
    );
    assert!(
        !listed_model_ids(&stdout)
            .iter()
            .any(|id| id == "cached-only-model"),
        "an expired cache must not be registered:\n{stdout}"
    );
}

/// A pre-envelope cache file has no recorded fetch time, which counts as expired at any threshold.
#[test]
fn models_ignores_a_legacy_cache_with_no_fetch_time() {
    let fx = Fixture::new("cache-legacy");
    fx.write_legacy_cache();

    let stdout = stdout_of(&fx.run(&["models"]));
    assert!(
        stdout.contains(
            "Source: static ModelSpecs offline fallback (models.dev cache ignored: no recorded \
             fetch time)"
        ),
        "{stdout}"
    );
    assert!(
        !listed_model_ids(&stdout)
            .iter()
            .any(|id| id == "cached-only-model"),
        "{stdout}"
    );
}

/// The thresholds are configurable, and the config must actually be read: a warn threshold of 1 day
/// makes a 2-day-old cache stale.
#[test]
fn models_honours_the_configured_cache_thresholds() {
    let fx = Fixture::new("cache-config");
    std::fs::write(
        fx.home.join("config.yaml"),
        "codingAgent: claude\nmodelCacheWarnAgeDays: 1\nmodelCacheMaxAgeDays: 3\n",
    )
    .unwrap();
    fx.write_cache(2);

    let out = fx.run(&["models"]);
    assert_eq!(exit_code(&out), 0);
    assert!(
        stderr_of(&out).contains("warning: cache is 2 days ago"),
        "a 2-day-old cache is stale under a 1-day warn threshold: {}",
        stderr_of(&out)
    );
    assert!(
        stdout_of(&out).contains("Source: models.dev cache (1 models, fetched 2 days ago)"),
        "{}",
        stdout_of(&out)
    );
}

/// An unparseable cache file is not fatal: `load_disk_cache` errors, the `if let Ok` skips it, and the
/// static catalogue is printed.
#[test]
fn models_falls_back_to_the_static_catalogue_for_an_unreadable_cache() {
    let fx = Fixture::new("cache-corrupt");
    let cache_dir = fx.home.join("cache");
    std::fs::create_dir_all(&cache_dir).unwrap();
    std::fs::write(cache_dir.join("models_cache.json"), "{ not json").unwrap();

    let out = fx.run(&["models"]);
    assert_eq!(
        exit_code(&out),
        0,
        "a corrupt cache must not fail the command"
    );
    assert!(
        stdout_of(&out).contains("Source: static ModelSpecs offline fallback"),
        "{}",
        stdout_of(&out)
    );
}

// ---------------------------------------------------------------------------
// --refresh
// ---------------------------------------------------------------------------

/// `--refresh` is the only network path in the command. The test forces the fetch to fail by
/// proxying it at a closed port, which pins the behaviour that matters: a refresh that cannot reach
/// models.dev reports the failure, prints the catalogue anyway, and exits 0.
///
/// This deliberately never depends on the machine having internet access.
#[test]
fn models_refresh_reports_a_failed_fetch_and_still_prints_the_catalogue() {
    let fx = Fixture::new("refresh-offline");

    let out = fx
        .command(&["models", "--refresh"])
        .env("HTTPS_PROXY", DEAD_PROXY)
        .env("https_proxy", DEAD_PROXY)
        .env("HTTP_PROXY", DEAD_PROXY)
        .env("http_proxy", DEAD_PROXY)
        .env("ALL_PROXY", DEAD_PROXY)
        .env("all_proxy", DEAD_PROXY)
        .env_remove("NO_PROXY")
        .env_remove("no_proxy")
        .output()
        .expect("run tendril");

    assert_eq!(
        exit_code(&out),
        0,
        "an unreachable models.dev is reported, not fatal; stderr:\n{}",
        stderr_of(&out)
    );
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains("Failed to refresh from models.dev:"),
        "the failure must be reported to the operator:\n{stdout}"
    );
    assert!(
        stdout.lines().any(|l| l.starts_with("MODEL ")),
        "the catalogue is still printed after a failed refresh:\n{stdout}"
    );
    assert!(
        stdout.contains("Source: static ModelSpecs offline fallback"),
        "a failed refresh falls back to the static catalogue:\n{stdout}"
    );
    assert!(
        !fx.home.join("cache").join("models_cache.json").exists(),
        "a failed fetch must not write a cache file"
    );
}

/// `--refresh` ignores the disk cache entirely — it does not read it, so an expired cache does not
/// change what a failed refresh reports.
#[test]
fn models_refresh_does_not_consult_the_disk_cache() {
    let fx = Fixture::new("refresh-ignores-cache");
    fx.write_cache(0);

    let out = fx
        .command(&["models", "--refresh"])
        .env("HTTPS_PROXY", DEAD_PROXY)
        .env("ALL_PROXY", DEAD_PROXY)
        .env_remove("NO_PROXY")
        .env_remove("no_proxy")
        .output()
        .expect("run tendril");

    assert_eq!(exit_code(&out), 0);
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains("Failed to refresh from models.dev:"),
        "{stdout}"
    );
    assert!(
        stdout.contains("Source: static ModelSpecs offline fallback"),
        "the fresh cache on disk is not consulted on the --refresh path:\n{stdout}"
    );
    assert!(
        !listed_model_ids(&stdout)
            .iter()
            .any(|id| id == "cached-only-model"),
        "{stdout}"
    );
}

// ---------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------

#[test]
fn models_usage_errors_exit_2() {
    let fx = Fixture::new("usage");
    for args in [
        vec!["models", "--bogus"],
        vec!["models", "--refrsh"],
        vec!["models", "unexpected-positional"],
    ] {
        let out = fx.run(&args);
        assert_eq!(exit_code(&out), 2, "{args:?} must be a clap usage error");
    }
}

#[test]
fn models_help_documents_refresh() {
    let fx = Fixture::new("help");
    let out = fx.run(&["models", "--help"]);
    assert_eq!(exit_code(&out), 0);
    assert!(stdout_of(&out).contains("--refresh"), "{}", stdout_of(&out));
}
