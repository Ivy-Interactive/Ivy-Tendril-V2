---
title: Welcome to Ivy Tendril
description: >-
  Tendril is an open source, local-first desktop application that serves as the operating system for
  AI-powered software development — orchestrating coding agents like Claude Code, Codex, Copilot,
  Gemini, OpenCode, Antigravity, Cursor, and Apple Foundation Models through a structured lifecycle from
  idea to merged pull request.
icon: Rocket
searchHints:
  - overview
  - what is tendril
  - agent orchestration
  - architecture
  - tauri
  - daemon
---

# Welcome to Ivy Tendril

[![Ivy Tendril in two minutes: watch on YouTube](../assets/yt-thumbnail-in-two-minutes-2.png)](https://youtu.be/_KVG1NnAj-8)

## The Concept

In Tendril, work is organised into [**plans**](../02_Concepts/01_Plans.md) — structured, reviewable units of work.
Instead of an opaque black box that outputs uninspected code, Tendril moves your plan through a defined
[lifecycle](../02_Concepts/03_Lifecycle.md) using [**promptwares**](../02_Concepts/02_Promptwares.md):
isolated, single-purpose workflow agents that specialise in one stage. Whether it is drafting the plan,
implementing changes in parallel worktrees, running verification gates, or opening pull requests, you retain
total visibility. Tendril doesn't just autocomplete lines in your editor; it orchestrates your autonomous
development workflow.

## Key Features

- **Parallel worktrees** — every agent operates in an isolated [Git worktree](https://git-scm.com/docs/git-worktree),
  allowing multiple plans to run concurrently without branch contamination or working tree collisions.
- **Tunnelling for remote and mobile work** — securely expose the local daemon via
  [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
  to inspect progress and steer running agents from your phone or remote browser.
- **Voice and rich input** — dictate requirements with built-in [OpenAI Whisper](https://github.com/openai/whisper)
  transcription, or drop in terminal logs, markdown specs, and design files as context.
- **Plan annotations** — mark up a draft plan inline; Tendril feeds your notes directly into
  [UpdatePlan](../02_Concepts/02_Promptwares.md) to revise the specification.
- **Code reviews with verification gates** — inspect git diffs, review automated test results (`Cargo`,
  `pnpm`, linting, formatting), and approve only verified changes.
- **GitHub and inbox ingestion** — convert incoming [GitHub](https://github.com) issues and
  [Jam.dev](https://jam.dev) bug reports into plans automatically via webhooks.

## Architecture

Tendril consists of three core components running locally on your machine:

- A **desktop app** built with [Tauri 2](https://tauri.app) — a high-performance native desktop shell
  housing a [React](https://react.dev) front end.
- A **server daemon** written in [Rust](https://www.rust-lang.org) (`tendril run` / `tendril serve`),
  exposing a REST and WebSocket API. The desktop app automatically spawns and supervises the daemon in the
  background.
- A **CLI** (`tendril`) that connects to the same daemon and shares the same data store. Anything
  controllable from the desktop app can be executed via the command line.

State is kept entirely local:

- A local [SQLite](https://www.sqlite.org) database at `$TENDRIL_HOME/tendril.db` records jobs, costs, and
  telemetry.
- Plain filesystem storage at `$TENDRIL_HOME/Plans/` stores plan files, revisions, annotations, logs, and
  verification reports as transparent YAML and Markdown documents.

> [!NOTE]
> `$TENDRIL_HOME` defaults to `~/.tendril`. See [Installation](02_Installation.md) for custom path configuration.

Your source code never leaves your local machine. The only outbound network traffic is your configured
coding agent's direct API requests (e.g. to Anthropic, OpenAI, or Google) and optional Cloudflare tunnels
you explicitly initiate.

Supported coding agents include:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models (`apple` via on-device `fm`)

## Why Tendril?

At [Ivy Interactive](https://ivy.app) we tested multiple multi-agent architectures for autonomous coding.
While individual CLI agents were powerful, managing a dozen terminal tabs and reviewing untracked diffs
quickly broke down.

Tendril brings structure to agentic engineering. Through our [promptware](../02_Concepts/02_Promptwares.md)
architecture, workflow agents accumulate project-specific memory across runs, learning codebase idioms and
preventing repeated failures. By centring the entire workflow around durable
[plans](../02_Concepts/01_Plans.md), human developers retain review control while autonomous agents perform
the implementation heavy lifting.

> [!TIP]
> We love hearing from you. Report issues and suggest features on the
> [GitHub repository](https://github.com/Ivy-Interactive/Ivy-Tendril-V2). For support or discussion, join our
> community on [Discord](https://discord.gg/FHgxkDga3y).

## Next steps

- [Installation](02_Installation.md) — build and install the desktop app and CLI.
- [Concepts](../02_Concepts/_Index.md) — dive into plans, promptwares, and the job lifecycle.
