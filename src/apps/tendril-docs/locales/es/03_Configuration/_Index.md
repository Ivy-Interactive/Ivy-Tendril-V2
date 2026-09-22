---
title: Configuración
description: Configure los ajustes de Tendril, las variables de entorno, las opciones del daemon y los perfiles de proyecto.
icon: Settings
groupExpanded: true
searchHints:
  - configuración
  - ajustes
  - opciones
  - preferencias
  - entorno
---

# Configuración

Tendril almacena sus ajustes, proyectos y preferencias de ejecución en un archivo de configuración centralizado en formato [YAML](https://yaml.org) ubicado en `$TENDRIL_HOME/config.yaml`.

Esta sección cubre la configuración del entorno global de Tendril, la gestión de la [Configuración de proyectos](02_Projects.md), el ajuste de las opciones del daemon y la configuración de perfiles de [Agentes de codificación](../06_CodingAgents/_Index.md):

- [Configuración y ajustes](01_Setup.md) — Configure opciones globales en la interfaz de Ajustes o en `$TENDRIL_HOME/config.yaml`, gestione [Agentes de codificación](../06_CodingAgents/_Index.md), la autenticación de sesiones, túneles de [Cloudflare](https://www.cloudflare.com) y las [Verificaciones](01_Setup.md#verifications) integradas.
- [Configuración de proyectos](02_Projects.md) — Registre repositorios de [Git](https://git-scm.com), configure muestras de color visuales, flujos de verificación, acciones de revisión, asignaciones de puertos, aislamiento en contenedores de [Docker](https://www.docker.com), servidores [MCP](../09_Advanced/03_MCP.md) y aislamiento mediante [worktrees de Git](02_Projects.md#repositories--git-worktrees).

Para conocer los conceptos básicos sobre cómo funcionan los planes y los promptwares, consulte [Planes](../02_Concepts/01_Plans.md), [Promptwares](../02_Concepts/02_Promptwares.md) y el [Ciclo de vida del plan](../02_Concepts/03_Lifecycle.md).
