---
title: OpenCode
description: OpenCode är en alternativ kodningsagent som stöder flera
  modell-leverantörer genom ett enhetligt CLI.
icon: Cpu
searchHints:
  - opencode
  - open code
  - kodningsagent
---

# OpenCode

## Konfiguration

Ange OpenCode som din kodningsagent i `config.yaml`:

```yaml
codingAgent: opencode
```

Eller välj den i **Settings > Coding Agent**.

För mer information om strukturen och inställningarna i `config.yaml`, se [Installation och inställningar](../03_Configuration/01_Setup.md).

## Krav

- **Medföljande sidecar**: Tendril levererar [OpenCode](https://opencode.ai) som en medföljande sidecar tillsammans med skrivbordsappen och föredrar den automatiskt framför eventuella versioner på PATH. Ingen manuell installation krävs vid nya installationer.
- **Fristående installation** (valfritt): Om du vill installera eller köra en fristående kopia:
  ```bash
  curl -fsSL https://opencode.ai/install | bash
  ```
- **Autentisering**: Kör `opencode providers login` (eller `opencode auth login`) för att autentisera med din valda leverantör (t.ex. [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), [Groq](https://groq.com)).

## Profiler

Tendril mappar ansträngningsnivåer (effort levels) till OpenCode-modeller:

| Profile    | Model   | Effort | Användningsområde                |
| ---------- | ------- | ------ | -------------------------------- |
| `deep`     | default | high   | Komplexa ändringar i flera filer |
| `balanced` | default | medium | Standard planexekvering          |
| `quick`    | default | low    | Enkla fixar och små redigeringar |

Ansträngningsnivåer mappar direkt till OpenCodes `--variant`-flagga (`low`, `medium`, `high`, `max`).

Standardkatalogsmodellen är `moonshotai/Kimi-K3`. OpenCode stöder även låsta Anthropic- och OpenAI-modeller såsom `claude-fable-5-1`, `claude-opus-5`, `claude-opus-4-7`, `claude-sonnet-5`, `claude-sonnet-4-6` och `gpt-5.5`.

## Ta med egen LLM & Leverantörer

OpenCode driver Tendrils **Bring-Your-Own LLM**-kort i **Settings > Coding Agent**:

- **[OpenAI](https://openai.com)**: Pekar OpenCode mot `https://api.openai.com` med din `OPENAI_API_KEY`.
- **[Anthropic](https://www.anthropic.com)**: Pekar OpenCode mot `https://api.anthropic.com/v1` med din `ANTHROPIC_API_KEY`.
- **[Berget AI](../08_ModelProviders/01_Berget.md)**: Pekar OpenCode mot `https://api.berget.ai/v1` med din [Berget AI](https://berget.ai)-API-nyckel.
- **Anpassade slutpunkter**: Konfigurera anpassade bas-URL:er och nycklar för valfri OpenAI-kompatibel eller Anthropic-kompatibel omvänd proxy. För fler leverantörer, se [Modell-leverantörer](../08_ModelProviders/_Index.md).

Tendril konfigurerar dessa leverantörer icke-destruktivt via `OPENCODE_CONFIG_CONTENT` så att din globala `opencode.json`-konfiguration aldrig skrivs över.

## Lokal [Ollama](https://ollama.com)-konfiguration

När du kör OpenCode med lokala [Ollama](https://ollama.com)-modeller anger du serverns URL direkt i `config.yaml`:

```yaml
codingAgents:
  - name: opencode
    environmentVariables:
      OLLAMA_HOST: "http://localhost:11434"
      OLLAMA_BASE_URL: "http://localhost:11434"
```
