---
title: Bienvenue sur Ivy Tendril
description: >-
  Tendril est une application de bureau open source et local-first servant de système d'exploitation pour le développement logiciel piloté par l'IA — orchestrant des agents de programmation comme Claude Code, Codex, Copilot, Gemini, OpenCode, Antigravity, Cursor et Apple Foundation Models à travers un cycle de vie structuré, de l'idée jusqu'à la pull request fusionnée.
icon: Rocket
searchHints:
  - aperçu
  - qu'est-ce que tendril
  - orchestration d'agents
  - architecture
  - tauri
  - démon
---

# Bienvenue sur Ivy Tendril

[![Ivy Tendril en deux minutes : regarder sur YouTube](../assets/yt-thumbnail-in-two-minutes-2.png)](https://youtu.be/_KVG1NnAj-8)

## Le concept

Dans Tendril, le travail est organisé en [**plans**](../02_Concepts/01_Plans.md) — des unités de travail structurées et examinables.
Au lieu d'une boîte noire opaque qui produit du code non inspecté, Tendril fait progresser votre plan à travers un
[cycle de vie](../02_Concepts/03_Lifecycle.md) défini en utilisant des [**promptwares**](../02_Concepts/02_Promptwares.md) :
des agents de flux de travail isolés et spécialisés dans une seule étape. Qu'il s'agisse de rédiger le plan,
d'implémenter des modifications dans des arbres de travail (worktrees) parallèles, d'exécuter des étapes de vérification ou d'ouvrir des pull requests, vous conservez
une visibilité totale. Tendril ne se contente pas d'autocompléter des lignes dans votre éditeur ; il orchestre l'ensemble de votre flux de développement
autonome.

## Fonctionnalités clés

- **Arbres de travail parallèles (Parallel worktrees)** — chaque agent opère dans un [Git worktree](https://git-scm.com/docs/git-worktree) isolé,
  permettant à plusieurs plans de s'exécuter simultanément sans contamination de branche ni conflit dans l'arbre de travail.
- **Tunnels pour le travail distant et mobile** — exposez le démon local en toute sécurité via
  [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
  afin d'inspecter l'avancement et de piloter les agents en cours d'exécution depuis votre téléphone ou un navigateur distant.
- **Entrée vocale et contenu enrichi** — dictez vos exigences grâce à la transcription intégrée d'[OpenAI Whisper](https://github.com/openai/whisper),
  ou glissez-déposez des journaux de terminal, des spécifications Markdown et des maquettes de conception en guise de contexte.
- **Annotations sur les plans** — annotez directement un brouillon de plan ; Tendril transmet vos notes à
  [UpdatePlan](../02_Concepts/02_Promptwares.md) pour ajuster et affiner la spécification.
- **Revues de code avec barrières de vérification** — examinez les diffs git, consultez les résultats des tests automatisés (`Cargo`,
  `pnpm`, linters, formatage) et n'approuvez que les modifications vérifiées.
- **Ingestion GitHub et boîte de réception** — convertissez automatiquement les tickets [GitHub](https://github.com) et les rapports de bogue
  [Jam.dev](https://jam.dev) en plans grâce à des webhooks.

## Architecture

Tendril est constitué de trois composants fondamentaux exécutés localement sur votre machine :

- Une **application de bureau** construite avec [Tauri 2](https://tauri.app) — une enveloppe native haute performance
  hébergeant une interface [React](https://react.dev).
- Un **démon serveur** développé en [Rust](https://www.rust-lang.org) (`tendril run` / `tendril serve`),
  qui expose une API REST et WebSocket. L'application de bureau lance et surveille automatiquement le démon
  en arrière-plan.
- Une **interface en ligne de commande (CLI)** (`tendril`) qui se connecte au même démon et partage le même magasin de données. Tout ce qui est
  contrôlable depuis l'application de bureau peut être exécuté en ligne de commande.

L'état est conservé entièrement en local :

- Une base de données locale [SQLite](https://www.sqlite.org) située à `$TENDRIL_HOME/tendril.db` enregistre les jobs, les coûts et
  la télémétrie.
- Un stockage sur le système de fichiers standard sous `$TENDRIL_HOME/Plans/` conserve les fichiers de plans, les révisions, les annotations, les journaux et
  les rapports de vérification sous forme de documents YAML et Markdown transparents.

> [!NOTE]
> `$TENDRIL_HOME` est défini par défaut sur `~/.tendril`. Consultez [Installation](02_Installation.md) pour la configuration d'un chemin personnalisé.

Votre code source ne quitte jamais votre machine locale. Le seul trafic réseau sortant correspond aux requêtes API directes de votre agent de programmation
configuré (vers Anthropic, OpenAI ou Google, par exemple) et aux tunnels Cloudflare optionnels que vous
activez explicitement.

Les agents de programmation pris en charge incluent :

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models (`apple` via `fm` sur l'appareil)

## Pourquoi Tendril ?

Chez [Ivy Interactive](https://ivy.app), nous avons testé de nombreuses architectures multi-agents dédiées au codage autonome.
Bien que les agents CLI individuels soient performants, la gestion d'une dizaine d'onglets de terminal et la revue de diffs
non suivis sont vite devenues ingérables.

Tendril apporte de la structure à l'ingénierie agentique. Grâce à notre architecture de [promptware](../02_Concepts/02_Promptwares.md),
les agents de flux de travail accumulent une mémoire propre au projet au fil des exécutions, apprenant les conventions de la base de code et
évitant ainsi les échecs récurrents. En articulant l'ensemble du flux de travail autour de [plans](../02_Concepts/01_Plans.md) pérennes,
les développeurs conservent la maîtrise des revues tandis que les agents autonomes prennent en charge
les tâches lourdes d'implémentation.

> [!TIP]
> Vos retours nous sont précieux. Signalez les bogues et suggérez des fonctionnalités sur le
> [dépôt GitHub](https://github.com/Ivy-Interactive/Ivy-Tendril-V2). Pour toute question ou échange, rejoignez notre
> communauté sur [Discord](https://discord.gg/FHgxkDga3y).

## Prochaines étapes

- [Installation](02_Installation.md) — compiler et installer l'application de bureau et la CLI.
- [Concepts](../02_Concepts/_Index.md) — découvrir les plans, les promptwares et le cycle de vie des jobs.
