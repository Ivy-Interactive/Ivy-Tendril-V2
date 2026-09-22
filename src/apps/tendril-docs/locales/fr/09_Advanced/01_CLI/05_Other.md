---
title: Autres commandes
description: Exécution de promptwares, orchestration des tâches en arrière-plan, sessions de chat, enregistrement de services d'arrière-plan et utilitaires.
icon: Wrench
searchHints:
  - promptware
  - memory
  - tool
  - job
  - chat
  - service
  - autostart
  - launchd
  - systemd
  - status
  - models
  - hash-password
  - generate-certs
  - agent-instructions
---

# Autres commandes

Référence pour l'exécution de promptwares, le suivi des tâches en arrière-plan, les sessions de chat interactives, la gestion des services d'arrière-plan du système d'exploitation et les commandes d'utilitaires de Tendril CLI.

## promptware

Tendril utilise des [promptwares](../../02_Concepts/02_Promptwares.md) pour structurer les flux d'exécution des agents. Pour plus de détails, consultez [Concept des Promptwares](../../02_Concepts/02_Promptwares.md).

#### promptware run

```terminal
>tendril promptware run <name> [args...] [options]
```

Exécute un promptware directement sur la machine hôte, en contournant la file d'attente des tâches du serveur.

| Option                 | Effet                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `--profile <profile>`  | Remplace le profil de raisonnement de l'agent (`deep`, `balanced`, `quick`)                  |
| `--working-dir <path>` | Répertoire de travail pour le processus d'exécution de l'agent                               |
| `--value <key=value>`  | Valeurs d'en-tête de firmware supplémentaires (répétable)                                    |
| `--plan <id>`          | ID du plan cible ou chemin du dossier                                                        |
| `--agent <provider>`   | Remplace le fournisseur de l'agent (`claude`, `antigravity`, `codex`, `copilot`, `opencode`) |
| `--dry-run`            | Affiche le firmware compilé sur stdout et quitte sans lancer d'agent                         |

#### Mémoire et Outils

```terminal
>tendril promptware list-memory <name>
>tendril promptware read-memory <name> [files...]
>tendril promptware write-memory <name> <filename> [--file <path>] [--stdin]
>tendril promptware delete-memory <name> <filename>
>tendril promptware write-tool <name> <tool_name> [--file <path>] [--stdin]
```

Les agents utilisent ces commandes pour enregistrer les motifs appris dans le répertoire `Memory/` d'un promptware et créer des outils personnalisés dans `Tools/`.

#### Déploiement et Couches

```terminal
>tendril promptware deploy
>tendril promptware layers [name]
```

- **deploy** — compile et installe les promptwares standards dans `<TendrilHome>/Promptwares/`.
- **layers** — inspecte quelle couche (valeur par défaut fournie ou surcouche d'équipe) a fourni chaque fichier de promptware.

## job

Gérez les tâches asynchrones des agents en arrière-plan. Les tâches passent par la file d'attente du démon et rapportent leur état en direct. Pour l'inspection dans l'interface utilisateur, consultez [l'application Tâches](../../04_Apps/04_Jobs.md).

#### job list

```terminal
>tendril job list
>tendril job list --status Running
>tendril job list --limit 50
>tendril job list --json
```

Liste les tâches récentes en arrière-plan du serveur démon Tendril.

| Option              | Effet                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `--status <status>` | Filtrer par état (`Pending`, `Queued`, `Running`, `Completed`, `Failed`, `Timeout`, `Stopped`, `Blocked`) |
| `--limit <n>`       | Nombre maximal de résultats (par défaut : 20)                                                             |
| `--json`            | Sortie des tâches sous forme de JSON structuré                                                            |

#### job start

```terminal
>tendril job start <job-type> [plan-id] [options]
```

Démarre une tâche asynchrone en arrière-plan sur le démon Tendril en cours d'exécution. Types de tâches pris en charge : `CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `AddProject`, `SyncRepo`.

| Option                    | Effet                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `--priority <number>`     | Rang de priorité pour la file d'attente (valeur plus élevée s'exécute en premier)                 |
| `--chat-session <id>`     | Associer la tâche à une session de chat (par défaut `$TENDRIL_CHAT_SESSION_ID`)                   |
| `--wait-for <job-id>`     | ID de tâche devant être achevée avant de mettre cette tâche en file d'attente (répétable)         |
| `--idempotency-key <key>` | Jeton d'idempotence : les resoumissions renvoient la tâche existante au lieu d'en créer une autre |
| `--force`                 | Resoumettre même si un travail identique est déjà en cours                                        |
| `--description <text>`    | Description de la tâche (utilisée avec `CreatePlan`)                                              |
| `--project <name>`        | Projet cible (utilisé avec `CreatePlan`)                                                          |
| `--note <text>`           | Note d'exécution (utilisée avec `ExecutePlan`)                                                    |
| `--instructions <text>`   | Invite de raffinement (utilisée avec `UpdatePlan`)                                                |
| `--change-request <text>` | Retours du réviseur (utilisé avec `RetryPlan`)                                                    |
| `--repo <name>`           | Dépôt (utilisé avec `CreateIssue`)                                                                |
| `--assignee <user>`       | Nom d'utilisateur de l'assigné sur GitHub (utilisé avec `CreateIssue` / `CreatePr`)               |
| `--reviewer <user>`       | Nom d'utilisateur du réviseur sur GitHub (utilisé avec `CreatePr`, répétable)                     |
| `--draft`                 | Créer en tant que PR brouillon (utilisé avec `CreatePr`)                                          |

```terminal
>tendril job start ExecutePlan 00042
>tendril job start RetryPlan 00042 --change-request "Fix failing unit tests"
>tendril job start CreatePlan --description "Add dark mode toggle" --project MyProject
```

#### job status et fail

```terminal
>tendril job status <job-id> --message <text> [--plan-id <id>] [--plan-title <title>]
>tendril job fail <job-id> --message <text>
```

Transmet la télémétrie de progression ou l'échec de la tâche directement au démon. Utilisé en interne par les scripts de promptware pendant l'exécution.

#### job cancel et delete

```terminal
>tendril job cancel <job-id> [--message <reason>]
>tendril job delete <job-id>
```

- **cancel** — signale à une tâche en cours d'exécution de s'interrompre.
- **delete** — supprime un enregistrement de tâche de la base de données (les fichiers journaux sur disque sont conservés).

#### job add-log

```terminal
>tendril job add-log <job-id> <action> [--summary <text>]
```

Ajoute une entrée narrative `## Agent Log` directement dans le fichier journal de la tâche dans `<TendrilHome>/Jobs/`. Opère directement sur le système de fichiers et ne nécessite pas que le serveur démon soit joignable.

#### File d'attente et Maintenance

```terminal
>tendril job queue [--json]
>tendril job force-start <job-id>
>tendril job stop-all
>tendril job clear [--completed] [--failed] [--all] [-y/--yes]
>tendril job maintenance
```

- **queue** — affiche les tâches en attente dans l'ordre de traitement
- **force-start** — contourne les limites de concurrence et de dépendances pour lancer immédiatement une tâche
- **stop-all** — annule toutes les tâches actives et en file d'attente
- **clear** — supprime en masse les tâches terminées ou échouées
- **maintenance** — exécute immédiatement une passe de nettoyage et de réconciliation des tâches

## chat

Pilotez des sessions de programmation interactives avec des agents depuis votre terminal :

```terminal
>tendril chat list [--json]
>tendril chat get <session-id> [--json]
>tendril chat create [--agent <agent>] [--model <model>] [--title <title>] [--effort <level>] [--plan <folder>] [--json]
>tendril chat send <session-id> "<message>" [--agent <agent>] [--model <model>] [--effort <effort>]
>tendril chat delete <session-id>
```

`tendril chat send` se connecte au démon, transmet le tour de dialogue et diffuse en temps réel les réponses de jetons et les événements d'appels d'outils directement sur stdout.

## service

Gérez le service de démarrage automatique du démon Tendril en arrière-plan selon les plateformes :

- **macOS** — enregistre un agent [launchd](https://en.wikipedia.org/wiki/Launchd) dans `~/Library/LaunchAgents/io.tendril.daemon.plist`
- **Linux** — enregistre une unité de service utilisateur [systemd](https://systemd.io)
- **Windows** — enregistre une tâche planifiée avec le [Planificateur de tâches](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page)

```terminal
>tendril service install [--no-start] [--force]
>tendril service status [--json]
>tendril service uninstall [--purge-binaries] [--force]
```

- **install** — enregistre l'exécutable en cours d'exécution en tant que service d'arrière-plan. Utilisez `--no-start` pour l'enregistrer pour la prochaine connexion sans le démarrer immédiatement.
- **status** — indique si le service est enregistré, chargé et actif (y compris l'URL et le PID).
- **uninstall** — supprime l'enregistrement de la configuration de démarrage automatique. Utilisez `--purge-binaries` pour supprimer les sidecars installés dans `<home>/bin`.

## Utilitaires

#### models

```terminal
>tendril models
>tendril models --refresh
```

Liste les modèles LLM pris en charge, leurs fournisseurs, les limites de fenêtre de contexte et les tarifs en direct. Utilisez `--refresh` pour récupérer les tarifs mis à jour depuis le registre des modèles.

#### generate-certs

```terminal
>tendril generate-certs <output-directory>
```

Génère une paire PEM auto-signée `localhost.crt` et `localhost.key` pour servir en HTTPS avec `tendril serve --tls-cert <path> --tls-key <path>`.

#### hash-password

```terminal
>tendril hash-password <password> [secret]
```

Hache un mot de passe avec [Argon2](https://en.wikipedia.org/wiki/Argon2) pour une utilisation dans la section `auth:` de `config.yaml`. Affiche la chaîne de hachage encodée et le secret pepper.

#### project-analyzer

```terminal
>tendril project-analyzer <folder-path>
```

Inspecte un répertoire et affiche une analyse allégée de la pile technique en YAML identifiant les environnements d'exécution de langages, les gestionnaires de paquets et les frameworks de test.

#### agent-instructions

```terminal
>tendril agent-instructions
```

Compile et affiche le modèle complet d'invite système d'agent avec les chemins d'installation substitués, formaté pour être redirigé vers l'invite d'un agent autonome.

#### wireframe

```terminal
>tendril wireframe setup [path] [--tailwind superset|jit] [--force] [--quiet]
>tendril wireframe serve [path] [--port <port>] [--host <host>] [--no-open]
>tendril wireframe screenshot [path] [--out <path>] [--width <w>] [--height <h>]
>tendril wireframe agent-readme [path]
```

Initialise, sert, prévisualise avec rechargement à chaud et capture des maquettes React conçues lors de la rédaction de plans.
