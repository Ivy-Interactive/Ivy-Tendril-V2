---
title: Gemini CLI
description: Gemini CLI is a coding agent powered by Google's Gemini models.
icon: Sparkles
searchHints:
  - gemini
  - google
  - coding agent
---

# Gemini CLI

## Configuration

Set Gemini as your coding agent in `config.yaml`:

```yaml
codingAgent: gemini
```

Or select it in **Settings > Coding Agent**.

For more details on `config.yaml` structure and settings, see [Setup & Settings](../03_Configuration/01_Setup.md).

## Requirements

- Install the `gemini` binary via [Homebrew](https://brew.sh) or [MacPorts](https://www.macports.org):
  ```bash
  brew install gemini-cli
  # or: sudo port install gemini-cli
  ```
- **Authentication**: Note that there is no `gemini auth` CLI subcommand. To authenticate:
  - On first run, `gemini` prompts with **Sign in with Google** via OAuth in your browser.
  - In an active CLI session, use the `/auth` slash command (or `/auth login`) to re-authenticate or switch accounts.
  - For headless or CI environments, set the `GEMINI_API_KEY` environment variable (generated via [Google AI Studio](https://aistudio.google.com/apikey)).

## Profiles

Tendril maps Gemini profiles to the following defaults:

| Profile    | Model            | Use Case                     |
| ---------- | ---------------- | ---------------------------- |
| `deep`     | gemini-3.8-flash | Complex multi-file changes   |
| `balanced` | gemini-3.8-flash | Standard plan execution      |
| `quick`    | gemini-3.8-flash | Simple fixes and small edits |

The profile is selected automatically based on the [plan's complexity level](../02_Concepts/01_Plans.md), or can be configured per [promptware](../02_Concepts/02_Promptwares.md) in `config.yaml`. The Gemini CLI does not use reasoning effort flags.

The default model for Gemini in Tendril is `gemini-3.8-flash`.

## Available Models

The Gemini catalog in Tendril includes:

- `gemini-3.8-flash` (default): Next-generation fast and highly capable reasoning, 1M context window
- `gemini-3.7-flash`: Fast and capable reasoning, 1M context window
- `gemini-3.6-flash`: Multimodal reasoning, 1M context window
- `gemini-3.1-pro`: Advanced reasoning for complex architecture, 1M context window
- `gemini-3-pro-preview`: Next-generation reasoning preview
- `gemini-3-flash-preview`: Next-generation fast preview

Override the model in `config.yaml`:

```yaml
codingAgents:
  - name: gemini
    profiles:
      - name: deep
        model: gemini-3.1-pro
```

## Execution & Flags

Tendril launches the Gemini CLI with:

- Non-interactive mode: `--output-format stream-json --skip-trust --approval-mode <mode>` (where `FullAuto` passes `yolo`, `AcceptEdits` passes `auto_edit`, and `Plan` passes `plan`), and `--sandbox` when sandbox mode is enabled.
- Interactive Agent terminal: `gemini --yolo --skip-trust -i "<prompt>"`.
