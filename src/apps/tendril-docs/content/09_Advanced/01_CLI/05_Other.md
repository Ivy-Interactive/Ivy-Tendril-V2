---
title: Other Commands
description: Promptware execution, background job orchestration, chat sessions, background service registration, and utilities.
icon: Wrench
searchHints:
  - promptware
  - memory
  - tool
  - job
  - chat
  - service
  - autostart
  - launchd
  - systemd
  - status
  - models
  - hash-password
  - generate-certs
  - agent-instructions
---

# Other Commands

Reference for promptware execution, background job tracking, interactive chat sessions, OS background service management, and Tendril CLI utility commands.

## promptware

Tendril uses [promptwares](../../02_Concepts/02_Promptwares.md) to structure agent execution workflows. For background details, see [Promptwares Concept](../../02_Concepts/02_Promptwares.md).

#### promptware run

```terminal
>tendril promptware run <name> [args...] [options]
```

Runs a promptware directly on the host machine, bypassing the server job queue.

| Option                 | Effect                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| `--profile <profile>`  | Override the agent reasoning profile (`deep`, `balanced`, `quick`)                |
| `--working-dir <path>` | Working directory for the agent execution process                                 |
| `--value <key=value>`  | Additional firmware header values (repeatable)                                    |
| `--plan <id>`          | Target plan ID or folder path                                                     |
| `--agent <provider>`   | Override agent provider (`claude`, `antigravity`, `codex`, `copilot`, `opencode`) |
| `--dry-run`            | Print the compiled firmware to stdout and exit without launching an agent         |

#### Memory and Tools

```terminal
>tendril promptware list-memory <name>
>tendril promptware read-memory <name> [files...]
>tendril promptware write-memory <name> <filename> [--file <path>] [--stdin]
>tendril promptware delete-memory <name> <filename>
>tendril promptware write-tool <name> <tool_name> [--file <path>] [--stdin]
```

Agents use these commands to persist learned patterns in a promptware's `Memory/` directory and author custom tools in `Tools/`.

#### Deployment & Layers

```terminal
>tendril promptware deploy
>tendril promptware layers [name]
```

- **deploy** — compiles and installs standard promptwares into `<TendrilHome>/Promptwares/`.
- **layers** — inspects which layer (shipped default or team overlay) supplied each promptware file.

## job

Manage asynchronous background agent jobs. Jobs run through the daemon queue and report live status. For UI inspection, see the [Jobs App](../../04_Apps/04_Jobs.md).

#### job list

```terminal
>tendril job list
>tendril job list --status Running
>tendril job list --limit 50
>tendril job list --json
```

Lists recent background jobs from the Tendril daemon server.

| Option              | Effect                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `--status <status>` | Filter by status (`Pending`, `Queued`, `Running`, `Completed`, `Failed`, `Timeout`, `Stopped`, `Blocked`) |
| `--limit <n>`       | Maximum number of results (default: 20)                                                                   |
| `--json`            | Output jobs as structured JSON                                                                            |

#### job start

```terminal
>tendril job start <job-type> [plan-id] [options]
```

Starts an asynchronous background job on the running Tendril daemon. Supported job types: `CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `AddProject`, `SyncRepo`.

| Option                    | Effect                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `--priority <number>`     | Priority ranking for queue dispatch (higher runs first)                              |
| `--chat-session <id>`     | Associate job with a chat session (defaults to `$TENDRIL_CHAT_SESSION_ID`)           |
| `--wait-for <job-id>`     | Job ID that must complete before this job can be queued (repeatable)                 |
| `--idempotency-key <key>` | Idempotency token: resubmissions return the existing job instead of creating another |
| `--force`                 | Resubmit even if identical work is already in flight                                 |
| `--description <text>`    | Task description (used with `CreatePlan`)                                            |
| `--project <name>`        | Target project (used with `CreatePlan`)                                              |
| `--note <text>`           | Execution note (used with `ExecutePlan`)                                             |
| `--instructions <text>`   | Refinement prompt (used with `UpdatePlan`)                                           |
| `--change-request <text>` | Reviewer feedback (used with `RetryPlan`)                                            |
| `--repo <name>`           | Repository (used with `CreateIssue`)                                                 |
| `--assignee <user>`       | Assignee username on GitHub (used with `CreateIssue` / `CreatePr`)                   |
| `--reviewer <user>`       | Reviewer username on GitHub (used with `CreatePr`, repeatable)                       |
| `--draft`                 | Create as a draft PR (used with `CreatePr`)                                          |

```terminal
>tendril job start ExecutePlan 00042
>tendril job start RetryPlan 00042 --change-request "Fix failing unit tests"
>tendril job start CreatePlan --description "Add dark mode toggle" --project MyProject
```

#### job status and fail

```terminal
>tendril job status <job-id> --message <text> [--plan-id <id>] [--plan-title <title>]
>tendril job fail <job-id> --message <text>
```

Reports progress telemetry or job failure directly to the daemon. Used internally by promptware scripts during execution.

#### job cancel and delete

```terminal
>tendril job cancel <job-id> [--message <reason>]
>tendril job delete <job-id>
```

- **cancel** — signals a running job to abort.
- **delete** — removes a job record from the database (log files on disk are preserved).

#### job add-log

```terminal
>tendril job add-log <job-id> <action> [--summary <text>]
```

Appends an `## Agent Log` narrative entry directly into the job's log file in `<TendrilHome>/Jobs/`. Operates directly on the filesystem and does not require the server daemon to be reachable.

#### Queue and Maintenance

```terminal
>tendril job queue [--json]
>tendril job force-start <job-id>
>tendril job stop-all
>tendril job clear [--completed] [--failed] [--all] [-y/--yes]
>tendril job maintenance
```

- **queue** — prints pending jobs in dispatch order
- **force-start** — bypasses concurrency and dependency gates to dispatch a job immediately
- **stop-all** — cancels every active and queued job
- **clear** — bulk-deletes completed or failed jobs
- **maintenance** — runs a job cleanup and reconciliation pass immediately

## chat

Drive interactive agent coding sessions from your terminal:

```terminal
>tendril chat list [--json]
>tendril chat get <session-id> [--json]
>tendril chat create [--agent <agent>] [--model <model>] [--title <title>] [--effort <level>] [--plan <folder>] [--json]
>tendril chat send <session-id> "<message>" [--agent <agent>] [--model <model>] [--effort <effort>]
>tendril chat delete <session-id>
```

`tendril chat send` connects to the daemon, dispatches the prompt turn, and streams real-time token responses and tool-call events directly to stdout.

## service

Manage the Tendril background daemon autostart service across platforms:

- **macOS** — registers a [launchd](https://en.wikipedia.org/wiki/Launchd) agent at `~/Library/LaunchAgents/io.tendril.daemon.plist`
- **Linux** — registers a [systemd](https://systemd.io) user service unit
- **Windows** — registers a scheduled task with [Task Scheduler](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page)

```terminal
>tendril service install [--no-start] [--force]
>tendril service status [--json]
>tendril service uninstall [--purge-binaries] [--force]
```

- **install** — registers the running executable as the background service. Use `--no-start` to register for next login without starting immediately.
- **status** — reports whether the service is registered, loaded, and serving (including URL and PID).
- **uninstall** — unregisters the autostart configuration. Use `--purge-binaries` to remove sidecars installed into `<home>/bin`.

## Utilities

#### models

```terminal
>tendril models
>tendril models --refresh
```

Lists supported LLM models, provider affiliations, context window limits, and live pricing. Use `--refresh` to fetch updated rates from the model registry.

#### generate-certs

```terminal
>tendril generate-certs <output-directory>
```

Generates a self-signed `localhost.crt` and `localhost.key` PEM pair for serving HTTPS with `tendril serve --tls-cert <path> --tls-key <path>`.

#### hash-password

```terminal
>tendril hash-password <password> [secret]
```

Hashes a password with [Argon2](https://en.wikipedia.org/wiki/Argon2) for use in `config.yaml`'s `auth:` section. Prints the encoded hash string and the pepper secret.

#### project-analyzer

```terminal
>tendril project-analyzer <folder-path>
```

Inspects a directory and prints a trimmed YAML stack analysis identifying language runtimes, package managers, and test frameworks.

#### agent-instructions

```terminal
>tendril agent-instructions
```

Compiles and prints the complete agent system prompt template with installation paths substituted, formatted for piping into an autonomous agent prompt.

#### wireframe

```terminal
>tendril wireframe setup [path] [--tailwind superset|jit] [--force] [--quiet]
>tendril wireframe serve [path] [--port <port>] [--host <host>] [--no-open]
>tendril wireframe screenshot [path] [--out <path>] [--width <w>] [--height <h>]
>tendril wireframe agent-readme [path]
```

Scaffolds, serves, previews with hot reload, and screenshots React wireframes designed during plan authoring.
