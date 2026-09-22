---
title: Installation & Inställningar
description: Konfigurera Tendril i inställningsgränssnittet eller genom att redigera TENDRIL_HOME/config.yaml (projekt, agenter, nivåer, verifieringar, inställningar).
icon: Construction
searchHints:
  - config
  - yaml
  - konfiguration
  - inställningar
  - projekt
  - gui
  - driftsättning
  - docker
  - hemligheter
  - BasicAuth
  - lösenord
  - hostad
---

# Installation & Inställningar

## Inställningar i appen (In-app Settings)

Tendril innehåller en dedikerad inställningsapp för att konfigurera miljön visuellt utan att manuellt redigera [YAML](https://yaml.org). Inställningarnas sidofält innehåller följande avsnitt:

- **Coding Agent** — Välj primär körmiljö för kodningsagent ([Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), Antigravity, [OpenCode](../06_CodingAgents/04_OpenCode.md), Cursor, Apple eller anpassade OpenAI-kompatibla proxyservrar), konfigurera leverantörers API-nycklar och anpassade bas-URL:er, anpassa agentprofiler och resonemangsnivåer (reasoning tiers), testa agentanslutning och bläddra bland modellspecifikationer i modellkatalogen (Model Catalog). För agentinstallation och konfiguration, se [Kodningsagenter](../06_CodingAgents/_Index.md).
- **Plans** — Redigera standardmallen för Markdown-planer (`planTemplate`) som används när en ny plan skapas i [Planer](../04_Apps/03_Plans.md).
- **Appearance** — Välj temaläge (**Light**, **Dark** eller **System**), välj bland inbyggda förinställningar med färgprover, konfigurera sidofältets standardläge (expanderat eller dolt) och välj vad chattknappen öppnar (**Chat view** eller **Terminal**).
- **Projects** — Hantera registrerade projekt, konfigurera arkiv, verifieringar, portar, miljövariabler, anpassade skills, [MCP](../09_Advanced/03_MCP.md)-servrar per projekt och få åtkomst till farozonen (Danger Zone). Se [Projektkonfiguration](02_Projects.md).
- **Team Vault** _(Beta)_ — Synkronisera projekt, anpassade skills, MCP-servrar och säkerhetsregler mellan teammedlemmar via ett delat [Git](https://git-scm.com)-arkiv.
- **Workflow Agents** — Konfigurera agentprofiler för [Promptware](../02_Concepts/02_Promptwares.md) och detaljerade verktygsbehörigheter (`allowedTools`, `deniedTools`) över standardarbetsflöden (`CreatePlan`, `ExecutePlan`, `UpdatePlan` etc.) eller globalt med nyckeln `_default`.
- **Levels** — Definiera komplexitetsnivåer (såsom L1, L2, L3) med relativa exekveringsvikter, beskrivningar och anpassade märkesfärger.
- **Notifications** — Slå på eller av skrivbordsaviseringar från operativsystemet för slutförda eller misslyckade jobb.
- **Security & Tunneling** — Konfigurera lösenordsskydd för webbsessioner, starta eller stoppa fullåtkomst-[Cloudflare](https://www.cloudflare.com)-tunnlar för fjärråtkomst och skapa skrivskyddade delningstunnlar med behörighetstokens.
- **Advanced** — Ange tidsgränser för körning (`jobTimeout`, `staleOutputTimeout`), konfigurera `maxConcurrentJobs`, slå på åtkomst till betafunktioner och inspektera **Daemon-diagnostik** i realtid (anslutningstillstånd, PID, latensping, sökväg för `$TENDRIL_HOME` och rapporterade förmågor).
- **Newsletter** — Prenumerera på produktuppdateringar och versionsmeddelanden för Ivy & Tendril.
- **Open config.yaml** — Öppna den inbyggda råa YAML-redigeraren med syntaxmarkering i realtid och direkt planlänkning.

## `config.yaml`

Inställningar som ändras i gränssnittet sparas omedelbart till `$TENDRIL_HOME/config.yaml` (standard `~/.tendril/config.yaml`). Du kan även redigera den här filen direkt eller ange en anpassad sökväg med miljövariabeln `TENDRIL_CONFIG`.

> [!NOTE]
> Konfigurationsfilen måste alltid heta `config.yaml`. Tendril-daemonen läser automatiskt in konfigurationsändringar när filen uppdateras på disken.

### Exempel

```yaml
codingAgent: claude
maxConcurrentJobs: 5
jobTimeout: 45
staleOutputTimeout: 10
theme: default
themeMode: system
chatMode: chat
desktopNotifications: true

projects:
  - name: Global Engine
    color: Emerald
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: CheckResult
        required: true

auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..." # Hanteras via Inställningar
  hashSecret: "base64-secret-pepper"

api:
  apiKey: "your-api-secret-key"
```

### Vanliga fält

| Fält                   | Typ          | Standard    | Syfte                                                                                                   |
| ---------------------- | ------------ | ----------- | ------------------------------------------------------------------------------------------------------- |
| `codingAgent`          | sträng       | `"claude"`  | Standardkörfil för kodningsagent. Se [Kodningsagenter](../06_CodingAgents/_Index.md).                   |
| `maxConcurrentJobs`    | heltal       | `20`        | Maximalt antal samtidiga agentexekverings-[Jobb](../04_Apps/04_Jobs.md) (worktrees).                    |
| `jobTimeout`           | heltal (min) | `30`        | Exekveringstimeout i minuter innan ett aktivt jobb avbryts.                                             |
| `staleOutputTimeout`   | heltal (min) | `10`        | Timeout i minuter om en agentprocess inte genererar någon stdout/stderr-utdata.                         |
| `daemonRequestTimeout` | heltal (sek) | `30`        | Klientbegärans timeout i sekunder vid kommunikation med den lokala daemonen.                            |
| `planTemplate`         | sträng       | `""`        | Markdown-mall som används vid skapande av nya planer i [Planer](../04_Apps/03_Plans.md).                |
| `theme`                | sträng       | `"default"` | Identifierare för utseendeförinställning (t.ex. `default`, `dracula`).                                  |
| `themeMode`            | sträng       | `"system"`  | Temaläge: `light`, `dark` eller `system`.                                                               |
| `chatMode`             | sträng       | `"chat"`    | Vad chattknappen öppnar: `chat` (chattvy) eller `terminal` (agentterminal).                             |
| `desktopNotifications` | boolesk      | `true`      | Om operativsystemets skrivbordsaviseringar är aktiverade för jobbhändelser.                             |
| `projects`             | lista        | `[]`        | Lista över registrerade projekt och deras konfigurationer. Se [Projektkonfiguration](02_Projects.md).   |
| `levels`               | lista        | standard    | Konfigurerade komplexitetsnivåer för planer och deras vikter.                                           |
| `auth`                 | objekt       | `null`      | Lösenordsskyddskonfiguration för sessioner med hjälp av [Argon2](https://en.wikipedia.org/wiki/Argon2). |
| `api.apiKey`           | sträng       | `null`      | Delad hemlighet som skyddar REST API-slutpunkter. Se [REST API](../09_Advanced/02_REST.md).             |
| `telemetry`            | boolesk      | `null`      | Samtycke till anonym användningstelemetri (`false` eller utelämnad betyder inaktiv).                    |

## Autentisering & Fjärråtkomst

### Sessionsskydd (Webb-UI)

När Tendril körs på en fjärrserver eller exponeras över ett nätverk, aktivera sessionsskydd i **Settings > Security & Tunneling** eller konfigurera inloggningsuppgifter via miljövariabler:

- `TENDRIL_AUTH_USERNAME` — Inloggningsanvändarnamn (standard: `admin`).
- `TENDRIL_AUTH_PASSWORD` — Klartextlösenord som hashas vid start.
- `TENDRIL_AUTH_HASH_SECRET` — 32-byte base64-sträng (`openssl rand -base64 32` via [OpenSSL](https://www.openssl.org)) som används som pepper-hemlighet för [Argon2](https://en.wikipedia.org/wiki/Argon2).

I `config.yaml` sparas lösenord som Argon2 PHC-hashar under `auth:`-blocket med valfri hastighetsbegränsning (rate limiting):

```yaml
auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..."
  hashSecret: "base64-encoded-pepper"
  rateLimit:
    threshold: 3
    baseDelaySeconds: 1.0
    maxDelaySeconds: 60.0
```

### Cloudflare-tunnlar

Tendril integreras med [Cloudflare](https://www.cloudflare.com)-tunnlar (`cloudflared`) för att exponera applikationen säkert utan öppna inkommande brandväggsportar:

- **Fullåtkomsttunnel (Full-Access Tunnel)**: Publicerar hela Tendril-daemonen. Av säkerhetsskäl kräver Tendril att sessionsskydd är aktivt med ett konfigurerat lösenord innan en fullåtkomsttunnel kan startas.
- **Delningstunnel (Share Tunnel)**: Skapar en skrivskyddad tunnel som skyddas av behörighetstokens, vilket möjliggör säker delning av [Översikten (Dashboard)](../04_Apps/01_Dashboard.md) och planframsteg med intressenter utan skrivåtkomst.

### REST API-skydd

REST API:et använder tokenautentisering via inställningen `api.apiKey` i `config.yaml` eller miljövariabeln `TENDRIL_API_KEY`. När den är angiven måste anrop innehålla sidhuvudet `X-Api-Key`. Se [REST API](../09_Advanced/02_REST.md) och [CLI-konfiguration](../09_Advanced/01_CLI/06_Config.md).

## Verifieringar

Tendril levereras med inbyggda definitioner av verifieringsgrindar som projekt kan koppla till sina arbetsflöden:

| Verifiering   | Beskrivning                                                              |
| ------------- | ------------------------------------------------------------------------ |
| `Build`       | Kör projektets byggkommando och verifiera noll kompileringsfel.          |
| `Format`      | Verifiera kodformateringsregler eller formatera ändrade filer.           |
| `Test`        | Kör enhets- eller integrationstester kopplade till planens ändringar.    |
| `Lint`        | Kör statisk analys / luddkontroll och rapportera överträdelser.          |
| `Screenshots` | Fånga skärmdumpar av användargränssnittet till planens artefaktmapp.     |
| `CheckResult` | Verifiera att den slutliga implementationen matchar planspecifikationen. |

Anpassade verifieringskommandon (såsom `cargo test`, `pnpm test` eller `pytest`) kan definieras globalt i `config.yaml` eller direkt i [Projektkonfiguration](02_Projects.md#verifieringspipeliner). För verifieringskommandon via CLI, se [CLI-verifiering](../09_Advanced/01_CLI/03_Verification.md).
