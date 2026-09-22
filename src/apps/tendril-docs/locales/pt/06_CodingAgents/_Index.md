---
title: Agentes de Código
description: Agentes de código são os runtimes alimentados por IA que executam
  planos do Tendril. Escolha um agente, configure perfis, instale skills de
  agente e deixe o Tendril orquestrar o trabalho.
icon: Bot
groupExpanded: true
searchHints:
  - agentes de código
  - agente
  - claude
  - codex
  - copilot
  - opencode
  - gemini
  - skills
---

# Agentes de Código

Agentes de código são os runtimes alimentados por IA que executam [planos](../02_Concepts/01_Plans.md) do Tendril. Escolha um agente, configure perfis, instale skills de agente e deixe o Tendril orquestrar o trabalho.

- [Agent Skills](00_Skills.md) — empacote fluxos de trabalho de engenharia, depuração e revisão para agentes autônomos de código de IA.
- [Claude Code](01_ClaudeCode.md) — agente de código padrão no Tendril, alimentado por modelos [Anthropic Claude](https://code.claude.com/docs).
- [Codex](02_Codex.md) — agente de código alternativo alimentado por modelos GPT da [OpenAI](https://openai.com).
- [Copilot](03_Copilot.md) — agente de código alimentado pelo [Copilot CLI](https://github.com/features/copilot) do GitHub.
- [OpenCode](04_OpenCode.md) — agente de código multi-provedor com suporte a diversos backends de inferência.
- [Gemini CLI](05_Gemini.md) — agente de código alimentado por modelos Google [Gemini](https://ai.google.dev).

## Variáveis de Ambiente

Você pode injetar variáveis de ambiente no processo do agente de código via `config.yaml`. Elas são aplicadas tanto à execução de jobs ([planos](../02_Concepts/01_Plans.md)) quanto à aba interativa do Agente (PTY). Para opções completas de configuração, consulte [Configuração & Ajustes](../03_Configuration/01_Setup.md).

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

Quaisquer pares de chave/valor sob `environmentVariables` são definidos no ambiente de processo do agente antes de sua inicialização. Use isso para configuração de provedor (por exemplo, [AWS Bedrock](https://aws.amazon.com/bedrock/), endpoints de API personalizados) ou quaisquer flags de runtime suportadas pela CLI do agente.
