---
title: Kodningsagenter
description: Kodningsagenter är de AI-drivna körmiljöerna som kör
  Tendril-planer. Välj en agent, konfigurera profiler, installera
  agentfärdigheter och låt Tendril orkestrera arbetet.
icon: Bot
groupExpanded: true
searchHints:
  - kodningsagenter
  - agent
  - claude
  - codex
  - copilot
  - opencode
  - gemini
  - färdigheter
---

# Kodningsagenter

Kodningsagenter är de AI-drivna körmiljöerna som kör Tendril-[planer](../02_Concepts/01_Plans.md). Välj en agent, konfigurera profiler, installera agentfärdigheter och låt Tendril orkestrera arbetet.

- [Agentfärdigheter](00_Skills.md) — paketering av arbetsflöden för ingenjörskonst, felsökning och granskning för autonoma AI-kodningsagenter.
- [Claude Code](01_ClaudeCode.md) — standardkodningsagenten i Tendril, driven av [Anthropic Claude](https://code.claude.com/docs)-modeller.
- [Codex](02_Codex.md) — alternativ kodningsagent driven av [OpenAI](https://openai.com) GPT-modeller.
- [Copilot](03_Copilot.md) — kodningsagent driven av GitHubs [Copilot CLI](https://github.com/features/copilot).
- [OpenCode](04_OpenCode.md) — flerleverantörskodningsagent med stöd för varierade inferens-backends.
- [Gemini CLI](05_Gemini.md) — kodningsagent driven av Google [Gemini](https://ai.google.dev)-modeller.

## Miljövariabler

Du kan injicera miljövariabler i kodningsagentens process via `config.yaml`. Dessa tillämpas på både jobbkörning ([planer](../02_Concepts/01_Plans.md)) och den interaktiva Agent-fliken (PTY). För fullständiga konfigurationsalternativ, se [Installation & Inställningar](../03_Configuration/01_Setup.md).

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

Alla nyckel/värde-par under `environmentVariables` sätts i agentens processmiljö innan den startar. Använd detta för leverantörskonfiguration (t.ex. [AWS Bedrock](https://aws.amazon.com/bedrock/), anpassade API-slutpunkter) eller eventuella körtidsflaggor som agentens CLI stöder.
