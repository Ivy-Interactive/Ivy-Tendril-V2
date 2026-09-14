//! Per-client exponential backoff for failed logins — a direct port of `Auth/LoginRateLimiter.cs`,
//! including its 5-minute cleanup sweep.
//!
//! ```text
//! attempts <= threshold  ->  no delay
//! attempts >  threshold  ->  min(baseDelaySeconds * 2^(attempts - threshold - 1), maxDelaySeconds)
//! ```
//!
//! With the default config (`threshold: 3`) the first three failures are free; the fourth costs 1s,
//! the fifth 2s, the sixth 4s, capped at 60s.
//!
//! Every public method delegates to an `*_at` variant that takes the current time, so tests advance
//! an injected clock instead of sleeping. Interior mutability (`&self`) lets the limiter live in
//! `AppState` behind an `Arc`.

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use crate::config::LoginRateLimitConfig;

/// How often old entries are swept, matching `_cleanupInterval`.
const CLEANUP_INTERVAL_SECS: i64 = 300;

/// The key used when no peer address is available, matching `TendrilAuthProvider`'s
/// `?? "global"` fallback.
pub const GLOBAL_KEY: &str = "global";

#[derive(Debug, Clone, Copy)]
struct LoginAttemptRecord {
    failed_attempts: i32,
    last_attempt: DateTime<Utc>,
}

struct Inner {
    attempts: HashMap<String, LoginAttemptRecord>,
    last_cleanup: DateTime<Utc>,
}

pub struct LoginRateLimiter {
    config: LoginRateLimitConfig,
    inner: Mutex<Inner>,
}

impl LoginRateLimiter {
    pub fn new(config: LoginRateLimitConfig) -> Self {
        Self::new_at(config, Utc::now())
    }

    pub fn new_at(config: LoginRateLimitConfig, now: DateTime<Utc>) -> Self {
        Self {
            config,
            inner: Mutex::new(Inner {
                attempts: HashMap::new(),
                last_cleanup: now,
            }),
        }
    }

    pub fn config(&self) -> &LoginRateLimitConfig {
        &self.config
    }

    pub fn is_login_allowed(&self, key: &str) -> bool {
        self.is_login_allowed_at(key, Utc::now())
    }

    pub fn is_login_allowed_at(&self, key: &str, now: DateTime<Utc>) -> bool {
        let mut inner = self.lock();
        self.cleanup_old_entries(&mut inner, now);

        let Some(record) = inner.attempts.get(key) else {
            return true;
        };

        let since_last = now - record.last_attempt;
        since_last >= self.required_delay_for(record.failed_attempts)
    }

    pub fn record_failed_attempt(&self, key: &str) {
        self.record_failed_attempt_at(key, Utc::now());
    }

    pub fn record_failed_attempt_at(&self, key: &str, now: DateTime<Utc>) {
        let mut inner = self.lock();
        inner
            .attempts
            .entry(key.to_string())
            .and_modify(|record| {
                record.failed_attempts += 1;
                record.last_attempt = now;
            })
            .or_insert(LoginAttemptRecord {
                failed_attempts: 1,
                last_attempt: now,
            });
    }

    pub fn record_successful_login(&self, key: &str) {
        self.lock().attempts.remove(key);
    }

    /// How long the caller must wait before the next attempt is accepted. Zero when there is no
    /// record, or when the required delay has already elapsed.
    pub fn required_delay(&self, key: &str) -> Duration {
        self.required_delay_at(key, Utc::now())
    }

    pub fn required_delay_at(&self, key: &str, now: DateTime<Utc>) -> Duration {
        let inner = self.lock();
        let Some(record) = inner.attempts.get(key) else {
            return Duration::ZERO;
        };

        let remaining = self.required_delay_for(record.failed_attempts) - (now - record.last_attempt);
        remaining.to_std().unwrap_or(Duration::ZERO)
    }

    /// Recorded failure count for a key. Exposed for diagnostics and tests.
    pub fn failed_attempts(&self, key: &str) -> i32 {
        self.lock()
            .attempts
            .get(key)
            .map_or(0, |record| record.failed_attempts)
    }

    /// `min(baseDelay * 2^(attempts - threshold - 1), maxDelay)`, zero at or below the threshold.
    fn required_delay_for(&self, failed_attempts: i32) -> ChronoDuration {
        if failed_attempts <= self.config.threshold {
            return ChronoDuration::zero();
        }

        let exponent = failed_attempts - self.config.threshold;
        let delay_seconds =
            self.config.base_delay_seconds * 2f64.powi(exponent.saturating_sub(1));
        let capped = delay_seconds.min(self.config.max_delay_seconds).max(0.0);

        // `from_secs_f64` would panic on a non-finite or out-of-range value, which a hand-edited
        // config could produce; fall back to the cap instead.
        ChronoDuration::from_std(Duration::try_from_secs_f64(capped).unwrap_or_else(|_| {
            Duration::try_from_secs_f64(self.config.max_delay_seconds.max(0.0))
                .unwrap_or(Duration::ZERO)
        }))
        .unwrap_or_else(|_| ChronoDuration::zero())
    }

    fn cleanup_old_entries(&self, inner: &mut Inner, now: DateTime<Utc>) {
        let interval = ChronoDuration::seconds(CLEANUP_INTERVAL_SECS);
        if now - inner.last_cleanup < interval {
            return;
        }

        inner.last_cleanup = now;
        let max_delay = ChronoDuration::from_std(
            Duration::try_from_secs_f64(self.config.max_delay_seconds.max(0.0))
                .unwrap_or(Duration::ZERO),
        )
        .unwrap_or_else(|_| ChronoDuration::zero());
        let cutoff = now - max_delay - interval;

        inner
            .attempts
            .retain(|_, record| record.last_attempt >= cutoff);
    }

    /// A poisoned mutex must not take the login route down: recover the guard and carry on, since
    /// the worst case is a stale attempt count.
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}
