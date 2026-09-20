use std::borrow::Cow;
use std::sync::Mutex;
use tendril_core::agents::model_specs::{self, ModelSpec};
use tendril_core::agents::pricing;

/// `register_dynamic_specs` mutates a process-wide static and `cargo test` runs this file's tests
/// concurrently, so anything touching the registry serializes on this. Same reason, same shape as
/// `model_cache_test.rs`.
static DYNAMIC_REGISTRY_LOCK: Mutex<()> = Mutex::new(());

/// A catalog row with nothing but an id and a rate card, which is all these tests price against.
fn spec(id: &'static str, input: f64, output: f64, cache_read: f64, cache_write: f64) -> ModelSpec {
    ModelSpec {
        model_id: Cow::Borrowed(id),
        display_name: Cow::Borrowed(id),
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: input,
        output_per_million: output,
        cache_read_per_million: cache_read,
        cache_write_per_million: cache_write,
    }
}

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

/// models.dev lists a model under every provider that resells it, and a provider publishing no
/// `cost` block parses to a rate card of zeros, because `parse_catalog` defaults each missing field
/// to `0.0`. `find` returned whichever duplicate the HashMap iteration order happened to put first.
///
/// This is the bug the user hit: the live catalog carried 18 `claude-opus-5` rows, three of them
/// such placeholders, and the zero-rate one sorted first. A real 1.25M-token run that the agent
/// itself billed at $1.2584 was priced at $0.00 and stamped `estimated`, so the Jobs table read
/// `$0.00` -- "this run was free" -- rather than `—`.
#[test]
fn a_zero_rate_duplicate_never_outbids_a_priced_one() {
    let _guard = DYNAMIC_REGISTRY_LOCK.lock().unwrap();
    model_specs::register_dynamic_specs(vec![
        // Order matters: the unpriced row is first, exactly as it was in the user's cache.
        spec("claude-opus-5", 0.0, 0.0, 0.0, 0.0),
        spec("claude-opus-5", 5.0, 25.0, 0.50, 6.25),
    ]);

    let found = model_specs::find("claude-opus-5").expect("a duplicated id is still found");
    assert_eq!(
        (found.input_per_million, found.output_per_million),
        (5.0, 25.0),
        "the priced duplicate must win, whatever order the catalog listed them in"
    );

    // The figure the user's own agent output reported, to the cent.
    let cost = pricing::calculate_cost("claude-opus-5", 37, 9_548, 1_172_885, 69_295);
    assert!(
        (cost - 1.25842125).abs() < 1e-6,
        "the run the user saw billed at ~$1.26 must price to that, not $0.00: got {cost}"
    );

    model_specs::register_dynamic_specs(Vec::new());
}

/// The other half of the same rule: when *nothing* can price the model, the cost writers must record
/// nothing rather than a zero. `—` and `$0.00` are different claims, and the codebase draws that
/// distinction deliberately (`JobsView.tsx`, `cost_backfill.rs`), so an all-zero card has to read as
/// a gap in the catalog rather than as a free run.
#[test]
fn an_all_zero_rate_card_prices_nothing_rather_than_zero() {
    let _guard = DYNAMIC_REGISTRY_LOCK.lock().unwrap();
    model_specs::register_dynamic_specs(vec![spec("zero-card-fixture", 0.0, 0.0, 0.0, 0.0)]);

    let found = model_specs::find("zero-card-fixture").expect("the id is in the catalog");
    assert!(
        !model_specs::is_priced(&found),
        "a card with no rate on it cannot price anything"
    );
    assert_eq!(
        pricing::find_model_price("zero-card-fixture"),
        None,
        "the cost writers must be told there is no price, not handed zeros"
    );
    assert_eq!(
        pricing::try_calculate_cost("zero-card-fixture", 1_000_000, 1_000_000, 0, 0),
        None,
        "an unpriceable run records no cost at all, so the UI renders the em dash"
    );

    model_specs::register_dynamic_specs(Vec::new());
}

/// `apple/system` is the one model whose zero rates are the truth -- it runs on the device and bills
/// nothing -- and `agent_launch_args_test` pins that the launched id resolves to a 0.0/0.0 card.
/// Demoting unpriced rows must not disturb it: nothing else in any catalog claims that id, so there
/// is no priced row for it to lose to.
#[test]
fn the_on_device_model_still_resolves_to_its_free_card() {
    let _guard = DYNAMIC_REGISTRY_LOCK.lock().unwrap();
    model_specs::register_dynamic_specs(Vec::new());

    let spec = model_specs::find("apple/system").expect("the on-device model stays findable");
    assert_eq!(spec.model_id.as_ref(), "apple/system");
    assert_eq!(
        (spec.input_per_million, spec.output_per_million),
        (0.0, 0.0)
    );
}

/// Pricedness breaks ties between rows for the *same* model; it must never promote a different,
/// less specific model. A short priced key that is a substring of a long unpriced one would
/// otherwise bill a run against the wrong model entirely, which is worse than recording nothing.
#[test]
fn specificity_still_beats_pricedness_in_the_pattern_tier() {
    let _guard = DYNAMIC_REGISTRY_LOCK.lock().unwrap();
    model_specs::register_dynamic_specs(vec![
        spec("some-model", 9.0, 9.0, 9.0, 9.0),
        spec("some-model-pro-max", 0.0, 0.0, 0.0, 0.0),
    ]);

    let found = model_specs::find("vendor:some-model-pro-max-20260101").expect("pattern match");
    assert_eq!(
        found.model_id.as_ref(),
        "some-model-pro-max",
        "the longest matching key is still the model; pricedness only picks among its duplicates"
    );
    assert_eq!(
        pricing::try_calculate_cost("vendor:some-model-pro-max-20260101", 1_000_000, 0, 0, 0),
        None,
        "recording nothing beats billing the run against a different model"
    );

    model_specs::register_dynamic_specs(Vec::new());
}
