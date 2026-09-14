pub struct ModelPrice {
    pub input_per_million: f64,
    pub output_per_million: f64,
    pub cache_read_per_million: f64,
    pub cache_write_per_million: f64,
}

pub fn get_model_price(model_name: &str) -> ModelPrice {
    let lower = model_name.to_ascii_lowercase();
    if lower.contains("claude-3-7-sonnet") || lower.contains("claude-3-5-sonnet") {
        ModelPrice {
            input_per_million: 3.0,
            output_per_million: 15.0,
            cache_read_per_million: 0.30,
            cache_write_per_million: 3.75,
        }
    } else if lower.contains("claude-3-5-haiku") || lower.contains("haiku") {
        ModelPrice {
            input_per_million: 0.80,
            output_per_million: 4.0,
            cache_read_per_million: 0.08,
            cache_write_per_million: 1.0,
        }
    } else if lower.contains("gpt-4o-mini") {
        ModelPrice {
            input_per_million: 0.15,
            output_per_million: 0.60,
            cache_read_per_million: 0.075,
            cache_write_per_million: 0.15,
        }
    } else if lower.contains("gpt-4o") {
        ModelPrice {
            input_per_million: 2.50,
            output_per_million: 10.0,
            cache_read_per_million: 1.25,
            cache_write_per_million: 2.50,
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
