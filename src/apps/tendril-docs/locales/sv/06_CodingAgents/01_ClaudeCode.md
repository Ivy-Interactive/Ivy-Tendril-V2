---
title: Claude Code
description: Claude Code är standardkodningsagenten i Tendril och drivs av
  Anthropics Claude-modeller.
icon: Bot
searchHints:
  - claude
  - claude code
  - anthropic
  - kodningsagent
  - ai-agent
---

# Claude Code

## Konfiguration

Ställ in Claude Code som din kodningsagent i `config.yaml`:

```yaml
codingAgent: claude
```

Eller välj den i **Inställningar > Kodningsagent**.

För mer information om strukturen och inställningarna i `config.yaml`, se [Installation och inställningar](../03_Configuration/01_Setup.md).

## Krav

- CLI-verktyget [Claude Code](https://code.claude.com/docs) måste vara installerat och tillgängligt som `claude` i din PATH. Använd den ursprungliga installationsmetoden eller [Homebrew](https://brew.sh) cask:
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  # or: brew install --cask claude-code
  ```
- Autentisera innan du använder Tendril genom att köra `claude auth login` (eller `claude login`). Claude Code kräver ett [Anthropic](https://www.anthropic.com) Pro-, Max-, Team-, Enterprise- eller [Console](https://console.anthropic.com)-abonnemang (gratisnivån på claude.ai inkluderar inte CLI-åtkomst).
- För headless-miljöer eller alternativa backend-system, ställ in `ANTHROPIC_API_KEY`, eller konfigurera [AWS Bedrock](https://aws.amazon.com/bedrock/) (`CLAUDE_CODE_USE_BEDROCK=1`) eller [Google Cloud Vertex AI](https://cloud.google.com/vertex-ai) (`CLAUDE_CODE_USE_VERTEX=1`).

## Profiler

Tendril mappar insatsnivåer (effort levels) till Claude-modeller:

| Profil     | Modell | Insats | Användningsområde                                     |
| ---------- | ------ | ------ | ----------------------------------------------------- |
| `deep`     | opus   | max    | Komplexa ändringar över flera filer, arkitekturarbete |
| `balanced` | sonnet | high   | Standardmässigt planutförande, de flesta uppgifter    |
| `quick`    | haiku  | low    | Enkla buggfixar, formatering, små redigeringar        |

Profilen väljs automatiskt baserat på [planens komplexitetsnivå](../02_Concepts/01_Plans.md), eller kan konfigureras per [promptware](../02_Concepts/02_Promptwares.md) i `config.yaml`.

## Tillgängliga modeller

| Modell           | ID                 | Kontextfönster | Prissättning (input / output per MTok) |
| ---------------- | ------------------ | -------------- | -------------------------------------- |
| Claude Fable 5.1 | `claude-fable-5-1` | 1M             | $10.00 / $50.00                        |
| Claude Opus 5    | `claude-opus-5`    | 1M             | $5.00 / $25.00                         |
| Claude Opus      | `opus`             | 1M             | $5.00 / $25.00                         |
| Claude Sonnet 5  | `claude-sonnet-5`  | 1M             | $2.00 / $10.00                         |
| Claude Sonnet    | `sonnet`           | 1M             | $2.00 / $10.00                         |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200k           | $1.00 / $5.00                          |
| Claude Haiku     | `haiku`            | 200k           | $1.00 / $5.00                          |

`opus`, `sonnet` och `haiku` är Claude Code-alias som spårar Anthropics nuvarande modell för den nivån, medan `claude-opus-5` (standard i katalogen) och `claude-fable-5-1` är låsta ID:n.

Claude Sonnets introduktionspris på $2.00 / $10.00 gäller till och med 2026-08-31; standardpriset på $3.00 / $15.00 gäller därefter.

## Plugin för Tendril Skills

Du kan installera officiella tekniska färdigheter och felsökningsfärdigheter för Tendril som ett Claude Code-plugin:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

Under lokal utveckling och testning kan du ladda färdigheter direkt från din lokala checkout:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

För mer information, se [Agentfärdigheter](00_Skills.md).
