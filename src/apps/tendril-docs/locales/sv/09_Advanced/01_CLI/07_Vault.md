---
title: vault
description: Hantera teamets konfigurationsvalv, upptäck och anslut delade arkiv
  på GitHub, inspektera katalogtillgångar, importera projekt och publicera
  konfigurationsuppdateringar direkt från CLI.
icon: KeyRound
searchHints:
  - valv
  - synka
  - hämta
  - importera
  - skicka
  - katalog
  - upptäck
  - anslut
  - autosynk
  - team
---

# vault

Hantera teamets konfigurationsvalv som backas upp av [Git](https://git-scm.com) och [GitHub](https://github.com). Valv gör det möjligt för team att dela projektkonfigurationer, anpassade färdigheter, serverkonfigurationer för [Model Context Protocol (MCP)](https://modelcontextprotocol.io), promptware-minnen och verifieringar över olika arbetsstationer. CLI:t interagerar med [GitHub CLI (`gh`)](https://cli.github.com) för att upptäcka teamarkiv, importera projektmallar och skicka uppdateringar via [GitHub Pull Requests](https://docs.github.com/en/pull-requests).

Se [Projekt](02_Project.md) för lokal projektkonfiguration och [Global konfiguration](06_Config.md) för globala inställningar.

## Kommandon

```terminal
>tendril vault list [--json]
>tendril vault status [vault-id] [--json]
>tendril vault discover [--json]
>tendril vault connect <repo-url> [--name <custom-name>]
>tendril vault create <repo-name> [--public] [--org <org>]
>tendril vault disconnect [vault-id] [-y, --yes]
>tendril vault sync [vault-id]
>tendril vault pull [vault-id]
>tendril vault set-auto-sync <enabled> [--vault <vault-id>]
>tendril vault catalog [vault-id] [--json]
>tendril vault import <project-name> [options]
>tendril vault push <projects...> [options]
>tendril vault delete <project-name> [--vault <vault-id>] [-y, --yes]
```

## Valvhantering

#### list

```terminal
>tendril vault list
>tendril vault list --json
```

Listar alla anslutna valv och visar deras ID, namn, URL till externt [Git](https://git-scm.com)-arkiv, aktiv gren, antal commits före/efter, tidsstämpel för senaste synkronisering och status för automatisk synkronisering.

#### status

```terminal
>tendril vault status
>tendril vault status <vault-id>
>tendril vault status --json
```

Visar detaljerad diagnostik- och synkroniseringsstatus för ett specifikt valv eller det primära konfigurerade valvet, inklusive icke-committade lokala ändringar och spårningstillstånd för grenen.

#### discover

```terminal
>tendril vault discover
>tendril vault discover --json
```

Söker igenom [GitHub](https://github.com) med [GitHub CLI (`gh`)](https://cli.github.com) för att upptäcka befintliga valvarkiv som är tillgängliga för ditt konto och dina organisationer.

#### connect

```terminal
>tendril vault connect https://github.com/my-org/team-vault.git
>tendril vault connect my-org/team-vault --name "Engineering Vault"
```

Ansluter ett befintligt [Git](https://git-scm.com)-arkiv som ett teamvalv. Accepterar fullständiga arkiv-URL:er eller kortformen `org/repo`.

#### create

```terminal
>tendril vault create engineering-vault
>tendril vault create team-vault --org my-org --public
```

Skapar ett nytt arkiv på [GitHub](https://github.com) (privat som standard), initierar standardmässiga katalogstrukturer för valv och ansluter det lokalt. Använd `--org` för att rikta in mot en organisation och `--public` för offentlig synlighet.

#### disconnect

```terminal
>tendril vault disconnect
>tendril vault disconnect <vault-id> -y
```

Kopplar bort ett valv från den lokala Tendril-konfigurationen utan att ta bort den lokala klonkatalogen. Ange `-y` eller `--yes` för att hoppa över bekräftelsefrågor.

#### sync / pull

```terminal
>tendril vault sync
>tendril vault pull
>tendril vault sync <vault-id>
```

Hämtar de senaste konfigurations-commitsen från det externa valvarkivet och uppdaterar spårade lokala projekt. `pull` är ett alias för `sync`.

#### set-auto-sync

```terminal
>tendril vault set-auto-sync true
>tendril vault set-auto-sync false --vault <vault-id>
```

Aktiverar eller inaktiverar automatisk synkronisering för ett valv. Accepterar `true`, `false`, `1`, `0`, `yes` eller `no`.

## Katalog & projektdelning

#### catalog

```terminal
>tendril vault catalog
>tendril vault catalog <vault-id> --json
```

Listar alla projekt och antal tillgångar (arkiv, anpassade färdigheter, [Model Context Protocol (MCP)](https://modelcontextprotocol.io)-servrar, promptware-minnen och verifieringar) som publicerats i valvkatalogen.

#### import

```terminal
>tendril vault import MyProject
>tendril vault import MyProject --target-name LocalProject --merge
>tendril vault import MyProject --repo api=~/code/api --repo web=~/code/web
```

Importerar en projektdefinition från valvkatalogen till den lokala Tendril-konfigurationen.

| Alternativ             | Beskrivning                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `--target-name <name>` | Anpassat lokalt projektnamn att registrera istället för katalognamnet                 |
| `--vault <vault-id>`   | Valv-ID eller namn att importera från (standard är det aktiva valvet)                 |
| `--repo <name=path>`   | Mappa en valvsarkividentifierare till en lokal filsystemssökväg (kan upprepas)        |
| `--no-permissions`     | Hoppa över import av säkerhetsregler och körbehörigheter                              |
| `--merge`              | Slå ihop inställningar med ett befintligt lokalt projekt istället för att ersätta det |

#### push

```terminal
>tendril vault push MyProject
>tendril vault push ProjectA ProjectB --version "1.2.0" --changelog "Added new skills and verifications"
>tendril vault push MyProject --reviewer alice,bob --title "feat(vault): update MyProject"
```

Samlar in projektkonfiguration, anpassade färdigheter, [Model Context Protocol (MCP)](https://modelcontextprotocol.io)-konfigurationer, promptware-minnen och verifieringar, committar dem till en funktionsgren och öppnar en [GitHub Pull Request](https://docs.github.com/en/pull-requests) mot valvarkivet.

| Alternativ            | Beskrivning                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `--vault <vault-id>`  | Målvalvets identifierare                                                                                 |
| `--version <version>` | Anpassad versionssträng (standard är UTC-tidsstämpel)                                                    |
| `--changelog <text>`  | Ändringslogganteckningar som inkluderas i pull request-beskrivningen                                     |
| `--title <title>`     | Anpassad titel för den genererade pull requesten                                                         |
| `--body <body>`       | Anpassad brödtextbeskrivning för pull requesten                                                          |
| `--reviewer <names>`  | [GitHub](https://github.com)-användarnamn att tilldela som granskare (kan upprepas eller kommaavskiljas) |

#### delete

```terminal
>tendril vault delete OldProject
>tendril vault delete OldProject --vault <vault-id> -y
```

Tar bort ett projekt från valvarkivet och skapar en [GitHub Pull Request](https://docs.github.com/en/pull-requests) för att tillämpa borttagningen. Ange `-y` eller `--yes` för att hoppa över bekräftelse.

## Exempel

**Anslut och synka ett teamvalv:**

```terminal
># Upptäck tillgängliga teamvalv på GitHub
>tendril vault discover

># Anslut valvarkiv
>tendril vault connect https://github.com/my-org/shared-vault.git

># Hämta uppdateringar
>tendril vault sync
```

**Importera ett projekt från katalogen:**

```terminal
># Inspektera tillgängliga katalogprojekt
>tendril vault catalog

># Importera med anpassade lokala arkivsökvägar
>tendril vault import BackendService --repo backend=~/Projects/backend
```

**Publicera projektuppdateringar via pull request:**

```terminal
># Skicka ändringar och öppna en pull request med tilldelade granskare
>tendril vault push BackendService --changelog "Added Playwright E2E verification" --reviewer alice,bob
```
