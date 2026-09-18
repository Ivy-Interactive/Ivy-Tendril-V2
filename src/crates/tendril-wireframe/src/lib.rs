//! Wireframes: the hand-drawn React sketch a planning agent makes for a plan that involves UX.
//!
//! Ported from V1's `Ivy.Tendril.Wireframe` project (`Ivy-Interactive/Ivy-Tendril` PR #2711,
//! pinned at `c146947c`).
//!
//! Neither version implements bundling or CSS compilation itself. Both provision two standalone
//! binaries into a shared cache on first use -- esbuild, a Go executable, and in `jit` mode the
//! Tailwind standalone CLI -- and exec them. That is why V1 chose those two tools: no node runtime
//! is required at any point. The port therefore drives the identical artifacts through the identical
//! arguments, so a wireframe built here and one built by V1 are the same bytes.
//!
//! A wireframe exists to show the user what will be built and to guide the agent that builds it.
//! It lives in the plan folder and never reaches a repo, a worktree or a PR -- which is what the
//! leak guard in `tendril-core` enforces.

pub mod assets;
pub mod build;
pub mod hosting;
pub mod manifest;
pub mod project;

pub use project::{TailwindMode, WireframeConfig, WireframeProject};
