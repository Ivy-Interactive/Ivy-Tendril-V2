//! Arithmetic for whether a plan's worktree root will stay under Windows' path budget.
//!
//! A worktree lives at `<plans root>/<plan folder>/Worktrees/<repo>` (see
//! [`crate::git::derive_worktree_relative_path`]). Windows caps process creation around 260 chars
//! total; `MAX_WORKTREE_ROOT_LEN` reserves headroom for everything a launched process appends past
//! the worktree root (a `.CMD` shim, argv, environment) so the root itself must stay well inside
//! that ceiling.

/// Budget for the worktree root path, in characters. Derived from the Windows `MAX_PATH` (260)
/// minus the `.CMD` launcher ceiling (246) minus 1 path separator minus a 150-char allowance for
/// whatever a spawned executable appends past the worktree root (arguments, a nested relative
/// path). What remains is `95`.
pub const MAX_WORKTREE_ROOT_LEN: usize = 95;

/// A worst-case length past `MAX_WORKTREE_ROOT_LEN` that is still likely to work in practice, so a
/// worktree root here is flagged but not treated as a hard failure.
const TIGHT_CEILING: usize = 125;

pub const WORKTREES_DIR_NAME: &str = "Worktrees";

/// The worktree root's length: `<plans root>/<plan folder>/Worktrees/<repo>`, one separator between
/// each segment.
pub fn worst_case_worktree_root_len(
    plans_root_len: usize,
    folder_name_len: usize,
    repo_rel_len: usize,
) -> usize {
    plans_root_len + 1 + folder_name_len + 1 + WORKTREES_DIR_NAME.len() + 1 + repo_rel_len
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathBudgetVerdict {
    Ok,
    Tight,
    Over,
}

pub fn classify_path_budget(worst_case_len: usize) -> PathBudgetVerdict {
    if worst_case_len <= MAX_WORKTREE_ROOT_LEN {
        PathBudgetVerdict::Ok
    } else if worst_case_len <= TIGHT_CEILING {
        PathBudgetVerdict::Tight
    } else {
        PathBudgetVerdict::Over
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worst_case_len_counts_every_separator() {
        assert_eq!(worst_case_worktree_root_len(31, 66, 14), 123);
    }

    #[test]
    fn classify_path_budget_thresholds() {
        assert_eq!(classify_path_budget(95), PathBudgetVerdict::Ok);
        assert_eq!(classify_path_budget(96), PathBudgetVerdict::Tight);
        assert_eq!(classify_path_budget(125), PathBudgetVerdict::Tight);
        assert_eq!(classify_path_budget(126), PathBudgetVerdict::Over);
    }
}
