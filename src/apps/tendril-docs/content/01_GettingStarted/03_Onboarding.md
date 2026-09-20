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

Tendril runs a coding agent against your repository inside an isolated git worktree, then builds,
tests and opens a pull request. For that loop to succeed without a human in the seat, the machine and
the repo have to be set up ahead of time. Work through the checklist below once per machine and once
per repository.

> [!TIP]
> When you are done, run `tendril doctor`. It confirms Tendril home, `config.yaml`, the database, the
> plans directory, `git` and `gh`. It does **not** test your coding agent — check that yourself with
> step 2.

## Machine checklist

### 1. Required build software is installed

Every tool needed to compile the project must be on the machine and on `PATH`. The agent cannot
install a missing toolchain for you mid-run. For a Rust and pnpm repo like Tendril's own that means
`rustup`, Node.js and pnpm; for your repo it means whatever your build scripts shell out to.

> [!NOTE]
> The bar is: a fresh clone builds from a clean shell using the documented commands, with no manual
> clicks and no IDE-only steps.

### 2. The preferred coding CLI is installed and authenticated

Install the agent you set as `codingAgent` and log in so it runs non-interactively.

```bash
# Example: Claude Code
npm install -g @anthropic-ai/claude-code
claude login
```

Verify the CLI is on `PATH` (`claude`, `codex`, `copilot`, `gemini`, `opencode` or `antigravity`)
and that a plain invocation does not stop to prompt for a login. The `apple` agent is the
exception: it runs through the bundled OpenCode against Apple's on-device model, so what has to be
present is `fm` (check with `fm available`) and an `fm serve` already listening.

### 3. Git is installed and authorised for unattended use

Tendril pulls code, creates worktrees, commits and pushes on your behalf. Confirm all of that works
without an interactive prompt:

- A global identity is set (`git config --global user.name` and `user.email`).
- Credentials are cached or a key is loaded, so `git pull` and `git push` never ask for a password.
- Worktrees can be created and removed (`git worktree add` / `git worktree remove`).

> [!WARNING]
> If pushing over HTTPS still prompts, configure a credential helper or use an SSH key with a
> passphrase-less agent. A single interactive prompt will stall an otherwise successful run.

### 4. The GitHub CLI is installed and authenticated

`CreatePr` uses `gh` to open pull requests. Install it and authenticate:

```bash
gh auth login
gh auth status
```

### 5. Required MCP servers are installed globally

If you rely on MCP servers — Jira for issue context, Figma for designs — install and register them at
the user or global level so every worktree can reach them. MCP servers are configured on the coding
agent, not inside Tendril.

```bash
# Example: register an MCP server globally for Claude Code
claude mcp add --scope user jira -- npx -y @your-org/jira-mcp
claude mcp add --scope user figma -- npx -y figma-developer-mcp
claude mcp list   # verify they are reachable
```

> [!NOTE]
> Use the global or user scope, not project scope, so servers survive the ephemeral worktree the agent
> runs in. Store any tokens they need as environment variables on the machine.

Make sure you are actually _authenticated_ to each MCP server, not merely that it is registered. The
reliable check is end to end: execute a small plan from Tendril and confirm every server comes up
authenticated rather than prompting for a login or returning auth errors. Some servers only complete
their OAuth flow on first use, so verifying through Tendril catches an unauthenticated server before it
stalls a real run.

## Repository checklist

### 6. The repo is worktree-ready

`ExecutePlan` works in a fresh `git worktree`, not your open checkout. A worktree starts from a clean
tree — no `target/`, no `node_modules/`, no `.env`, no restored packages. Make sure a brand-new
worktree can build:

- List any steps needed after checkout before the code compiles (restore, generate, copy an example
  env file). Document them, and prefer a single script that performs them.
- Do not depend on files that are gitignored and only exist in your main checkout.
- Use a package manager with a shared cache so each worktree restores fast instead of downloading
  everything again — the pnpm store, the Cargo registry cache, an npm cache.

> [!TIP]
> Quick test: `git worktree add ../repo-probe`, then run your documented build in that folder from a
> clean shell. If it builds, Tendril will too. Remove it with `git worktree remove ../repo-probe`.

### 7. Write a run script for each app

Give every app in the repo a small, committed script that starts it on configurable ports. Tendril can
execute several plans across worktrees at once, so a hard-coded port makes the second instance fail to
bind. Keep each port overridable and default it sensibly.

Most apps have a backend and a frontend, so start both, each on its own port. For a Vite frontend in
front of a Python API the script could look like this:

```bash
#!/usr/bin/env bash
# run.sh - launch the Python backend API and the Vite frontend
set -euo pipefail

api_port="${API_PORT:-8000}"
web_port="${WEB_PORT:-5173}"

cd "$(dirname "$0")"

# Backend: set up the virtualenv and install dependencies.
python -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt

# Start the backend API in the background on its own port.
uvicorn app.main:app --port "$api_port" &
api_pid=$!

# Stop the backend when the frontend exits.
trap 'kill "$api_pid" 2>/dev/null' EXIT

# Frontend: install and start the Vite dev server in the foreground. Vite
# auto-picks the next free port if this one is taken, so concurrent
# worktrees never collide.
npm --prefix web install --prefer-offline --no-audit
npm --prefix web run dev -- --port "$web_port" --open
```

> [!NOTE]
> Keeping the launch logic in a committed script rather than a long inline command means people and
> agents start the app the same way, and a fresh worktree runs with a single command.

### 8. Add an AGENTS.md (or README.md) at the repo root

Give the agent the minimum context it needs to orient itself without guessing. At minimum, cover:

- **Prerequisites** the machine needs to build and run the code.
- **Apps in the codebase** and how they relate — for example, a web front end talking to an API that
  talks to a database.
- **How each app is compiled**, in commands that are obvious to an agent. A fresh clone should build
  from these alone.
- **How to run each app**, pointing at the run scripts from the previous step.

## Next steps

- Run the full loop end to end with the [Tutorial](04_Tutorial.md).
- Read [Concepts](../02_Concepts/_Index.md) to understand what the agent is actually being handed.
