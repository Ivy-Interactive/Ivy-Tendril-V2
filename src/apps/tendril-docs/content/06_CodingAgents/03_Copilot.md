---
title: Copilot
description: Copilot is an alternative coding agent powered by GitHub's Copilot CLI.
icon: Bot
searchHints:
  - copilot
  - github
  - coding agent
---

# Copilot

## Configuration

Set Copilot as your coding agent in `config.yaml`:

```yaml
codingAgent: copilot
```

Or select it in **Settings > Coding Agent**.

For more details on `config.yaml` structure and settings, see [Setup & Settings](../03_Configuration/01_Setup.md).

## Requirements

- The [GitHub Copilot CLI](https://github.com/features/copilot) must be available as `copilot` on your PATH. Install using the official script or [Homebrew](https://brew.sh) cask:
  ```bash
  curl -fsSL https://gh.io/copilot-install | bash
  # or: brew install --cask copilot-cli
  ```
  Tendril automatically falls back to `gh copilot` if the standalone `copilot` binary is not found but the [GitHub CLI](https://cli.github.com) (`gh`) is installed.
- An active [GitHub Copilot](https://github.com/features/copilot) subscription is required.
- **Authentication**: Copilot does not have a `login` CLI command and does not share credentials with `gh auth login`. To sign in:
  1. Launch the CLI in your terminal: `copilot`
  2. At the prompt, run the slash command: `/login`
  3. For headless or unattended CI environments, set the `COPILOT_GITHUB_TOKEN` (or `GH_TOKEN`) environment variable with a personal access token carrying the `Copilot Requests` permission.

## Profiles

Tendril maps effort levels to Copilot:

| Profile    | Model   | Effort | Use Case                     |
| ---------- | ------- | ------ | ---------------------------- |
| `deep`     | gpt-5.4 | high   | Complex multi-file changes   |
| `balanced` | gpt-5.4 | medium | Standard plan execution      |
| `quick`    | gpt-5.4 | low    | Simple fixes and small edits |

The profile is selected automatically based on the [plan's complexity level](../02_Concepts/01_Plans.md), or can be configured per [promptware](../02_Concepts/02_Promptwares.md) in `config.yaml`.

The default model for Copilot in Tendril is `gpt-5.4`.

### Supported Models

GitHub Copilot supports both OpenAI and Anthropic models through its runtime:

- **[OpenAI](https://openai.com) Models**: `gpt-5.4` (default), `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5-mini`, `gpt-4.1` (reasoning effort: `low`, `medium`, `high`, `xhigh`).
- **[Anthropic Claude](https://code.claude.com/docs) Models**: `claude-opus-5-5`, `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5` (reasoning effort: `low`, `medium`, `high`, `xhigh`, `max`).

## Installing Tendril Skills for GitHub Copilot

Tendril provides specialized skills for GitHub Copilot in [Visual Studio Code](https://code.visualstudio.com), covering plan debugging, job artifact inspection, code reviews, and issue triage.

### Using the Skills CLI

Install skills for your workspace:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

Or install globally across all workspaces:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

### Manual Placement in `.agents/skills/`

Skills can also be placed directly in the `.agents/skills/`, `.github/skills/`, or `~/.copilot/skills/` directory:

```bash
mkdir -p .agents/skills
cp -r /path/to/skills/* .agents/skills/
```

Once installed, skills appear in GitHub Copilot Chat under the `/skills` menu and can be invoked directly as slash commands (e.g. `/tendril-debug-plan`, `/tendril-review`).

For more details, see [Agent Skills](00_Skills.md).
