use tendril_core::agents::model_specs;
use tendril_core::agents::pricing;

#[test]
fn test_exact_model_lookup() {
    let sonnet = model_specs::find("claude-3-7-sonnet").expect("claude-3-7-sonnet should be found");
    assert_eq!(sonnet.model_id, "claude-3-7-sonnet");
    assert_eq!(sonnet.context_window, 200_000);
    assert_eq!(sonnet.max_output_tokens, 64_000);

    let gpt4o = model_specs::find("gpt-4o").expect("gpt-4o should be found");
    assert_eq!(gpt4o.model_id, "gpt-4o");
    assert_eq!(gpt4o.context_window, 128_000);
    assert_eq!(gpt4o.max_output_tokens, 16_000);

    let gemini = model_specs::find("gemini-3.8-flash").expect("gemini-3.8-flash should be found");
    assert_eq!(gemini.model_id, "gemini-3.8-flash");
    assert_eq!(gemini.context_window, 1_000_000);
    assert_eq!(gemini.max_output_tokens, 65_536);
}

#[test]
fn test_prefix_stripping() {
    let sonnet =
        model_specs::find("anthropic/claude-3-7-sonnet").expect("should strip anthropic/ prefix");
    assert_eq!(sonnet.model_id, "claude-3-7-sonnet");

    let opus =
        model_specs::find("eu.anthropic.claude-opus-5").expect("should strip eu.anthropic. prefix");
    assert_eq!(opus.model_id, "claude-opus-5");

    let gpt4o = model_specs::find("openai/gpt-4o").expect("should strip openai/ prefix");
    assert_eq!(gpt4o.model_id, "gpt-4o");
}

#[test]
fn test_normalization() {
    let dash = model_specs::find("claude-3-5-sonnet").expect("dash model should be found");
    let dot = model_specs::find("claude-3.5-sonnet").expect("dot model should be found");
    assert_eq!(dash, dot);
    assert_eq!(dash.model_id, "claude-3-5-sonnet");

    let upper = model_specs::find("CLAUDE-3-5-SONNET").expect("uppercase should be normalized");
    assert_eq!(upper.model_id, "claude-3-5-sonnet");

    let mixed = model_specs::find("Claude-Opus-5.1").expect("mixed case and dot should normalize");
    assert_eq!(mixed.model_id, "claude-opus-5-1");
}

#[test]
fn test_longest_pattern_preference() {
    let spec = model_specs::find("claude-opus-4-8").expect("claude-opus-4-8 should be found");
    assert_eq!(spec.model_id, "claude-opus-4-8");
    assert_eq!(spec.input_per_million, 5.0);
    assert_eq!(spec.output_per_million, 25.0);
    // Ensure it is not shadowed by claude-opus-4 (which has 15.0/75.0)
    assert_ne!(spec.input_per_million, 15.0);
    assert_ne!(spec.output_per_million, 75.0);
}

#[test]
fn test_cost_calculation() {
    let spec = model_specs::find("claude-3-7-sonnet").expect("spec found");
    let spec_cost = spec.calculate_cost(1_000_000, 1_000_000, 1_000_000, 1_000_000);
    // 3.0 + 15.0 + 0.30 + 3.75 = 22.05
    assert!((spec_cost - 22.05).abs() < 1e-6);

    let cost = pricing::calculate_cost(
        "claude-3-7-sonnet",
        1_000_000,
        1_000_000,
        1_000_000,
        1_000_000,
    );
    assert!((cost - 22.05).abs() < 1e-6);

    // Half million tokens
    let half_cost = pricing::calculate_cost("claude-3-7-sonnet", 500_000, 500_000, 0, 0);
    assert!((half_cost - 9.0).abs() < 1e-6);
}

#[test]
fn test_unknown_model_fallback() {
    assert!(model_specs::find("unknown-model-xyz-123").is_none());

    let price = pricing::get_model_price("unknown-model-xyz-123");
    assert_eq!(price.input_per_million, 3.0);
    assert_eq!(price.output_per_million, 15.0);
    assert_eq!(price.cache_read_per_million, 0.30);
    assert_eq!(price.cache_write_per_million, 3.75);

    let cost = pricing::calculate_cost("unknown-model-xyz-123", 1_000_000, 0, 0, 0);
    assert!((cost - 3.0).abs() < 1e-6);
}
