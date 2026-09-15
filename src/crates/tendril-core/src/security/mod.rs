//! Host and filesystem policy for the local-file endpoint.
//!
//! Ports of `Controllers/LocalFileRootPolicy.cs` and `LocalFileGuardMiddleware.IsAllowedHost` from
//! the original Tendril. Both are pure decision functions living in `tendril-core` so they can be
//! unit-tested without a running server; `tendril-server` only wires them into a middleware.

pub mod host_policy;
pub mod local_file_roots;
