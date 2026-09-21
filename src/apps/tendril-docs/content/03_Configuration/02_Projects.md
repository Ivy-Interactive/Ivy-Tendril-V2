---
title: Project Setup
description: Each project is a git repo with its own verifications and agent context. Tendril runs many projects side by side.
icon: FolderGit
searchHints:
  - project
  - repo
  - repository
  - multi-project
  - isolation
  - worktree
  - danger zone
  - mcp
  - sandboxing
---

# Project Setup

Tendril supports managing multiple projects side by side. Each project defines its own [Git](https://git-scm.com) repositories, verification gates, port allocations, environment variables, security sandboxes, and custom skills.

## Adding & Managing Projects

Projects can be configured visually via **Settings > Projects** or by declaring them in `$TENDRIL_HOME/config.yaml` (see [Setup & Settings](01_Setup.md)):

- **Add Project Wizard** — Click **Add Project** in the Settings sidebar to register a project with its repository path, initial color, and default verification gates.
- **Inline Renaming** — Click the edit pencil icon next to the project name in the header to rename a project. Tendril validates against duplicate sibling names and updates associated plan records automatically.
- **Color Swatch Picker** — Select an accent color from the 32 Ivy color palette swatch grid (`ColorSwatchField`). This color distinguishes the project across the [Dashboard](../04_Apps/01_Dashboard.md), [Plans](../04_Apps/03_Plans.md) queue, [Review](../04_Apps/02_Review.md) queue, and [Pull Requests](../04_Apps/06_PullRequests.md) tracker.
- **Context** — Markdown instructions describing domain terminology, architectural constraints, and coding standards. This context is prepended to the promptware instructions for all agent runs on the project.

### `config.yaml` Example

```yaml
projects:
  - name: Global Engine
    color: Emerald
    context: |
      Core engine services written in Rust with a TypeScript CLI.
      Follow standard Ivy design tokens and ensure all tests pass.
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: Lint
        required: true
      - name: CheckResult
        required: true
    reviewActions:
      - name: Run E2E
        command: pnpm test:e2e
        condition: "${hasChanges}"
    ports:
      backend:
        defaultPort: 8080
        description: API gateway service
    envFiles:
      - path: .env
        template: .env.example
        overrides:
          PORT: "${ports.backend}"
          DATABASE_URL: "sqlite://${env.TENDRIL_HOME}/dev.db"
    wireframes: true
    wireframeGuard: true
    sandboxMode: Off
    securityPreset: Standard
```

## Repositories & Git Worktrees

Tendril projects link one or more [Git](https://git-scm.com) repositories (`repos:`).

When an agent executes a plan via `ExecutePlan`, it isolates code generation from your local development environment:

- **Dedicated Git Worktrees** — Tendril creates an isolated Git worktree branch (`tendril/<planId>-<slug>`) branched from your target branch. Your working tree, branch, and IDE remain untouched.
- **Concurrent Execution** — Multiple plans can execute simultaneously across different repositories without git lock contention.
- **Safe Failure & Discard** — Failed or rejected runs can be discarded cleanly without manual git cleanups.
- **Worktree Reaper** — Automated background cleanup reaps idle or completed worktrees according to `worktreeReaperInterval` and `worktreeReaperGrace` settings in [Setup & Settings](01_Setup.md).

## Verification Pipelines

Projects define an ordered sequence of verification gates that agents must satisfy before work reaches [Review](../04_Apps/02_Review.md):

- **Sortable Order** — Drag and drop verification steps into the desired execution sequence (`SortableVerificationList`).
- **Required Gates** — Mark verifications as required. A plan only shows as `Verified` in [Review](../04_Apps/02_Review.md) if all required verifications succeed.
- **Custom Verifications** — Add project-specific commands and custom verification prompts (e.g. `cargo clippy`, `pnpm check`, `pytest`). See [CLI Verification](../09_Advanced/01_CLI/03_Verification.md) for command-line management.

## Review Actions

Define one-click action buttons rendered in the [Review](../04_Apps/02_Review.md) app toolbar (`reviewActions:`):

- `name` — Action label displayed on the toolbar button.
- `command` — Shell command executed in the plan's worktree.
- `condition` — Optional execution condition (such as `${hasChanges}`).

## Ports & Environment Files

Complex projects often require isolated ports and environment configurations:

- **Port Allocations (`ports:`)** — Declare named ports (e.g. `backend`, `frontend`). If the default port is already in use, Tendril allocates an open port and exposes it via `${ports.<name>}` placeholders.
- **Environment Files (`envFiles:`)** — Automatically recreate `.env` files inside agent worktrees from a base template (e.g. `.env.example`) and line-by-line key/value overrides supporting `${ports.<name>}`, `${env.<VAR>}`, and `%VAR%` variables.

## Agent Security & Sandboxing

Tendril provides granular project-level security controls:

- **Security Presets** — Select `Strict`, `Standard`, `Permissive`, or `Custom`. Presets configure default sandboxing and file access rules.
- **Sandbox Mode** — Select runtime isolation: `Off`, [Docker](https://www.docker.com), or [Bubblewrap](https://github.com/containers/bubblewrap).
- **Outside File Access** — Control whether agents may read files outside the repository tree (`Deny`, `ReadOnly`, `Full`).
- **Terminal Auto-Execution** — Choose whether agents execute shell commands automatically (`AllowAll`), ask for confirmation (`RequireConfirmation`), or deny command execution (`DenyAll`).
- **File Permissions** — Configure granular path rules: `Allow <path>`, `Ask <path>`, or `Deny <path>`.
- **Wireframes & Wireframe Guard** — Toggle `wireframes` to enable UI prototype generation in plans, and toggle `wireframeGuard` to verify that temporary wireframe code is checked before landing in production pull requests.

## Project MCP Servers & Skills

Extend agent capabilities for a specific project:

- **MCP Servers (`mcpServers:`)** — Register project-scoped [Model Context Protocol](https://modelcontextprotocol.io) servers with custom executables, arguments, and environment variables. See [MCP Integration](../09_Advanced/03_MCP.md).
- **Skills (`skills:`)** — Equip agents with project-specific procedures and markdown instructions. See [Skills Guide](../06_CodingAgents/00_Skills.md).

## Repo-Local Context

Tendril automatically detects and prepends documentation from the repository root to the promptware context:

- **`CLAUDE.md`** — Guidance and conventions for Claude Code. See [Claude Code Guide](../06_CodingAgents/01_ClaudeCode.md).
- **`AGENTS.md` / `DEVELOPER.md`** — Team development standards, testing requirements, and codebase conventions.

## Danger Zone: Remove vs. Delete

Project settings concludes with two distinct destruction options in the Danger Zone:

```
[ Remove Project ]  (Outline)
Removes the project from config.yaml. Cloned repositories, plan folders and history
are left on disk, so adding the project back by name restores it.

[ Delete Project ]  (Destructive)
Permanently deletes the project's plans, its cloned repositories under
<TENDRIL_HOME>/Projects/, its database rows and its config entry. This cannot be
undone, and asks you to type the project name first.
```

> [!WARNING]
> **Remove Project** only unregisters the project from configuration while keeping files intact on disk. **Delete Project** permanently wipes repositories, plans, and database records, requiring typing the exact project name to confirm.
