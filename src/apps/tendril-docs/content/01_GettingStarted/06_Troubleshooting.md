---
title: Troubleshooting
description: >-
  Common symptoms and how to fix them. If you are still stuck, run `tendril doctor` and reach out on
  Discord.
icon: Wrench
searchHints:
  - troubleshooting
  - error
  - problem
  - symptom
  - debug
  - diagnose
  - stale worktree
  - database
  - doctor
  - db
---

# Troubleshooting

Diagnose and resolve common configuration, agent, plan, and database issues.

## Installation & environment

| Symptom                                 | Fix                                                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TENDRIL_HOME` not found                | Set the environment variable and restart your terminal, or write the path into `~/.tendril_location`. Without either, Tendril defaults to `~/.tendril`.                                                |
| `config.yaml` not found                 | The file must exist at `$TENDRIL_HOME/config.yaml` and be named exactly that — not `tendril-config.yaml`. `tendril doctor` reports the path it expects.                                                |
| `gh` not authenticated                  | Run [GitHub CLI](https://cli.github.com/) authentication: `gh auth login`, then `gh auth status` to confirm.                                                                                           |
| `git` not found                         | Install [Git](https://git-scm.com/) and verify it is on your `PATH`.                                                                                                                                   |
| `tendril` not recognised after building | `cargo build --release` leaves the binary at `target/release/tendril`. Either add that to `PATH`, or run `cargo install --path src/crates/tendril-cli`.                                                |
| The app starts but nothing loads        | The desktop app supervises the `tendril run` daemon; if sidecar binaries are missing from a packaged build, there is no daemon to talk to. See [Installation](02_Installation.md) for packaging steps. |

## Plans

| Symptom                                       | Fix                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plan stuck in `Draft`                         | Check a repository is attached with `tendril plan get <id>`, and verify the project definition exists in `config.yaml`.                                      |
| Plan folder looks incomplete or fails to load | Run `tendril plan validate <id>` to inspect issues — invalid `plan.yaml`, missing `Revisions/`, empty title, or mismatched schema versions.                  |
| Plan on an outdated schema                    | Run `tendril plan doctor --fix` to migrate plan folders to the current schema. To remove orphaned empty plan husks, run `tendril plan doctor --prune-husks`. |
| Plan has no repos configured                  | Run `tendril plan add-repo <id> <path>`.                                                                                                                     |
| Stale worktree after a failed run             | Run `tendril plan cleanup <id>` to remove worktrees for finished plans. For non-terminal plans, pass `--force`: `tendril plan cleanup <id> --force`.         |

## Execution & agents

| Symptom                            | Fix                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent not reachable                | Check `codingAgent` in `config.yaml`, then run the agent's CLI directly in a clean shell. Tendril executes it as a child process; if `claude`, `codex`, `copilot`, `gemini`, `opencode`, `antigravity`, or `cursor` cannot run unattended, background jobs will stall. For `apple`, verify `fm available` and ensure `fm serve` is active. |
| Execution fails immediately        | Read the job log under `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`. Common causes include missing repository context or missing tool grants in [Promptwares](../02_Concepts/02_Promptwares.md).                                                                                                                                    |
| Verifications keep failing         | Run the verification command by hand inside the plan's isolated worktree (`$TENDRIL_HOME/Plans/{id}-{name}/Worktrees/{repo}`). The command is usually correct and the worktree is missing a setup step — see [Onboarding a Codebase](03_Onboarding.md).                                                                                    |
| Job never starts                   | Run `tendril job queue` to inspect dispatch order and concurrency limits (`maxConcurrentJobs` in `config.yaml`). Promote a queued or blocked job with `tendril job force-start <id>`, or halt stuck jobs with `tendril job stop-all`. See [Lifecycle & Jobs](../02_Concepts/03_Lifecycle.md).                                              |
| Voice input says it is unavailable | On macOS, grant microphone permissions under System Settings → Privacy & Security → Microphone, then restart the desktop app.                                                                                                                                                                                                              |

## Database

Tendril manages its [SQLite](https://www.sqlite.org) database at `$TENDRIL_HOME/tendril.db`. While migrations
run automatically upon daemon startup, Tendril provides dedicated database commands:

```bash
# Check current database schema version
tendril db version

# Apply any pending migrations
tendril db migrate

# Verify database integrity
tendril db integrity

# Reclaim unused disk space
tendril db vacuum

# Reset database (prompted confirmation)
tendril db reset
```

| Symptom                                | Fix                                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unsure whether the database is healthy | Run `tendril doctor` (verifies connectivity) or `tendril db integrity` to check internal SQLite consistency.                                                                                                       |
| Database locked                        | Another process has an exclusive lock. Only one daemon should run at once; close the desktop app before running `tendril run` or `tendril serve` manually.                                                         |
| Database corrupted                     | Stop the app and daemon, then run `tendril db reset` (or delete `$TENDRIL_HOME/tendril.db` along with `-wal` and `-shm` files). Plan markdown files on disk under `$TENDRIL_HOME/Plans/` remain completely intact. |

> [!TIP]
> When requesting assistance on [Discord](https://discord.gg/FHgxkDga3y) or GitHub, bundle full diagnostic
> logs using `tendril report-bug <plan-id>` — see [Getting Help](05_GettingHelp.md).
