---
title: project
description: Manage projects stored in config.yaml. Projects group repositories, verifications, build dependencies, review actions, MCP servers, and custom skills.
icon: FolderGit
searchHints:
  - project
  - repo
  - verification
  - build
  - dependency
  - review
  - action
  - mcp
  - skills
  - sync
  - hooks
---

# project

Manage projects stored in `config.yaml`. Projects group [Git](https://git-scm.com) repositories, [verifications](03_Verification.md), build dependencies, review actions, [Model Context Protocol (MCP)](https://modelcontextprotocol.io) servers, and custom [agent skills](../../06_CodingAgents/00_Skills.md). For broader UI workflows, see [Project Configuration](../../03_Configuration/02_Projects.md).

## CRUD

```terminal
>tendril project list
>tendril project get <name>
>tendril project add <name>
>tendril project rename <name> <new-name>
>tendril project remove <name>
>tendril project set <name> <field> <value>
```

- **list** — lists all configured projects, displaying repository and verification counts
- **get** — displays full configuration details in [YAML](https://yaml.org) format, including repositories, verifications, review actions, build dependencies, MCP servers, and custom skills
- **add** — creates a new project entry in `config.yaml`
- **rename** — renames an existing project and updates all internal references
- **remove** — deletes the project configuration from `config.yaml`
- **set** — updates a scalar project field. Supported fields: `color` (hex color string), `context` (markdown prompt instructions for agents), `stackHash`

## Repositories & Sync

```terminal
>tendril project add-repo <project-name> <repo-path>
>tendril project remove-repo <project-name> <repo-path>
>tendril project sync <project-name> [--repo <repo>]
```

- **add-repo** — associates a local repository checkout path with the project
- **remove-repo** — disassociates a repository path from the project
- **sync** — pulls remote branches and fast-forwards all project repositories using [Git](https://git-scm.com). Diverged repositories report diagnostic remediation instructions.

## Verifications

Projects define which [verification checks](03_Verification.md) must pass before a [plan](01_Plan.md) can complete:

```terminal
>tendril project add-verification <project-name> <verification-name> [--required | --optional] [--after <target>]
>tendril project remove-verification <project-name> <verification-name>
>tendril project move-verification <project-name> <verification-name> [--before <target> | --after <target> | --position <pos>]
```

- **add-verification** — links a global verification check to this project. Required by default; pass `--optional` to mark it advisory, or `--after` to specify execution sequence.
- **remove-verification** — removes a verification gate from the project.
- **move-verification** — adjusts run order position relative to other verifications (`--before`, `--after`, or zero-based `--position`).

## Build Dependencies

```terminal
>tendril project add-build-dep <project-name> <dependency>
>tendril project remove-build-dep <project-name> <dependency>
```

Configures external binary and tool prerequisites (e.g. `cargo`, `dotnet`, `node`, [gh](https://cli.github.com)) verified before executing a plan.

## Review Actions

```terminal
>tendril project add-review-action <project-name> <name> --command <cmd> [options]
>tendril project remove-review-action <project-name> <name>
>tendril project review-actions <project-name> [--changed-file <file>...] [--plan <plan>] [--format <table>]
```

Review actions are shell commands run during interactive code review:

| Option             | Effect                                                                            |
| ------------------ | --------------------------------------------------------------------------------- |
| `--command <cmd>`  | Shell command line executed inside an interactive terminal PTY                    |
| `--condition <ex>` | Optional expression evaluated before running the action                           |
| `--paths <prefix>` | Repository-relative path filter triggering this action when modified (repeatable) |
| `--before <name>`  | Insert before an existing action                                                  |
| `--after <name>`   | Insert after an existing action                                                   |

`tendril project review-actions` evaluates and ranks review actions against changed files derived from a plan's worktree.

## MCP Servers & Custom Skills

Projects can register project-scoped [MCP](https://modelcontextprotocol.io) servers and custom agent skills:

```terminal
>tendril project list-mcp <project-name>
>tendril project add-mcp <project-name> <server-name> <command> [--arg <arg>...] [--env KEY=VALUE...]
>tendril project remove-mcp <project-name> <server-name>

>tendril project list-skills <project-name>
>tendril project add-skill <project-name> <skill-name> [--description <desc>] [--path <path>] [--instructions <text>]
>tendril project remove-skill <project-name> <skill-name>
```

To import MCP servers or skills directly from an existing repository:

```terminal
>tendril project import <project-name> <repo-path> [--mcp-only] [--skills-only]
>tendril project import-mcp <project-name> <repo-path> [--name <server>]
>tendril project import-skills <project-name> <repo-path> [--name <skill>] [--no-copy]
```

## Promptware Hooks

Hooks execute custom shell actions before or after [promptware](../../02_Concepts/02_Promptwares.md) runs:

```terminal
>tendril project add-hook <project-name> <name> --action <action> [options]
>tendril project remove-hook <project-name> <name>
```

| Option                 | Effect                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `--when <timing>`      | Timing trigger: `before` (default) or `after`                                              |
| `--promptwares <list>` | Comma-separated promptwares to fire for (e.g. `ExecutePlan,CreatePr`), or all when omitted |
| `--action <cmd>`       | Shell command to execute                                                                   |
| `--condition <expr>`   | Expression that must evaluate to true for the hook to fire                                 |

## Ports & Environment Files

Manage named service ports and `.env` template files materialized into plan worktrees:

```terminal
>tendril project port list <project-name>
>tendril project port add <project-name> <port-name> --default-port <port> [--description <desc>]
>tendril project port remove <project-name> <port-name>

>tendril project env-file list <project-name>
>tendril project env-file add <project-name> <path> [--template <file>] [--override KEY=VALUE...]
>tendril project env-file remove <project-name> <path>
```
