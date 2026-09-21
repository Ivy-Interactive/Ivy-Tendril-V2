---
title: Setup & Settings
description: Configure Tendril in the in-app Settings UI or by editing TENDRIL_HOME/config.yaml (projects, agents, levels, verifications, preferences).
icon: Construction
searchHints:
  - config
  - yaml
  - configuration
  - settings
  - projects
  - gui
  - deployment
  - docker
  - secrets
  - BasicAuth
  - password
  - hosted
---

# Setup & Settings

## In-app Settings

Tendril includes a dedicated Settings app to configure the environment visually without hand-editing [YAML](https://yaml.org). The settings sidebar provides the following sections:

- **Coding Agent** — Choose the primary coding agent runtime ([Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), Antigravity, [OpenCode](../06_CodingAgents/04_OpenCode.md), Cursor, Apple, or custom OpenAI-compatible proxies), configure provider API keys and custom base URLs, customize agent profiles and reasoning tiers, test agent connectivity, and browse model specs via the Model Catalog. For agent installation and setup, see [Coding Agents](../06_CodingAgents/_Index.md).
- **Plans** — Edit the default Markdown plan template (`planTemplate`) used whenever a new plan is created in [Plans](../04_Apps/03_Plans.md).
- **Appearance** — Select theme mode (**Light**, **Dark**, or **System**), choose from built-in theme presets with preview swatches, configure default sidebar state (expanded or collapsed), and choose the Chat button target (**Chat view** or **Terminal**).
- **Projects** — Manage registered projects, configure per-project repositories, verifications, ports, environment variables, custom skills, [MCP](../09_Advanced/03_MCP.md) servers, and access the Danger Zone. See [Project Setup](02_Projects.md).
- **Team Vault** _(Beta)_ — Synchronize projects, custom skills, MCP servers, and security rules across team members via a shared [Git](https://git-scm.com) repository.
- **Workflow Agents** — Configure [Promptware](../02_Concepts/02_Promptwares.md) agent profiles and granular tool permissions (`allowedTools`, `deniedTools`) across standard workflows (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, etc.) or globally using the `_default` key.
- **Levels** — Define complexity tiers (such as L1, L2, L3) with relative execution weights, descriptions, and custom badge colors.
- **Notifications** — Toggle desktop system notifications on or off for job completions and failures.
- **Security & Tunneling** — Configure web session password protection, start or stop full-access [Cloudflare](https://www.cloudflare.com) tunnels for remote access, and create read-only share tunnels with capability tokens.
- **Advanced** — Set execution timeouts (`jobTimeout`, `staleOutputTimeout`), configure `maxConcurrentJobs`, toggle beta feature access, and inspect live **Daemon Diagnostics** (connection state, PID, latency ping, `$TENDRIL_HOME` path, and reported capabilities).
- **Newsletter** — Subscribe to Ivy & Tendril product updates and release notes.
- **Open config.yaml** — Launch the built-in raw YAML editor with live syntax highlighting and direct plan linking.

## `config.yaml`

Settings modified in the UI persist immediately to `$TENDRIL_HOME/config.yaml` (defaulting to `~/.tendril/config.yaml`). You can also edit this file directly or specify a custom path using the `TENDRIL_CONFIG` environment variable.

> [!NOTE]
> The configuration file must always be named `config.yaml`. The Tendril daemon reloads configuration changes automatically when updated on disk.

### Example

```yaml
codingAgent: claude
maxConcurrentJobs: 5
jobTimeout: 45
staleOutputTimeout: 10
theme: default
themeMode: system
chatMode: chat
desktopNotifications: true

projects:
  - name: Global Engine
    color: Emerald
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: CheckResult
        required: true

auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..." # Managed via Settings
  hashSecret: "base64-secret-pepper"

api:
  apiKey: "your-api-secret-key"
```

### Common fields

| Field                  | Type          | Default     | Purpose                                                                                         |
| ---------------------- | ------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `codingAgent`          | string        | `"claude"`  | Default coding agent executable. See [Coding Agents](../06_CodingAgents/_Index.md).             |
| `maxConcurrentJobs`    | integer       | `20`        | Maximum number of concurrent agent execution [Jobs](../04_Apps/04_Jobs.md) (worktrees).         |
| `jobTimeout`           | integer (min) | `30`        | Execution timeout in minutes before an active job is canceled.                                  |
| `staleOutputTimeout`   | integer (min) | `10`        | Timeout in minutes if an agent process produces no stdout/stderr output.                        |
| `daemonRequestTimeout` | integer (sec) | `30`        | Client request timeout in seconds when communicating with the local daemon.                     |
| `planTemplate`         | string        | `""`        | Markdown template used when creating new plans in [Plans](../04_Apps/03_Plans.md).              |
| `theme`                | string        | `"default"` | Appearance preset identifier (e.g. `default`, `dracula`).                                       |
| `themeMode`            | string        | `"system"`  | Theme mode: `light`, `dark`, or `system`.                                                       |
| `chatMode`             | string        | `"chat"`    | What the Chat button opens: `chat` (Chat view) or `terminal` (agent terminal).                  |
| `desktopNotifications` | boolean       | `true`      | Whether desktop OS notifications are enabled for job events.                                    |
| `projects`             | list          | `[]`        | List of registered projects and their configurations. See [Project Setup](02_Projects.md).      |
| `levels`               | list          | standard    | Configured plan complexity tiers and weights.                                                   |
| `auth`                 | object        | `null`      | Session password protection configuration using [Argon2](https://en.wikipedia.org/wiki/Argon2). |
| `api.apiKey`           | string        | `null`      | Shared secret protecting REST API endpoints. See [REST API](../09_Advanced/02_REST.md).         |
| `telemetry`            | boolean       | `null`      | Anonymous usage telemetry opt-in (`false` or absent means off).                                 |

## Authentication & Remote Access

### Session Protection (Web UI)

When hosting Tendril on a remote server or exposing it over a network, enable session protection in **Settings > Security & Tunneling** or configure credentials via environment variables:

- `TENDRIL_AUTH_USERNAME` — Login username (default: `admin`).
- `TENDRIL_AUTH_PASSWORD` — Plaintext password to hash on startup.
- `TENDRIL_AUTH_HASH_SECRET` — 32-byte base64 string (`openssl rand -base64 32` via [OpenSSL](https://www.openssl.org)) used as the [Argon2](https://en.wikipedia.org/wiki/Argon2) pepper secret.

In `config.yaml`, passwords are stored as Argon2 PHC hashes under the `auth:` block with optional rate limiting:

```yaml
auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..."
  hashSecret: "base64-encoded-pepper"
  rateLimit:
    threshold: 3
    baseDelaySeconds: 1.0
    maxDelaySeconds: 60.0
```

### Cloudflare Tunnels

Tendril integrates with [Cloudflare](https://www.cloudflare.com) tunnels (`cloudflared`) to expose the application securely without open incoming firewall ports:

- **Full-Access Tunnel**: Publishes the complete Tendril daemon. For security, Tendril enforces that Session Protection is active with a configured password before starting a full-access tunnel.
- **Share Tunnel**: Creates a read-only tunnel protected by capability tokens, allowing safe sharing of [Dashboard](../04_Apps/01_Dashboard.md) and plan progress with stakeholders without exposing write access.

### REST API Protection

The REST API uses token authentication via the `api.apiKey` setting in `config.yaml` or the `TENDRIL_API_KEY` environment variable. When set, requests must supply the `X-Api-Key` header. See [REST API](../09_Advanced/02_REST.md) and [CLI Configuration](../09_Advanced/01_CLI/06_Config.md).

## Verifications

Tendril ships with built-in verification gate definitions that projects can wire into their pipelines:

| Verification  | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| `Build`       | Run the project build command and verify zero compile errors.   |
| `Format`      | Verify code formatting rules or format changed files.           |
| `Test`        | Run unit or integration tests scoped to the plan's changes.     |
| `Lint`        | Run static analysis / linters and report any violations.        |
| `Screenshots` | Capture UI screenshots into the plan's artifacts directory.     |
| `CheckResult` | Verify the final implementation matches the plan specification. |

Custom verification commands (such as `cargo test`, `pnpm test`, or `pytest`) can be defined globally in `config.yaml` or directly inside [Project Setup](02_Projects.md#verification-pipelines). For CLI verification commands, see [CLI Verification](../09_Advanced/01_CLI/03_Verification.md).
