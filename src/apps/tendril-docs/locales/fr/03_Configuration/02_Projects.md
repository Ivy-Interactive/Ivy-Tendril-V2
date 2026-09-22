---
title: Configuration de projets
description: Chaque projet est un dépôt git avec ses propres vérifications et son contexte d'agent. Tendril exécute plusieurs projets en parallèle.
icon: FolderGit
searchHints:
  - projet
  - repo
  - dépôt
  - multi-projet
  - isolation
  - worktree
  - danger zone
  - mcp
  - sandboxing
---

# Configuration de projets

Tendril prend en charge la gestion de plusieurs projets en parallèle. Chaque projet définit ses propres dépôts [Git](https://git-scm.com), barrières de vérification, allocations de ports, variables d'environnement, bacs à sable de sécurité et compétences personnalisées.

## Ajouter et gérer des projets

Les projets peuvent être configurés visuellement via **Paramètres > Projets** ou en les déclarant dans `$TENDRIL_HOME/config.yaml` (voir [Configuration et paramètres](01_Setup.md)) :

- **Assistant d'ajout de projet** — Cliquez sur **Add Project** dans la barre latérale des paramètres pour enregistrer un projet avec son chemin de dépôt, sa couleur initiale et ses barrières de vérification par défaut.
- **Renommage en ligne** — Cliquez sur l'icône de crayon d'édition à côté du nom du projet dans l'en-tête pour le renommer. Tendril s'assure qu'il n'y a pas de doublons parmi les projets voisins et met à jour automatiquement les enregistrements de plans associés.
- **Sélecteur de pastilles de couleur** — Choisissez une couleur d'accentuation dans la grille de 32 pastilles de la palette de couleurs d'Ivy (`ColorSwatchField`). Cette couleur distingue le projet sur le [Dashboard](../04_Apps/01_Dashboard.md), la file d'attente des [Plans](../04_Apps/03_Plans.md), la file d'attente de [Review](../04_Apps/02_Review.md) et le suivi des [Pull Requests](../04_Apps/06_PullRequests.md).
- **Contexte** — Instructions au format Markdown décrivant la terminologie du domaine, les contraintes architecturales et les normes de codage. Ce contexte est ajouté en préfixe aux instructions de promptware pour toutes les exécutions d'agents sur le projet.

### Exemple `config.yaml`

```yaml
projects:
  - name: Global Engine
    color: Emerald
    context: |
      Core engine services written in Rust with a TypeScript CLI.
      Follow standard Ivy design tokens and ensure all tests pass.
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: Lint
        required: true
      - name: CheckResult
        required: true
    reviewActions:
      - name: Run E2E
        command: pnpm test:e2e
        condition: "${hasChanges}"
    ports:
      backend:
        defaultPort: 8080
        description: API gateway service
    envFiles:
      - path: .env
        template: .env.example
        overrides:
          PORT: "${ports.backend}"
          DATABASE_URL: "sqlite://${env.TENDRIL_HOME}/dev.db"
    wireframes: true
    wireframeGuard: true
    sandboxMode: Off
    securityPreset: Standard
```

## Dépôts et worktrees Git

Les projets Tendril associent un ou plusieurs dépôts [Git](https://git-scm.com) (`repos:`).

Lorsqu'un agent exécute un plan via `ExecutePlan`, il isole la génération de code de votre environnement de développement local :

- **Worktrees Git dédiés** — Tendril crée une branche de worktree Git isolée (`tendril/<planId>-<slug>`) issue de votre branche cible. Votre arbre de travail, votre branche et votre IDE restent intacts.
- **Exécution simultanée** — Plusieurs plans peuvent s'exécuter simultanément sur différents dépôts sans conflit de verrouillage Git.
- **Échec et abandon sécurisés** — Les exécutions échouées ou rejetées peuvent être supprimées proprement sans nécessiter de nettoyage manuel de Git.
- **Worktree Reaper** — Un nettoyage automatique en arrière-plan supprime les worktrees inactifs ou terminés conformément aux paramètres `worktreeReaperInterval` et `worktreeReaperGrace` de [Configuration et paramètres](01_Setup.md).

## Pipelines de vérification

Les projets définissent une séquence ordonnée de barrières de vérification que les agents doivent franchir avant que le travail n'arrive dans [Review](../04_Apps/02_Review.md) :

- **Ordre modifiable** — Glissez-déposez les étapes de vérification selon la séquence d'exécution souhaitée (`SortableVerificationList`).
- **Barrières obligatoires** — Marquez les vérifications comme obligatoires. Un plan ne s'affiche comme `Verified` dans [Review](../04_Apps/02_Review.md) que si toutes les vérifications obligatoires réussissent.
- **Vérifications personnalisées** — Ajoutez des commandes spécifiques au projet et des prompts de vérification personnalisés (par ex. `cargo clippy`, `pnpm check`, `pytest`). Consultez [Vérification via le CLI](../09_Advanced/01_CLI/03_Verification.md) pour la gestion en ligne de commande.

## Actions de révision

Définissez des boutons d'action en un clic affichés dans la barre d'outils de l'application [Review](../04_Apps/02_Review.md) (`reviewActions:`) :

- `name` — Libellé de l'action affiché sur le bouton de la barre d'outils.
- `command` — Commande shell exécutée dans le worktree du plan.
- `condition` — Condition d'exécution facultative (telle que `${hasChanges}`).

## Ports et fichiers d'environnement

Les projets complexes nécessitent souvent des configurations de ports et d'environnement isolées :

- **Allocations de ports (`ports:`)** — Déclarez des ports nommés (par exemple `backend`, `frontend`). Si le port par défaut est déjà utilisé, Tendril attribue un port disponible et l'expose via les variables de substitution `${ports.<nom>}`.
- **Fichiers d'environnement (`envFiles:`)** — Recréez automatiquement des fichiers `.env` dans les worktrees d'agents à partir d'un modèle de base (par exemple `.env.example`) et de surcharges clé/valeur ligne par ligne prenant en charge les variables `${ports.<nom>}`, `${env.<VAR>}` et `%VAR%`.

## Sécurité et sandboxing des agents

Tendril offre des contrôles de sécurité précis au niveau du projet :

- **Profils de sécurité** — Sélectionnez `Strict`, `Standard`, `Permissive` ou `Custom`. Les profils configurent les règles d'accès aux fichiers et de sandboxing par défaut.
- **Mode Sandbox** — Choisissez l'isolation d'exécution : `Off`, [Docker](https://www.docker.com) ou [Bubblewrap](https://github.com/containers/bubblewrap).
- **Accès aux fichiers externes** — Déterminez si les agents peuvent lire des fichiers situés en dehors de l'arborescence du dépôt (`Deny`, `ReadOnly`, `Full`).
- **Exécution automatique dans le terminal** — Choisissez si les agents exécutent les commandes shell automatiquement (`AllowAll`), demandent confirmation (`RequireConfirmation`) ou refusent toute commande (`DenyAll`).
- **Autorisations de fichiers** — Configurez des règles de chemins détaillées : `Allow <chemin>`, `Ask <chemin>` ou `Deny <chemin>`.
- **Maquettes et Wireframe Guard** — Activez `wireframes` pour autoriser la génération de prototypes d'interface dans les plans, et activez `wireframeGuard` pour vérifier que le code temporaire de maquette est validé avant d'atterrir dans les pull requests de production.

## Serveurs MCP et compétences du projet

Étendez les capacités des agents pour un projet spécifique :

- **Serveurs MCP (`mcpServers:`)** — Enregistrez des serveurs [Model Context Protocol](https://modelcontextprotocol.io) délimités au projet avec des exécutables, des arguments et des variables d'environnement personnalisés. Voir [Intégration MCP](../09_Advanced/03_MCP.md).
- **Compétences (`skills:`)** — Équipez les agents de procédures et d'instructions Markdown spécifiques au projet. Voir [Guide des compétences](../06_CodingAgents/00_Skills.md).

## Contexte local au dépôt

Tendril détecte et ajoute automatiquement la documentation de la racine du dépôt au contexte du promptware :

- **`CLAUDE.md`** — Conseils et conventions pour Claude Code. Voir [Guide Claude Code](../06_CodingAgents/01_ClaudeCode.md).
- **`AGENTS.md` / `DEVELOPER.md`** — Normes de développement de l'équipe, exigences de test et conventions du code source.

## Zone de danger : Retirer ou Supprimer

Les paramètres du projet se terminent par deux options de destruction distinctes dans la Zone de danger :

```
[ Remove Project ]  (Contour)
Supprime le projet de config.yaml. Les dépôts clonés, les dossiers de plans et
l'historique sont conservés sur le disque ; réajouter le projet par son nom le restaure.

[ Delete Project ]  (Destructif)
Supprime définitivement les plans du projet, ses dépôts clonés sous
<TENDRIL_HOME>/Projects/, ses lignes de base de données et son entrée de configuration.
Cette action est irréversible et vous demande de saisir d'abord le nom du projet.
```

> [!WARNING]
> **Remove Project** désenregistre uniquement le projet de la configuration tout en conservant les fichiers intacts sur le disque. **Delete Project** efface définitivement les dépôts, les plans et les enregistrements de la base de données, nécessitant de saisir le nom exact du projet pour confirmer.
