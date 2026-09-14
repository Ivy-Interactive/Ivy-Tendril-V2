//! The formula under test, straight from `LoginRateLimiter.CalculateRequiredDelay`:
//!
//! ```text
//! attempts <= threshold  ->  no delay
//! attempts >  threshold  ->  min(baseDelaySeconds * 2^(attempts - threshold - 1), maxDelaySeconds)
//! ```
//!
//! With the default `threshold: 3` the *fourth* failure is the first one that costs anything — three
//! failures are free, exactly as in the original. (The plan's Tests section describes the block as
//! starting after the third failure, which does not follow from the formula it quotes two sections
//! earlier; behavioural parity with the original wins, since a stricter-than-original limiter would
//! lock out installs that work today.)

use chrono::{Duration as ChronoDuration, TimeZone, Utc};
use std::time::Duration;
use tendril_core::auth::rate_limit::{LoginRateLimiter, GLOBAL_KEY};
use tendril_core::config::LoginRateLimitConfig;

fn base_time() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap()
}

#[test]
fn test_blocks_after_configured_threshold() {
    let now = base_time();
    let limiter = LoginRateLimiter::new_at(LoginRateLimitConfig::default(), now);
    let ip = "10.0.0.7";

    // Three failures are free, so the client is still allowed to try after each of them.
    for attempt in 1..=3 {
        assert!(
            limiter.is_login_allowed_at(ip, now),
            "attempt {attempt} should be allowed"
        );
        limiter.record_failed_attempt_at(ip, now);
        assert_eq!(limiter.failed_attempts(ip), attempt);
    }
    assert!(limiter.is_login_allowed_at(ip, now));
    assert_eq!(limiter.required_delay_at(ip, now), Duration::ZERO);

    // The fourth failure crosses the threshold: the next attempt is refused for 1s.
    limiter.record_failed_attempt_at(ip, now);
    assert!(!limiter.is_login_allowed_at(ip, now));
    assert_eq!(limiter.required_delay_at(ip, now), Duration::from_secs(1));
}

#[test]
fn test_backoff_doubles_and_caps() {
    let now = base_time();
    let limiter = LoginRateLimiter::new_at(LoginRateLimitConfig::default(), now);
    let ip = "192.168.1.5";

    for _ in 0..4 {
        limiter.record_failed_attempt_at(ip, now);
    }
    assert_eq!(limiter.required_delay_at(ip, now), Duration::from_secs(1));

    limiter.record_failed_attempt_at(ip, now);
    assert_eq!(limiter.required_delay_at(ip, now), Duration::from_secs(2));

    limiter.record_failed_attempt_at(ip, now);
    assert_eq!(limiter.required_delay_at(ip, now), Duration::from_secs(4));

    // 1 * 2^(n-4) grows past 60 at the 11th failure; from there it must stay pinned at the cap
    // rather than growing without bound.
    for _ in 0..20 {
        limiter.record_failed_attempt_at(ip, now);
    }
    assert_eq!(limiter.required_delay_at(ip, now), Duration::from_secs(60));
}

/// The limiter is genuinely driven by `auth.rateLimit`, not by hard-coded numbers.
#[test]
fn test_custom_config_is_honoured() {
    let now = base_time();
    let config = LoginRateLimitConfig {
        threshold: 1,
        base_delay_seconds: 5.0,
        max_delay_seconds: 10.0,
    };
    let limiter = LoginRateLimiter::new_at(config, now);
    let ip = "172.16.4.4";

    limiter.record_failed_attempt_at(ip, now);
    assert!(limiter.is_login_allowed_at(ip, now));

    limiter.record_failed_attempt_at(ip, now);
    assert!(!limiter.is_login_allowed_at(ip, now));
    assert_eq!(limiter.required_delay_at(ip, now), Duration::from_secs(5));

    limiter.record_failed_attempt_at(ip, now);
    assert_eq!(limiter.required_delay_at(ip, now), Duration::from_secs(10));

    // Already at the cap.
    limiter.record_failed_attempt_at(ip, now);
    assert_eq!(limiter.required_delay_at(ip, now), Duration::from_secs(10));
}

#[test]
fn test_delay_elapses_and_success_clears_the_record() {
    let now = base_time();
    let limiter = LoginRateLimiter::new_at(LoginRateLimitConfig::default(), now);
    let ip = "10.1.2.3";

    for _ in 0..5 {
        limiter.record_failed_attempt_at(ip, now);
    }
    assert_eq!(limiter.required_delay_at(ip, now), Duration::from_secs(2));
    assert!(!limiter.is_login_allowed_at(ip, now));

    // Halfway through the delay: still blocked, with the remaining time reported.
    let midway = now + ChronoDuration::seconds(1);
    assert!(!limiter.is_login_allowed_at(ip, midway));
    assert_eq!(limiter.required_delay_at(ip, midway), Duration::from_secs(1));

    // Past the delay: allowed again, and nothing left to wait for.
    let later = now + ChronoDuration::seconds(3);
    assert!(limiter.is_login_allowed_at(ip, later));
    assert_eq!(limiter.required_delay_at(ip, later), Duration::ZERO);

    // A success wipes the record outright.
    limiter.record_failed_attempt_at(ip, later);
    limiter.record_failed_attempt_at(ip, later);
    limiter.record_successful_login(ip);
    assert_eq!(limiter.failed_attempts(ip), 0);
    assert!(limiter.is_login_allowed_at(ip, later));
    assert_eq!(limiter.required_delay_at(ip, later), Duration::ZERO);
}

/// One client's failures must never lock out another — the limiter is keyed per client.
#[test]
fn test_keys_are_independent() {
    let now = base_time();
    let limiter = LoginRateLimiter::new_at(LoginRateLimitConfig::default(), now);

    for _ in 0..6 {
        limiter.record_failed_attempt_at("10.0.0.1", now);
    }

    assert!(!limiter.is_login_allowed_at("10.0.0.1", now));
    assert!(limiter.is_login_allowed_at("10.0.0.2", now));
    assert!(limiter.is_login_allowed_at(GLOBAL_KEY, now));
}

/// The 5-minute sweep drops records that can no longer delay anything, and must not drop a record
/// that is still holding a client back.
#[test]
fn test_cleanup_sweep_drops_only_stale_records() {
    let now = base_time();
    let limiter = LoginRateLimiter::new_at(LoginRateLimitConfig::default(), now);

    for _ in 0..4 {
        limiter.record_failed_attempt_at("10.0.0.1", now);
    }
    assert_eq!(limiter.failed_attempts("10.0.0.1"), 4);

    // A probe well past maxDelay + the cleanup interval triggers the sweep.
    let much_later = now + ChronoDuration::seconds(3600);
    assert!(limiter.is_login_allowed_at("10.0.0.2", much_later));
    assert_eq!(limiter.failed_attempts("10.0.0.1"), 0);

    // A fresh failure right before a sweep survives it.
    limiter.record_failed_attempt_at("10.0.0.3", much_later);
    let just_after = much_later + ChronoDuration::seconds(1);
    assert!(limiter.is_login_allowed_at("10.0.0.4", just_after));
    assert_eq!(limiter.failed_attempts("10.0.0.3"), 1);
}
