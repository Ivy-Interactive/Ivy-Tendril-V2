<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Resolving Merge Conflicts

When resolving conflicts in `package.json` or `pnpm-workspace.yaml`:

1. **Never keep your branch's manifest side wholesale.** Resolve conflicts key-by-key, preferring the side that introduced the change over the base. Keeping `HEAD` or `MERGE_HEAD` without inspection silently reverts already-merged changes.

2. **Run the merge guard before committing the resolution:**

   ```bash
   pnpm run verify:merge
   ```

   The guard detects lost changes by comparing `base`, `ours`, `theirs`, and `merged` for every dependency/script key in `package.json` and every catalog, override and setting in `pnpm-workspace.yaml`. If it reports findings, review each one — a revert surfaces as someone else's test failing, not yours.

3. **If a drop is deliberate,** pass `--allow <section>.<key>` to suppress the warning and document why in the commit message. For example:

   ```bash
   node scripts/verify-merge-resolution.mjs --allow devDependencies.old-package
   ```

4. **After committing the resolution, run the full test suite** (`pnpm test`), not only your plan's tests. A lost change is detected by another plan's tests breaking, so a green suite on your subset proves nothing.

### Precedent

Commit `8698ad1` _"[00059] Resolve merge conflicts with main"_ kept the base side of `package.json` wholesale, reverting [Plan 00077](plan://00077)'s dev scripts and [Plan 00090](plan://00090)'s variable font switch. Both were already merged to `main` — the conflict resolution undid them. Two test files went red (`tests/storybook-runner.test.ts`, `tests/fonts.test.ts`) and the bad resolution merged anyway because `vp check` short-circuited before the suite ran.

The merge guard prevents this pattern. Branch protection that requires a green `Lint & Types` + `Package Build` + `Unit Tests` + `Merge Resolution Guard` status will be enabled via `pnpm run protect:main` once the repository is public or on a paid GitHub plan. Until then, the guard runs in CI as a job that can fail the PR, but cannot block merging.

## Multi-Document Lockfile

`pnpm-lock.yaml` contains **two YAML documents** separated by `---`. The leading document locks the package manager itself (`packageManagerDependencies`); the second document is the project's dependency graph.

The pinned pnpm — 11.25.0 — is what _writes_ the leading document. Any older pnpm **removes** it, silently and with exit 0, and does not put it back: pnpm 10 has no `packageManagerDependencies` support, so a bare `pnpm install` from a pnpm 10 on `PATH` strips the block and never restores it. That is a one-way loss, not self-healing behavior. Once stripped, `pnpm install --frozen-lockfile` (both jobs in `.github/workflows/storybook-tests.yml`) fails with a message that names neither a pnpm version nor a file:

```
[ERROR] Cannot update packageManagerDependencies with "frozen-lockfile" because the lockfile is not up to date
```

The top-level `"packageManager": "pnpm@11.25.0"` field in `package.json` is what forces the right pnpm: pnpm's `manage-package-manager-versions` (default `true`) reads it and re-executes as 11.25.0, so even a pnpm 10 on `PATH` leaves the lockfile byte-identical. `devEngines.packageManager` is kept alongside it because `vp install` reads that one; the two must always name the same version, and `tests/package-manager-pin.test.ts` fails if they drift or if the lockfile block goes missing.

Operational rules:

- Do not delete the leading document during merge conflict resolution. It will not come back on its own.
- If `manage-package-manager-versions` is disabled in your pnpm config, install with `vp install` or `corepack pnpm@11.25.0 install` rather than bare `pnpm` — the `packageManager` field cannot protect you with that setting off.
- Tests that parse the lockfile use the `yaml` package to select a document by key (`overrides` for the project document, `packageManagerDependencies` for the leading one) — never by index.
