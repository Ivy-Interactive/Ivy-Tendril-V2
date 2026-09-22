---
title: Bem-vindo ao Ivy Tendril
description: O Tendril é um aplicativo desktop local-first e de código aberto
  que serve como o sistema operacional para o desenvolvimento de software
  impulsionado por IA — orquestrando agentes de código como Claude Code, Codex,
  Copilot, Gemini, OpenCode, Antigravity, Cursor e Apple Foundation Models por
  meio de um ciclo de vida estruturado, desde a ideia até o pull request
  mesclado.
icon: Rocket
searchHints:
  - visão geral
  - o que é o tendril
  - orquestração de agentes
  - arquitetura
  - tauri
  - daemon
---

# Bem-vindo ao Ivy Tendril

[![Ivy Tendril em dois minutos: assista no YouTube](../assets/yt-thumbnail-in-two-minutes-2.png)](https://youtu.be/_KVG1NnAj-8)

## O Conceito

No Tendril, o trabalho é organizado em [**planos**](../02_Concepts/01_Plans.md) — unidades de trabalho estruturadas e revisáveis.
Em vez de uma caixa-preta opaca que produz código não inspecionado, o Tendril conduz seu plano por um
[ciclo de vida](../02_Concepts/03_Lifecycle.md) definido usando [**promptwares**](../02_Concepts/02_Promptwares.md):
agentes de fluxo de trabalho isolados e de propósito único especializados em uma etapa. Seja redigindo o plano,
implementando alterações em worktrees paralelas, executando verificações de qualidade ou abrindo pull requests, você mantém
visibilidade total. O Tendril não apenas autocompleta linhas no seu editor; ele orquestra todo o seu fluxo de desenvolvimento
autônomo.

## Principais Recursos

- **Worktrees paralelas** — cada agente opera em uma [Git worktree](https://git-scm.com/docs/git-worktree) isolada,
  permitindo que múltiplos planos sejam executados concorrentemente sem contaminação de branches ou conflitos na árvore de trabalho.
- **Túneis para trabalho remoto e móvel** — exponha o daemon local com segurança por meio de
  [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
  para inspecionar o progresso e direcionar agentes em execução diretamente do seu celular ou navegador remoto.
- **Voz e entrada avançada** — dite requisitos com a transcrição integrada do [OpenAI Whisper](https://github.com/openai/whisper)
  ou envie logs de terminal, especificações em markdown e arquivos de design como contexto.
- **Anotações de plano** — comente diretamente em uma versão preliminar do plano; o Tendril envia suas notas diretamente para o
  [UpdatePlan](../02_Concepts/02_Promptwares.md) para revisar a especificação.
- **Revisões de código com verificações de qualidade** — inspecione diffs do git, analise resultados de testes automatizados (`Cargo`,
  `pnpm`, linters, formatação) e aprove apenas alterações verificadas.
- **Ingestão do GitHub e caixa de entrada** — converta issues do [GitHub](https://github.com) e relatórios de bugs do
  [Jam.dev](https://jam.dev) em planos automaticamente por meio de webhooks.

## Arquitetura

O Tendril consiste em três componentes centrais executados localmente na sua máquina:

- Um **aplicativo desktop** construído com [Tauri 2](https://tauri.app) — uma estrutura desktop nativa de alto desempenho
  que abriga uma interface em [React](https://react.dev).
- Um **daemon de servidor** escrito em [Rust](https://www.rust-lang.org) (`tendril run` / `tendril serve`),
  expondo uma API REST e WebSocket. O aplicativo desktop inicializa e supervisiona o daemon automaticamente em
  segundo plano.
- Uma **CLI** (`tendril`) que se conecta ao mesmo daemon e compartilha o mesmo armazenamento de dados. Qualquer operação
  controlável a partir do aplicativo desktop pode ser executada via linha de comando.

O estado é mantido inteiramente local:

- Um banco de dados [SQLite](https://www.sqlite.org) local em `$TENDRIL_HOME/tendril.db` registra tarefas, custos e
  telemetria.
- O armazenamento comum no sistema de arquivos em `$TENDRIL_HOME/Plans/` armazena arquivos de plano, revisões, anotações, logs e
  relatórios de verificação como documentos transparentes em YAML e Markdown.

> [!NOTE]
> `$TENDRIL_HOME` tem como padrão `~/.tendril`. Consulte [Instalação](02_Installation.md) para configuração de caminho personalizado.

Seu código-fonte nunca sai da sua máquina local. O único tráfego de rede de saída são as requisições diretas à API do agente de
código configurado (por exemplo, para a Anthropic, OpenAI ou Google) e os túneis opcionais da Cloudflare que
você iniciar explicitamente.

Os agentes de código suportados incluem:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models (`apple` via `fm` no dispositivo)

## Por que o Tendril?

Na [Ivy Interactive](https://ivy.app), testamos diversas arquiteturas multiagente para programação autônoma.
Embora agentes de CLI individuais fossem poderosos, gerenciar dezenas de abas no terminal e revisar diffs
não rastreados rapidamente se tornou inviável.

O Tendril traz estrutura para a engenharia baseada em agentes. Por meio da nossa arquitetura de [promptware](../02_Concepts/02_Promptwares.md),
os agentes de fluxo de trabalho acumulam memória específica do projeto ao longo das execuções, aprendendo os padrões da base de código e
prevenindo falhas repetidas. Ao centralizar todo o fluxo de trabalho em torno de [planos](../02_Concepts/01_Plans.md) duráveis,
os desenvolvedores humanos mantêm o controle de revisão enquanto os agentes autônomos realizam o trabalho pesado de implementação.

> [!TIP]
> Adoramos receber seu feedback. Relate problemas e sugira novos recursos no
> [repositório do GitHub](https://github.com/Ivy-Interactive/Ivy-Tendril-V2). Para suporte ou discussões, participe da nossa
> comunidade no [Discord](https://discord.gg/FHgxkDga3y).

## Próximos passos

- [Instalação](02_Installation.md) — compile e instale o aplicativo desktop e a CLI.
- [Conceitos](../02_Concepts/_Index.md) — aprofunde-se em planos, promptwares e no ciclo de vida das tarefas.
