---
title: Onboarding a Codebase
description: >-
  A checklist for preparing your dev machine and your repository so Tendril can plan, execute, verify
  and ship changes unattended.
icon: ClipboardCheck
searchHints:
  - onboarding
  - checklist
  - prepare
  - dev machine
  - environment
  - worktree
  - AGENTS.md
  - gh
  - mcp
---

# Onboarding a Codebase

Tendril runs a coding agent against your repository inside an isolated
[Git worktree](https://git-scm.com/docs/git-worktree), then builds, tests, and opens a pull request.
For that loop to succeed without human intervention, the machine and the repository must be configured
ahead of time. Work through the checklist below once per machine and once per codebase.

> [!TIP]
> When you are done, run `tendril doctor`. It confirms Tendril home, `config.yaml`, the database, the
> plans directory, `git` and `gh`. It does **not** test your coding agent — verify that yourself with
> step 2 below.

## Machine checklist

### 1. Required build software is installed

Every tool needed to compile the project must be installed and available on your `PATH`. The agent cannot
install a missing compiler or SDK mid-run. For a Rust and pnpm repo like Tendril's own, that means
[Rustup](https://rustup.rs/), [Node.js](https://nodejs.org/), and [pnpm](https://pnpm.io/); for your
project it means whatever build toolchain your scripts invoke.

> [!NOTE]
> The target requirement: a fresh clone builds from a clean terminal using documented commands, with no
> interactive prompts and no IDE-only manual steps.

### 2. The preferred coding CLI is installed and authenticated

Install the agent you set as `codingAgent` in `config.yaml` and log in so it executes non-interactively:

```bash
# Example: Claude Code
npm install -g @anthropic-ai/claude-code
claude login
```

Verify the CLI is on `PATH` and that a plain invocation does not stop to prompt for credentials:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor` / `cursor-agent`)
- Apple Foundation Models (`apple` via on-device `fm`)

The `apple` agent is the exception: it runs through the bundled OpenCode against Apple's on-device model,
so ensure `fm` is installed (verify with `fm available`) and an `fm serve` process is already listening.

### 3. Git is installed and authorised for unattended use

Tendril pulls code, creates worktrees, commits, and pushes on your behalf. Confirm all operations work
without an interactive prompt:

- A global identity is configured (`git config --global user.name` and `user.email`).
- Credentials are cached via a credential helper or an SSH key loaded into an agent, so `git pull` and
  `git push` never prompt for passwords.
- Worktrees can be added and pruned (`git worktree add` and `git worktree remove`).

> [!WARNING]
> If pushing over HTTPS prompts for credentials, configure a credential helper or use an SSH key with an
> active `ssh-agent`. A single interactive prompt will stall an otherwise unattended job.

### 4. The GitHub CLI is installed and authenticated

[CreatePr](../02_Concepts/02_Promptwares.md) uses [GitHub CLI](https://cli.github.com/)
(`gh`) to open pull requests. Install it and verify authentication:

```bash
gh auth login
gh auth status
```

### 5. Required MCP servers are installed globally

If you rely on [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) servers — such as Jira
for issue context or Figma for UI designs — install and register them globally so every worktree can access
them. MCP servers are registered on the coding agent, not inside Tendril:

```bash
# Example: register an MCP server globally for Claude Code
claude mcp add --scope user jira -- npx -y @your-org/jira-mcp
claude mcp add --scope user figma -- npx -y figma-developer-mcp
claude mcp list   # verify they are reachable
```

> [!NOTE]
> Use the global or user scope, not project scope, so MCP servers survive the ephemeral git worktrees the
> agent works in. Store any required API tokens as environment variables on your system.

Make sure you are actually _authenticated_ to each MCP server, not merely that it is registered. Execute a
small test plan from Tendril and confirm every server initializes without triggering OAuth modals.

## Repository checklist

### 6. The repo is worktree-ready

[ExecutePlan](../02_Concepts/02_Promptwares.md) runs inside an isolated
[Git worktree](https://git-scm.com/docs/git-worktree), not your active working directory. A worktree starts
from a clean commit — no `target/`, `node_modules/`, or untracked `.env` files exist.

- Document any setup commands needed after checkout before the code compiles (e.g. dependency restores,
  code generation, sample `.env` copies), and provide a committed setup script.
- Do not depend on uncommitted files that exist only in your primary checkout.
- Use a package manager with a centralized cache so each worktree restores in seconds rather than
  re-downloading packages (e.g. the pnpm store, Cargo registry cache, or Go module cache).

> [!TIP]
> Quick test: run `git worktree add ../repo-probe`, then execute your documented build commands in that
> directory from a clean shell. If it compiles and passes tests, Tendril will succeed too. Remove it with
> `git worktree remove ../repo-probe`.

### 7. Write a run script for each app

Provide a small, committed launch script for each application in the repository with configurable ports.
Tendril can run parallel plans across worktrees simultaneously, so hard-coded ports cause port collisions.

For a [Vite](https://vite.dev) frontend paired with a Python API, the script might look like:

```bash
#!/usr/bin/env bash
# run.sh - launch the Python backend API and the Vite frontend
set -euo pipefail

api_port="${API_PORT:-8000}"
web_port="${WEB_PORT:-5173}"

cd "$(dirname "$0")"

# Backend: configure virtualenv and install dependencies
python -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt

# Start backend API on its dedicated port
uvicorn app.main:app --port "$api_port" &
api_pid=$!

# Terminate backend when the frontend process exits
trap 'kill "$api_pid" 2>/dev/null' EXIT

# Frontend: install dependencies and start Vite dev server
npm --prefix web install --prefer-offline --no-audit
npm --prefix web run dev -- --port "$web_port" --open
```

> [!NOTE]
> Keeping startup commands in a committed script ensures both developers and autonomous workflow agents
> launch the application identically.

### 8. Add an AGENTS.md (or README.md) at the repo root

Give workflow agents the foundational context they need to navigate the codebase without guesswork:

- **Prerequisites** required to build and run the code.
- **Architectural map** detailing applications, libraries, and communication protocols.
- **Build and test commands** that compile and verify the repository.
- **Run scripts** pointing to the launch scripts from the previous step.

## Next steps

- Follow the end-to-end loop in the [Tutorial](04_Tutorial.md).
- Explore [Concepts: Plans](../02_Concepts/01_Plans.md) and [Promptwares](../02_Concepts/02_Promptwares.md).
- Understand the [Job Lifecycle](../02_Concepts/03_Lifecycle.md).
