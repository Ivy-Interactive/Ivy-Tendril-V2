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
---

# Troubleshooting

## Installation & environment

| Symptom                                 | Fix                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENDRIL_HOME` not found                | Set the environment variable and restart your terminal, or write the path into `~/.tendril_location`. With neither, Tendril uses `~/.tendril`.                                                          |
| `config.yaml` not found                 | The file must exist at `$TENDRIL_HOME/config.yaml` and be named exactly that — not `tendril-config.yaml`. `tendril doctor` prints the path it expects.                                                  |
| `gh` not authenticated                  | Run `gh auth login`, then `gh auth status` to confirm.                                                                                                                                                  |
| `git` not found                         | Install Git and make sure it is on your `PATH`.                                                                                                                                                         |
| `tendril` not recognised after building | `cargo build --release` leaves the binary at `target/release/tendril` and does not touch your `PATH`. Either use that path, or install it with `cargo install --path src/crates/tendril-cli`.           |
| The app starts but nothing loads        | The app supervises the `tendril serve` daemon; if the sidecar binary is missing from a packaged build, there is no daemon to talk to. See [Installation](02_Installation.md) for the sidecar copy step. |

## Plans

| Symptom                                       | Fix                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plan stuck in `Draft`                         | Check a repo is attached with `tendril plan get <id>`, and that the project exists in `config.yaml`.                                                         |
| Plan folder looks incomplete or fails to load | `tendril plan validate <id>` lists the issues — a missing or invalid `plan.yaml`, a missing `Revisions/` folder, an empty title, an outdated schema version. |
| Plan on an outdated schema                    | `tendril plan doctor --fix` migrates every plan folder to the current schema version. There is no `--prune`.                                                 |
| Plan has no repos configured                  | `tendril plan add-repo <id> <path>`.                                                                                                                         |
| Stale worktree after a failed run             | `tendril plan cleanup <id>` removes the plan's worktrees. There is no `--force`.                                                                             |

## Execution & agents

| Symptom                            | Fix                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent not reachable                | Check `codingAgent` in `config.yaml`, then run the agent's own CLI by hand. Tendril shells out to it, so if `claude` (or `codex`, `copilot`, `gemini`, `opencode`) does not run non-interactively for you, it will not run for a job either. For `apple`, check `fm available` and that `fm serve` is running. |
| Execution fails immediately        | Read the job log under `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`. The usual causes are missing repository context and a misconfigured verification.                                                                                                                                                  |
| Verifications keep failing         | Run the verification command by hand inside the plan's worktree. Nearly always the command is right and the worktree is missing a setup step — see [Onboarding a Codebase](03_Onboarding.md).                                                                                                                  |
| Job never starts                   | `tendril job queue` shows dispatch order. Concurrency is capped by `maxConcurrentJobs` in `config.yaml`; a blocked job can be promoted with `tendril job force-start <id>`.                                                                                                                                    |
| Voice input says it is unavailable | On macOS, allow microphone access under System Settings → Privacy & Security → Microphone, then restart the app.                                                                                                                                                                                               |

## Database

Migrations run automatically whenever the database is opened, so there is nothing to apply by hand —
and consequently no `db-migrate`, `db-reset` or `db-version` commands.

| Symptom                                | Fix                                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unsure whether the database is healthy | `tendril doctor` reports `[OK] Database accessible and migrated` with the file path when it is.                                                                                                                                                        |
| Database locked                        | Something else already has it open. Only one daemon should be running: quit the desktop app before starting `tendril serve` yourself.                                                                                                                  |
| Database corrupted                     | Stop the app and the daemon, then delete `$TENDRIL_HOME/tendril.db` along with its `-wal` and `-shm` siblings. A fresh one is created on next start. Plan folders on disk are not affected, so your plans, revisions and verification reports survive. |

> [!TIP]
> When reporting an issue, include the output of `tendril doctor` and `tendril version` — see
> [Getting Help](05_GettingHelp.md).
