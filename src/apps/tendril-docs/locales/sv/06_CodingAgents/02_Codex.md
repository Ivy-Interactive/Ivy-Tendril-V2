---
title: Codex
description: Codex är en alternativ kodningsagent som drivs av OpenAI:s GPT-modeller.
icon: Terminal
searchHints:
  - codex
  - openai
  - gpt
  - kodningsagent
---

# Codex

## Konfiguration

Ställ in Codex som din kodningsagent i `config.yaml`:

```yaml
codingAgent: codex
```

Eller välj den i **Settings > Coding Agent**.

För mer information om strukturen och inställningarna i `config.yaml`, se [Inställningar och konfiguration](../03_Configuration/01_Setup.md).

## Krav

- CLI-verktyget [Codex](https://chatgpt.com/codex) måste vara installerat och tillgängligt som `codex` i din PATH. Installera via det officiella skriptet eller [Homebrew](https://brew.sh)-cask:
  ```bash
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  # or: brew install --cask codex
  ```
- Autentisera innan du använder Tendril genom att köra:
  ```bash
  codex login
  ```
  För headless- eller obemannade miljöer, skicka en [OpenAI-plattforms-API-nyckel](https://platform.openai.com/api-keys) via stdin:
  ```bash
  printenv OPENAI_API_KEY | codex login --with-api-key
  ```

## Profiler

Tendril mappar ansträngningsnivåer (effort) till Codex-modeller:

| Profile    | Model         | Effort | Användningsområde             |
| ---------- | ------------- | ------ | ----------------------------- |
| `deep`     | gpt-5.6-sol   | high   | Komplexa flerfilsändringar    |
| `balanced` | gpt-5.6-terra | medium | Standardmässig planexekvering |
| `quick`    | gpt-5.6-luna  | low    | Enkla fixar och små ändringar |

Profilen väljs automatiskt baserat på [planens komplexitetsnivå](../02_Concepts/01_Plans.md), eller kan konfigureras per [promptware](../02_Concepts/02_Promptwares.md) i `config.yaml`.

Standardmodellen för Codex i Tendril är `gpt-5.6-terra`.

### Modeller som stöds och resonemangsnivå

Codex-katalogen stöder följande [OpenAI](https://openai.com)-modeller:

- `gpt-6-astra`
- `gpt-5.6-sol`
- `gpt-5.6-terra` (standard)
- `gpt-5.6-luna`
- `gpt-5.5`
- `gpt-5.4` / `gpt-5.4-mini`
- `gpt-5.3-codex`
- `o3` / `o4-mini`
- `gpt-4.1`
- `codex-mini`

Codex stöder fem nivåer för resonemangsansträngning (reasoning effort): `none`, `low`, `medium`, `high` och `xhigh`. Nivån `none` gör det möjligt att köra Codex utan resonemangsoverhead för snabba redigeringar.

## Exekvering och isolering (Sandboxing)

Tendril startar Codex via `codex exec` i icke-interaktivt läge:

- Sandboxing är som standard inställt på `--sandbox workspace-write` med nätverksåtkomst aktiverad. När sandbox-läget inaktiveras i projektets säkerhetsinställningar skickar Tendril med `danger-full-access`.
- Ytterligare tillåtna sökvägar från säkerhetsregler anges via `--add-dir`.
- Konfigurerade [MCP (Model Context Protocol)](https://modelcontextprotocol.io)-servrar skrivs till en temporär JSON-konfiguration och tillhandahålls via `--mcp-config`.
