---
title: Welcome to Ivy Tendril
description: >-
  Tendril is an open source, local-first desktop application that serves as the operating system for
  AI-powered software development — orchestrating coding agents like Claude Code, Codex, Copilot,
  Gemini and OpenCode through a structured lifecycle from idea to merged pull request.
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

[Ivy Tendril in two minutes](https://youtu.be/_KVG1NnAj-8)

## The Concept

In Tendril, work is organised into **plans** — structured units of work. Instead of a black box that
outputs code and hopes for the best, Tendril moves your plan through a defined lifecycle using
**promptwares**: isolated, single-purpose agents that specialise in one stage. Whether it is drafting
the plan, implementing it, verifying the build or opening the pull request, you have total visibility.
Tendril doesn't autocomplete your lines; it orchestrates your workflow.

## Key Features

- **Parallel worktrees** — every agent works in its own isolated `git worktree`, so several plans can
  run at once and your main branch stays clean until you review, approve and merge.
- **Tunnelling for remote and mobile work** — expose the local server through a Cloudflare Quick
  Tunnel and steer a running agent from your phone.
- **Voice and rich input** — dictate a plan with built-in Whisper transcription, or drag in logs,
  documents and text files as context.
- **Plan annotations** — mark up a draft inline and Tendril folds your notes into a revised plan
  rather than making you rewrite the brief.
- **Code reviews with verification gates** — inspect the diff, read the verification output, and
  approve only what passed. Nothing advances on the agent's word alone.
- **GitHub and inbox ingestion** — GitHub issues and jam.dev bug reports arrive over webhooks and
  become plans without anyone retyping them.

## Architecture

Tendril is three pieces that all run on your machine:

- A **desktop app** built with Tauri 2 — a React front end in a native window.
- A **server daemon**, `tendril serve`, exposing a REST and WebSocket API. The desktop app starts and
  supervises it as a background service, so you never launch it by hand; it is also the reason the
  same session can be driven from a browser or over a tunnel.
- A **CLI**, `tendril`, which talks to the same daemon and the same data. Anything the app can do to a
  plan, the CLI can do too.

State lives in two places, both plain and both local: a SQLite database at `$TENDRIL_HOME/tendril.db`
for jobs, costs and telemetry, and one folder per plan under `$TENDRIL_HOME/Plans/` holding the plan's
YAML, revisions, verification reports and artifacts as ordinary files you can read, diff and grep.

> [!NOTE]
> `$TENDRIL_HOME` defaults to `~/.tendril`. [Installation](02_Installation.md) covers how to move it.

Your code never leaves your machine. The only outbound traffic is your coding agent's own API calls
and, if you turn it on, a tunnel you control.

## Why Tendril?

At [Ivy Interactive](https://ivy.app) we tried a lot of architectures to take advantage of agentic
coding. Working with the capabilities of Claude and others was great, but it quickly became messy
managing a dozen terminal windows.

So we built this system to streamline working with different agents. Through the
[promptware](../02_Concepts/02_Promptwares.md) architecture we created a feedback loop in which agents
are not only organised and structured but also self-improving, accumulating memory about the projects
they work on. By centring the whole process on a [plan](../02_Concepts/01_Plans.md), you keep the
source of truth while specialised agents do the heavy lifting.

> [!TIP]
> We love hearing from you. Report issues, bugs and suggestions on the
> [GitHub repository](https://github.com/Ivy-Interactive/Ivy-Tendril-V2). For direct help or to meet
> other users, join us on [Discord](https://discord.gg/FHgxkDga3y).

## Next steps

- [Installation](02_Installation.md) — get it building and running.
- [Concepts](../02_Concepts/_Index.md) — plans, promptwares and the job lifecycle in detail.
