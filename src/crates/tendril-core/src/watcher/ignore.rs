//! The CPU guard: one pure predicate deciding whether a raw filesystem event is noise.
//!
//! This is checked before anything else touches the path. On macOS notify's FSEvents backend
//! already filters non-recursive subtree events itself, but this pass is what keeps a `git checkout`
//! or an `npm install` inside `Worktrees/` from costing anything even if a future backend, a stray
//! registration, or a recursive-mode regression delivers those events anyway.

use std::path::Path;

/// Directory names that are never interesting, wherever they appear in a path.
///
/// `Worktrees` is the load-bearing entry: a plan's worktree churns through tens of thousands of
/// files during execution, and upstream learned the hard way that watching it destabilises the
/// machine. `Artifacts` and `Logs` are the same problem at smaller scale — a running job appends to
/// them constantly and no client view is driven off them.
const IGNORED_DIRS: &[&str] = &[
    "worktrees",
    ".git",
    "target",
    "node_modules",
    "dist",
    "build",
    "bin",
    "obj",
    ".vp",
    ".next",
    "artifacts",
    "logs",
];

/// Suffixes belonging to editor scratch files and our own staging files.
const IGNORED_SUFFIXES: &[&str] = &[".tmp", ".lock", ".swp", ".swx", "~"];

/// The one dotfile that carries real meaning: the plan-ID counter.
const ALLOWED_DOTFILES: &[&str] = &[".counter"];

/// Whether an event path is noise.
pub fn should_ignore(path: &Path) -> bool {
    for component in path.components() {
        let Some(name) = component.as_os_str().to_str() else {
            // A non-UTF-8 component cannot belong to anything we watch.
            return true;
        };
        let lower = name.to_ascii_lowercase();
        if IGNORED_DIRS.contains(&lower.as_str()) {
            return true;
        }
    }

    let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
        // No file name means the path is a root; nothing we care about lives there.
        return true;
    };

    if IGNORED_SUFFIXES
        .iter()
        .any(|suffix| file_name.ends_with(suffix))
    {
        return true;
    }

    // `write_atomic` stages to `<name>.tmp.<pid>`, so the suffix check above misses it.
    if file_name.contains(".tmp.") {
        return true;
    }

    if file_name.starts_with('.') && !ALLOWED_DOTFILES.contains(&file_name) {
        return true;
    }

    false
}
