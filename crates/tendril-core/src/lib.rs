pub mod agents;
pub mod config;
pub mod db;
pub mod error;
pub mod git;
pub mod jobs;
pub mod mcp;
pub mod models;
pub mod plans;
pub mod promptware;

pub use config::*;
pub use error::*;
pub use models::*;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
