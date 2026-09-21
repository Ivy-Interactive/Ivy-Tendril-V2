---
title: Claude Code
description: Claude Code is the default coding agent in Tendril, powered by Anthropic's Claude models.
icon: Bot
searchHints:
  - claude
  - claude code
  - anthropic
  - coding agent
  - ai agent
---

# Claude Code

## Configuration

Set Claude Code as your coding agent in `config.yaml`:

```yaml
codingAgent: claude
```

Or select it in **Settings > Coding Agent**.

For more details on `config.yaml` structure and settings, see [Setup & Settings](../03_Configuration/01_Setup.md).

## Requirements

- The [Claude Code](https://code.claude.com/docs) CLI must be installed and available as `claude` on your PATH. Use the native installer or [Homebrew](https://brew.sh) cask:
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  # or: brew install --cask claude-code
  ```
- Authenticate before using Tendril by running `claude auth login` (or `claude login`). Claude Code requires an [Anthropic](https://www.anthropic.com) Pro, Max, Team, Enterprise, or [Console](https://console.anthropic.com) plan (the free claude.ai tier does not include CLI access).
- For headless environments or alternative backends, set `ANTHROPIC_API_KEY`, or configure [AWS Bedrock](https://aws.amazon.com/bedrock/) (`CLAUDE_CODE_USE_BEDROCK=1`) or [Google Cloud Vertex AI](https://cloud.google.com/vertex-ai) (`CLAUDE_CODE_USE_VERTEX=1`).

## Profiles

Tendril maps effort levels to Claude models:

| Profile    | Model  | Effort | Use Case                                      |
| ---------- | ------ | ------ | --------------------------------------------- |
| `deep`     | opus   | max    | Complex multi-file changes, architecture work |
| `balanced` | sonnet | high   | Standard plan execution, most tasks           |
| `quick`    | haiku  | low    | Simple fixes, formatting, small edits         |

The profile is selected automatically based on the [plan's complexity level](../02_Concepts/01_Plans.md), or can be configured per [promptware](../02_Concepts/02_Promptwares.md) in `config.yaml`.

## Available models

| Model            | ID                 | Context Window | Pricing (input / output per MTok) |
| ---------------- | ------------------ | -------------- | --------------------------------- |
| Claude Fable 5.1 | `claude-fable-5-1` | 1M             | $10.00 / $50.00                   |
| Claude Opus 5    | `claude-opus-5`    | 1M             | $5.00 / $25.00                    |
| Claude Opus      | `opus`             | 1M             | $5.00 / $25.00                    |
| Claude Sonnet 5  | `claude-sonnet-5`  | 1M             | $2.00 / $10.00                    |
| Claude Sonnet    | `sonnet`           | 1M             | $2.00 / $10.00                    |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200k           | $1.00 / $5.00                     |
| Claude Haiku     | `haiku`            | 200k           | $1.00 / $5.00                     |

`opus`, `sonnet`, and `haiku` are Claude Code aliases that track Anthropic's current model for that tier, while `claude-opus-5` (the catalog default) and `claude-fable-5-1` are pinned IDs.

Claude Sonnet's introductory pricing of $2.00 / $10.00 applies through 2026-08-31; standard pricing of $3.00 / $15.00 applies after.

## Tendril Skills Plugin

You can install official Tendril engineering and debugging skills as a Claude Code plugin:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

During local development and testing, load skills directly from your checkout:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

For more details, see [Agent Skills](00_Skills.md).
