use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::sync::{OnceLock, RwLock};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelSpec {
    pub model_id: Cow<'static, str>,
    pub display_name: Cow<'static, str>,
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
        model_id: Cow::Borrowed("claude-fable-5-1"),
        display_name: Cow::Borrowed("Claude Fable 5.1"),
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 10.0,
        output_per_million: 50.0,
        cache_read_per_million: 1.0,
        cache_write_per_million: 12.50,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-3-7-sonnet"),
        display_name: Cow::Borrowed("Claude 3.7 Sonnet"),
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_read_per_million: 0.30,
        cache_write_per_million: 3.75,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-3-5-sonnet"),
        display_name: Cow::Borrowed("Claude 3.5 Sonnet"),
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_read_per_million: 0.30,
        cache_write_per_million: 3.75,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-sonnet-5"),
        display_name: Cow::Borrowed("Claude Sonnet 5"),
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_read_per_million: 0.30,
        cache_write_per_million: 3.75,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-sonnet-5-1"),
        display_name: Cow::Borrowed("Claude Sonnet 5.1"),
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_read_per_million: 0.30,
        cache_write_per_million: 3.75,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-sonnet-4-6"),
        display_name: Cow::Borrowed("Claude Sonnet 4.6"),
        context_window: 1_000_000,
        max_output_tokens: 64_000,
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_read_per_million: 0.30,
        cache_write_per_million: 3.75,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-sonnet-4-5"),
        display_name: Cow::Borrowed("Claude Sonnet 4.5"),
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_read_per_million: 0.30,
        cache_write_per_million: 3.75,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-opus-5"),
        display_name: Cow::Borrowed("Claude Opus 5"),
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 5.0,
        output_per_million: 25.0,
        cache_read_per_million: 0.50,
        cache_write_per_million: 6.25,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-opus-5-1"),
        display_name: Cow::Borrowed("Claude Opus 5.1"),
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 5.0,
        output_per_million: 25.0,
        cache_read_per_million: 0.50,
        cache_write_per_million: 6.25,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-opus-4-8"),
        display_name: Cow::Borrowed("Claude Opus 4.8"),
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 5.0,
        output_per_million: 25.0,
        cache_read_per_million: 0.50,
        cache_write_per_million: 6.25,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-opus-4-7"),
        display_name: Cow::Borrowed("Claude Opus 4.7"),
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 5.0,
        output_per_million: 25.0,
        cache_read_per_million: 0.50,
        cache_write_per_million: 6.25,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-opus-4-6"),
        display_name: Cow::Borrowed("Claude Opus 4.6"),
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 5.0,
        output_per_million: 25.0,
        cache_read_per_million: 0.50,
        cache_write_per_million: 6.25,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-opus-4"),
        display_name: Cow::Borrowed("Claude Opus 4"),
        context_window: 200_000,
        max_output_tokens: 128_000,
        input_per_million: 15.0,
        output_per_million: 75.0,
        cache_read_per_million: 1.50,
        cache_write_per_million: 18.75,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-haiku-5-1"),
        display_name: Cow::Borrowed("Claude Haiku 5.1"),
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: 1.0,
        output_per_million: 5.0,
        cache_read_per_million: 0.10,
        cache_write_per_million: 1.25,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-haiku-4-5"),
        display_name: Cow::Borrowed("Claude Haiku 4.5"),
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: 1.0,
        output_per_million: 5.0,
        cache_read_per_million: 0.10,
        cache_write_per_million: 1.25,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-haiku-4-5-20251001"),
        display_name: Cow::Borrowed("Claude Haiku 4.5"),
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: 1.0,
        output_per_million: 5.0,
        cache_read_per_million: 0.10,
        cache_write_per_million: 1.25,
    },
    ModelSpec {
        model_id: Cow::Borrowed("claude-3-5-haiku"),
        display_name: Cow::Borrowed("Claude 3.5 Haiku"),
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: 0.80,
        output_per_million: 4.0,
        cache_read_per_million: 0.08,
        cache_write_per_million: 1.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("opus"),
        display_name: Cow::Borrowed("Claude Opus"),
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 5.0,
        output_per_million: 25.0,
        cache_read_per_million: 0.50,
        cache_write_per_million: 6.25,
    },
    ModelSpec {
        model_id: Cow::Borrowed("sonnet"),
        display_name: Cow::Borrowed("Claude Sonnet"),
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_read_per_million: 0.30,
        cache_write_per_million: 3.75,
    },
    ModelSpec {
        model_id: Cow::Borrowed("haiku"),
        display_name: Cow::Borrowed("Claude Haiku"),
        context_window: 200_000,
        max_output_tokens: 64_000,
        input_per_million: 1.0,
        output_per_million: 5.0,
        cache_read_per_million: 0.10,
        cache_write_per_million: 1.25,
    },
    // OpenAI
    ModelSpec {
        model_id: Cow::Borrowed("gpt-6-astra"),
        display_name: Cow::Borrowed("GPT-6 Astra"),
        context_window: 400_000,
        max_output_tokens: 32_000,
        input_per_million: 10.0,
        output_per_million: 40.0,
        cache_read_per_million: 2.50,
        cache_write_per_million: 12.50,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-5.6-sol"),
        display_name: Cow::Borrowed("GPT-5.6 Sol"),
        context_window: 1_050_000,
        max_output_tokens: 128_000,
        input_per_million: 5.0,
        output_per_million: 30.0,
        cache_read_per_million: 0.50,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-5.6-terra"),
        display_name: Cow::Borrowed("GPT-5.6 Terra"),
        context_window: 1_050_000,
        max_output_tokens: 128_000,
        input_per_million: 2.50,
        output_per_million: 15.0,
        cache_read_per_million: 0.25,
        cache_write_per_million: 3.125,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-5.6-luna"),
        display_name: Cow::Borrowed("GPT-5.6 Luna"),
        context_window: 1_050_000,
        max_output_tokens: 128_000,
        input_per_million: 1.0,
        output_per_million: 6.0,
        cache_read_per_million: 0.10,
        cache_write_per_million: 1.25,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-5.5"),
        display_name: Cow::Borrowed("GPT-5.5"),
        context_window: 400_000,
        max_output_tokens: 32_000,
        input_per_million: 10.0,
        output_per_million: 40.0,
        cache_read_per_million: 2.50,
        cache_write_per_million: 12.50,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-5.4"),
        display_name: Cow::Borrowed("GPT-5.4"),
        context_window: 400_000,
        max_output_tokens: 32_000,
        input_per_million: 10.0,
        output_per_million: 40.0,
        cache_read_per_million: 2.50,
        cache_write_per_million: 12.50,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-5.4-mini"),
        display_name: Cow::Borrowed("GPT-5.4 Mini"),
        context_window: 400_000,
        max_output_tokens: 128_000,
        input_per_million: 0.75,
        output_per_million: 4.50,
        cache_read_per_million: 0.075,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-5.3-codex"),
        display_name: Cow::Borrowed("GPT-5.3 Codex"),
        context_window: 400_000,
        max_output_tokens: 128_000,
        input_per_million: 1.75,
        output_per_million: 14.0,
        cache_read_per_million: 0.175,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-5.2-codex"),
        display_name: Cow::Borrowed("GPT-5.2 Codex"),
        context_window: 400_000,
        max_output_tokens: 128_000,
        input_per_million: 1.75,
        output_per_million: 14.0,
        cache_read_per_million: 0.175,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-5.2"),
        display_name: Cow::Borrowed("GPT-5.2"),
        context_window: 400_000,
        max_output_tokens: 128_000,
        input_per_million: 1.75,
        output_per_million: 14.0,
        cache_read_per_million: 0.125,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-5-mini"),
        display_name: Cow::Borrowed("GPT-5 Mini"),
        context_window: 400_000,
        max_output_tokens: 128_000,
        input_per_million: 0.25,
        output_per_million: 2.0,
        cache_read_per_million: 0.03,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-oss-120b"),
        display_name: Cow::Borrowed("GPT-OSS 120B"),
        context_window: 131_072,
        max_output_tokens: 131_072,
        input_per_million: 0.04,
        output_per_million: 0.16,
        cache_read_per_million: 0.0,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-4o"),
        display_name: Cow::Borrowed("GPT-4o"),
        context_window: 128_000,
        max_output_tokens: 16_000,
        input_per_million: 2.50,
        output_per_million: 10.0,
        cache_read_per_million: 1.25,
        cache_write_per_million: 3.125,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-4o-mini"),
        display_name: Cow::Borrowed("GPT-4o Mini"),
        context_window: 128_000,
        max_output_tokens: 16_000,
        input_per_million: 0.15,
        output_per_million: 0.60,
        cache_read_per_million: 0.075,
        cache_write_per_million: 0.1875,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-4.5"),
        display_name: Cow::Borrowed("GPT-4.5"),
        context_window: 128_000,
        max_output_tokens: 16_000,
        input_per_million: 75.0,
        output_per_million: 150.0,
        cache_read_per_million: 37.50,
        cache_write_per_million: 93.75,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gpt-4.1"),
        display_name: Cow::Borrowed("GPT-4.1"),
        context_window: 1_047_576,
        max_output_tokens: 32_000,
        input_per_million: 2.0,
        output_per_million: 8.0,
        cache_read_per_million: 0.50,
        cache_write_per_million: 2.50,
    },
    ModelSpec {
        model_id: Cow::Borrowed("o3"),
        display_name: Cow::Borrowed("o3"),
        context_window: 200_000,
        max_output_tokens: 100_000,
        input_per_million: 10.0,
        output_per_million: 40.0,
        cache_read_per_million: 2.50,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("o3-mini"),
        display_name: Cow::Borrowed("o3-mini"),
        context_window: 200_000,
        max_output_tokens: 100_000,
        input_per_million: 1.10,
        output_per_million: 4.40,
        cache_read_per_million: 0.55,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("o4-mini"),
        display_name: Cow::Borrowed("o4-mini"),
        context_window: 200_000,
        max_output_tokens: 100_000,
        input_per_million: 1.10,
        output_per_million: 4.40,
        cache_read_per_million: 0.55,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("o1"),
        display_name: Cow::Borrowed("o1"),
        context_window: 200_000,
        max_output_tokens: 100_000,
        input_per_million: 15.0,
        output_per_million: 60.0,
        cache_read_per_million: 7.50,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("codex-mini"),
        display_name: Cow::Borrowed("Codex Mini"),
        context_window: 400_000,
        max_output_tokens: 16_000,
        input_per_million: 1.50,
        output_per_million: 6.0,
        cache_read_per_million: 0.375,
        cache_write_per_million: 0.0,
    },
    // Google Gemini
    ModelSpec {
        model_id: Cow::Borrowed("gemini-3.8-flash"),
        display_name: Cow::Borrowed("Gemini 3.8 Flash"),
        context_window: 1_000_000,
        max_output_tokens: 65_536,
        input_per_million: 0.15,
        output_per_million: 0.60,
        cache_read_per_million: 0.0375,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gemini-3.7-flash"),
        display_name: Cow::Borrowed("Gemini 3.7 Flash"),
        context_window: 1_000_000,
        max_output_tokens: 65_536,
        input_per_million: 0.15,
        output_per_million: 0.60,
        cache_read_per_million: 0.0375,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gemini-3.6-flash"),
        display_name: Cow::Borrowed("Gemini 3.6 Flash"),
        context_window: 1_000_000,
        max_output_tokens: 65_536,
        input_per_million: 0.15,
        output_per_million: 0.60,
        cache_read_per_million: 0.0375,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gemini-3.1-pro"),
        display_name: Cow::Borrowed("Gemini 3.1 Pro"),
        context_window: 1_000_000,
        max_output_tokens: 65_536,
        input_per_million: 1.25,
        output_per_million: 10.0,
        cache_read_per_million: 0.315,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gemini-3-pro-preview"),
        display_name: Cow::Borrowed("Gemini 3 Pro"),
        context_window: 1_048_576,
        max_output_tokens: 65_536,
        input_per_million: 2.0,
        output_per_million: 12.0,
        cache_read_per_million: 0.20,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gemini-3-flash-preview"),
        display_name: Cow::Borrowed("Gemini 3 Flash"),
        context_window: 1_048_576,
        max_output_tokens: 65_536,
        input_per_million: 0.50,
        output_per_million: 3.0,
        cache_read_per_million: 0.05,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gemini-2.5-flash"),
        display_name: Cow::Borrowed("Gemini 2.5 Flash"),
        context_window: 1_048_576,
        max_output_tokens: 65_536,
        input_per_million: 0.15,
        output_per_million: 3.50,
        cache_read_per_million: 0.0375,
        cache_write_per_million: 0.15,
    },
    ModelSpec {
        model_id: Cow::Borrowed("gemini-2.5-pro"),
        display_name: Cow::Borrowed("Gemini 2.5 Pro"),
        context_window: 1_048_576,
        max_output_tokens: 65_536,
        input_per_million: 1.25,
        output_per_million: 10.0,
        cache_read_per_million: 0.3125,
        cache_write_per_million: 1.5625,
    },
    // DeepSeek & Open Weights
    ModelSpec {
        model_id: Cow::Borrowed("deepseek-chat"),
        display_name: Cow::Borrowed("DeepSeek Chat"),
        context_window: 128_000,
        max_output_tokens: 8_192,
        input_per_million: 0.14,
        output_per_million: 0.28,
        cache_read_per_million: 0.014,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("deepseek-v3"),
        display_name: Cow::Borrowed("DeepSeek V3"),
        context_window: 128_000,
        max_output_tokens: 8_192,
        input_per_million: 0.14,
        output_per_million: 0.28,
        cache_read_per_million: 0.014,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("deepseek-reasoner"),
        display_name: Cow::Borrowed("DeepSeek Reasoner"),
        context_window: 128_000,
        max_output_tokens: 8_192,
        input_per_million: 0.55,
        output_per_million: 2.19,
        cache_read_per_million: 0.14,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("deepseek-r1"),
        display_name: Cow::Borrowed("DeepSeek R1"),
        context_window: 128_000,
        max_output_tokens: 8_192,
        input_per_million: 0.55,
        output_per_million: 2.19,
        cache_read_per_million: 0.14,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("deepseek-v4-pro"),
        display_name: Cow::Borrowed("DeepSeek V4 Pro"),
        context_window: 256_000,
        max_output_tokens: 16_384,
        input_per_million: 0.30,
        output_per_million: 1.20,
        cache_read_per_million: 0.03,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("deepseek-flash"),
        display_name: Cow::Borrowed("DeepSeek Flash"),
        context_window: 128_000,
        max_output_tokens: 8_192,
        input_per_million: 0.07,
        output_per_million: 0.14,
        cache_read_per_million: 0.007,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("kimi-k3"),
        display_name: Cow::Borrowed("Kimi K3"),
        context_window: 327_680,
        max_output_tokens: 32_768,
        input_per_million: 0.0,
        output_per_million: 0.0,
        cache_read_per_million: 0.0,
        cache_write_per_million: 0.0,
    },
    // Cursor's own four priced house models, rated from cursor.com/docs/models. They are here so a
    // run on one reports a real cost; they are deliberately NOT in the `cursor` catalog row, because
    // the picker should keep steering at the vendor models whose ladders Tendril can reason about.
    //
    // `context_window: 0` on three of them is the honest value, not a placeholder: Cursor publishes
    // rates for these but no context size, and zero is already what `model_cache` writes when a
    // source omits the limits section. Muse Spark is the exception -- the CLI names it "Muse Spark
    // 1.3 1M", so the window is stated.
    //
    // The `-fast` tiers (Grok 4.6 Fast at $4/$12, Composer 2.5 Fast at $3/$15) are separately billed
    // and deliberately absent, the same reason `format_cursor_model` never composes a `-fast` id.
    ModelSpec {
        model_id: Cow::Borrowed("cursor-grok-4.6"),
        display_name: Cow::Borrowed("Cursor Grok 4.6"),
        context_window: 0,
        max_output_tokens: 0,
        input_per_million: 2.0,
        output_per_million: 6.0,
        cache_read_per_million: 0.5,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("cursor-grok-4.5"),
        display_name: Cow::Borrowed("Cursor Grok 4.5"),
        context_window: 0,
        max_output_tokens: 0,
        input_per_million: 2.0,
        output_per_million: 6.0,
        cache_read_per_million: 0.5,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("composer-2.5"),
        display_name: Cow::Borrowed("Composer 2.5"),
        context_window: 0,
        max_output_tokens: 0,
        input_per_million: 0.5,
        output_per_million: 2.5,
        cache_read_per_million: 0.2,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("muse-spark-1.3"),
        display_name: Cow::Borrowed("Muse Spark 1.3"),
        context_window: 1_000_000,
        max_output_tokens: 0,
        // Cached input bills at the read rate with no separate write charge, so the zero below is
        // Cursor's own rate rather than a missing one.
        input_per_million: 1.25,
        output_per_million: 4.25,
        cache_read_per_million: 0.15,
        cache_write_per_million: 0.0,
    },
    ModelSpec {
        model_id: Cow::Borrowed("qwen2.5-coder-32b-instruct"),
        display_name: Cow::Borrowed("Qwen 2.5 Coder 32B Instruct"),
        context_window: 128_000,
        max_output_tokens: 32_000,
        input_per_million: 0.0,
        output_per_million: 0.0,
        cache_read_per_million: 0.0,
        cache_write_per_million: 0.0,
    },
    // Apple
    //
    // Served by `fm serve` from the on-device Foundation Model. It runs locally and bills nothing,
    // so every rate is zero: this row exists so cost reporting says free rather than falling back
    // to Sonnet's rates, which is what an unknown id gets. The window is measured, not published.
    //
    // The id carries its provider prefix, unlike every other row. It has to: this is the one row
    // whose model reaches the wire through OpenCode, which addresses models as `provider/model`,
    // and `providers::APPLE_MODEL_ID` pins exactly this string. Naming the row anything else would
    // put a second id in circulation and price the launched one at the unknown-model fallback.
    ModelSpec {
        model_id: Cow::Borrowed("apple/system"),
        display_name: Cow::Borrowed("Apple On-Device Foundation"),
        context_window: 8_192,
        max_output_tokens: 1_024,
        input_per_million: 0.0,
        output_per_million: 0.0,
        cache_read_per_million: 0.0,
        cache_write_per_million: 0.0,
    },
];

static DYNAMIC_SPECS: OnceLock<RwLock<Vec<ModelSpec>>> = OnceLock::new();

pub fn register_dynamic_specs(specs: Vec<ModelSpec>) {
    let registry = DYNAMIC_SPECS.get_or_init(|| RwLock::new(Vec::new()));
    let mut guard = registry.write().unwrap();
    *guard = specs;
}

pub fn dynamic_specs_count() -> usize {
    DYNAMIC_SPECS
        .get()
        .map(|registry| registry.read().unwrap().len())
        .unwrap_or(0)
}

pub fn all_specs() -> Vec<ModelSpec> {
    let Some(registry) = DYNAMIC_SPECS.get() else {
        return SPECS.to_vec();
    };
    let dynamic = registry.read().unwrap();
    if dynamic.is_empty() {
        return SPECS.to_vec();
    }

    let dynamic_ids: std::collections::HashSet<String> = dynamic
        .iter()
        .map(|spec| normalize_model_id(spec.model_id.as_ref()))
        .collect();

    let mut result: Vec<ModelSpec> = dynamic.clone();
    for spec in SPECS {
        if !dynamic_ids.contains(&normalize_model_id(spec.model_id.as_ref())) {
            result.push(spec.clone());
        }
    }
    result
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

/// Whether a spec carries rates worth pricing a run against.
///
/// "The catalog knows this model" and "the catalog can price this model" are different questions,
/// and conflating them is what recorded a $1.26 run as `$0.00`. models.dev lists the same model
/// under every provider that resells it, and a provider that publishes no `cost` block at all
/// parses to a rate card of zeros, because [`crate::agents::model_cache::parse_catalog`] defaults
/// each missing field to `0.0`. The live catalog carries 18 rows for `claude-opus-5`, three of them
/// such placeholders.
///
/// A card of all zeros is therefore read as "no prices here" rather than "free". The one model that
/// means it — `apple/system`, which bills nothing because it runs on the device — is unaffected:
/// [`prefer_priced`] only demotes an unpriced row when a priced row matches just as well, and
/// nothing else in any catalog claims that id.
pub fn is_priced(spec: &ModelSpec) -> bool {
    spec.input_per_million > 0.0
        || spec.output_per_million > 0.0
        || spec.cache_read_per_million > 0.0
        || spec.cache_write_per_million > 0.0
}

/// Picks between specs that all match a lookup *equally well*: the first priced one, or the first
/// of them if none carries prices.
///
/// Order within a tier is still dynamic-before-static and, in tier 3, longest-key-first, so this
/// only ever chooses among rows that were already interchangeable. Which of 18 duplicate
/// `claude-opus-5` rows the HashMap iteration order happened to put first is not a decision worth
/// letting a bill turn on.
fn prefer_priced<'a>(mut matches: impl Iterator<Item = &'a ModelSpec>) -> Option<ModelSpec> {
    let first = matches.next()?;
    if is_priced(first) {
        return Some(first.clone());
    }
    Some(
        matches
            .find(|spec| is_priced(spec))
            .unwrap_or(first)
            .clone(),
    )
}

pub fn find(id: &str) -> Option<ModelSpec> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = normalize_model_id(trimmed);
    let stripped = strip_provider_prefix(trimmed);
    let normalized_stripped = normalize_model_id(stripped);

    let dynamic_guard = DYNAMIC_SPECS.get().map(|registry| registry.read().unwrap());
    let dynamic_specs: &[ModelSpec] = dynamic_guard.as_deref().map_or(&[], |v| v.as_slice());

    // 1. Exact declared ID match (case-insensitive and dot-dash normalized),
    //    checking the dynamic registry before the static fallback table.
    let exact = dynamic_specs
        .iter()
        .chain(SPECS)
        .filter(|spec| normalize_model_id(spec.model_id.as_ref()) == normalized);
    if let Some(spec) = prefer_priced(exact) {
        return Some(spec);
    }

    // 2. Provider-prefix stripped match
    let stripped_match = dynamic_specs
        .iter()
        .chain(SPECS)
        .filter(|spec| normalize_model_id(spec.model_id.as_ref()) == normalized_stripped);
    if let Some(spec) = prefer_priced(stripped_match) {
        return Some(spec);
    }

    // 3. Longest-first pattern match across declared model keys
    let mut sorted_specs: Vec<&ModelSpec> = dynamic_specs.iter().chain(SPECS).collect();
    sorted_specs.sort_by_key(|a| std::cmp::Reverse(a.model_id.len()));

    // The longest matching key is the most specific model, so specificity still decides *which*
    // model wins; pricedness only decides which of that model's duplicate rows does. Resolving the
    // key first is what keeps a short, priced key from outbidding a long, unpriced one and pricing
    // the run against a different model entirely.
    let winning_key = sorted_specs.iter().find_map(|spec| {
        let spec_key = normalize_model_id(spec.model_id.as_ref());
        (normalized_stripped.contains(&spec_key) || normalized.contains(&spec_key))
            .then_some(spec_key)
    })?;

    prefer_priced(
        sorted_specs
            .iter()
            .copied()
            .filter(|spec| normalize_model_id(spec.model_id.as_ref()) == winning_key),
    )
}
