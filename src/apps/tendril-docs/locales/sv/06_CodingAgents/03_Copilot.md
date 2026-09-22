---
title: Copilot
description: Copilot är en alternativ kodningsagent som drivs av GitHubs Copilot CLI.
icon: Bot
searchHints:
  - copilot
  - github
  - kodningsagent
---

# Copilot

## Konfiguration

Ställ in Copilot som din kodningsagent i `config.yaml`:

```yaml
codingAgent: copilot
```

Eller välj den i **Inställningar > Kodningsagent**.

För fler detaljer om strukturen och inställningarna i `config.yaml`, se [Installation och inställningar](../03_Configuration/01_Setup.md).

## Krav

- [GitHub Copilot CLI](https://github.com/features/copilot) måste finnas tillgänglig som `copilot` i din PATH. Installera med hjälp av det officiella skriptet eller via [Homebrew](https://brew.sh)-cask:
  ```bash
  curl -fsSL https://gh.io/copilot-install | bash
  # or: brew install --cask copilot-cli
  ```
  Tendril faller automatiskt tillbaka på `gh copilot` om den fristående binären `copilot` inte hittas men [GitHub CLI](https://cli.github.com) (`gh`) är installerat.
- En aktiv [GitHub Copilot](https://github.com/features/copilot)-prenumeration krävs.
- **Autentisering**: Copilot har inget `login`-CLI-kommando och delar inte inloggningsuppgifter med `gh auth login`. För att logga in:
  1. Starta CLI i din terminal: `copilot`
  2. Kör snedstreckskommandot vid prompten: `/login`
  3. För headless- eller obevakade CI-miljöer, ställ in miljövariabeln `COPILOT_GITHUB_TOKEN` (eller `GH_TOKEN`) med en personlig åtkomsttoken som har behörigheten `Copilot Requests`.

## Profiler

Tendril mappar ansträngningsnivåer (effort levels) till Copilot:

| Profil     | Modell  | Ansträngning | Användningsområde                        |
| ---------- | ------- | ------------ | ---------------------------------------- |
| `deep`     | gpt-5.4 | high         | Komplexa ändringar i flera filer         |
| `balanced` | gpt-5.4 | medium       | Standardmässigt planutförande            |
| `quick`    | gpt-5.4 | low          | Enkla korrigeringar och små redigeringar |

Profilen väljs automatiskt baserat på [planens komplexitetsnivå](../02_Concepts/01_Plans.md), eller kan konfigureras per [promptware](../02_Concepts/02_Promptwares.md) i `config.yaml`.

Standardmodellen för Copilot i Tendril är `gpt-5.4`.

### Modeller som stöds

GitHub Copilot stöder både OpenAI- och Anthropic-modeller via sin körtidsmiljö:

- **[OpenAI](https://openai.com)-modeller**: `gpt-5.4` (standard), `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5-mini`, `gpt-4.1` (resonemangsinsats: `low`, `medium`, `high`, `xhigh`).
- **[Anthropic Claude](https://code.claude.com/docs)-modeller**: `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5` (resonemangsinsats: `low`, `medium`, `high`, `xhigh`, `max`).

## Installera Tendril-färdigheter för GitHub Copilot

Tendril tillhandahåller specialiserade färdigheter för GitHub Copilot i [Visual Studio Code](https://code.visualstudio.com), vilket täcker felsökning av planer, granskning av jobb-artefakter, kodgranskningar och ärendehantering.

### Använda Skills CLI

Installera färdigheter för din arbetsyta:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

Eller installera globalt över alla arbetsytor:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

### Manuell placering i `.agents/skills/`

Färdigheter kan också placeras direkt i katalogen `.agents/skills/`, `.github/skills/` eller `~/.copilot/skills/`:

```bash
mkdir -p .agents/skills
cp -r /path/to/skills/* .agents/skills/
```

När de har installerats visas färdigheterna i GitHub Copilot Chat under menyn `/skills` och kan anropas direkt som snedstreckskommandon (t.ex. `/tendril-debug-plan`, `/tendril-review`).

För mer information, se [Agentfärdigheter](00_Skills.md).
