---
title: Conceptos
description: Las tres ideas sobre las que se fundamenta Tendril — planes, promptwares y trabajos.
icon: Layers
groupExpanded: true
searchHints:
  - conceptos
  - modelo
  - arquitectura
  - plan
  - promptware
  - trabajo
---

# Conceptos

Tendril cuenta con un modelo conceptual conciso, y cada elemento de la aplicación de escritorio y de la CLI se corresponde con
una de estas tres primitivas fundamentales:

- [Planes](01_Plans.md) — la unidad básica de trabajo. Un plan es una carpeta transparente en disco, una máquina
  de estados, un conjunto inmutable de revisiones, anotaciones en línea y verificaciones automatizadas.
- [Promptwares](02_Promptwares.md) — agentes de flujo de trabajo especializados que mueven un plan de un estado
  al siguiente, cada uno con su propio prompt de sistema, permisos acotados de herramientas y memoria a largo plazo.
- [Ciclo de vida y trabajos](03_Lifecycle.md) — una ejecución de un promptware sobre un plan constituye un trabajo (job):
  estado, telemetría, worktrees de git aislados, seguimiento de costes y filtros de calidad que determinan si el trabajo
  avanza a revisión.

Si aún no has completado el ciclo, el [Tutorial](../01_GettingStarted/04_Tutorial.md) muestra estas
primitivas en acción. También puedes consultar [Incorporación de una base de código](../01_GettingStarted/03_Onboarding.md)
para preparar tus repositorios para worktrees paralelos.
