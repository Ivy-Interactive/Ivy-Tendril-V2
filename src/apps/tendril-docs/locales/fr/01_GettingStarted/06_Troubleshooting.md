---
title: Dépannage
description: >-
  Symptômes courants et méthodes de résolution. Si vous êtes toujours bloqué, exécutez `tendril doctor` et contactez-nous
  sur Discord.
icon: Wrench
searchHints:
  - dépannage
  - erreur
  - problème
  - symptôme
  - débogage
  - diagnostic
  - worktree obsolète
  - base de données
  - doctor
  - db
---

# Dépannage

Diagnostiquez et résolvez les incidents courants liés à la configuration, aux agents, aux plans et à la base de données.

## Installation et environnement

| Symptôme                                  | Solution                                                                                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENDRIL_HOME` introuvable                | Définissez la variable d'environnement et redémarrez votre terminal, ou écrivez le chemin dans `~/.tendril_location`. Sans cela, Tendril utilisera par défaut `~/.tendril`.                                                      |
| `config.yaml` introuvable                 | Le fichier doit obligatoirement se trouver dans `$TENDRIL_HOME/config.yaml` et porter ce nom exact (et non `tendril-config.yaml`). `tendril doctor` indique le chemin attendu.                                                   |
| `gh` non authentifié                      | Procédez à l'authentification de la [CLI GitHub](https://cli.github.com/) : `gh auth login`, puis `gh auth status` pour confirmer.                                                                                               |
| `git` introuvable                         | Installez [Git](https://git-scm.com/) et assurez-vous qu'il figure dans votre `PATH`.                                                                                                                                            |
| `tendril` non reconnu après compilation   | `cargo build --release` place le binaire dans `target/release/tendril`. Ajoutez ce chemin à votre `PATH` ou exécutez `cargo install --path src/crates/tendril-cli`.                                                              |
| L'application s'ouvre mais rien ne charge | L'application de bureau supervise le démon `tendril run` ; si les binaires sidecar sont absents d'un paquet compilé, aucun démon ne répond. Consultez [Installation](02_Installation.md) pour les étapes de création de paquets. |

## Plans

| Symptôme                                                | Solution                                                                                                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le plan reste bloqué en `Draft`                         | Vérifiez qu'un dépôt est bien associé via `tendril plan get <id>`, et assurez-vous que la définition du projet est présente dans `config.yaml`.                                                            |
| Le dossier du plan semble incomplet ou ne se charge pas | Lancez `tendril plan validate <id>` pour identifier le problème : `plan.yaml` invalide, dossier `Revisions/` manquant, titre vide ou incompatibilité de version de schéma.                                 |
| Plan utilisant un schéma obsolète                       | Exécutez `tendril plan doctor --fix` pour faire migrer les dossiers de plans vers le schéma actuel. Pour supprimer les coquilles de plans orphelines et vides, lancez `tendril plan doctor --prune-husks`. |
| Le plan n'a aucun dépôt configuré                       | Exécutez `tendril plan add-repo <id> <chemin>`.                                                                                                                                                            |
| Worktree résiduel après une exécution avortée           | Lancez `tendril plan cleanup <id>` pour purger les worktrees des plans terminés. Pour les plans qui ne sont pas dans un état final, ajoutez `--force` : `tendril plan cleanup <id> --force`.               |

## Exécution et agents

| Symptôme                                    | Solution                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent non joignable                         | Vérifiez la valeur de `codingAgent` dans `config.yaml`, puis exécutez directement la CLI de l'agent dans un terminal propre. Tendril la lance en sous-processus ; si `claude`, `codex`, `copilot`, `gemini`, `opencode`, `antigravity` ou `cursor` ne peuvent s'exécuter sans surveillance, les jobs en arrière-plan se figeront. Pour `apple`, vérifiez `fm available` et `fm serve`. |
| L'exécution échoue immédiatement            | Consultez le journal du job sous `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`. Les causes courantes incluent un contexte de dépôt absent ou des autorisations d'outils manquantes dans les [Promptwares](../02_Concepts/02_Promptwares.md).                                                                                                                                     |
| Les vérifications échouent systématiquement | Lancez manuellement la commande de vérification au sein du worktree isolé du plan (`$TENDRIL_HOME/Plans/{id}-{name}/Worktrees/{repo}`). La commande est en général correcte mais une étape de configuration préalable fait défaut dans le worktree — consultez [Intégration d'une base de code](03_Onboarding.md).                                                                     |
| Le job ne démarre jamais                    | Lancez `tendril job queue` pour vérifier l'ordre d'attribution et les limites de concurrence (`maxConcurrentJobs` dans `config.yaml`). Vous pouvez forcer le démarrage d'un job en attente ou bloqué via `tendril job force-start <id>`, ou interrompre les jobs bloqués avec `tendril job stop-all`. Voir [Cycle de vie et jobs](../02_Concepts/03_Lifecycle.md).                     |
| La saisie vocale indique être indisponible  | Sur macOS, accordez l'accès au microphone dans Réglages Système → Confidentialité et sécurité → Microphone, puis redémarrez l'application de bureau.                                                                                                                                                                                                                                   |

## Base de données

Tendril gère sa base [SQLite](https://www.sqlite.org) sous `$TENDRIL_HOME/tendril.db`. Bien que les migrations
s'exécutent automatiquement au lancement du démon, Tendril met à disposition des commandes dédiées à la base :

```bash
# Vérifier la version actuelle du schéma de base de données
tendril db version

# Appliquer les migrations en attente
tendril db migrate

# Contrôler l'intégrité de la base de données
tendril db integrity

# Récupérer l'espace disque inutilisé
tendril db vacuum

# Réinitialiser la base de données (demande confirmation)
tendril db reset
```

| Symptôme                                      | Solution                                                                                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doute quant à la santé de la base de données  | Lancez `tendril doctor` (contrôle la connectivité) ou `tendril db integrity` pour valider la cohérence interne de SQLite.                                                                                                                               |
| Base de données verrouillée (database locked) | Un autre processus détient un verrou exclusif. Un seul démon doit tourner à la fois ; fermez l'application de bureau avant de lancer `tendril run` ou `tendril serve` manuellement.                                                                     |
| Base de données corrompue                     | Arrêtez l'application et le démon, puis lancez `tendril db reset` (ou supprimez `$TENDRIL_HOME/tendril.db` ainsi que les fichiers `-wal` et `-shm`). Les fichiers Markdown des plans stockés sur le disque sous `$TENDRIL_HOME/Plans/` restent intacts. |

> [!TIP]
> Lorsque vous sollicitez de l'aide sur [Discord](https://discord.gg/FHgxkDga3y) ou GitHub, fournissez les journaux
> de diagnostic complets avec `tendril report-bug <plan-id>` — voir [Obtenir de l'aide](05_GettingHelp.md).
