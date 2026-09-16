//! Password authentication primitives: Argon2 hashing/verification and the login rate limiter.
//!
//! Both are direct ports of the original Tendril's `Auth/` folder, kept in `tendril-core` so they
//! are pure and unit-testable independently of the Axum wiring in `tendril-server`.
//!
//! [`credentials`] is the write side: the port of `SecuritySetupView`'s Save button, which is what
//! `PUT`/`DELETE /api/auth/password` drives.

pub mod credentials;
pub mod password;
pub mod rate_limit;
