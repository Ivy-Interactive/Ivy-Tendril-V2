---
title: Installation
description: Installez Tendril via des binaires précompilés ou compilez-le depuis les sources, lancez l'application de bureau et la CLI, et configurez votre environnement.
icon: Download
searchHints:
  - installer
  - binaires précompilés
  - compiler depuis les sources
  - prérequis
  - cargo
  - pnpm
  - tendril home
  - config.yaml
  - mettre à jour
---

# Installation

Tendril peut être installé à l'aide de paquets de bureau précompilés et de binaires CLI, ou compilé localement depuis les sources.

## Installation rapide

Téléchargez directement les installateurs de bureau autonomes (`.dmg`, `.pkg`, `.exe`, `.AppImage`, `.deb`) depuis
les [GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) ou exécutez l'un des
scripts d'installation automatisés :

**macOS / Linux :**

```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows (PowerShell) :**

```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

L'installateur place le binaire CLI `tendril` dans votre `PATH` et enregistre l'application de bureau dans le menu
de votre système.

## Prérequis (pour la compilation depuis les sources)

Si vous compilez depuis les sources, assurez-vous que ces dépendances sont installées et accessibles dans votre `PATH` :

| Outil                                        | Version              | Rôle                                                                                          |
| -------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| [Rust](https://www.rust-lang.org/)           | 1.80+ (édition 2021) | Compile la CLI native, le démon serveur et le cœur (core).                                    |
| [Node.js](https://nodejs.org/)               | 22 ou plus récent    | Alimente l'outillage front-end et les scripts de build.                                       |
| [pnpm](https://pnpm.io/)                     | 11 ou plus récent    | Gère les paquets de l'espace de travail et les dépendances.                                   |
| [Vite+](https://viteplus.dev/) (`vp`)        | actuelle             | Orchestre la compilation, le linting, le formatage et les tests.                              |
| [Git](https://git-scm.com/)                  | 2.30+                | Gère les [git worktrees](https://git-scm.com/docs/git-worktree), les commits et les branches. |
| [GitHub CLI](https://cli.github.com/) (`gh`) | authentifié          | Ouvre des pull requests et gère automatiquement les tickets (issues).                         |

Vous aurez également besoin d'au moins une CLI d'agent de programmation authentifiée (ex. [Claude Code](https://code.claude.com/docs),
[GitHub Copilot](https://github.com/features/copilot), [Gemini](https://ai.google.dev),
[OpenCode](https://opencode.ai), [Antigravity](https://github.com/google-deepmind) ou
[Cursor](https://www.cursor.com)). [Intégration d'une base de code](03_Onboarding.md) détaille la configuration des agents.

## Compilation depuis les sources

Clonez le dépôt et installez les dépendances de l'espace de travail :

```bash
git clone https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git
cd Ivy-Tendril-V2

pnpm install
pnpm --filter @ivy-interactive/components build   # bibliothèque UI partagée, requise par l'application de bureau
node src/scripts/ensure-wireframe-payload.mjs      # prépare les ressources wireframe pour la compilation native
cargo build --workspace                            # compile tendril-core, tendril-server, tendril-cli
```

> [!NOTE]
> La bibliothèque `@ivy-interactive/components` et les données wireframe doivent être générées avant de compiler
> les crates natifs de l'espace de travail, car `tendril-app` et `tendril-wireframe` importent ces éléments lors de la compilation.

## Lancer l'application de bureau

Pour le développement local avec rechargement à chaud (hot module reloading) :

```bash
pnpm dev:desktop
```

Cette commande compile les binaires sidecar nécessaires et démarre Vite aux côtés de la fenêtre native
[Tauri 2](https://tauri.app). L'application de bureau gère automatiquement le démon en arrière-plan (`tendril run`).

### Créer un paquet autonome (release)

Pour générer un installateur autonome pour votre plateforme :

```bash
cargo build --release --bin tendril

# Préparez le binaire sidecar CLI natif pour votre architecture cible
triple=$(rustc -vV | sed -n 's/^host: //p')
mkdir -p src/apps/tendril-app/src-tauri/binaries
cp target/release/tendril "src/apps/tendril-app/src-tauri/binaries/tendril-$triple"

# Récupérez l'agent sidecar OpenCode intégré
./src/apps/tendril-app/scripts/release/fetch-opencode-sidecar.sh

# Construisez le paquet d'installation (DMG sur macOS, NSIS/MSI sur Windows, AppImage/deb sur Linux)
pnpm --filter @ivy-interactive/tendril-app exec tauri build
```

## Installer la CLI

Le binaire `tendril` sert à la fois d'interface en ligne de commande et de démon serveur :

```bash
cargo build --release --bin tendril
# ou installez-le directement dans ~/.cargo/bin :
cargo install --path src/crates/tendril-cli
```

Vérifiez votre installation grâce au diagnostic de santé :

```bash
tendril version
tendril doctor
```

`tendril doctor` vérifie `$TENDRIL_HOME`, la syntaxe de `config.yaml`, la base de données [SQLite](https://www.sqlite.org),
le dossier des plans ainsi que vos identifiants `git` et `gh`.

### Exécuter le démon sans interface (headless)

Pour faire tourner Tendril comme démon serveur autonome sans l'interface graphique :

```bash
# Recommandé : vérifie la disponibilité du port et applique les migrations en attente
tendril run

# Ou écouteur direct (supporte --tls-cert et --tls-key) :
tendril serve --host 127.0.0.1 --port 5010
```

> [!NOTE]
> Le serveur écoute par défaut sur `127.0.0.1:5010`, exposant des points d'accès REST et WebSocket. Il ne sert
> pas d'interface web statique ; interagissez avec lui via l'application de bureau ou la CLI.

## Configuration et arborescence des dossiers

Tout l'état d'exécution de Tendril est stocké dans `$TENDRIL_HOME`, déterminé selon l'ordre de priorité suivant :

1. La variable d'environnement `TENDRIL_HOME` ;
2. Le chemin inscrit dans `~/.tendril_location` (s'il existe) ;
3. L'emplacement par défaut de l'utilisateur : `~/.tendril`.

À l'intérieur de `$TENDRIL_HOME` :

```
~/.tendril/
├── config.yaml     # agent de programmation, projets, vérifications, surcharges promptwares
├── tendril.db      # base SQLite pour les jobs, les coûts et la télémétrie d'exécution
├── Plans/          # plans structurés et leurs worktrees git isolés
├── Jobs/           # journaux d'exécution, prompts d'agents et transcriptions brutes
└── Promptwares/    # définitions déployées des agents de flux de travail
```

Exemple minimal de `config.yaml` :

```yaml
codingAgent: claude
maxConcurrentJobs: 20

projects:
  - name: MyProject
    repos:
      - path: /Users/you/Repos/MyProject
    verifications:
      - name: NpmBuild
        required: true
      - name: CheckResult
        required: true
```

Déployez les promptwares standards pour initialiser les définitions des agents :

```bash
tendril promptware deploy
```

> [!WARNING]
> Assurez-vous que la CLI de l'agent de programmation choisi est bien authentifiée avant de lancer votre premier job. Si un agent s'arrête
> pour demander des identifiants dans un processus d'arrière-plan sans assistance, le job sera bloqué ou expirera.

## Mise à jour

En cas d'installation par script, réexécutez la commande en une ligne pour récupérer la dernière version.

Si vous travaillez depuis un dépôt cloné :

```bash
git pull
pnpm install
pnpm --filter @ivy-interactive/components build
node src/scripts/ensure-wireframe-payload.mjs
cargo build --workspace
```

## Prochaines étapes

- [Intégration d'une base de code](03_Onboarding.md) — configurer les prérequis du dépôt et vérifier l'accès des agents.
- [Concepts : Plans](../02_Concepts/01_Plans.md) — appréhender la structure des plans et les cycles de revue.
- [Dépannage](06_Troubleshooting.md) — solutions aux erreurs de compilation et d'exécution.
