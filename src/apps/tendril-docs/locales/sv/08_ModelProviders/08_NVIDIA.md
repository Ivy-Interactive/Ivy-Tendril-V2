---
title: NVIDIA
description: Få tillgång till NVIDIA NIM inferensmikrotjänster och accelererade
  öppna modeller för kodningsuppgifter via NVIDIA Build.
icon: Cpu
searchHints:
  - nvidia
  - nim
  - spark
  - build
  - gpu
---

# NVIDIA

[NVIDIA Build](https://build.nvidia.com) ger tillgång till [NVIDIA](https://www.nvidia.com) NIM-slutpunkter (Inference Microservice), vilket erbjuder företagsoptimerad, GPU-accelererad inferens för ledande öppna modeller inklusive [Metas Llama](https://llama.meta.com), [DeepSeek](https://www.deepseek.com), [Mistral AI](https://mistral.ai) och [Qwen](https://github.com/QwenLM).

## Konfiguration via OpenCode

1. Skapa en API-nyckel (som börjar med `nvapi-`) på [build.nvidia.com](https://build.nvidia.com).
2. Anslut i [OpenCode](https://opencode.ai) via terminalen eller Tendrils inbäddade PTY:
   ```bash
   opencode
   ```
   Skriv `/connect`, välj **NVIDIA** och klistra in din API-nyckel.
3. Byt din aktiva modell med `/models`.

## Rekommenderade modeller

NVIDIA NIM tillhandahåller optimerade byggen för de främsta kodningsmodellerna:

| Modell                     | NIM-identifierare                 | Exekveringsnivå   | Skapare                              |
| :------------------------- | :-------------------------------- | :---------------- | :----------------------------------- |
| **Llama 3.3 70B Instruct** | `meta/llama-3.3-70b-instruct`     | Deep              | [Meta AI](https://llama.meta.com)    |
| **DeepSeek R1**            | `deepseek-ai/deepseek-r1`         | Deep (Resonemang) | [DeepSeek](https://www.deepseek.com) |
| **Qwen 2.5 Coder 32B**     | `qwen/qwen2.5-coder-32b-instruct` | Balanserad        | [Qwen](https://github.com/QwenLM)    |
| **Llama 3.1 8B Instruct**  | `meta/llama-3.1-8b-instruct`      | Snabb             | [Meta AI](https://llama.meta.com)    |

## Användning med Tendril

### Alternativ A: Via medföljande OpenCode

1. Öppna **Inställningar > Kodningsagent** (Settings > Coding Agent) i Tendril-skrivbordsapplikationen.
2. Välj **OpenCode** som din aktiva kodningsagent (se [OpenCode-agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril kör planer genom den medföljande [OpenCode](https://opencode.ai)-sidovagnen med hjälp av dina autentiserade NVIDIA NIM-modeller.

### Alternativ B: Direkt NIM-API i `config.yaml`

NVIDIA NIM tillhandahåller fullt [OpenAI](https://openai.com)-kompatibla slutpunkter på `https://integrate.api.nvidia.com/v1`. Du kan konfigurera Tendril att ansluta direkt i `~/.tendril/config.yaml` (se [Konfigurationsguide](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "nvapi-..."
      OPENAI_BASE_URL: "https://integrate.api.nvidia.com/v1"
    profiles:
      - name: deep
        model: "meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "qwen/qwen2.5-coder-32b-instruct"
        effort: medium
      - name: quick
        model: "meta/llama-3.1-8b-instruct"
        effort: low
```

> [!TIP]
> NVIDIA NIM-slutpunkter använder standard OpenAI Chat Completion-scheman med aktiverad token-strömning, vilket gör dem fullt kompatibla med Tendrils visningsverktyg för direktutdata.

## Länkar

- [Modellleverantörer](_Index.md)
- [Kodningsagenter](../06_CodingAgents/_Index.md)
- [NVIDIA Build-katalog](https://build.nvidia.com)
- [NVIDIA NIM-dokumentation](https://build.nvidia.com/spark/cli-coding-agent)
