---
title: Gemini CLI
description: Gemini CLI är en kodningsagent som drivs av Googles Gemini-modeller.
icon: Sparkles
searchHints:
  - gemini
  - google
  - kodningsagent
---

# Gemini CLI

## Konfiguration

Ställ in Gemini som din kodningsagent i `config.yaml`:

```yaml
codingAgent: gemini
```

Eller välj den i **Inställningar > Kodningsagent**.

För mer information om strukturen och inställningarna i `config.yaml`, se [Konfiguration och inställningar](../03_Configuration/01_Setup.md).

## Krav

- Installera `gemini`-binären via [Homebrew](https://brew.sh) eller [MacPorts](https://www.macports.org):
  ```bash
  brew install gemini-cli
  # or: sudo port install gemini-cli
  ```
- **Autentisering**: Observera att det inte finns något `gemini auth`-underkommando i CLI:et. För att autentisera:
  - Vid första körningen uppmanar `gemini` med **Logga in med Google** via OAuth i din webbläsare.
  - I en aktiv CLI-session använder du snabbkommandot `/auth` (eller `/auth login`) för att återautentisera eller byta konto.
  - För gränssnittslösa miljöer (headless) eller CI-miljöer anger du miljövariabeln `GEMINI_API_KEY` (genererad via [Google AI Studio](https://aistudio.google.com/apikey)).

## Profiler

Tendril mappar Gemini-profiler till följande standardvärden:

| Profil     | Modell           | Användningsområde                        |
| ---------- | ---------------- | ---------------------------------------- |
| `deep`     | gemini-3.8-flash | Komplexa flerfilsändringar               |
| `balanced` | gemini-3.8-flash | Standardutförande av plan                |
| `quick`    | gemini-3.8-flash | Enkla korrigeringar och små redigeringar |

Profilen väljs automatiskt baserat på [planens komplexitetsnivå](../02_Concepts/01_Plans.md), eller kan konfigureras per [promptware](../02_Concepts/02_Promptwares.md) i `config.yaml`. Gemini CLI använder inte flaggor för resonemangsansträngning (reasoning effort).

Standardmodellen för Gemini i Tendril är `gemini-3.8-flash`.

## Tillgängliga modeller

Gemini-katalogen i Tendril inkluderar:

- `gemini-3.8-flash` (standard): Nästa generations snabba och mycket kapabla resonemang, 1M kontextfönster
- `gemini-3.7-flash`: Snabbt och kapabelt resonemang, 1M kontextfönster
- `gemini-3.6-flash`: Multimodalt resonemang, 1M kontextfönster
- `gemini-3.1-pro`: Avancerat resonemang för komplex arkitektur, 1M kontextfönster
- `gemini-3-pro-preview`: Förhandsvisning av nästa generations resonemang
- `gemini-3-flash-preview`: Förhandsvisning av nästa generations snabba modell

Åsidosätt modellen i `config.yaml`:

```yaml
codingAgents:
  - name: gemini
    profiles:
      - name: deep
        model: gemini-3.1-pro
```

## Körning & flaggor

Tendril startar Gemini CLI med:

- Icke-interaktivt läge: `--output-format stream-json --skip-trust --approval-mode <mode>` (där `FullAuto` skickar `yolo`, `AcceptEdits` skickar `auto_edit` och `Plan` skickar `plan`), samt `--sandbox` när sandlådeläget är aktiverat.
- Interaktiv agentterminal: `gemini --yolo --skip-trust -i "<prompt>"`.
