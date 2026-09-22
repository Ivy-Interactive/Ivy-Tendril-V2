---
title: Få hjälp
description: Har du kört fast? Här beskrivs hur du får support och kommer i kontakt med Tendril-communityn.
icon: LifeBuoy
searchHints:
  - hjälp
  - support
  - discord
  - github-ärenden
  - community
  - felrapport
  - report-bug
  - doctor
---

# Få hjälp

Om du stöter på problem eller har frågor om att konfigurera Tendril finns flera supportresurser och
diagnostikverktyg tillgängliga.

## Kör diagnostik först

Innan du skickar in ett ärende eller ber om hjälp, kör Tendrils inbyggda miljödiagnostikverktyg:

```bash
tendril doctor
```

`tendril doctor` verifierar katalogen `$TENDRIL_HOME`, syntaxen i `config.yaml`, tillgängligheten till
[SQLite](https://www.sqlite.org)-databasen, [plan](../02_Concepts/01_Plans.md)-katalogen, [Git](https://git-scm.com/) och
autentiseringen i [GitHub CLI](https://cli.github.com/).

Om en specifik plan eller ett jobb har misslyckats kan du paketera fullständig diagnostik med `tendril report-bug`:

```bash
# Paketera plantillstånd, verifieringsrapporter och jobbloggar i en zip-fil
tendril report-bug <plan-id>
```

Detta skapar ett diagnostikarkiv som paketerar planens YAML, revisionshistorik, verifieringsutdata
och råa agenttranskriptioner utan att avslöja känsliga inloggningsuppgifter.

## Felsökning

För vanliga felmeddelanden, databasmigreringar och worktree-återställningssteg, se
[Felsökning](06_Troubleshooting.md).

## Discord-community

Det snabbaste sättet att nå utvecklingsteamet och andra användare är vår
[Discord-server](https://discord.gg/FHgxkDga3y). Gå med för att ställa frågor, dela feedback och diskutera anpassade
promptware-arbetsflöden.

## GitHub-ärenden (Issues)

Hittade du ett fel eller vill du föreslå en ny funktion? Öppna ett ärende i vårt
[GitHub-arkiv](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/issues).

> [!TIP]
> Inkludera alltid utdata från `tendril doctor` och `tendril version` i din ärendebeskrivning. Om du
> rapporterar en misslyckad plankörning, bifoga diagnostik-zipen som genereras av `tendril report-bug <plan-id>`
> eller jobbloggen från `$TENDRIL_HOME/Jobs/`.

## Nästa steg

- [Felsökning](06_Troubleshooting.md) — vanliga felsignaturer och lösningar.
- [Livscykel & Jobb](../02_Concepts/03_Lifecycle.md) — förstå jobbstatusar och felhantering.
