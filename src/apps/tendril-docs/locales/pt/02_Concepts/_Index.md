---
title: Conceitos
description: As três ideias sobre as quais o restante do Tendril é construído —
  planos, promptwares e trabalhos.
icon: Layers
groupExpanded: true
searchHints:
  - conceitos
  - modelo
  - arquitetura
  - plano
  - promptware
  - trabalho
---

# Conceitos

O Tendril possui um modelo conceitual conciso, e tudo no aplicativo desktop e na CLI mapeia para uma destas três primitivas fundamentais:

- [Planos](01_Plans.md) — a unidade fundamental de trabalho. Um plano é uma pasta transparente no disco, uma máquina de estados, um conjunto imutável de revisões, anotações inline e verificações automatizadas.
- [Promptwares](02_Promptwares.md) — os agentes de fluxo de trabalho de propósito único que movem um plano de um estado para o próximo, cada um com seu próprio prompt de sistema, concessões limitadas de ferramentas e memória de longo prazo.
- [Ciclo de Vida e Trabalhos](03_Lifecycle.md) — uma execução de um promptware em relação a um plano constitui um trabalho: status, telemetria, git worktrees isolados, rastreamento de custos e portões de qualidade que determinam se o trabalho avança para revisão.

Se você ainda não executou o loop, o [Tutorial](../01_GettingStarted/04_Tutorial.md) demonstra essas primitivas em ação. Você também pode consultar [Integrando uma Base de Código](../01_GettingStarted/03_Onboarding.md) para preparar seus repositórios para worktrees paralelos.
