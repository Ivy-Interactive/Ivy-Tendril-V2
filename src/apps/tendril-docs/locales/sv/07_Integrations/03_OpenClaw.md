---
title: OpenClaw
description: Integrera OpenClaw eller valfritt filbaserat verktyg med Tendril
  genom att släppa markdown-filer i Inbox-mappen.
icon: Terminal
searchHints:
  - openclaw
  - inbox
  - mapp
  - filbevakare
  - släppmapp
---

# OpenClaw

## Översikt

Tendril bevakar en **Inbox-mapp** efter nya markdown-filer och konverterar dem automatiskt till [planer](../02_Concepts/01_Plans.md). Detta ger en enkel, filbaserad integrationspunkt för externa verktyg som OpenClaw eller anpassade skript som skriver filer till disk.

## Inbox-mappens plats

```
$TENDRIL_HOME/Inbox/
```

För detaljer om Tendrils hemkatalog och konfiguration, se [Installation och inställningar](../03_Configuration/01_Setup.md). Tendrils filsystemsbevakare övervakar denna katalog efter nya `.md`-filer.

## Filformat

Släpp en markdown-fil (`.md`) med valfri YAML-frontmatter:

```markdown
---
project: ProjectName
sourcePath: optional/path/to/code
---

Describe the plan here. This text becomes the plan description
and is passed to the [CreatePlan promptware](../02_Concepts/02_Promptwares.md).
```

| Fält         | Obligatoriskt | Beskrivning                              |
| ------------ | ------------- | ---------------------------------------- |
| `project`    | Nej           | Målprojektnamn (standardvärde är `Auto`) |
| `sourcePath` | Nej           | Sökvägstips för relaterad källkod        |

Innehållet efter frontmattern blir planbeskrivningen.

> [!NOTE]
> Om du utelämnar frontmattern helt används hela filinnehållet som planbeskrivning med standardinställningar.

## Fillivscykel

1. **Släpp** en `.md`-fil i Inbox-mappen
2. **Bearbetning** — Filen döps om till `.md.processing` medan den hanteras
3. **Slutförande** — Filen raderas så snart planen har skapats framgångsrikt

## Återställning

Om Tendril startar om under bearbetningen återställs alla `.md.processing`-filer automatiskt tillbaka till `.md` och bearbetas på nytt vid uppstart.

## Konfigurera med OpenClaw

Konfigurera OpenClaw så att dess utdata skrivs som markdown-filer till Tendrils Inbox-mapp. Varje fil blir en separat plan:

1. Sätt utdatakatalogen till `$TENDRIL_HOME/Inbox/`
2. Använd markdown-format med YAML-frontmatter för projektinriktning
3. Tendril fångar upp nya filer automatiskt — ingen polling eller API-anrop behövs
