use crate::agents::model_specs;

#[derive(Debug, Clone, PartialEq)]
pub struct ModelPrice {
    pub input_per_million: f64,
    pub output_per_million: f64,
    pub cache_read_per_million: f64,
    pub cache_write_per_million: f64,
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
