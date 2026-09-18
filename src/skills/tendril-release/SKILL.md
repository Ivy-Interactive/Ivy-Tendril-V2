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
9. **Triggers the GitHub release workflow** (`release-full.yml`) on the release ref.

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

### Phase 7: Trigger the Release Workflow

`ci.yml` builds and tests; it publishes nothing. The workflow that cuts a release is
`release-full.yml`, and it takes a version.

Dry run first — `test-mode` defaults to `true`, which builds every artifact and prints a summary
without creating a tag or a release:

```bash
gh workflow run release-full.yml --ref main -f version=0.2.0
```

Publish for real by turning it off:

```bash
gh workflow run release-full.yml --ref main -f version=0.2.0 -f test-mode=false
```

`--ref` takes any branch, not just `main`, which is how a release is cut from a target branch. The
release tag is created on the exact commit the run checked out (`target_commitish: github.sha`), so
the tag matches the artifacts even when the branch moves on.

Confirm that the workflow has been dispatched:
```bash
gh run list --workflow=release-full.yml --limit 1
```

What it publishes, under a single `v<version>` tag: the `@ivy-interactive/components` npm tarball,
the `tendril` CLI for five targets, `tendril-server` for five targets, the desktop installers for
macOS (arm64 and x64), Windows and Linux, and the VS Code `.vsix`. Code signing is not wired up
yet — macOS and Windows artifacts are unsigned, so a first launch needs the OS override.

The desktop installers carry two sidecars: the `tendril` companion daemon, built from the same
commit, and the OpenCode agent, downloaded by
`src/apps/tendril-app/scripts/release/fetch-opencode-sidecar.sh` at the version pinned in that
script. Bump the pin there to ship a newer agent.

---

## Troubleshooting & Common Mistakes

- **Authentication Errors**: If `gh` is not authenticated, authenticate by running `gh auth login`.
- **Merge Conflicts**: If merging `main` back into `development` has conflicts, stop and resolve them manually.
- **Untracked Files**: Ensure no temporary test or build files remain in the workspace.
