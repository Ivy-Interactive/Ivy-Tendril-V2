---
title: Introducera en kodbas
description: >-
  En checklista för att förbereda din utvecklingsmaskin och ditt kodarkiv så att Tendril kan planera, exekvera,
  verifiera och leverera ändringar oövervakat.
icon: ClipboardCheck
searchHints:
  - introduktion
  - checklista
  - förbered
  - utvecklingsmaskin
  - miljö
  - worktree
  - AGENTS.md
  - gh
  - mcp
---

# Introducera en kodbas

Tendril kör en kodningsagent mot ditt kodarkiv inuti ett isolerat
[Git-worktree](https://git-scm.com/docs/git-worktree), bygger och testar koden och öppnar sedan en pull request.
För att detta flöde ska lyckas utan mänsklig inblandning måste maskinen och arkivet konfigureras i förväg.
Gå igenom checklistan nedan en gång per maskin och en gång per kodbas.

> [!TIP]
> När du är klar, kör `tendril doctor`. Det bekräftar Tendril home, `config.yaml`, databasen, plankatalogen,
> `git` och `gh`. Det testar **inte** din kodningsagent — verifiera det själv med steg 2 nedan.

## Checklista för maskinen

### 1. Nödvändig byggprogramvara är installerad

Alla verktyg som behövs för att kompilera projektet måste vara installerade och tillgängliga i din `PATH`. Agenten kan inte
installera en saknad kompilator eller ett SDK under körningen. För ett Rust- och pnpm-arkiv som Tendrils eget innebär det
[Rustup](https://rustup.rs/), [Node.js](https://nodejs.org/) och [pnpm](https://pnpm.io/); för ditt eget
projekt innebär det den byggverktygskedja som dina skript anropar.

> [!NOTE]
> Målkravet: en ny klon ska kunna byggas från en ren terminal med dokumenterade kommandon, utan interaktiva frågor
> och utan manuella steg i en specifik IDE.

### 2. Föredragen kodnings-CLI är installerad och autentiserad

Installera den agent du angav som `codingAgent` i `config.yaml` och logga in så att den kan köras icke-interaktivt:

```bash
# Exempel: Claude Code
npm install -g @anthropic-ai/claude-code
claude login
```

Verifiera att CLI-verktyget finns i `PATH` och att ett vanligt anrop inte stannar för att fråga efter inloggningsuppgifter:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor` / `cursor-agent`)
- Apple Foundation Models (`apple` via enhetsbaserad `fm`)

Agenten `apple` är undantaget: den körs via medföljande OpenCode mot Apples lokala modell på enheten,
så säkerställ att `fm` är installerat (verifiera med `fm available`) och att en `fm serve`-process redan lyssnar.

### 3. Git är installerat och auktoriserat för oövervakad användning

Tendril hämtar kod, skapar worktrees, committar och pushar för din räkning. Bekräfta att alla operationer fungerar
utan interaktiva frågor:

- En global identitet är konfigurerad (`git config --global user.name` och `user.email`).
- Inloggningsuppgifter sparas via en credential helper eller en SSH-nyckel laddad i en agent, så att `git pull` och
  `git push` aldrig frågar efter lösenord.
- Worktrees kan skapas och tas bort (`git worktree add` och `git worktree remove`).

> [!WARNING]
> Om push via HTTPS frågar efter autentiseringsuppgifter, konfigurera en credential helper eller använd en SSH-nyckel med en
> aktiv `ssh-agent`. En enda interaktiv fråga avbryter ett annars helt oövervakat jobb.

### 4. GitHub CLI är installerat och autentiserat

[CreatePr](../02_Concepts/02_Promptwares.md) använder [GitHub CLI](https://cli.github.com/)
(`gh`) för att öppna pull requests. Installera det och verifiera autentiseringen:

```bash
gh auth login
gh auth status
```

### 5. Nödvändiga MCP-servrar är installerade globalt

Om du förlitar dig på [Model Context Protocol](https://modelcontextprotocol.io/) (MCP)-servrar — såsom Jira
för ärendekontext eller Figma för UI-design — installera och registrera dem globalt så att varje worktree kan komma åt
dem. MCP-servrar registreras i kodningsagenten, inte inuti Tendril:

```bash
# Exempel: registrera en MCP-server globalt för Claude Code
claude mcp add --scope user jira -- npx -y @your-org/jira-mcp
claude mcp add --scope user figma -- npx -y figma-developer-mcp
claude mcp list   # verifiera att de är nåbara
```

> [!NOTE]
> Använd global eller användaromfattning (scope: user), inte projektomfattning, så att MCP-servrarna överlever de kortlivade git-worktrees som
> agenten arbetar i. Lagra eventuella nödvändiga API-tokens som miljövariabler i ditt system.

Se till att du faktiskt är _autentiserad_ mot varje MCP-server, inte bara att den är registrerad. Kör en
liten testplan från Tendril och bekräfta att varje server initialiseras utan att utlösa OAuth-fönster.

## Checklista för kodarkivet

### 6. Arkivet är redo för Git-worktrees

[ExecutePlan](../02_Concepts/02_Promptwares.md) körs inuti ett isolerat
[Git-worktree](https://git-scm.com/docs/git-worktree), inte din aktiva arbetskatalog. Ett worktree startar
från en ren commit — inga `target/`-, `node_modules/`- eller ospårade `.env`-filer finns.

- Dokumentera eventuella konfigurationskommandon som behövs efter utcheckning innan koden kompileras (t.ex. beroendeåterställning,
  kodgenerering, kopiering av mall-`.env`), och tillhandahåll ett incheckat konfigurationsskript.
- Förlita dig inte på ocommittade filer som bara finns i din primära utcheckning.
- Använd en pakethanterare med centraliserad cache så att varje worktree återställs på några sekunder istället för att
  ladda ner paket på nytt (t.ex. pnpm-store, Cargo registry-cache eller Go-modulcache).

> [!TIP]
> Snabbtest: kör `git worktree add ../repo-probe`, och kör sedan dina dokumenterade byggkommandon i den
> katalogen från en ren terminal. Om det kompilerar och klarar testerna kommer även Tendril att lyckas. Ta bort katalogen med
> `git worktree remove ../repo-probe`.

### 7. Skriv ett startskript för varje app

Tillhandahåll ett litet, incheckat startskript för varje applikation i arkivet med konfigurerbara portar via variabler.
Tendril kan köra parallella planer över worktrees samtidigt, så hårdkodade portar orsakar portkollisioner.

För ett [Vite](https://vite.dev)-frontend tillsammans med ett Python-API kan skriptet se ut så här:

```bash
#!/usr/bin/env bash
# run.sh - starta Python backend-API:et och Vite-frontenden
set -euo pipefail

api_port="${API_PORT:-8000}"
web_port="${WEB_PORT:-5173}"

cd "$(dirname "$0")"

# Backend: konfigurera virtualenv och installera beroenden
python -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt

# Starta backend-API:et på dess dedikerade port
uvicorn app.main:app --port "$api_port" &
api_pid=$!

# Avsluta backend när frontend-processen avslutas
trap 'kill "$api_pid" 2>/dev/null' EXIT

# Frontend: installera beroenden och starta Vite dev-server
npm --prefix web install --prefer-offline --no-audit
npm --prefix web run dev -- --port "$web_port" --open
```

> [!NOTE]
> Att samla startkommandon i ett incheckat skript säkerställer att både utvecklare och autonoma agenter
> startar applikationen på exakt samma sätt.

### 8. Lägg till en AGENTS.md (eller README.md) i arkivets rot

Ge arbetsflödesagenterna den grundläggande kontext de behöver för att navigera i kodbasen utan gissningar:

- **Förutsättningar** som krävs för att bygga och köra koden.
- **Arkitekturkarta** som beskriver applikationer, bibliotek och kommunikationsprotokoll.
- **Bygg- och testkommandon** som kompilerar och verifierar arkivet.
- **Startskript** som pekar på startskripten från föregående steg.

## Nästa steg

- Följ genomgången från början till slut i [Handledning](04_Tutorial.md).
- Utforska [Koncept: Planer](../02_Concepts/01_Plans.md) och [Promptwares](../02_Concepts/02_Promptwares.md).
- Förstå [Jobblivscykeln](../02_Concepts/03_Lifecycle.md).
