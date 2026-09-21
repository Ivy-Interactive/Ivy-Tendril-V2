---
title: config
description: Get and set top-level Tendril configuration settings stored in config.yaml directly from the command line.
icon: Settings
searchHints:
  - config
  - configuration
  - settings
  - jobTimeout
  - codingAgent
  - planTemplate
  - gitTimeout
  - daemonRequestTimeout
  - llm
---

# config

Get and set top-level Tendril configuration settings stored in [YAML](https://yaml.org) format inside `config.yaml` — the same global values managed under Settings in the desktop and web interfaces. See the [Setup Guide](../../03_Configuration/01_Setup.md) for more details on environment and directory layout.

## Commands

```terminal
>tendril config get <key>
>tendril config set <key> <value>
```

- **`get`** — Prints the raw value to standard output without decorative formatting, making it ideal for shell scripting and piping directly into files or other tools.
- **`set`** — Validates and updates the value in `config.yaml`. Keys are case-insensitive.

## Primitive Keys

Tendril models several primitive configuration keys with typed validation:

| Key                            | Type                                | Default            | Description                                                                                                                      |
| ------------------------------ | ----------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `codingAgent`                  | string                              | `claude`           | Default coding agent executable or alias (e.g., `claude`, `aider`, `codestory`).                                                 |
| `jobTimeout`                   | integer (minutes)                   | `120`              | Maximum execution timeout for a running plan job.                                                                                |
| `staleOutputTimeout`           | integer (minutes)                   | `10`               | Inactivity duration before a job with no output is flagged as stalled.                                                           |
| `gitTimeout`                   | integer (minutes)                   | `5`                | Command timeout for [Git](https://git-scm.com) operations.                                                                       |
| `daemonRequestTimeout`         | integer (seconds)                   | `30`               | Timeout in seconds for HTTP requests to the local Tendril daemon (`0` or negative disables).                                     |
| `maxConcurrentJobs`            | integer                             | `2`                | Maximum number of concurrent execution jobs allowed.                                                                             |
| `planTemplate`                 | string                              | `""`               | [Markdown](https://daringfireball.net/projects/markdown/) template prepended when creating new plans.                            |
| `planFolder`                   | string (optional)                   | `None`             | Custom filesystem directory where plan markdown files are stored. Pass `""` to unset.                                            |
| `promptwareOverlay`            | string (optional)                   | `None`             | Path to an overlay directory containing custom promptwares. Pass `""` to unset.                                                  |
| `telemetry`                    | boolean (optional)                  | `None`             | Opt-in anonymous telemetry toggle (`true` or `false`). Pass `""` to clear.                                                       |
| `beta`                         | boolean                             | `false`            | Enables experimental preview features (`true` or `false`).                                                                       |
| `desktopNotifications`         | boolean                             | `true`             | Enables system desktop notifications for plan status and agent completions (`true` or `false`).                                  |
| `theme`                        | string                              | `default`          | UI color preset ID (e.g., `default`, `dracula`).                                                                                 |
| `worktreeReaperInterval`       | integer (minutes)                   | `60`               | Frequency of automated [Git](https://git-scm.com) worktree reaper passes (`0` or negative disables).                             |
| `worktreeReaperGrace`          | integer (minutes)                   | `1440`             | Idle grace period in minutes before an inactive worktree is considered eligible for reaping.                                     |
| `worktreeBranchDeleteMode`     | string                              | `PreserveUnpushed` | Branch deletion safety mode on worktree reap (`PreserveUnpushed` or `Force`).                                                    |
| `coAuthor`                     | string (optional)                   | `None`             | [Git](https://git-scm.com) trailer attribution identity in `Name <email>` format added to automated commits. Pass `""` to unset. |
| `enrichModels`                 | boolean                             | `true`             | Enables automatic background model discovery and enrichment (`true` or `false`).                                                 |
| `modelEnrichmentIntervalHours` | integer (hours)                     | `24`               | Background refresh interval for model metadata.                                                                                  |
| `modelCacheWarnAgeDays`        | integer (days)                      | `7`                | Soft age threshold before stale model cache produces warnings.                                                                   |
| `modelCacheMaxAgeDays`         | integer (days)                      | `30`               | Hard age threshold after which cached model metadata expires.                                                                    |
| `llm`                          | [JSON](https://www.json.org) object | `None`             | Endpoint, API key, and model configuration for the auxiliary LLM service. Merged with existing fields.                           |

> [!NOTE]
> Unmodeled scalar keys can also be stored and retrieved; they are stored in an extra attributes table in `config.yaml`.

## Structured Keys

Tendril settings also contain structured lists and maps that cannot be set or retrieved via `tendril config`:

- `projects` — Configured project definitions (manage using [`tendril project`](02_Project.md)).
- `verifications` — Global verification suite definitions (manage using [`tendril verification`](03_Verification.md)).
- `levels` — Plan complexity tiers and verification bindings.
- `onboarding` — First-run wizard completion states.
- `codingAgents` — Per-agent binary paths, arguments, environment variables, and profiles.
- `promptwares` — Per-promptware instructions, profiles, and tool rules.
- `inbox` — Inbound notification rules and delivery integrations.

Attempting to run `tendril config get` or `tendril config set` on any structured key prints an error directing you to use the dedicated CLI command or edit `config.yaml` directly.

## Examples

```terminal
># Read a configuration value
>tendril config get jobTimeout

># Update a numeric or text setting
>tendril config set jobTimeout 60
>tendril config set codingAgent claude

># Toggle boolean options
>tendril config set desktopNotifications false
>tendril config set beta true

># Merge auxiliary LLM configuration
>tendril config set llm '{"model":"gpt-4o"}'

># Clear an optional setting by passing an empty string
>tendril config set coAuthor ""
>tendril config set planFolder ""

># Set a multiline plan template using shell command substitution
>tendril config set planTemplate "$(cat template.md)"

># Round-trip the plan template back out to a file
>tendril config get planTemplate > template.md
```

> [!TIP]
> When assigning multiline text such as `planTemplate` or [JSON](https://www.json.org) objects such as `llm`, use shell quoting or command substitution (`"$(cat file.md)"`) to ensure values are passed cleanly as a single argument.
