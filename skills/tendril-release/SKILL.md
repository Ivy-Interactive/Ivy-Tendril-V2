---
name: tendril-release
description: Automates release preparation, package updates, version bumps, PR creation, and GitHub workflow triggering for Ivy-Tendril-V2.
---

# Tendril Release Automator

This skill automates the release preparation and deployment process for Ivy-Tendril-V2. It manages package updates, local branch integration, GitHub PR generation and merging, branch synchronization, and triggers the final release workflow.

## Invocation

```bash
/tendril-release
```

## What This Skill Does

1. **Creates a release branch** off `development` or current working branch.
2. **Updates dependencies** and verifies lockfiles (`pnpm install`, `cargo update`).
3. **Builds the project** to verify compilation and workspace compatibility (`cargo build --workspace`, `pnpm build`).
4. **Runs workspace tests and lints** (`cargo test --workspace`, `cargo clippy --workspace --all-targets`, `pnpm test`, `pnpm check`).
5. **Increments the version** across `Cargo.toml` and root `package.json` (e.g. `0.1.0` -> `0.1.1`).
6. **Creates a Pull Request** from `development` into `main`.
7. **Merges the PR** into `main` (if checks pass and approved).
8. **Synchronizes the branches** by merging `main` back into `development`.
9. **Triggers the GitHub release workflow** (`ci.yml` or release action) on `main`.

## Prerequisites

- **GitHub CLI** (`gh`) must be installed and authenticated with PR and workflow write access.
- **Node.js** (v22+) and **pnpm** (v11+) installed.
- **Rust toolchain** (stable 2021) installed.

---

## Step-by-Step Workflow

### Phase 1: Create Release Prep Branch
Ensure the workspace is clean and up to date, then check out a temporary release branch:
```bash
git checkout development
git pull origin development
git checkout -b release/prepare-release
```

### Phase 2: Update Dependencies & Lockfiles
```bash
pnpm install
cargo update
```

### Phase 3: Verify Builds and Tests
Verify that compilation and all tests pass cleanly:
```bash
cargo check --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm check
pnpm test
pnpm build
```

If any check fails, abort the process and diagnose the failure. Do not proceed to commit.

### Phase 4: Bump Version
Update the workspace version in:
- `Cargo.toml` (`[workspace.package] version = "..."`)
- `package.json` (`"version": "..."`)
- `src/apps/tendril-app/package.json`
- `src/packages/components/package.json`

Commit the changes:
```bash
git add Cargo.toml Cargo.lock package.json pnpm-lock.yaml src/apps/tendril-app/package.json src/packages/components/package.json
git commit -m "chore: bump version for release (Plan 00516)"
git push origin release/prepare-release
```

### Phase 5: Create and Merge PR into Main
Generate a Pull Request to merge the updated release branch into `main`:
```bash
gh pr create --base main --head release/prepare-release --title "Release: Bump version" --body "Automated release PR created by Tendril Release Skill."
```

Once the PR is created, merge when checks pass:
```bash
gh pr merge --merge --auto
```

### Phase 6: Sync Main Back into Development
Keep branches synchronized:
```bash
git checkout main
git pull origin main
git checkout development
git merge main --no-ff -m "Merge branch 'main' into development to sync"
git push origin development
git branch -d release/prepare-release
git push origin --delete release/prepare-release
```

### Phase 7: Trigger CI / Release Workflow
Trigger the release Action workflow on `main`:
```bash
gh workflow run ci.yml --ref main
```

Confirm that the workflow has been dispatched:
```bash
gh run list --workflow=ci.yml --limit 1
```

---

## Troubleshooting & Common Mistakes

- **Authentication Errors**: If `gh` is not authenticated, authenticate by running `gh auth login`.
- **Merge Conflicts**: If merging `main` back into `development` has conflicts, stop and resolve them manually.
- **Untracked Files**: Ensure no temporary test or build files remain in the workspace.
