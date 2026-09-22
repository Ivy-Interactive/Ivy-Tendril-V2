---
title: Promptwares
description: >-
  Les promptwares sont les agents de flux de travail spécialisés derrière chaque étape d'un plan — chacun disposant de son propre prompt,
  de ses outils et de sa mémoire à long terme.
icon: Terminal
searchHints:
  - promptware
  - agent
  - prompt
  - outils
  - mémoire
  - allowedTools
  - profil
  - customInstructions
  - couches
---

# Promptwares

Un promptware est un dossier contenant les consignes, les outils et la mémoire qui définissent un agent
de flux de travail à tâche unique. Les instances déployées se trouvent sous `$TENDRIL_HOME/Promptwares/`, à raison d'une par promptware :

- **Program.md** — le prompt système : l'objectif de l'agent, sa procédure pas à pas et ses règles d'exécution.
- **Tools/** — les scripts et utilitaires exécutables auxquels l'agent peut faire appel durant son exécution.
- **Memory/** — les notes Markdown persistantes qui perdurent entre les exécutions. Cette boucle de rétroaction permet aux promptwares
  d'apprendre les particularités d'une base de code et de progresser plutôt que de reproduire les mêmes erreurs.

Tendril répartit les promptwares via votre agent de programmation configuré (comme
[Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Codex](../06_CodingAgents/02_Codex.md),
[Copilot](../06_CodingAgents/03_Copilot.md), [Gemini](../06_CodingAgents/05_Gemini.md),
[OpenCode](../06_CodingAgents/04_OpenCode.md), Antigravity ou [Cursor](https://www.cursor.com)), en exécutant
un job à la fois avec des droits d'accès aux outils régis par le principe du moindre privilège.

## Déploiement et couches

Tendril fournit par défaut un jeu de promptwares intégrés à la plateforme. Les équipes peuvent également configurer un dossier
de surcharge (overlay) dans [config.yaml](../03_Configuration/01_Setup.md) afin de redéfinir les prompts système ou d'apporter des outils
spécifiques à leur équipe.

Déployer ou actualiser les promptwares :

```bash
tendril promptware deploy
```

Pour vérifier si un promptware s'exécute depuis le socle initial ou depuis une couche d'équipe :

```bash
tendril promptware layers
# ou vérifier un promptware spécifique :
tendril promptware layers ExecutePlan
```

## Agents de flux de travail principaux

| Promptware       | Rôle                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **CreatePlan**   | Rédige un plan à partir d'une description sommaire, d'un élément reçu ou d'un ticket [GitHub](https://github.com).        |
| **ExpandPlan**   | Développe un plan succinct pour en faire une spécification exécutable découpée en phases.                                 |
| **UpdatePlan**   | Révise un plan existant en intégrant les retours de revue, les discussions et les annotations contextuelles.              |
| **SplitPlan**    | Découpe un plan volumineux en sous-plans indépendants plus maniables.                                                     |
| **ExecutePlan**  | Crée des [git worktrees](https://git-scm.com/docs/git-worktree) isolés, applique les phases du plan et exécute les tests. |
| **RetryPlan**    | Effectue une nouvelle passe sur un plan ayant échoué aux vérifications, à partir des journaux et des diffs.               |
| **CreatePr**     | Ouvre une pull request GitHub d'après les diffs du worktree via la [CLI GitHub](https://cli.github.com/) (`gh`).          |
| **CreateIssue**  | Transmet un échec de plan, un statut ou une demande de triage vers les tickets GitHub.                                    |
| **AddProject**   | Enregistre un nouveau projet et configure les chemins de ses dépôts.                                                      |
| **SetupProject** | Détermine et enregistre la méthode de compilation, d'exécution et de vérification d'un projet.                            |
| **SyncRepo**     | Met à jour les dépôts d'un projet par rapport à leurs branches amont (upstream).                                          |

## Configuration

Chaque promptware se configure dans [~/.tendril/config.yaml](../03_Configuration/01_Setup.md) sous la
clé `promptwares:` :

```yaml
promptwares:
  _default:
    profile: balanced

  CreatePlan:
    profile: deep
    allowedTools:
      - Read
      - Glob
      - Grep
      - Bash
      - Write(%PLANS_DIR%/**)
    deniedTools:
      - WebFetch
    customInstructions: |
      Always include acceptance criteria and verification gates in the plan.
```

| Champ                | Requis | Description                                                                                                                                                                |
| -------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile`            | Oui    | Quel profil d'agent adopter — `quick`, `balanced` ou `deep`. Les profils correspondent à un modèle et à un niveau d'effort par agent.                                      |
| `allowedTools`       | Non    | Outils attribués en complément des options par défaut. Prend en charge les variables `%PROMPTWARE_DIR%`, `%PLAN_DIR%` et `%PLANS_DIR%` pour cibler des répertoires précis. |
| `deniedTools`        | Non    | Outils refusés, même si une autre règle les avait accordés.                                                                                                                |
| `customInstructions` | Non    | Texte libre injecté dans le prompt de l'agent avec des indicateurs de priorité.                                                                                            |

L'entrée `_default` constitue un socle appliqué à l'ensemble des promptwares ; une entrée nommée prévaut sur celle-ci.

### Instructions personnalisées (Custom instructions)

Lorsque `customInstructions` est défini, Tendril l'ajoute au prompt de firmware compilé avec une mention
explicite de priorité. L'agent reçoit l'ordre de respecter ces instructions en priorité, devant le modèle de firmware et le propre fichier
`Program.md` du promptware. C'est le moyen privilégié pour adapter le comportement d'un promptware sans toucher aux fichiers
de programme partagés.

## Flux d'exécution

1. **Contexte** — compiler `Program.md`, joindre le plan, les annotations contextuelles, la configuration du projet et
   les éventuelles `customInstructions` de `config.yaml`.
2. **Outils et permissions** — exposer `Tools/` et les accès accordés, en développant les variables `%...%` en
   chemins absolus. Les répertoires accessibles en écriture sont strictement confinés au dossier du plan, à la
   `Memory/` du promptware et aux worktrees git du dépôt.
3. **Exécution** — lancer l'agent de programmation en tant que processus d'arrière-plan dans son worktree isolé.
4. **Capture et télémétrie** — diffuser la sortie en direct dans `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`,
   notifier la progression au démon et inscrire la consommation de jetons ainsi que le coût dans le fichier `costs.csv` du plan.

## Mémoire et apprentissage

La mémoire constitue la boucle d'apprentissage : un promptware consigne ce qu'il a appris d'un projet ou d'un incident,
puis le relit lors des exécutions futures. La CLI propose une gestion directe de la mémoire :

```bash
# Lister les notes en mémoire enregistrées pour un promptware
tendril promptware list-memory ExecutePlan

# Lire des notes de mémoire spécifiques
tendril promptware read-memory ExecutePlan worktree-hygiene.md

# Rédiger ou modifier une note de mémoire depuis un fichier (ou stdin)
tendril promptware write-memory ExecutePlan worktree-hygiene.md --file notes.md

# Supprimer une note de mémoire obsolète ou erronée
tendril promptware delete-memory ExecutePlan worktree-hygiene.md
```

> [!TIP]
> La mémoire a vocation à être épurée aussi bien qu'enrichie — une hypothèse ou une règle devenue caduque doit
> être supprimée avec `delete-memory`, au lieu de s'accumuler sous des notes contradictoires.

## Exécution directe

Pour tester ou lancer un promptware directement au premier plan, sans passer par le gestionnaire de jobs du démon :

```bash
# Lancer CreatePlan directement avec un prompt de tâche
tendril promptware run CreatePlan "Add a health-check endpoint" --profile deep

# Afficher le prompt compilé sans démarrer l'agent
tendril promptware run CreatePlan "Add a health-check endpoint" --dry-run
```

## Prochaines étapes

- [Cycle de vie et jobs](03_Lifecycle.md) — visualiser le déroulement d'une exécution de promptware en direct.
- [Plans](01_Plans.md) — l'artéfact lu et enrichi par chaque promptware.
