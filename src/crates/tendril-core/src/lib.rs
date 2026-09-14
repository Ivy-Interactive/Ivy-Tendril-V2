pub mod agents;
pub mod chat;
pub mod config;
pub mod db;
pub mod error;
pub mod fs_lock;
pub mod git;
pub mod inbox;
pub mod jobs;
pub mod mcp;
pub mod models;
pub mod plans;
pub mod promptware;
pub mod questions;
pub mod stack;
pub mod vault;
pub mod watcher;

pub use agents::model_specs;
pub use agents::truncation;
pub use config::*;
pub use error::*;
pub use models::*;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
