---
title: Configuração
description: Configure as definições do Tendril, variáveis de ambiente, opções
  do daemon e perfis de projeto.
icon: Settings
groupExpanded: true
searchHints:
  - configuração
  - definições
  - opções
  - preferências
  - ambiente
---

# Configuração

O Tendril armazena suas configurações, projetos e preferências de execução em um arquivo de configuração [YAML](https://yaml.org) centralizado localizado em `$TENDRIL_HOME/config.yaml`.

Esta seção aborda a configuração do ambiente global do Tendril, o gerenciamento de [Configuração de Projetos](02_Projects.md), o ajuste das opções do daemon e a definição de perfis de [Agentes de Codificação](../06_CodingAgents/_Index.md):

- [Instalação e Configurações](01_Setup.md) — Configure opções globais na interface de Configurações ou em `$TENDRIL_HOME/config.yaml`, gerencie [Agentes de Codificação](../06_CodingAgents/_Index.md), autenticação de sessão, túneis do [Cloudflare](https://www.cloudflare.com) e [Verificações](01_Setup.md#verifications) integradas.
- [Configuração de Projetos](02_Projects.md) — Registre repositórios [Git](https://git-scm.com), configure paletas visuais de cores, pipelines de verificação, ações de revisão, alocações de portas, sandboxing com [Docker](https://www.docker.com), servidores [MCP](../09_Advanced/03_MCP.md) e isolamento via [Git worktree](02_Projects.md#repositories--git-worktrees).

Para obter uma base conceitual sobre como planos e promptwares funcionam, consulte [Planos](../02_Concepts/01_Plans.md), [Promptwares](../02_Concepts/02_Promptwares.md) e [Ciclo de Vida do Plano](../02_Concepts/03_Lifecycle.md).
