---
title: project
description: Hantera projekt som lagras i config.yaml. Projekt grupperar arkiv,
  verifieringar, byggberoenden, granskningsåtgärder, MCP-servrar och anpassade
  färdigheter.
icon: FolderGit
searchHints:
  - projekt
  - arkiv
  - verifiering
  - bygg
  - beroende
  - granskning
  - åtgärd
  - mcp
  - färdigheter
  - synkronisering
  - krokar
---

# project

Hantera projekt som lagras i `config.yaml`. Projekt grupperar [Git](https://git-scm.com)-arkiv, [verifieringar](03_Verification.md), byggberoenden, granskningsåtgärder, [Model Context Protocol (MCP)](https://modelcontextprotocol.io)-servrar och anpassade [agentfärdigheter](../../06_CodingAgents/00_Skills.md). För bredare UI-arbetsflöden, se [Projektkonfiguration](../../03_Configuration/02_Projects.md).

## CRUD

```terminal
>tendril project list
>tendril project get <name>
>tendril project add <name>
>tendril project rename <name> <new-name>
>tendril project remove <name>
>tendril project set <name> <field> <value>
```

- **list** — listar alla konfigurerade projekt och visar antal arkiv och verifieringar
- **get** — visar fullständiga konfigurationsdetaljer i [YAML](https://yaml.org)-format, inklusive arkiv, verifieringar, granskningsåtgärder, byggberoenden, MCP-servrar och anpassade färdigheter
- **add** — skapar en ny projektpost i `config.yaml`
- **rename** — byter namn på ett befintligt projekt och uppdaterar alla interna referenser
- **remove** — tar bort projektkonfigurationen från `config.yaml`
- **set** — uppdaterar ett skalärt projektfält. Fält som stöds: `color` (hex-färgsträng), `context` (markdown-promptinstruktioner för agenter), `stackHash`

## Arkiv och synkronisering

```terminal
>tendril project add-repo <project-name> <repo-path>
>tendril project remove-repo <project-name> <repo-path>
>tendril project sync <project-name> [--repo <repo>]
```

- **add-repo** — associerar en lokal sökväg för ett utcheckat arkiv med projektet
- **remove-repo** — kopplar bort en arkivsökväg från projektet
- **sync** — hämtar fjärrgrenar och snabbspolar (fast-forward) alla projektarkiv med hjälp av [Git](https://git-scm.com). Arkiv som har divergerat rapporterar diagnostiska åtgärdsinstruktioner.

## Verifieringar

Projekt definierar vilka [verifieringskontroller](03_Verification.md) som måste godkännas innan en [plan](01_Plan.md) kan slutföras:

```terminal
>tendril project add-verification <project-name> <verification-name> [--required | --optional] [--after <target>]
>tendril project remove-verification <project-name> <verification-name>
>tendril project move-verification <project-name> <verification-name> [--before <target> | --after <target> | --position <pos>]
```

- **add-verification** — länkar en global verifieringskontroll till detta projekt. Obligatorisk som standard; skicka med `--optional` för att markera den som rådgivande, eller `--after` för att ange körningsordning.
- **remove-verification** — tar bort en verifieringsspärr från projektet.
- **move-verification** — justerar positionen i körningsordningen i förhållande till andra verifieringar (`--before`, `--after` eller nollbaserad `--position`).

## Byggberoenden

```terminal
>tendril project add-build-dep <project-name> <dependency>
>tendril project remove-build-dep <project-name> <dependency>
```

Konfigurerar externa binär- och verktygsförutsättningar (t.ex. `cargo`, `dotnet`, `node`, [gh](https://cli.github.com)) som verifieras innan en plan körs.

## Granskningsåtgärder

```terminal
>tendril project add-review-action <project-name> <name> --command <cmd> [options]
>tendril project remove-review-action <project-name> <name>
>tendril project review-actions <project-name> [--changed-file <file>...] [--plan <plan>] [--format <table>]
```

Granskningsåtgärder är skalkommandon som körs under interaktiv kodgranskning:

| Alternativ         | Effekt                                                                          |
| ------------------ | ------------------------------------------------------------------------------- |
| `--command <cmd>`  | Skalkommandorad som körs i en interaktiv terminal-PTY                           |
| `--condition <ex>` | Valfritt uttryck som utvärderas innan åtgärden körs                             |
| `--paths <prefix>` | Arkivrelativt sökvägsfilter som utlöser denna åtgärd vid ändring (kan upprepas) |
| `--before <name>`  | Infoga före en befintlig åtgärd                                                 |
| `--after <name>`   | Infoga efter en befintlig åtgärd                                                |

`tendril project review-actions` utvärderar och rangordnar granskningsåtgärder gentemot ändrade filer härledda från en plans arbetsträd.

## MCP-servrar och anpassade färdigheter

Projekt kan registrera projektomfattande [MCP](https://modelcontextprotocol.io)-servrar och anpassade agentfärdigheter:

```terminal
>tendril project list-mcp <project-name>
>tendril project add-mcp <project-name> <server-name> <command> [--arg <arg>...] [--env KEY=VALUE...]
>tendril project remove-mcp <project-name> <server-name>

>tendril project list-skills <project-name>
>tendril project add-skill <project-name> <skill-name> [--description <desc>] [--path <path>] [--instructions <text>]
>tendril project remove-skill <project-name> <skill-name>
```

För att importera MCP-servrar eller färdigheter direkt från ett befintligt arkiv:

```terminal
>tendril project import <project-name> <repo-path> [--mcp-only] [--skills-only]
>tendril project import-mcp <project-name> <repo-path> [--name <server>]
>tendril project import-skills <project-name> <repo-path> [--name <skill>] [--no-copy]
```

## Promptware-krokar

Krokar kör anpassade skalåtgärder före eller efter att [promptware](../../02_Concepts/02_Promptwares.md) körs:

```terminal
>tendril project add-hook <project-name> <name> --action <action> [options]
>tendril project remove-hook <project-name> <name>
```

| Alternativ             | Effekt                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `--when <timing>`      | Tidpunkt för utlösare: `before` (standard) eller `after`                                                     |
| `--promptwares <list>` | Kommaseparerad lista över promptwares att trigga för (t.ex. `ExecutePlan,CreatePr`), eller alla om utelämnat |
| `--action <cmd>`       | Skalkommando att köra                                                                                        |
| `--condition <expr>`   | Uttryck som måste utvärderas till sant för att kroken ska utlösas                                            |

## Portar och miljöfiler

Hantera namngivna tjänsteportar och `.env`-mallfiler som materialiseras i planens arbetsträd:

```terminal
>tendril project port list <project-name>
>tendril project port add <project-name> <port-name> --default-port <port> [--description <desc>]
>tendril project port remove <project-name> <port-name>

>tendril project env-file list <project-name>
>tendril project env-file add <project-name> <path> [--template <file>] [--override KEY=VALUE...]
>tendril project env-file remove <project-name> <path>
```
