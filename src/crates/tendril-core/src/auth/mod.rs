//! Password authentication primitives: Argon2 hashing/verification and the login rate limiter.
//!
//! Both are direct ports of the original Tendril's `Auth/` folder, kept in `tendril-core` so they
//! are pure and unit-testable independently of the Axum wiring in `tendril-server`.

pub mod password;
pub mod rate_limit;
