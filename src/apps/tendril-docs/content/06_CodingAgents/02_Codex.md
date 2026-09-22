---
title: Codex
description: Codex is an alternative coding agent powered by OpenAI's GPT models.
icon: Terminal
searchHints:
  - codex
  - openai
  - gpt
  - coding agent
---

# Codex

## Configuration

Set Codex as your coding agent in `config.yaml`:

```yaml
codingAgent: codex
```

Or select it in **Settings > Coding Agent**.

For more details on `config.yaml` structure and settings, see [Setup & Settings](../03_Configuration/01_Setup.md).

## Requirements

- The [Codex](https://chatgpt.com/codex) CLI must be installed and available as `codex` on your PATH. Install using the official script or [Homebrew](https://brew.sh) cask:
  ```bash
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  # or: brew install --cask codex
  ```
- Authenticate before using Tendril by running:
  ```bash
  codex login
  ```
  For headless or unattended environments, pass an [OpenAI platform API key](https://platform.openai.com/api-keys) via stdin:
  ```bash
  printenv OPENAI_API_KEY | codex login --with-api-key
  ```

## Profiles

Tendril maps effort levels to Codex models:

| Profile    | Model         | Effort | Use Case                     |
| ---------- | ------------- | ------ | ---------------------------- |
| `deep`     | gpt-5.6-sol   | high   | Complex multi-file changes   |
| `balanced` | gpt-5.6-terra | medium | Standard plan execution      |
| `quick`    | gpt-5.6-luna  | low    | Simple fixes and small edits |

The profile is selected automatically based on the [plan's complexity level](../02_Concepts/01_Plans.md), or can be configured per [promptware](../02_Concepts/02_Promptwares.md) in `config.yaml`.

The default model for Codex in Tendril is `gpt-5.6-terra`.

### Supported Models & Reasoning Effort

The Codex catalog supports the following [OpenAI](https://openai.com) models:

- `gpt-6-astra`
- `gpt-5.6-sol`
- `gpt-5.6-terra` (default)
- `gpt-5.6-luna`
- `gpt-5.5`
- `gpt-5.4` / `gpt-5.4-mini`
- `gpt-5.3-codex`
- `o3` / `o4-mini`
- `gpt-4.1`
- `codex-mini`

Codex supports five reasoning effort levels: `none`, `low`, `medium`, `high`, and `xhigh`. The `none` level allows running Codex with zero reasoning overhead for rapid edits.

## Execution & Sandboxing

Tendril launches Codex via `codex exec` in non-interactive mode:

- Sandboxing defaults to `--sandbox workspace-write` with network access enabled. When sandbox mode is disabled in project security settings, Tendril passes `danger-full-access`.
- Additional allowed paths from security rules are supplied via `--add-dir`.
- Configured [MCP (Model Context Protocol)](https://modelcontextprotocol.io) servers are written to a temporary JSON configuration and supplied via `--mcp-config`.
