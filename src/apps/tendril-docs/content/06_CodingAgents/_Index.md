---
title: Coding Agents
description: Coding agents are the AI-powered runtimes that execute Tendril plans. Choose an agent, configure profiles, install agent skills, and let Tendril orchestrate the work.
icon: Bot
groupExpanded: true
searchHints:
  - coding agents
  - agent
  - claude
  - codex
  - copilot
  - opencode
  - gemini
  - skills
---

# Coding Agents

Coding agents are the AI-powered runtimes that execute Tendril plans. Choose an agent, configure profiles, install agent skills, and let Tendril orchestrate the work.

- [Agent Skills](00_Skills.md) — package engineering, debugging, and review workflows for autonomous AI coding agents.
- [Claude Code](01_ClaudeCode.md) — default coding agent in Tendril, powered by Anthropic Claude models.
- [Codex](02_Codex.md) — alternative coding agent powered by OpenAI GPT models.
- [Copilot](03_Copilot.md) — coding agent powered by GitHub's Copilot CLI.
- [OpenCode](04_OpenCode.md) — multi-provider coding agent supporting varied inference backends.
- [Gemini CLI](05_Gemini.md) — coding agent powered by Google Gemini models.

## Environment Variables

You can inject environment variables into the coding agent process via `config.yaml`. These are applied to both job execution (plans) and the interactive Agent tab (PTY).

```yaml
codingAgents:
  - name: claude
    environmentVariables:
      CLAUDE_CODE_USE_BEDROCK: "1"
      ANTHROPIC_BASE_URL: "https://your-endpoint.example.com"
    profiles:
      - name: balanced
        model: sonnet
        effort: high
```

Any key/value pairs under `environmentVariables` are set in the agent's process environment before it starts. Use this for provider configuration (e.g. Bedrock, custom API endpoints) or any runtime flags the agent CLI supports.
