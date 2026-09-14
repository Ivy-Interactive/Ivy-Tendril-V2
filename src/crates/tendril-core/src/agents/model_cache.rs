use crate::agents::model_specs::{self, ModelSpec};
use anyhow::{Context, Result};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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

pub fn cache_path(tendril_home: &Path) -> PathBuf {
    tendril_home.join("cache").join("models_cache.json")
}

/// Facts about the on-disk models.dev cache, for status reporting. `None` timestamps
/// mean the cache file does not exist yet (static fallback is in use).
pub struct CacheStatus {
    pub path: PathBuf,
    pub exists: bool,
    pub cached_at: Option<chrono::DateTime<chrono::Utc>>,
    pub cached_model_count: usize,
}

/// Reports facts about the on-disk models.dev cache without erroring on a missing or
/// unparseable cache file — those are reported as `exists: false` / count `0` instead.
pub fn cache_status(tendril_home: &Path) -> CacheStatus {
    let path = cache_path(tendril_home);
    let metadata = std::fs::metadata(&path).ok();
    let exists = metadata.is_some();
    let cached_at = metadata
        .and_then(|m| m.modified().ok())
        .map(chrono::DateTime::<chrono::Utc>::from);
    let cached_model_count = load_disk_cache(tendril_home)
        .map(|specs| specs.len())
        .unwrap_or(0);

    CacheStatus {
        path,
        exists,
        cached_at,
        cached_model_count,
    }
}

/// Reads and deserializes cached specs on startup without any network access.
/// Returns an empty vec (not an error) when no cache file exists yet.
pub fn load_disk_cache(tendril_home: &Path) -> Result<Vec<ModelSpec>> {
    let path = cache_path(tendril_home);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("failed to read model cache at {}", path.display()))?;
    let specs: Vec<ModelSpec> = serde_json::from_str(&content)
        .with_context(|| format!("failed to parse model cache at {}", path.display()))?;
    Ok(specs)
}

/// Atomically saves the given specs to the disk cache (write to a temp file, then rename).
pub fn save_disk_cache(tendril_home: &Path, specs: &[ModelSpec]) -> Result<()> {
    let path = cache_path(tendril_home);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create cache directory {}", parent.display()))?;
    }

    let json = serde_json::to_string_pretty(specs).context("failed to serialize model cache")?;
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
