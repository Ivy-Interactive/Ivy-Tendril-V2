//! Chat turn execution: prompt assembly, provider invocation, streaming, persistence.
//!
//! The modules follow one turn's life. `manager` holds the state every part of it reads — the
//! session cache, the queue, the cancellation handles and the live output buffers — plus the
//! operations that do not run an agent at all (create, rename, enqueue, answer a question block).
//! `turn` is the loop that actually runs one: it assembles the prompt with `prompt`, streams the
//! provider's output through `streaming` into those buffers, and closes the turn out with
//! `outcome`, which decides what the finished message says and why. `titles` is the separate,
//! 30s-budgeted naming run that renames a session from its first user message, `answers` the
//! in-place rewriting of a question block's answers into a stream of eventwire lines, and `events`
//! the `chat.*` frames all of them broadcast.
//!
//! `turn` and `titles` are further `impl ChatExecutionManager` blocks rather than free functions, so
//! the fields they share with `manager` are `pub(super)` — that widening is confined to this
//! directory. Every name callers already used is re-exported here, so `chat::execution::*` is the
//! same surface it has always been.

mod answers;
mod events;
mod manager;
mod outcome;
mod prompt;
mod streaming;
mod titles;
mod turn;

pub use events::ChatEvent;
pub use manager::{ChatExecutionManager, ChatTurnOptions, SpecBuilder};
pub use prompt::{build_chat_agent_prompt, is_event_role, ChatSpawnedJob};
pub use titles::{build_title_prompt, clean_generated_title, is_default_chat_title};
