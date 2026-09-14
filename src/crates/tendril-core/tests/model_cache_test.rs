use std::borrow::Cow;
use std::sync::Mutex;
use tendril_core::agents::model_cache;
use tendril_core::agents::model_specs::{self, ModelSpec};
use tendril_core::agents::pricing;

/// `model_specs::register_dynamic_specs` mutates a process-wide static, and `cargo test`
/// runs the `#[test]` functions in this file concurrently by default. Serialize any test
/// that touches the dynamic registry so they don't stomp each other's state.
static DYNAMIC_REGISTRY_LOCK: Mutex<()> = Mutex::new(());

const SAMPLE_CATALOG: &str = r#"{
    "anthropic": {
        "id": "anthropic",
        "name": "Anthropic",
        "models": {
            "claude-test-model": {
                "id": "claude-test-model",
                "name": "Claude Test Model",
                "limit": { "context": 500000, "output": 32000 },
                "cost": { "input": 4.0, "output": 20.0, "cache_read": 0.4, "cache_write": 5.0 }
            },
            "claude-no-pricing": {
                "id": "claude-no-pricing",
                "name": "Claude No Pricing"
            }
        }
    }
}"#;

#[test]
fn test_parse_models_dev_sample() {
    let specs = model_cache::parse_catalog(SAMPLE_CATALOG).expect("sample catalog should parse");

    // Each model registers both a bare ID and a provider-qualified ID.
    assert_eq!(specs.len(), 4);

    let priced = specs
        .iter()
        .find(|s| s.model_id == "claude-test-model")
        .expect("bare id should be present");
    assert_eq!(priced.context_window, 500_000);
    assert_eq!(priced.max_output_tokens, 32_000);
    assert_eq!(priced.input_per_million, 4.0);
    assert_eq!(priced.output_per_million, 20.0);
    assert_eq!(priced.cache_read_per_million, 0.4);
    assert_eq!(priced.cache_write_per_million, 5.0);

    let qualified = specs
        .iter()
        .find(|s| s.model_id == "anthropic/claude-test-model")
        .expect("provider-qualified id should be present");
    assert_eq!(qualified.input_per_million, 4.0);

    // Missing limit/cost sections default to zero rather than failing to parse.
    let unpriced = specs
        .iter()
        .find(|s| s.model_id == "claude-no-pricing")
        .expect("model with no limit/cost should still parse");
    assert_eq!(unpriced.context_window, 0);
    assert_eq!(unpriced.max_output_tokens, 0);
    assert_eq!(unpriced.input_per_million, 0.0);
    assert_eq!(unpriced.output_per_million, 0.0);
}

#[test]
fn test_offline_static_fallback() {
    let _guard = DYNAMIC_REGISTRY_LOCK.lock().unwrap();
    model_specs::register_dynamic_specs(Vec::new());

    let spec = model_specs::find("claude-3-7-sonnet").expect("static spec should be found");
    assert_eq!(spec.context_window, 200_000);
    assert_eq!(spec.max_output_tokens, 64_000);
    assert_eq!(spec.input_per_million, 3.0);
}

#[test]
fn test_dynamic_spec_overrides() {
    let _guard = DYNAMIC_REGISTRY_LOCK.lock().unwrap();
    model_specs::register_dynamic_specs(vec![ModelSpec {
        model_id: Cow::Borrowed("claude-3-7-sonnet"),
        display_name: Cow::Borrowed("Claude 3.7 Sonnet (enriched)"),
        context_window: 999_000,
        max_output_tokens: 99_000,
        input_per_million: 1.23,
        output_per_million: 4.56,
        cache_read_per_million: 0.0,
        cache_write_per_million: 0.0,
    }]);

    let spec = model_specs::find("claude-3-7-sonnet").expect("spec should be found");
    assert_eq!(spec.context_window, 999_000);
    assert_eq!(spec.input_per_million, 1.23);

    // Clean up so this test's override doesn't leak into a sibling test's assertions.
    model_specs::register_dynamic_specs(Vec::new());
}

#[test]
fn test_disk_cache_persistence() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-model-cache-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).expect("failed to create test dir");

    let specs = vec![ModelSpec {
        model_id: Cow::Borrowed("cached-model"),
        display_name: Cow::Borrowed("Cached Model"),
        context_window: 128_000,
        max_output_tokens: 8_000,
        input_per_million: 0.5,
        output_per_million: 1.5,
        cache_read_per_million: 0.05,
        cache_write_per_million: 0.15,
    }];

    // No cache file yet: loading returns an empty catalog rather than an error.
    let loaded_before = model_cache::load_disk_cache(&tendril_home).expect("load should succeed");
    assert!(loaded_before.is_empty());

    model_cache::save_disk_cache(&tendril_home, &specs).expect("save should succeed");

    let loaded_after = model_cache::load_disk_cache(&tendril_home).expect("load should succeed");
    assert_eq!(loaded_after.specs.len(), 1);
    assert_eq!(loaded_after.specs[0].model_id, "cached-model");
    assert_eq!(loaded_after.specs[0].context_window, 128_000);
    assert_eq!(loaded_after.specs[0].input_per_million, 0.5);

    std::fs::remove_dir_all(&tendril_home).ok();
}

#[test]
fn test_cache_status_missing_cache() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-model-cache-status-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).expect("failed to create test dir");

    let status = model_cache::cache_status(&tendril_home);
    assert!(!status.exists);
    assert!(status.cached_at.is_none());
    assert_eq!(status.cached_model_count, 0);

    std::fs::remove_dir_all(&tendril_home).ok();
}

#[test]
fn test_cache_status_existing_cache() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-model-cache-status-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).expect("failed to create test dir");

    let specs = vec![
        ModelSpec {
            model_id: Cow::Borrowed("status-model-a"),
            display_name: Cow::Borrowed("Status Model A"),
            context_window: 128_000,
            max_output_tokens: 8_000,
            input_per_million: 0.5,
            output_per_million: 1.5,
            cache_read_per_million: 0.05,
            cache_write_per_million: 0.15,
        },
        ModelSpec {
            model_id: Cow::Borrowed("status-model-b"),
            display_name: Cow::Borrowed("Status Model B"),
            context_window: 64_000,
            max_output_tokens: 4_000,
            input_per_million: 0.25,
            output_per_million: 0.75,
            cache_read_per_million: 0.025,
            cache_write_per_million: 0.075,
        },
    ];
    model_cache::save_disk_cache(&tendril_home, &specs).expect("save should succeed");

    let status = model_cache::cache_status(&tendril_home);
    assert!(status.exists);
    assert!(status.cached_at.is_some());
    assert_eq!(status.cached_model_count, 2);
    assert!(status.path.ends_with("cache/models_cache.json"));

    std::fs::remove_dir_all(&tendril_home).ok();
}

#[test]
fn test_disk_cache_records_fetched_at() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-model-cache-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).expect("failed to create test dir");

    let specs = vec![ModelSpec {
        model_id: Cow::Borrowed("cached-model"),
        display_name: Cow::Borrowed("Cached Model"),
        context_window: 128_000,
        max_output_tokens: 8_000,
        input_per_million: 0.5,
        output_per_million: 1.5,
        cache_read_per_million: 0.05,
        cache_write_per_million: 0.15,
    }];

    model_cache::save_disk_cache(&tendril_home, &specs).expect("save should succeed");

    let loaded = model_cache::load_disk_cache(&tendril_home).expect("load should succeed");
    assert_eq!(loaded.specs.len(), 1);
    assert_eq!(loaded.specs[0].model_id, "cached-model");

    let fetched_at = loaded.fetched_at.expect("fetched_at should be recorded");
    let age = chrono::Utc::now() - fetched_at;
    assert!(age.num_seconds() >= 0 && age.num_seconds() < 60);

    std::fs::remove_dir_all(&tendril_home).ok();
}

#[test]
fn test_legacy_cache_without_timestamp_loads() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-model-cache-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let cache_dir = tendril_home.join("cache");
    std::fs::create_dir_all(&cache_dir).expect("failed to create test dir");

    let legacy_json = r#"[
        {
            "model_id": "legacy-model",
            "display_name": "Legacy Model",
            "context_window": 64000,
            "max_output_tokens": 4000,
            "input_per_million": 1.0,
            "output_per_million": 2.0,
            "cache_read_per_million": 0.1,
            "cache_write_per_million": 0.2
        }
    ]"#;
    std::fs::write(cache_dir.join("models_cache.json"), legacy_json)
        .expect("failed to write legacy cache file");

    let loaded = model_cache::load_disk_cache(&tendril_home).expect("load should succeed");
    assert_eq!(loaded.specs.len(), 1);
    assert_eq!(loaded.specs[0].model_id, "legacy-model");
    assert!(loaded.fetched_at.is_none());

    std::fs::remove_dir_all(&tendril_home).ok();
}

#[test]
fn test_classify_fresh_stale_expired() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-model-cache-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).expect("failed to create test dir");

    let specs = vec![ModelSpec {
        model_id: Cow::Borrowed("aged-model"),
        display_name: Cow::Borrowed("Aged Model"),
        context_window: 1,
        max_output_tokens: 1,
        input_per_million: 0.0,
        output_per_million: 0.0,
        cache_read_per_million: 0.0,
        cache_write_per_million: 0.0,
    }];

    let now = chrono::Utc::now();

    model_cache::save_disk_cache_at(&tendril_home, &specs, now - chrono::Duration::days(1))
        .expect("save should succeed");
    let fresh = model_cache::load_disk_cache(&tendril_home).expect("load should succeed");
    assert!(matches!(
        model_cache::classify(&fresh, 7, 30),
        model_cache::CacheFreshness::Fresh { .. }
    ));

    model_cache::save_disk_cache_at(&tendril_home, &specs, now - chrono::Duration::days(10))
        .expect("save should succeed");
    let stale = model_cache::load_disk_cache(&tendril_home).expect("load should succeed");
    assert!(matches!(
        model_cache::classify(&stale, 7, 30),
        model_cache::CacheFreshness::Stale { .. }
    ));

    model_cache::save_disk_cache_at(&tendril_home, &specs, now - chrono::Duration::days(60))
        .expect("save should succeed");
    let expired = model_cache::load_disk_cache(&tendril_home).expect("load should succeed");
    assert!(matches!(
        model_cache::classify(&expired, 7, 30),
        model_cache::CacheFreshness::Expired { .. }
    ));

    std::fs::remove_dir_all(&tendril_home).ok();
}

#[test]
fn test_classify_missing_timestamp_is_expired() {
    let catalog = model_cache::CachedCatalog {
        specs: vec![ModelSpec {
            model_id: Cow::Borrowed("legacy-model"),
            display_name: Cow::Borrowed("Legacy Model"),
            context_window: 1,
            max_output_tokens: 1,
            input_per_million: 0.0,
            output_per_million: 0.0,
            cache_read_per_million: 0.0,
            cache_write_per_million: 0.0,
        }],
        fetched_at: None,
    };

    assert!(matches!(
        model_cache::classify(&catalog, 7, 30),
        model_cache::CacheFreshness::Expired { age_days: None }
    ));
}

#[test]
fn test_classify_thresholds_disabled() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-model-cache-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).expect("failed to create test dir");

    let specs = vec![ModelSpec {
        model_id: Cow::Borrowed("very-old-model"),
        display_name: Cow::Borrowed("Very Old Model"),
        context_window: 1,
        max_output_tokens: 1,
        input_per_million: 0.0,
        output_per_million: 0.0,
        cache_read_per_million: 0.0,
        cache_write_per_million: 0.0,
    }];

    model_cache::save_disk_cache_at(
        &tendril_home,
        &specs,
        chrono::Utc::now() - chrono::Duration::days(400),
    )
    .expect("save should succeed");
    let catalog = model_cache::load_disk_cache(&tendril_home).expect("load should succeed");

    assert!(matches!(
        model_cache::classify(&catalog, 0, 0),
        model_cache::CacheFreshness::Fresh { .. }
    ));

    std::fs::remove_dir_all(&tendril_home).ok();
}

#[test]
fn test_expired_cache_falls_back_to_static_specs() {
    let _guard = DYNAMIC_REGISTRY_LOCK.lock().unwrap();
    model_specs::register_dynamic_specs(Vec::new());

    // Simulate the load-time decision an Expired classification implies: never register.
    let spec = model_specs::find("claude-3-7-sonnet").expect("static spec should be found");
    assert_eq!(spec.context_window, 200_000);
    assert_eq!(spec.input_per_million, 3.0);
}

#[test]
fn test_pricing_calculation_with_dynamic_model() {
    let _guard = DYNAMIC_REGISTRY_LOCK.lock().unwrap();
    model_specs::register_dynamic_specs(vec![ModelSpec {
        model_id: Cow::Borrowed("dynamic-only-model"),
        display_name: Cow::Borrowed("Dynamic Only Model"),
        context_window: 64_000,
        max_output_tokens: 4_000,
        input_per_million: 2.0,
        output_per_million: 8.0,
        cache_read_per_million: 0.2,
        cache_write_per_million: 1.0,
    }]);

    let price = pricing::get_model_price("dynamic-only-model");
    assert_eq!(price.input_per_million, 2.0);
    assert_eq!(price.output_per_million, 8.0);

    let cost = pricing::calculate_cost("dynamic-only-model", 1_000_000, 1_000_000, 0, 0);
    assert!((cost - 10.0).abs() < 1e-6);

    model_specs::register_dynamic_specs(Vec::new());
}

#[test]
fn test_enrichment_interval_mapping() {
    assert_eq!(
        model_cache::enrichment_interval(12),
        Some(std::time::Duration::from_secs(43_200))
    );
    assert_eq!(model_cache::enrichment_interval(0), None);
    assert_eq!(model_cache::enrichment_interval(-1), None);
}

#[tokio::test(start_paused = true)]
async fn test_enrichment_loop_fires_immediately_then_on_period() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    let count = Arc::new(AtomicUsize::new(0));
    let count_clone = count.clone();
    let handle = tokio::spawn(async move {
        model_cache::run_enrichment_loop(std::time::Duration::from_secs(3600), move || {
            let count = count_clone.clone();
            async move {
                count.fetch_add(1, Ordering::SeqCst);
                Ok(1)
            }
        })
        .await;
    });

    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    assert_eq!(count.load(Ordering::SeqCst), 1);

    tokio::time::advance(std::time::Duration::from_secs(3600)).await;
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    assert_eq!(count.load(Ordering::SeqCst), 2);

    handle.abort();
}

#[tokio::test(start_paused = true)]
async fn test_enrichment_loop_survives_a_failed_refresh() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    let count = Arc::new(AtomicUsize::new(0));
    let count_clone = count.clone();
    let handle = tokio::spawn(async move {
        model_cache::run_enrichment_loop(std::time::Duration::from_secs(3600), move || {
            let count = count_clone.clone();
            async move {
                let call = count.fetch_add(1, Ordering::SeqCst);
                if call == 0 {
                    Err(anyhow::anyhow!("offline"))
                } else {
                    Ok(7)
                }
            }
        })
        .await;
    });

    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    assert_eq!(count.load(Ordering::SeqCst), 1);

    tokio::time::advance(std::time::Duration::from_secs(3600)).await;
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    assert_eq!(count.load(Ordering::SeqCst), 2);

    handle.abort();
}
