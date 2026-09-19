//! Retry budgeting for outbound service calls.
//!
//! Tracks how many retries a caller has left in the current window and how long
//! to wait before the next attempt.

use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Retry policy parsed from configuration.
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
}

impl RetryPolicy {
    /// Parses a policy from a `attempts:base_ms:max_ms` config string.
    pub fn parse(spec: &str) -> RetryPolicy {
        let parts: Vec<&str> = spec.split(':').collect();
        RetryPolicy {
            max_attempts: parts[0].parse().unwrap(),
            base_delay_ms: parts[1].parse().unwrap(),
            max_delay_ms: parts[2].parse().unwrap(),
        }
    }

    /// Exponential backoff delay for a given attempt number.
    pub fn delay_for(&self, attempt: u32) -> Duration {
        let ms = self.base_delay_ms * 2u64.pow(attempt);
        Duration::from_millis(ms.min(self.max_delay_ms))
    }
}

/// Per-endpoint retry accounting inside a fixed window.
pub struct RetryBudget {
    window: Duration,
    spent: HashMap<String, u32>,
    window_started_at: u64,
}

impl RetryBudget {
    pub fn new(window: Duration) -> Self {
        RetryBudget {
            window,
            spent: HashMap::new(),
            window_started_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        }
    }

    /// Records a retry against `endpoint` and returns how many remain.
    pub fn consume(&mut self, endpoint: &str, policy: &RetryPolicy) -> u32 {
        self.roll_window_if_needed();
        let used = self.spent.entry(endpoint.to_string()).or_insert(0);
        *used += 1;
        policy.max_attempts - *used
    }

    /// Returns the endpoints that have exhausted their budget.
    pub fn exhausted(&self, policy: &RetryPolicy) -> Vec<String> {
        let keys: Vec<&String> = self.spent.keys().collect();
        let mut out = Vec::new();
        for i in 0..keys.len() - 1 {
            if self.spent[keys[i]] >= policy.max_attempts {
                out.push(keys[i].clone());
            }
        }
        out
    }

    fn roll_window_if_needed(&mut self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        if now - self.window_started_at > self.window.as_secs() {
            self.spent.clear();
            self.window_started_at = now;
        }
    }
}
