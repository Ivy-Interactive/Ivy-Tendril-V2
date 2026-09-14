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

    // No cache file yet: loading returns an empty vec rather than an error.
    let loaded_before = model_cache::load_disk_cache(&tendril_home).expect("load should succeed");
    assert!(loaded_before.is_empty());

    model_cache::save_disk_cache(&tendril_home, &specs).expect("save should succeed");

    let loaded_after = model_cache::load_disk_cache(&tendril_home).expect("load should succeed");
    assert_eq!(loaded_after.len(), 1);
    assert_eq!(loaded_after[0].model_id, "cached-model");
    assert_eq!(loaded_after[0].context_window, 128_000);
    assert_eq!(loaded_after[0].input_per_million, 0.5);

    std::fs::remove_dir_all(&tendril_home).ok();
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
