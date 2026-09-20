use crate::agents::model_specs;

#[derive(Debug, Clone, PartialEq)]
pub struct ModelPrice {
    pub input_per_million: f64,
    pub output_per_million: f64,
    pub cache_read_per_million: f64,
    pub cache_write_per_million: f64,
}

/// The rate card for a model, or `None` when nothing can price it.
///
/// Separate from [`get_model_price`] because the two callers want opposite things from a miss:
/// `get_model_price` guesses at Sonnet rates so a live run still shows *a* number, while the cost
/// writers must record nothing at all rather than a figure nobody was billed. Only a card with a
/// rate on it counts -- see [`model_specs::is_priced`] for why an all-zero card from models.dev is a
/// gap in the catalog and not a free model.
pub fn find_model_price(model_name: &str) -> Option<ModelPrice> {
    let spec = model_specs::find(model_name)?;
    if !model_specs::is_priced(&spec) {
        return None;
    }
    Some(ModelPrice {
        input_per_million: spec.input_per_million,
        output_per_million: spec.output_per_million,
        cache_read_per_million: spec.cache_read_per_million,
        cache_write_per_million: spec.cache_write_per_million,
    })
}

pub fn get_model_price(model_name: &str) -> ModelPrice {
    if let Some(spec) = model_specs::find(model_name) {
        ModelPrice {
            input_per_million: spec.input_per_million,
            output_per_million: spec.output_per_million,
            cache_read_per_million: spec.cache_read_per_million,
            cache_write_per_million: spec.cache_write_per_million,
        }
    } else {
        // Fallback default
        ModelPrice {
            input_per_million: 3.0,
            output_per_million: 15.0,
            cache_read_per_million: 0.30,
            cache_write_per_million: 3.75,
        }
    }
}

pub fn calculate_cost(
    model: &str,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
) -> f64 {
    let price = get_model_price(model);
    let in_cost = (input_tokens as f64 / 1_000_000.0) * price.input_per_million;
    let out_cost = (output_tokens as f64 / 1_000_000.0) * price.output_per_million;
    let read_cost = (cache_read_tokens as f64 / 1_000_000.0) * price.cache_read_per_million;
    let write_cost = (cache_write_tokens as f64 / 1_000_000.0) * price.cache_write_per_million;
    in_cost + out_cost + read_cost + write_cost
}

/// [`calculate_cost`], but `None` rather than a guess when no rate card can price the model.
///
/// What the cost *writers* want. `calculate_cost` falls back to hardcoded Sonnet rates, which is
/// defensible for a live display and indefensible for a stored figure: it invents money. Callers
/// that persist a cost use this and record nothing on a `None`, so the UI renders `—` ("no cost
/// known") instead of `$0.00` ("this run was free") -- two different claims.
pub fn try_calculate_cost(
    model: &str,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
) -> Option<f64> {
    let price = find_model_price(model)?;
    let in_cost = (input_tokens as f64 / 1_000_000.0) * price.input_per_million;
    let out_cost = (output_tokens as f64 / 1_000_000.0) * price.output_per_million;
    let read_cost = (cache_read_tokens as f64 / 1_000_000.0) * price.cache_read_per_million;
    let write_cost = (cache_write_tokens as f64 / 1_000_000.0) * price.cache_write_per_million;
    Some(in_cost + out_cost + read_cost + write_cost)
}
