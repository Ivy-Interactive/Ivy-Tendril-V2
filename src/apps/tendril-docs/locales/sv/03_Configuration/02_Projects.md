---
title: Projektkonfiguration
description: Varje projekt är ett git-arkiv med egna verifieringar och agentkontext. Tendril kör många projekt sida vid sida.
icon: FolderGit
searchHints:
  - projekt
  - arkiv
  - repository
  - multiprojekt
  - isolering
  - worktree
  - danger zone
  - mcp
  - sandlåda
---

# Projektkonfiguration

Tendril stöder hantering av flera projekt sida vid sida. Varje projekt definierar sina egna [Git](https://git-scm.com)-arkiv, verifieringsgrindar, portallokeringar, miljövariabler, säkerhetssandlådor och anpassade skills.

## Lägga till & hantera projekt

Projekt kan konfigureras visuellt via **Settings > Projects** eller genom att deklarera dem i `$TENDRIL_HOME/config.yaml` (se [Installation & Inställningar](01_Setup.md)):

- **Guiden Lägg till projekt (Add Project Wizard)** — Klicka på **Add Project** i inställningarnas sidofält för att registrera ett projekt med dess arkivsökväg, färg och standardverifieringsgrindar.
- **Namnändring i gränssnittet** — Klicka på pennikonen bredvid projektnamnet i sidhuvudet för att byta namn på ett projekt. Tendril kontrollerar mot dubblettnamn och uppdaterar associerade planposter automatiskt.
- **Färgprovsväljare (Color Swatch Picker)** — Välj en accentfärg från Ivy-färgpalettens 32 prover (`ColorSwatchField`). Denna färg särskiljer projektet i [Översikten (Dashboard)](../04_Apps/01_Dashboard.md), [Planer](../04_Apps/03_Plans.md)-kön, [Granskning (Review)](../04_Apps/02_Review.md)-kön och [Pull Requests](../04_Apps/06_PullRequests.md)-översikten.
- **Kontext** — Markdown-instruktioner som beskriver domänterminologi, arkitektoniska begränsningar och kodningsstandarder. Denna kontext läggs till före promptware-instruktionerna för alla agentkörningar i projektet.

### Exempel i `config.yaml`

```yaml
projects:
  - name: Global Engine
    color: Emerald
    context: |
      Kärnmotortjänster skrivna i Rust med ett TypeScript-CLI.
      Följ Ivy-standardens designtokens och säkerställ att alla tester passerar.
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: Lint
        required: true
      - name: CheckResult
        required: true
    reviewActions:
      - name: Run E2E
        command: pnpm test:e2e
        condition: "${hasChanges}"
    ports:
      backend:
        defaultPort: 8080
        description: API gateway service
    envFiles:
      - path: .env
        template: .env.example
        overrides:
          PORT: "${ports.backend}"
          DATABASE_URL: "sqlite://${env.TENDRIL_HOME}/dev.db"
    wireframes: true
    wireframeGuard: true
    sandboxMode: Off
    securityPreset: Standard
```

## Arkiv & Git-worktrees

Tendril-projekt länkar ett eller flera [Git](https://git-scm.com)-arkiv (`repos:`).

När en agent exekverar en plan via `ExecutePlan` isoleras kodgenereringen från din lokala utvecklingsmiljö:

- **Dedikerade Git-worktrees** — Tendril skapar en isolerad Git-worktreegren (`tendril/<planId>-<slug>`) förgrenad från din målgren. Ditt arbetsträd, din gren och din IDE förblir orörda.
- **Samtidig exekvering** — Flera planer kan köras samtidigt över olika arkiv utan konflikter med git-lås.
- **Säker felhantering och kassering** — Misslyckade eller avvisade körningar kan kasseras rent utan manuell git-städning.
- **Worktree-rensare (Worktree Reaper)** — Automatiserad bakgrundsrensning tar bort inaktiva eller slutförda worktrees enligt inställningarna `worktreeReaperInterval` och `worktreeReaperGrace` i [Installation & Inställningar](01_Setup.md).

## Verifieringspipeliner

Projekt definierar en ordnad sekvens av verifieringsgrindar som agenter måste uppfylla innan arbetet når [Granskning (Review)](../04_Apps/02_Review.md):

- **Sorterbar ordning** — Dra och släpp verifieringsstegen i önskad körningsordning (`SortableVerificationList`).
- **Obligatoriska grindar** — Markera verifieringar som obligatoriska. En plan visas endast som `Verified` i [Granskning](../04_Apps/02_Review.md) om alla obligatoriska verifieringar lyckas.
- **Anpassade verifieringar** — Lägg till projektspecifika kommandon och anpassade verifieringsprompter (t.ex. `cargo clippy`, `pnpm check`, `pytest`). Se [CLI-verifiering](../09_Advanced/01_CLI/03_Verification.md) för kommandoradshantering.

## Granskningsåtgärder (Review Actions)

Definiera enklicksknappar som visas i verktygsfältet i appen [Granskning (Review)](../04_Apps/02_Review.md) (`reviewActions:`):

- `name` — Åtgärdens etikett som visas på knappen i verktygsfältet.
- `command` — Skalkommando som körs i planens worktree.
- `condition` — Valfritt körningsvillkor (såsom `${hasChanges}`).

## Portar & miljöfiler

Komplexa projekt kräver ofta isolerade portar och miljökonfigurationer:

- **Portallokeringar (`ports:`)** — Deklarera namngivna portar (t.ex. `backend`, `frontend`). Om standardporten redan används allokerar Tendril en ledig port och exponerar den via platshållarna `${ports.<name>}`.
- **Miljöfiler (`envFiles:`)** — Återskapa automatiskt `.env`-filer inuti agentens worktree från en basmall (t.ex. `.env.example`) med radvisa nyckel/värde-överskridningar som stöder variablerna `${ports.<name>}`, `${env.<VAR>}` och `%VAR%`.

## Agentsäkerhet & Sandlådor

Tendril tillhandahåller detaljerade säkerhetskontroller på projektnivå:

- **Säkerhetsförinställningar** — Välj `Strict`, `Standard`, `Permissive` eller `Custom`. Förinställningarna konfigurerar standardsandlådor och filåtkomstregler.
- **Sandlådeläge (Sandbox Mode)** — Välj körtidsisolering: `Off`, [Docker](https://www.docker.com) eller [Bubblewrap](https://github.com/containers/bubblewrap).
- **Filåtkomst utanför arkivet** — Styr om agenter får läsa filer utanför arkivträdet (`Deny`, `ReadOnly`, `Full`).
- **Automatisk exekvering i terminalen** — Välj om agenter kör skalkommandon automatiskt (`AllowAll`), frågar om bekräftelse (`RequireConfirmation`) eller nekar kommandokörning (`DenyAll`).
- **Filbehörigheter** — Konfigurera detaljerade sökvägsregler: `Allow <path>`, `Ask <path>` eller `Deny <path>`.
- **Wireframes & Wireframe Guard** — Slå på `wireframes` för att aktivera UI-prototypgenerering i planer, och slå på `wireframeGuard` för att verifiera att tillfällig wireframe-kod kontrolleras innan den landar i produktions-pull requests.

## Projekt-MCP-servrar & Skills

Utöka agentförmågor för ett specifikt projekt:

- **MCP-servrar (`mcpServers:`)** — Registrera projektspecifika servrar för [Model Context Protocol](https://modelcontextprotocol.io) med anpassade körfiler, argument och miljövariabler. Se [MCP-integrering](../09_Advanced/03_MCP.md).
- **Skills (`skills:`)** — Utrusta agenter med projektspecifika procedurer och markdown-instruktioner. Se [Skills-guide](../06_CodingAgents/00_Skills.md).

## Arkivlokal kontext

Tendril upptäcker och infogar automatiskt dokumentation från arkivroten i promptware-kontexten:

- **`CLAUDE.md`** — Vägledning och konventioner för Claude Code. Se [Claude Code-guide](../06_CodingAgents/01_ClaudeCode.md).
- **`AGENTS.md` / `DEVELOPER.md`** — Teamets utvecklingsstandarder, testkrav och kodbankonventioner.

## Farozon: Remove vs. Delete

Projektinställningarna avslutas med två distinkta borttagningsalternativ i Farozonen (Danger Zone):

```
[ Remove Project ]  (Konturknapp)
Tar bort projektet från config.yaml. Klonade arkiv, planmappar och historik
lämnas kvar på disken, så att lägga till projektet igen med samma namn återställer det.

[ Delete Project ]  (Destruktiv knapp)
Raderar permanent projektets planer, dess klonade arkiv under
<TENDRIL_HOME>/Projects/, dess databasrader och dess konfigurationspost. Detta kan inte
ångras och kräver att du skriver in projektnamnet först.
```

> [!WARNING]
> **Remove Project** avregistrerar endast projektet från konfigurationen och behåller filerna på disken. **Delete Project** raderar permanent arkiv, planer och databasposter, och kräver att det exakta projektnamnet skrivs in som bekräftelse.
