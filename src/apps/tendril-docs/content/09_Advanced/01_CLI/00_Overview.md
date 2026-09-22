---
title: CLI Overview
description: Manage plans, projects, databases, and agents directly from your terminal. The tendril binary works as both a server daemon and a full-featured CLI tool.
icon: Terminal
searchHints:
  - cli
  - command
  - terminal
  - tendril
  - shell
  - reset
  - report-bug
  - run
  - serve
  - doctor
  - version
  - config
---

# CLI Overview

Manage plans, projects, databases, and agents directly from your terminal. The `tendril` binary works as both a server daemon and a full-featured CLI tool.

Tendril CLI gives you complete control over your workflow without touching the UI:

- **Plans** — create, list, update, and inspect plans; manage repos, worktrees, verifications, and recommendations
- **Projects** — configure projects, their repos, build dependencies, review actions, MCP servers, and custom skills
- **Verifications** — define and manage reusable verification checks
- **Config** — read and update top-level settings stored in `config.yaml`
- **Vault** — connect team vaults, discover remote repos, sync assets, and import or push projects
- **Database** — run migrations, inspect schema versions, reset tables, check integrity, and vacuum
- **Agents & Jobs** — run promptwares, manage background jobs, and drive interactive chat sessions

## Quick Start

**1. Check your installation**

```terminal
>tendril doctor
```

**2. Start the daemon server**

```terminal
>tendril run
```

**3. Create a new plan**

```terminal
>tendril plan create "Fix login bug" MyProject
```

**4. List active plans**

```terminal
>tendril plan list --state Executing
```

**5. Reset everything and start fresh**

```terminal
>tendril reset
```

> [!TIP]
> Every command supports `--help` for detailed usage. For example: `tendril plan create --help`.

## Global Options

| Flag            | Effect                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------- |
| `--home <path>` | Path to Tendril home directory (can also be set via the `TENDRIL_HOME` environment variable) |

## Environment Variables

| Variable        | Purpose                                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENDRIL_HOME`  | Root directory for config, database, inbox, and plans (defaults to `~/.tendril` or `D:\.tendril`)                                                                     |
| `TENDRIL_PLANS` | Override plans directory (defaults to `TENDRIL_HOME/Plans`)                                                                                                           |
| `RUST_LOG`      | Filter directive for process logging on stderr (default: `warn,tendril_cli=info,tendril_core=info,tendril_server=info`). Set to `debug` for detailed diagnostic logs. |

## Common Commands

#### doctor

```terminal
>tendril doctor
>tendril doctor --rebuild-search-index
```

Validates your Tendril installation — checks `TENDRIL_HOME`, `config.yaml`, required tools (`git`, `gh`), database connectivity, and agent model availability. Use `--rebuild-search-index` to regenerate the full-text search index from the database.

#### plan doctor

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

Scans every plan folder and reports health: missing or malformed `plan.yaml`, stale worktrees, and plans left `Completed` over a failed verification. See [Plan](01_Plan.md#doctor) for the full option and health-code reference.

#### serve and run

```terminal
>tendril serve --port 5010 --host 127.0.0.1
>tendril serve --tls-cert /path/localhost.crt --tls-key /path/localhost.key
>tendril run
```

`tendril serve` starts the HTTP and WebSocket API server (default port `5010`, host `127.0.0.1`). Optional `--tls-cert` and `--tls-key` flags serve HTTPS.

`tendril run` verifies that the target port is available, automatically applies any pending database migrations, and then launches the daemon.

#### reset

```terminal
>tendril reset
>tendril reset --force
```

Removes all Tendril data from the machine — deletes `TENDRIL_HOME` and `TENDRIL_PLANS`. Prompts for confirmation unless `--force` is provided.

> [!WARNING]
> This permanently deletes all plans, jobs, and configuration data in the target directories.

#### report-bug

```terminal
>tendril report-bug --plan 00042
>tendril report-bug --job 00150 -d "Agent failed to create worktree"
>tendril report-bug --plan 00042 --out ~/Desktop/diagnostics.zip
>tendril report-bug --plan 00042 --submit --yes
```

Collects plan files and every job artifact — the Job Log, Job Prompt, Job Raw Log and Job Eventwire Log from `<TendrilHome>/Jobs/` — into a zip archive with sanitized configuration and health diagnostics. When `--submit` and `--yes` are given, uploads the archive and opens a GitHub issue.

| Option                  | Effect                                                    |
| ----------------------- | --------------------------------------------------------- |
| `--plan <id>`           | Include this plan folder and all jobs that ran against it |
| `--job <id>`            | Include this job's four artifacts plus its plan's context |
| `-d, --description <t>` | Bug description (prompted interactively if omitted)       |
| `--out <path>`          | Destination path for the zip archive                      |
| `--github-user <name>`  | GitHub username for issue follow-up                       |
| `--submit`              | Upload report to GitHub (requires `--yes`)                |
| `-y, --yes`             | Skip the confirmation prompt                              |

> [!WARNING]
> Submitting a report attaches the zip bundle to a **public** GitHub issue. Secrets are stripped from configs and job logs, but review plan content before submitting.

#### version

```terminal
>tendril version
```

Prints the installed Tendril version (e.g. `tendril v2.0.0`).

#### update-promptwares

```terminal
>tendril update-promptwares
>tendril update-promptwares --dry-run
>tendril update-promptwares --source /path/to/promptwares
```

Refreshes deployed promptwares in `<TendrilHome>/Promptwares/`, preserving their `Memory/` and `Tools/` directories.

## Next Steps

- [Plan commands](01_Plan.md) — full reference for creating and managing plans
- [Project commands](02_Project.md) — configure projects, repos, review actions, MCP servers, and skills
- [Verification commands](03_Verification.md) — manage global verification definitions
- [Database commands](04_Database.md) — migrations, schema version, integrity, and vacuum
- [Other commands](05_Other.md) — promptware, job, chat, service, and utilities
- [Config commands](06_Config.md) — read and update top-level `config.yaml` settings
- [Vault commands](07_Vault.md) — connect team vaults, sync assets, and import or publish projects
