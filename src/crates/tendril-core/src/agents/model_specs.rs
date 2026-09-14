use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelSpec {
    pub model_id: &'static str,
    pub display_name: &'static str,
    pub context_window: u64,
    pub max_output_tokens: u64,
    pub input_per_million: f64,
    pub output_per_million: f64,
    pub cache_read_per_million: f64,
    pub cache_write_per_million: f64,
}

impl ModelSpec {
    pub fn calculate_cost(
        &self,
        input_tokens: i64,
        output_tokens: i64,
        cache_read_tokens: i64,
        cache_write_tokens: i64,
    ) -> f64 {
        let in_cost = (input_tokens as f64 / 1_000_000.0) * self.input_per_million;
        let out_cost = (output_tokens as f64 / 1_000_000.0) * self.output_per_million;
        let read_cost = (cache_read_tokens as f64 / 1_000_000.0) * self.cache_read_per_million;
        let write_cost = (cache_write_tokens as f64 / 1_000_000.0) * self.cache_write_per_million;
        in_cost + out_cost + read_cost + write_cost
    }
}

pub static SPECS: &[ModelSpec] = &[
    // Anthropic
    ModelSpec {
        model_id: "claude-3-7-sonnet",
        display_name: "Claude 3.7 Sonnet",
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_read_per_million: 0.30,
        cache_write_per_million: 3.75,
    },
    ModelSpec {
        model_id: "claude-3-5-sonnet",
        display_name: "Claude 3.5 Sonnet",
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_read_per_million: 0.30,
        cache_write_per_million: 3.75,
    },
    ModelSpec {
        model_id: "claude-sonnet-5",
        display_name: "Claude Sonnet 5",
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_read_per_million: 0.30,
        cache_write_per_million: 3.75,
    },
    ModelSpec {
        model_id: "claude-sonnet-5-1",
        display_name: "Claude Sonnet 5.1",
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_read_per_million: 0.30,
        cache_write_per_million: 3.75,
    },
    ModelSpec {
        model_id: "claude-opus-5",
        display_name: "Claude Opus 5",
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 5.0,
        output_per_million: 25.0,
        cache_read_per_million: 0.50,
        cache_write_per_million: 6.25,
    },
    ModelSpec {
        model_id: "claude-opus-5-1",
        display_name: "Claude Opus 5.1",
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 5.0,
        output_per_million: 25.0,
        cache_read_per_million: 0.50,
        cache_write_per_million: 6.25,
    },
    ModelSpec {
        model_id: "claude-opus-4-8",
        display_name: "Claude Opus 4.8",
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 5.0,
        output_per_million: 25.0,
        cache_read_per_million: 0.50,
        cache_write_per_million: 6.25,
    },
    ModelSpec {
        model_id: "claude-opus-4",
        display_name: "Claude Opus 4",
        context_window: 200_000,
        max_output_tokens: 128_000,
        input_per_million: 15.0,
        output_per_million: 75.0,
        cache_read_per_million: 1.50,
        cache_write_per_million: 18.75,
    },
    ModelSpec {
        model_id: "claude-haiku-5-1",
        display_name: "Claude Haiku 5.1",
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: 1.0,
        output_per_million: 5.0,
        cache_read_per_million: 0.10,
        cache_write_per_million: 1.25,
    },
    ModelSpec {
        model_id: "claude-3-5-haiku",
        display_name: "Claude 3.5 Haiku",
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: 0.80,
        output_per_million: 4.0,
        cache_read_per_million: 0.08,
        cache_write_per_million: 1.0,
    },
    ModelSpec {
        model_id: "opus",
        display_name: "Claude Opus",
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 5.0,
        output_per_million: 25.0,
        cache_read_per_million: 0.50,
        cache_write_per_million: 6.25,
    },
    ModelSpec {
        model_id: "sonnet",
        display_name: "Claude Sonnet",
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_read_per_million: 0.30,
        cache_write_per_million: 3.75,
    },
    ModelSpec {
        model_id: "haiku",
        display_name: "Claude Haiku",
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: 1.0,
        output_per_million: 5.0,
        cache_read_per_million: 0.10,
        cache_write_per_million: 1.25,
    },
    // OpenAI
    ModelSpec {
        model_id: "gpt-6-astra",
        display_name: "GPT-6 Astra",
        context_window: 400_000,
        max_output_tokens: 32_000,
        input_per_million: 10.0,
        output_per_million: 40.0,
        cache_read_per_million: 2.50,
        cache_write_per_million: 12.50,
    },
    ModelSpec {
        model_id: "gpt-5.5",
        display_name: "GPT-5.5",
        context_window: 400_000,
        max_output_tokens: 32_000,
        input_per_million: 10.0,
        output_per_million: 40.0,
        cache_read_per_million: 2.50,
        cache_write_per_million: 12.50,
    },
    ModelSpec {
        model_id: "gpt-5.4",
        display_name: "GPT-5.4",
        context_window: 400_000,
        max_output_tokens: 32_000,
        input_per_million: 10.0,
        output_per_million: 40.0,
        cache_read_per_million: 2.50,
        cache_write_per_million: 12.50,
    },
    ModelSpec {
        model_id: "gpt-4o",
        display_name: "GPT-4o",
        context_window: 128_000,
        max_output_tokens: 16_000,
        input_per_million: 2.50,
        output_per_million: 10.0,
        cache_read_per_million: 1.25,
        cache_write_per_million: 3.125,
    },
    ModelSpec {
        model_id: "gpt-4o-mini",
        display_name: "GPT-4o Mini",
        context_window: 128_000,
        max_output_tokens: 16_000,
        input_per_million: 0.15,
        output_per_million: 0.60,
        cache_read_per_million: 0.075,
        cache_write_per_million: 0.1875,
    },
    ModelSpec {
        model_id: "gpt-4.5",
        display_name: "GPT-4.5",
        context_window: 128_000,
        max_output_tokens: 16_000,
        input_per_million: 75.0,
        output_per_million: 150.0,
        cache_read_per_million: 37.50,
        cache_write_per_million: 93.75,
    },
    ModelSpec {
        model_id: "gpt-4.1",
        display_name: "GPT-4.1",
        context_window: 1_047_576,
        max_output_tokens: 32_000,
        input_per_million: 2.0,
        output_per_million: 8.0,
        cache_read_per_million: 0.50,
        cache_write_per_million: 2.50,
    },
    ModelSpec {
        model_id: "o3",
        display_name: "o3",
        context_window: 200_000,
        max_output_tokens: 100_000,
        input_per_million: 10.0,
        output_per_million: 40.0,
        cache_read_per_million: 2.50,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "o3-mini",
        display_name: "o3-mini",
        context_window: 200_000,
        max_output_tokens: 100_000,
        input_per_million: 1.10,
        output_per_million: 4.40,
        cache_read_per_million: 0.55,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "o4-mini",
        display_name: "o4-mini",
        context_window: 200_000,
        max_output_tokens: 100_000,
        input_per_million: 1.10,
        output_per_million: 4.40,
        cache_read_per_million: 0.55,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "o1",
        display_name: "o1",
        context_window: 200_000,
        max_output_tokens: 100_000,
        input_per_million: 15.0,
        output_per_million: 60.0,
        cache_read_per_million: 7.50,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "codex-mini",
        display_name: "Codex Mini",
        context_window: 400_000,
        max_output_tokens: 16_000,
        input_per_million: 1.50,
        output_per_million: 6.0,
        cache_read_per_million: 0.375,
        cache_write_per_million: 0.0,
    },
    // Google Gemini
    ModelSpec {
        model_id: "gemini-3.8-flash",
        display_name: "Gemini 3.8 Flash",
        context_window: 1_000_000,
        max_output_tokens: 65_536,
        input_per_million: 0.15,
        output_per_million: 0.60,
        cache_read_per_million: 0.0375,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "gemini-3.7-flash",
        display_name: "Gemini 3.7 Flash",
        context_window: 1_000_000,
        max_output_tokens: 65_536,
        input_per_million: 0.15,
        output_per_million: 0.60,
        cache_read_per_million: 0.0375,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "gemini-3.6-flash",
        display_name: "Gemini 3.6 Flash",
        context_window: 1_000_000,
        max_output_tokens: 65_536,
        input_per_million: 0.15,
        output_per_million: 0.60,
        cache_read_per_million: 0.0375,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "gemini-3.1-pro",
        display_name: "Gemini 3.1 Pro",
        context_window: 1_000_000,
        max_output_tokens: 65_536,
        input_per_million: 1.25,
        output_per_million: 10.0,
        cache_read_per_million: 0.315,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "gemini-2.5-flash",
        display_name: "Gemini 2.5 Flash",
        context_window: 1_048_576,
        max_output_tokens: 65_536,
        input_per_million: 0.15,
        output_per_million: 3.50,
        cache_read_per_million: 0.0375,
        cache_write_per_million: 0.15,
    },
    ModelSpec {
        model_id: "gemini-2.5-pro",
        display_name: "Gemini 2.5 Pro",
        context_window: 1_048_576,
        max_output_tokens: 65_536,
        input_per_million: 1.25,
        output_per_million: 10.0,
        cache_read_per_million: 0.3125,
        cache_write_per_million: 1.5625,
    },
    // DeepSeek & Open Weights
    ModelSpec {
        model_id: "deepseek-chat",
        display_name: "DeepSeek Chat",
        context_window: 128_000,
        max_output_tokens: 8_192,
        input_per_million: 0.14,
        output_per_million: 0.28,
        cache_read_per_million: 0.014,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "deepseek-v3",
        display_name: "DeepSeek V3",
        context_window: 128_000,
        max_output_tokens: 8_192,
        input_per_million: 0.14,
        output_per_million: 0.28,
        cache_read_per_million: 0.014,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "deepseek-reasoner",
        display_name: "DeepSeek Reasoner",
        context_window: 128_000,
        max_output_tokens: 8_192,
        input_per_million: 0.55,
        output_per_million: 2.19,
        cache_read_per_million: 0.14,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "deepseek-r1",
        display_name: "DeepSeek R1",
        context_window: 128_000,
        max_output_tokens: 8_192,
        input_per_million: 0.55,
        output_per_million: 2.19,
        cache_read_per_million: 0.14,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "deepseek-v4-pro",
        display_name: "DeepSeek V4 Pro",
        context_window: 256_000,
        max_output_tokens: 16_384,
        input_per_million: 0.30,
        output_per_million: 1.20,
        cache_read_per_million: 0.03,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "deepseek-flash",
        display_name: "DeepSeek Flash",
        context_window: 128_000,
        max_output_tokens: 8_192,
        input_per_million: 0.07,
        output_per_million: 0.14,
        cache_read_per_million: 0.007,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "kimi-k3",
        display_name: "Kimi K3",
        context_window: 327_680,
        max_output_tokens: 32_768,
        input_per_million: 0.0,
        output_per_million: 0.0,
        cache_read_per_million: 0.0,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: "qwen2.5-coder-32b-instruct",
        display_name: "Qwen 2.5 Coder 32B Instruct",
        context_window: 128_000,
        max_output_tokens: 32_000,
        input_per_million: 0.0,
        output_per_million: 0.0,
        cache_read_per_million: 0.0,
        cache_write_per_million: 0.0,
    },
];

pub fn all_specs() -> &'static [ModelSpec] {
    SPECS
}

pub fn normalize_model_id(id: &str) -> String {
    id.trim().to_ascii_lowercase().replace('.', "-")
}

pub fn strip_provider_prefix(id: &str) -> &str {
    let s = id.trim();
    let prefixes = [
        "anthropic/",
        "openai/",
        "google/",
        "bedrock/",
        "eu.anthropic.",
        "global.anthropic.",
        "us.anthropic.",
    ];
    for prefix in prefixes {
        if s.len() >= prefix.len() && s[..prefix.len()].eq_ignore_ascii_case(prefix) {
            return &s[prefix.len()..];
        }
    }
    s
}

pub fn find(id: &str) -> Option<&'static ModelSpec> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return None;
    }

    // 1. Exact declared ID match (case-insensitive and dot-dash normalized)
    let normalized = normalize_model_id(trimmed);
    for spec in SPECS {
        if normalize_model_id(spec.model_id) == normalized {
            return Some(spec);
        }
    }

    // 2. Provider-prefix stripped match
    let stripped = strip_provider_prefix(trimmed);
    let normalized_stripped = normalize_model_id(stripped);
    for spec in SPECS {
        if normalize_model_id(spec.model_id) == normalized_stripped {
            return Some(spec);
        }
    }

    // 3. Longest-first pattern match across declared model keys
    let mut sorted_specs: Vec<&'static ModelSpec> = SPECS.iter().collect();
    sorted_specs.sort_by_key(|a| std::cmp::Reverse(a.model_id.len()));

    for spec in sorted_specs {
        let spec_key = normalize_model_id(spec.model_id);
        if normalized_stripped.contains(&spec_key) || normalized.contains(&spec_key) {
            return Some(spec);
        }
    }

    None
}
