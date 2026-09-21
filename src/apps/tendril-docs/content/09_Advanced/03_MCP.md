---
title: MCP Server
description: Tendril includes a Model Context Protocol (MCP) server that exposes plan management tools to AI coding agents like Claude Code.
icon: Bot
searchHints:
  - mcp
  - model context protocol
  - claude
  - tools
  - tendril_get_plan
  - tendril_list_plans
  - tendril_start_job
  - tendril_inbox
  - tendril_get_config
---

# MCP Server

Tendril includes a Model Context Protocol (MCP) server that exposes plan management, job orchestration, and project discovery tools to AI coding agents like Claude Code.

## Starting the MCP Server

```bash
tendril mcp
```

This launches the MCP server via stdio transport, suitable for use in Claude Code's MCP configuration. Standard input and output are reserved strictly for JSON-RPC messages; diagnostic logs are directed to stderr.

## Authentication

Set the `TENDRIL_MCP_TOKEN` environment variable to require token authentication for MCP sessions:

- **Environment variables**: Clients connecting over stdio can provide the matching token via `TENDRIL_MCP_CLIENT_TOKEN` (or `TENDRIL_MCP_TOKEN`).
- **Request metadata**: Clients may also pass the token per-request in `initialize` params under `_meta["io.tendril/token"]`.

When `TENDRIL_MCP_TOKEN` is unset or blank, authentication is disabled and local requests are permitted.

## Available Tools

All tools are prefixed with `tendril_` and operate directly against the daemon or local Tendril storage.

### Plan Inspection & Query

| Tool                             | Parameters                                                           | Description                                                                                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_plan`               | `plan_id` (required), `field` (optional)                             | Get a plan's metadata and latest revision. When `field` is specified, returns only that field (e.g. `title`, `state`, `project`, `level`, `repos`, `commits`, `prs`, `verifications`, `dependsOn`, `revision`). |
| `tendril_list_plans`             | `state` (optional), `project` (optional), `search`, `since`, `limit` | List plans matching filters. `since` accepts an RFC 3339 timestamp; `search` filters by title or ID.                                                                                                            |
| `tendril_get_revision`           | `plan_id` (required), `number` (optional)                            | Get the markdown text of a plan revision (the latest by default, or a specific revision number).                                                                                                                |
| `tendril_plan_validate`          | `plan_id` (required)                                                 | Check plan health and report any structural or schema issues.                                                                                                                                                   |
| `tendril_plan_verification_list` | `plan_id` (required)                                                 | List all verifications and their current statuses (`Pending`, `Pass`, `Fail`, `Skipped`) for a plan.                                                                                                            |
| `tendril_plan_rec_list`          | `plan_id` (required), `state` (optional)                             | List recommendations for a plan. Filter states: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`.                                                                                                         |

### Plan Authoring & Modification

| Tool                               | Parameters                                                                                                              | Description                                                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_plan_create`              | `title` (required), `project` (required), `level`, `initial_prompt`, `source_url`, `execution_profile`, `priority`, ... | Create a new plan. Verification gates are seeded automatically from project configuration.                                                                                                        |
| `tendril_plan_write_revision`      | `plan_id` (required), `content` (required), `reason` (optional)                                                         | Write a new numbered markdown revision. Question blocks are validated against the schema.                                                                                                         |
| `tendril_plan_set`                 | `plan_id` (required), `field` (required), `value` (required)                                                            | Update a scalar field (`state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`). State changes enforce verification gates before allowing `Completed`. |
| `tendril_plan_set_verification`    | `plan_id` (required), `name` (required), `status` (required)                                                            | Set verification gate status (`Pending`, `Pass`, `Fail`, `Skipped`).                                                                                                                              |
| `tendril_plan_verification_remove` | `plan_id` (required), `name` (required)                                                                                 | Remove a verification gate from a plan.                                                                                                                                                           |
| `tendril_plan_add_repo`            | `plan_id` (required), `path` (required)                                                                                 | Associate a repository path with a plan.                                                                                                                                                          |
| `tendril_plan_remove_repo`         | `plan_id` (required), `path` (required)                                                                                 | Disassociate a repository path from a plan.                                                                                                                                                       |
| `tendril_plan_add_pr`              | `plan_id` (required), `url` (required)                                                                                  | Record a pull request URL on a plan.                                                                                                                                                              |
| `tendril_plan_add_commit`          | `plan_id` (required), `sha` (required)                                                                                  | Record a commit SHA on a plan.                                                                                                                                                                    |
| `tendril_plan_add_depends_on`      | `plan_id` (required), `folder` (required)                                                                               | Add a blocking plan dependency. The dependent plan will not execute until the target reaches `Completed` and its PRs merge.                                                                       |
| `tendril_plan_remove_depends_on`   | `plan_id` (required), `folder` (required)                                                                               | Remove a blocking plan dependency.                                                                                                                                                                |
| `tendril_plan_add_related_plan`    | `plan_id` (required), `folder` (required)                                                                               | Link a related plan for contextual reference.                                                                                                                                                     |
| `tendril_plan_remove_related_plan` | `plan_id` (required), `folder` (required)                                                                               | Remove a related plan link.                                                                                                                                                                       |

### Recommendations

| Tool                       | Parameters                                                                              | Description                                                             |
| -------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `tendril_plan_rec_add`     | `plan_id` (required), `title` (required), `description` (required), `impact` (optional) | Add a new recommendation with impact level (`Small`, `Medium`, `High`). |
| `tendril_plan_rec_accept`  | `plan_id` (required), `title` (required)                                                | Accept a recommendation.                                                |
| `tendril_plan_rec_decline` | `plan_id` (required), `title` (required), `reason` (optional)                           | Decline a recommendation with an optional rationale.                    |
| `tendril_plan_rec_remove`  | `plan_id` (required), `title` (required)                                                | Remove a recommendation from the plan.                                  |

### Jobs & Inbox

| Tool                  | Parameters                                                                          | Description                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tendril_inbox`       | `description` (required), `project` (optional), `source_path` (optional)            | Submit a new task description to the Tendril inbox, automatically launching a `CreatePlan` job.                                                                                                        |
| `tendril_start_job`   | `job_type` (required), `plan_id`, `description`, `project`, `note`, `priority`, ... | Start a background job on the running daemon (`CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `SyncRepo`, `AddProject`). |
| `tendril_list_jobs`   | `status` (optional), `limit` (optional)                                             | List recent background jobs from the daemon.                                                                                                                                                           |
| `tendril_get_job`     | `job_id` (required)                                                                 | Retrieve status, timing, token counts, and cost details for a specific job.                                                                                                                            |
| `tendril_cancel_job`  | `job_id` (required), `message` (optional)                                           | Cancel a running background job.                                                                                                                                                                       |
| `tendril_job_add_log` | `job_id` (required), `action` (required), `summary` (optional)                      | Append a narrative log entry to `<TendrilHome>/Jobs/`. Works offline even if the daemon is stopped.                                                                                                    |

### Configuration & Discovery

| Tool                         | Parameters        | Description                                                                                                              |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `tendril_get_config`         | `key` (optional)  | Read public configuration values (e.g. `codingAgent`, `jobTimeout`, `planTemplate`). Sensitive credentials are redacted. |
| `tendril_list_projects`      | —                 | List all configured projects with their repository paths, verifications, and settings.                                   |
| `tendril_list_verifications` | `name` (optional) | List global verification check definitions, or inspect one by name.                                                      |

> [!NOTE]
> Configuration is read-only over MCP: modifying machine-wide settings like `planFolder` or `codingAgent` requires using the CLI (`tendril config set`) or the Tendril UI.

## Claude Code Configuration

Add Tendril's MCP server to your Claude Code settings (`~/.claude/settings.json` or project-level `.claude/settings.json`):

```json
{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"]
    }
  }
}
```

With token authentication enabled:

```json
{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"],
      "env": {
        "TENDRIL_MCP_CLIENT_TOKEN": "your-secret-token"
      }
    }
  }
}
```
