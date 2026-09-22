---
title: Välkommen till Ivy Tendril
description: >-
  Tendril är en skrivbordsapplikation med öppen källkod och lokalprioriterad arkitektur (local-first) som fungerar som operativsystemet för
  AI-driven mjukvaruutveckling — och orkestrerar kodningsagenter som Claude Code, Codex, Copilot,
  Gemini, OpenCode, Antigravity, Cursor och Apple Foundation Models genom en strukturerad livscykel från idé till sammanfogad pull request.
icon: Rocket
searchHints:
  - översikt
  - vad är tendril
  - agentorkestrering
  - arkitektur
  - tauri
  - daemon
---

# Välkommen till Ivy Tendril

[![Ivy Tendril på två minuter: titta på YouTube](../assets/yt-thumbnail-in-two-minutes-2.png)](https://youtu.be/_KVG1NnAj-8)

## Konceptet

I Tendril organiseras arbetet i [**planer**](../02_Concepts/01_Plans.md) — strukturerade, granskningsbara enheter av arbete.
Istället för en ogenomskinlig svart låda som levererar ogranskad kod flyttar Tendril din plan genom en definierad
[livscykel](../02_Concepts/03_Lifecycle.md) med hjälp av [**promptwares**](../02_Concepts/02_Promptwares.md):
isolerade arbetsflödesagenter med ett enda syfte som specialiserar sig på ett steg i taget. Oavsett om det handlar om att utforma planen,
implementera ändringar i parallella worktrees, köra verifieringskontroller eller öppna pull requests behåller du
full insyn. Tendril autokompletterar inte bara rader i din redigerare; det orkestrerar hela ditt autonoma
utvecklingsarbetsflöde.

## Huvudfunktioner

- **Parallella worktrees** — varje agent arbetar i ett isolerat [Git-worktree](https://git-scm.com/docs/git-worktree),
  vilket gör att flera planer kan köras samtidigt utan grenkontaminering eller arbetskatalogkollisioner.
- **Tunnelering för fjärr- och mobilarbete** — exponera den lokala daemonen säkert via
  [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
  för att granska framsteg och styra körande agenter från din telefon eller en extern webbläsare.
- **Röst och rikt innehåll** — diktera krav med inbyggd transkribering via [OpenAI Whisper](https://github.com/openai/whisper)
  eller släpp in terminalloggar, markdown-specifikationer och designfiler som kontext.
- **Planannoteringar** — gör kommentarer och markeringar i ett planutkast direkt i gränssnittet; Tendril skickar dina anteckningar direkt till
  [UpdatePlan](../02_Concepts/02_Promptwares.md) för att revidera specifikationen.
- **Kodgranskningar med verifieringsgrindar** — granska git-differenser, kontrollera automatiserade testresultat (`Cargo`,
  `pnpm`, luddkontroll/linting, formatering) och godkänn endast verifierade ändringar.
- **Inhämtning från GitHub och inkorg** — konvertera inkommande [GitHub](https://github.com)-ärenden och
  felrapporter från [Jam.dev](https://jam.dev) till planer automatiskt via webhooks.

## Arkitektur

Tendril består av tre kärnkomponenter som körs lokalt på din maskin:

- En **skrivbordsapplikation** byggd med [Tauri 2](https://tauri.app) — ett högpresterande nativt skrivbordsskal
  med ett [React](https://react.dev)-frontend.
- En **serverdaemon** skriven i [Rust](https://www.rust-lang.org) (`tendril run` / `tendril serve`),
  som exponerar ett REST- och WebSocket-API. Skrivbordsappen startar och övervakar automatiskt daemonen i
  bakgrunden.
- Ett **CLI** (`tendril`) som ansluter till samma daemon och delar samma datalager. Allt som kan
  styras från skrivbordsappen kan köras via kommandoraden.

Tillståndet bevaras uteslutande lokalt:

- En lokal [SQLite](https://www.sqlite.org)-databas på `$TENDRIL_HOME/tendril.db` lagrar jobb, kostnader och
  telemetri.
- Enkel filsystemlagring på `$TENDRIL_HOME/Plans/` sparar planfiler, revisioner, annoteringar, loggar och
  verifieringsrapporter som transparenta YAML- och Markdown-dokument.

> [!NOTE]
> `$TENDRIL_HOME` har standardvärdet `~/.tendril`. Se [Installation](02_Installation.md) för konfiguration av anpassade sökvägar.

Din källkod lämnar aldrig din lokala maskin. Den enda utgående nätverkstrafiken är din konfigurerade
kodningsagents direkta API-anrop (t.ex. till Anthropic, OpenAI eller Google) samt eventuella Cloudflare-tunnlar
som du uttryckligen initierar.

Stödda kodningsagenter inkluderar:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models (`apple` via enhetsbaserad `fm`)

## Varför Tendril?

På [Ivy Interactive](https://ivy.app) testade vi flera multiagentarkitekturer för autonom kodning.
Även om enskilda CLI-agenter var kraftfulla blev hanteringen av ett dussin terminalflikar och granskningen av ospårade differenser
snabbt ohållbar.

Tendril tillför struktur till agentbaserad utveckling. Genom vår [promptware](../02_Concepts/02_Promptwares.md)-arkitektur
ackumulerar arbetsflödesagenter projektspecifikt minne mellan körningar, vilket gör att de lär sig kodbasens mönster och
förhindrar upprepade misstag. Genom att centrera hela arbetsflödet kring varaktiga
[planer](../02_Concepts/01_Plans.md) behåller mänskliga utvecklare granskningskontrollen medan de autonoma agenterna utför
det tunga implementeringsarbetet.

> [!TIP]
> Vi uppskattar din feedback. Rapportera fel och föreslå funktioner i vårt
> [GitHub-arkiv](https://github.com/Ivy-Interactive/Ivy-Tendril-V2). För support eller diskussioner, gå med i vår
> community på [Discord](https://discord.gg/FHgxkDga3y).

## Nästa steg

- [Installation](02_Installation.md) — bygg och installera skrivbordsappen och CLI.
- [Koncept](../02_Concepts/_Index.md) — fördjupa dig i planer, promptwares och jobblivscykeln.
