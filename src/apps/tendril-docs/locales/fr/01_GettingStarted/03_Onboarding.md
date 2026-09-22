---
title: Intégration d'une base de code
description: >-
  Une liste de contrôle pour préparer votre machine de développement et votre dépôt afin que Tendril puisse planifier, exécuter, vérifier
  et livrer des modifications de manière autonome.
icon: ClipboardCheck
searchHints:
  - intégration
  - liste de contrôle
  - préparer
  - machine de dév
  - environnement
  - worktree
  - AGENTS.md
  - gh
  - mcp
---

# Intégration d'une base de code

Tendril exécute un agent de programmation sur votre dépôt au sein d'un
[Git worktree](https://git-scm.com/docs/git-worktree) isolé, puis compile, teste et ouvre une pull request.
Pour que cette boucle aboutisse sans intervention humaine, la machine et le dépôt doivent être configurés
au préalable. Parcourez la liste de contrôle ci-dessous une fois par machine et une fois par base de code.

> [!TIP]
> Une fois terminé, lancez `tendril doctor`. Cela vérifie le répertoire personnel de Tendril, `config.yaml`, la base de données,
> le dossier des plans, `git` et `gh`. Cela ne teste **pas** votre agent de programmation — vérifiez-le vous-même
> à l'étape 2 ci-dessous.

## Liste de contrôle de la machine

### 1. Les logiciels de compilation requis sont installés

Chaque outil nécessaire à la compilation du projet doit être installé et accessible dans votre `PATH`. L'agent ne peut pas
installer un compilateur ou un SDK manquant en cours d'exécution. Pour un dépôt Rust et pnpm tel que celui de Tendril, cela implique
[Rustup](https://rustup.rs/), [Node.js](https://nodejs.org/) et [pnpm](https://pnpm.io/) ; pour votre
projet, cela correspond à toute la chaîne d'outils invoquée par vos scripts.

> [!NOTE]
> L'exigence cible : un clone vierge doit pouvoir compiler depuis un terminal propre à l'aide des commandes documentées, sans
> invite interactive ni étape manuelle spécifique à un IDE.

### 2. La CLI de programmation préférée est installée et authentifiée

Installez l'agent défini comme `codingAgent` dans `config.yaml` et connectez-vous afin qu'il s'exécute de façon non interactive :

```bash
# Exemple : Claude Code
npm install -g @anthropic-ai/claude-code
claude login
```

Vérifiez que la CLI est présente dans le `PATH` et qu'un appel simple ne s'interrompt pas pour demander des identifiants :

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor` / `cursor-agent`)
- Apple Foundation Models (`apple` via `fm` sur l'appareil)

L'agent `apple` fait exception : il s'exécute via l'OpenCode intégré en interrogeant le modèle sur l'appareil d'Apple ;
assurez-vous donc que `fm` est installé (vérifiez avec `fm available`) et qu'un processus `fm serve` est déjà à l'écoute.

### 3. Git est installé et configuré pour une utilisation autonome

Tendril extrait le code, crée des worktrees, effectue des commits et pousse en votre nom. Vérifiez que toutes les opérations fonctionnent
sans invite interactive :

- Une identité globale est configurée (`git config --global user.name` et `user.email`).
- Les identifiants sont mis en cache via un assistant d'authentification (credential helper) ou une clé SSH chargée dans un agent, de sorte que `git pull` et
  `git push` ne demandent jamais de mot de passe.
- Les worktrees peuvent être créés et nettoyés (`git worktree add` et `git worktree remove`).

> [!WARNING]
> Si pousser via HTTPS demande des identifiants, configurez un assistant de stockage ou utilisez une clé SSH avec un
> `ssh-agent` actif. Une simple invite interactive bloquera un job qui devrait s'exécuter en toute autonomie.

### 4. La CLI GitHub est installée et authentifiée

[CreatePr](../02_Concepts/02_Promptwares.md) utilise la [CLI GitHub](https://cli.github.com/)
(`gh`) pour ouvrir des pull requests. Installez-la et confirmez l'authentification :

```bash
gh auth login
gh auth status
```

### 5. Les serveurs MCP requis sont installés globalement

Si vous utilisez des serveurs [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) — tels que Jira
pour le contexte des tickets ou Figma pour les maquettes —, installez-les et déclarez-les globalement afin que chaque worktree puisse y
accéder. Les serveurs MCP sont enregistrés sur l'agent de programmation, et non dans Tendril :

```bash
# Exemple : enregistrer un serveur MCP globalement pour Claude Code
claude mcp add --scope user jira -- npx -y @your-org/jira-mcp
claude mcp add --scope user figma -- npx -y figma-developer-mcp
claude mcp list   # vérifier qu'ils sont joignables
```

> [!NOTE]
> Utilisez la portée globale (global ou user), et non celle du projet, afin que les serveurs MCP persistent au-delà des worktrees git
> éphémères dans lesquels travaille l'agent. Stockez les jetons d'API requis sous forme de variables d'environnement sur votre système.

Assurez-vous d'être effectivement _authentifié_ auprès de chaque serveur MCP, et non simplement de l'avoir enregistré. Lancez un
petit plan de test depuis Tendril et confirmez que chaque serveur s'initialise sans déclencher de fenêtre OAuth.

## Liste de contrôle du dépôt

### 6. Le dépôt est compatible avec les worktrees

[ExecutePlan](../02_Concepts/02_Promptwares.md) tourne au sein d'un
[Git worktree](https://git-scm.com/docs/git-worktree) isolé, et non dans votre répertoire de travail courant. Un worktree démarre
à partir d'un commit propre : aucun dossier `target/`, `node_modules/` ni fichier `.env` non suivi n'y figure.

- Documentez toute commande de préparation requise après extraction avant que le code ne compile (ex. restauration des dépendances,
  génération de code, copie de modèles `.env`), et fournissez un script de configuration versionné dans git.
- Ne dépendez pas de fichiers non versionnés présents uniquement dans votre clone principal.
- Utilisez un gestionnaire de paquets doté d'un cache centralisé pour que chaque worktree soit restauré en quelques secondes plutôt que
  de retélécharger les paquets (ex. le store pnpm, le cache du registre Cargo ou le cache des modules Go).

> [!TIP]
> Test rapide : exécutez `git worktree add ../repo-probe`, puis lancez vos commandes de build documentées dans ce
> répertoire depuis un terminal propre. Si le projet compile et passe les tests, Tendril réussira également. Nettoyez-le avec
> `git worktree remove ../repo-probe`.

### 7. Rédigez un script de lancement pour chaque application

Fournissez un petit script de démarrage versionné pour chaque application du dépôt avec des ports configurables.
Tendril pouvant exécuter des plans en parallèle sur plusieurs worktrees, des ports codés en dur provoqueraient des conflits.

Pour un front-end [Vite](https://vite.dev) couplé à une API Python, le script pourrait ressembler à ceci :

```bash
#!/usr/bin/env bash
# run.sh - démarre l'API backend Python et le frontend Vite
set -euo pipefail

api_port="${API_PORT:-8000}"
web_port="${WEB_PORT:-5173}"

cd "$(dirname "$0")"

# Backend : configurer l'environnement virtuel et installer les dépendances
python -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt

# Démarrer l'API backend sur son port dédié
uvicorn app.main:app --port "$api_port" &
api_pid=$!

# Arrêter le backend à la fermeture du processus frontend
trap 'kill "$api_pid" 2>/dev/null' EXIT

# Frontend : installer les dépendances et démarrer le serveur de développement Vite
npm --prefix web install --prefer-offline --no-audit
npm --prefix web run dev -- --port "$web_port" --open
```

> [!NOTE]
> Conserver les commandes de démarrage dans un script versionné garantit que les développeurs et les agents de flux
> de travail autonomes lancent l'application de façon rigoureusement identique.

### 8. Ajoutez un AGENTS.md (ou README.md) à la racine du dépôt

Fournissez aux agents de flux de travail le contexte indispensable pour s'orienter dans la base de code sans incertitude :

- **Prérequis** nécessaires pour compiler et exécuter le code.
- **Plan d'architecture** détaillant les applications, bibliothèques et protocoles de communication.
- **Commandes de compilation et de test** pour vérifier le dépôt.
- **Scripts de lancement** pointant vers les scripts de démarrage de l'étape précédente.

## Prochaines étapes

- Suivez la boucle de bout en bout dans le [Tutoriel](04_Tutorial.md).
- Explorez les [Concepts : Plans](../02_Concepts/01_Plans.md) et les [Promptwares](../02_Concepts/02_Promptwares.md).
- Comprenez le [Cycle de vie des jobs](../02_Concepts/03_Lifecycle.md).
