---
title: Konfiguration
description: Konfigurera Tendril-inställningar, miljövariabler, daemon-alternativ och projektprofiler.
icon: Settings
groupExpanded: true
searchHints:
  - konfiguration
  - inställningar
  - alternativ
  - preferenser
  - miljö
---

# Konfiguration

Tendril sparar sina inställningar, projekt och exekveringspreferenser i en centraliserad [YAML](https://yaml.org)-konfigurationsfil belägen på `$TENDRIL_HOME/config.yaml`.

Det här avsnittet täcker konfiguration av den globala Tendril-miljön, hantering av [Projektkonfiguration](02_Projects.md), justering av daemon-inställningar och konfiguration av profiler för [Kodningsagenter](../06_CodingAgents/_Index.md):

- [Installation & Inställningar](01_Setup.md) — konfigurera globala alternativ i inställningsgränssnittet eller via `$TENDRIL_HOME/config.yaml`, hantera [Kodningsagenter](../06_CodingAgents/_Index.md), sessionsautentisering, [Cloudflare](https://www.cloudflare.com)-tunnlar och inbyggda [Verifieringar](01_Setup.md#verifieringar).
- [Projektkonfiguration](02_Projects.md) — registrera [Git](https://git-scm.com)-arkiv, konfigurera visuella färgmarkeringar, verifieringspipeliner, granskningsåtgärder, portallokeringar, [Docker](https://www.docker.com)-sandlådor, [MCP](../09_Advanced/03_MCP.md)-servrar och isolering via [Git-worktrees](02_Projects.md#arkiv--git-worktrees).

För konceptuell bakgrund om hur planer och promptwares fungerar, se [Planer](../02_Concepts/01_Plans.md), [Promptwares](../02_Concepts/02_Promptwares.md) och [Planlivscykel](../02_Concepts/03_Lifecycle.md).
