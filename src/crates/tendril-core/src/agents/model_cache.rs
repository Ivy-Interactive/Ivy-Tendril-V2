use crate::agents::model_specs::{self, ModelSpec};
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

const MODELS_DEV_URL: &str = "https://models.dev/api.json";

pub type ModelsDevCatalog = HashMap<String, ModelsDevProvider>;

#[derive(Debug, Deserialize)]
pub struct ModelsDevProvider {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub models: HashMap<String, ModelsDevModel>,
}

#[derive(Debug, Deserialize)]
pub struct ModelsDevModel {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub limit: Option<ModelsDevLimit>,
    #[serde(default)]
    pub cost: Option<ModelsDevCost>,
}

#[derive(Debug, Deserialize)]
pub struct ModelsDevLimit {
    #[serde(default)]
    pub context: Option<u64>,
    #[serde(default)]
    pub output: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct ModelsDevCost {
    #[serde(default)]
    pub input: Option<f64>,
    #[serde(default)]
    pub output: Option<f64>,
    #[serde(default, rename = "cache_read")]
    pub cache_read: Option<f64>,
    #[serde(default, rename = "cache_write")]
    pub cache_write: Option<f64>,
}

/// Parses a raw models.dev `api.json` payload into `ModelSpec`s, registering both the bare
/// model ID (`claude-sonnet-4-6`) and the provider-qualified ID (`anthropic/claude-sonnet-4-6`)
/// for each model so lookups work regardless of which form callers pass in.
pub fn parse_catalog(json: &str) -> Result<Vec<ModelSpec>> {
    let catalog: ModelsDevCatalog =
        serde_json::from_str(json).context("failed to parse models.dev catalog")?;

    let mut specs = Vec::new();
    for (provider_key, provider) in catalog.iter() {
        for (model_key, model) in provider.models.iter() {
            let bare_id = model.id.clone().unwrap_or_else(|| model_key.clone());
            let display_name = model.name.clone().unwrap_or_else(|| bare_id.clone());
            let context_window = model.limit.as_ref().and_then(|l| l.context).unwrap_or(0);
            let max_output_tokens = model.limit.as_ref().and_then(|l| l.output).unwrap_or(0);
            let input_per_million = model.cost.as_ref().and_then(|c| c.input).unwrap_or(0.0);
            let output_per_million = model.cost.as_ref().and_then(|c| c.output).unwrap_or(0.0);
            let cache_read_per_million = model
                .cost
                .as_ref()
                .and_then(|c| c.cache_read)
                .unwrap_or(0.0);
            let cache_write_per_million = model
                .cost
                .as_ref()
                .and_then(|c| c.cache_write)
                .unwrap_or(0.0);

            let qualified_id = format!("{}/{}", provider_key, bare_id);

            specs.push(ModelSpec {
                model_id: Cow::Owned(bare_id),
                display_name: Cow::Owned(display_name.clone()),
                context_window,
                max_output_tokens,
                input_per_million,
                output_per_million,
                cache_read_per_million,
                cache_write_per_million,
            });

            specs.push(ModelSpec {
                model_id: Cow::Owned(qualified_id),
                display_name: Cow::Owned(display_name),
                context_window,
                max_output_tokens,
                input_per_million,
                output_per_million,
                cache_read_per_million,
                cache_write_per_million,
            });
        }
    }

    Ok(specs)
}

/// Soft threshold: cache is still used, but its age is reported as a warning.
pub const DEFAULT_CACHE_WARN_AGE_DAYS: i64 = 7;
/// Hard threshold: cache is ignored entirely and the static SPECS table is used.
pub const DEFAULT_CACHE_MAX_AGE_DAYS: i64 = 30;

/// On-disk cache envelope. Written by `save_disk_cache`.
#[derive(Debug, Serialize, Deserialize)]
struct CacheFile {
    #[serde(rename = "fetchedAt")]
    fetched_at: DateTime<Utc>,
    specs: Vec<ModelSpec>,
}

/// A loaded cache plus how old it is. `fetched_at` is `None` for a legacy
/// (pre-envelope) cache file, which has no recorded fetch time.
#[derive(Debug, Default)]
pub struct CachedCatalog {
    pub specs: Vec<ModelSpec>,
    pub fetched_at: Option<DateTime<Utc>>,
}

impl CachedCatalog {
    pub fn is_empty(&self) -> bool {
        self.specs.is_empty()
    }

    /// Age in whole days, or `None` when no timestamp was recorded.
    pub fn age_days(&self, now: DateTime<Utc>) -> Option<i64> {
        self.fetched_at.map(|t| (now - t).num_days().max(0))
    }

    /// A legacy cache with no timestamp counts as stale at any threshold.
    pub fn is_older_than(&self, now: DateTime<Utc>, days: i64) -> bool {
        match self.age_days(now) {
            Some(age) => age >= days,
            None => true,
        }
    }
}

/// How a loaded cache should be treated relative to the configured age thresholds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheFreshness {
    /// Younger than the warn threshold (or the warn threshold is disabled).
    Fresh { age_days: Option<i64> },
    /// Past the warn threshold but still usable.
    Stale { age_days: Option<i64> },
    /// Past the max age threshold; must not be registered.
    Expired { age_days: Option<i64> },
}

/// Classifies a cache's freshness against the configured warn/max-age thresholds
/// (in days). A threshold of `<= 0` disables that tier. `Expired` takes priority
/// over `Stale` when both thresholds are exceeded, and a cache with no recorded
/// fetch time (a legacy pre-envelope file) is always `Expired`.
pub fn classify(catalog: &CachedCatalog, warn_days: i64, max_days: i64) -> CacheFreshness {
    let now = Utc::now();
    let age_days = catalog.age_days(now);

    if max_days > 0 && catalog.is_older_than(now, max_days) {
        return CacheFreshness::Expired { age_days };
    }
    if warn_days > 0 && catalog.is_older_than(now, warn_days) {
        return CacheFreshness::Stale { age_days };
    }
    CacheFreshness::Fresh { age_days }
}

fn cache_file_path(tendril_home: &Path) -> PathBuf {
    tendril_home.join("cache").join("models_cache.json")
}

/// Reads and deserializes the cached specs on startup without any network access.
/// Returns an empty `CachedCatalog` (not an error) when no cache file exists yet.
///
/// A cache written before this change has no `fetchedAt` envelope — it is read as
/// a bare `Vec<ModelSpec>` and returned with `fetched_at: None`.
pub fn load_disk_cache(tendril_home: &Path) -> Result<CachedCatalog> {
    let path = cache_file_path(tendril_home);
    if !path.exists() {
        return Ok(CachedCatalog::default());
    }

    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("failed to read model cache at {}", path.display()))?;

    if let Ok(file) = serde_json::from_str::<CacheFile>(&content) {
        return Ok(CachedCatalog {
            specs: file.specs,
            fetched_at: Some(file.fetched_at),
        });
    }

    let specs: Vec<ModelSpec> = serde_json::from_str(&content)
        .with_context(|| format!("failed to parse model cache at {}", path.display()))?;
    Ok(CachedCatalog {
        specs,
        fetched_at: None,
    })
}

/// Atomically saves the given specs to the disk cache (write to a temp file, then rename),
/// stamped with the current time as the fetch time.
pub fn save_disk_cache(tendril_home: &Path, specs: &[ModelSpec]) -> Result<()> {
    save_disk_cache_at(tendril_home, specs, Utc::now())
}

/// Same as `save_disk_cache`, but with an explicit `fetched_at` timestamp — used by tests
/// to write a cache of a known age.
pub fn save_disk_cache_at(
    tendril_home: &Path,
    specs: &[ModelSpec],
    fetched_at: DateTime<Utc>,
) -> Result<()> {
    let path = cache_file_path(tendril_home);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create cache directory {}", parent.display()))?;
    }

    let file = CacheFile {
        fetched_at,
        specs: specs.to_vec(),
    };
    let json = serde_json::to_string_pretty(&file).context("failed to serialize model cache")?;
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, json)
        .with_context(|| format!("failed to write temp model cache at {}", tmp_path.display()))?;
    std::fs::rename(&tmp_path, &path)
        .with_context(|| format!("failed to finalize model cache at {}", path.display()))?;
    Ok(())
}

/// Fetches the live models.dev catalog, saves it to the disk cache, and registers it as the
/// active dynamic model registry. Returns the number of specs enriched on success.
pub async fn fetch_live_models(client: &reqwest::Client, tendril_home: &Path) -> Result<usize> {
    let response = client
        .get(MODELS_DEV_URL)
        .send()
        .await
        .context("failed to reach models.dev")?
        .error_for_status()
        .context("models.dev returned an error status")?;
    let body = response
        .text()
        .await
        .context("failed to read models.dev response body")?;

    let specs = parse_catalog(&body)?;
    save_disk_cache(tendril_home, &specs)?;
    let count = specs.len();
    model_specs::register_dynamic_specs(specs);
    Ok(count)
}

/// Default cadence for background models.dev refreshes, in hours.
pub const DEFAULT_ENRICHMENT_INTERVAL_HOURS: i32 = 12;

/// Maps a configured cadence in hours to a tick period. A non-positive value means
/// "refresh once at startup and never again", which is how the daemon behaved before
/// periodic refresh existed.
pub fn enrichment_interval(hours: i32) -> Option<Duration> {
    (hours > 0).then(|| Duration::from_secs(hours as u64 * 3600))
}

/// Logs the outcome of a single enrichment attempt, used identically by the startup-only
/// path and every tick of the repeating loop.
async fn refresh_and_log<Fut>(fut: Fut)
where
    Fut: std::future::Future<Output = Result<usize>>,
{
    match fut.await {
        Ok(count) => {
            tracing::info!("Enriched model specs cache from models.dev ({count} models)")
        }
        Err(err) => {
            tracing::warn!("models.dev live enrichment skipped (offline or network error): {err}")
        }
    }
}

/// Drives `refresh` on a fixed cadence forever, logging each outcome. The first tick of a
/// `tokio::time::interval` fires immediately, so the caller still gets a refresh at startup.
/// An error never ends the loop — a transient outage must not disable enrichment for the
/// lifetime of the process.
pub async fn run_enrichment_loop<F, Fut>(period: Duration, mut refresh: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<usize>>,
{
    let mut ticker = tokio::time::interval(period);
    // Delay rather than Burst: after a laptop sleeps through several periods we want one
    // catch-up refresh, not a rapid-fire series of them.
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticker.tick().await;
        refresh_and_log(refresh()).await;
    }
}

/// Spawns background models.dev enrichment for `tendril_home`. `period: Some(d)` refreshes
/// immediately and then every `d`; `None` refreshes exactly once.
pub fn spawn_enrichment(
    tendril_home: PathBuf,
    period: Option<Duration>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();
        let refresh = move || {
            let client = client.clone();
            let home = tendril_home.clone();
            async move { fetch_live_models(&client, &home).await }
        };
        match period {
            Some(period) => run_enrichment_loop(period, refresh).await,
            None => refresh_and_log(refresh()).await,
        }
    })
}
