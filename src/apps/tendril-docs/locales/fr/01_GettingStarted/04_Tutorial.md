---
title: Tutoriel
description: >-
  Un guide complet de bout en bout : compilez Tendril, enregistrez un dépôt local, créez votre premier
  plan, exécutez-le avec un agent, examinez le résultat et ouvrez une pull request.
icon: GraduationCap
searchHints:
  - tutoriel
  - guide pas à pas
  - démarrage rapide
  - premier plan
  - de bout en bout
  - exemple
---

# Tutoriel

Voici le déroulement complet du flux de travail de bout en bout sur le dépôt de votre choix. Il aborde l'enregistrement d'un projet,
la génération d'un plan, l'exécution des modifications dans des worktrees isolés, l'examen des diffs et la création d'une pull request.

## Étape 1 : Compiler et vérifier

Suivez les instructions d'[Installation](02_Installation.md) pour installer ou compiler Tendril et placer `tendril` dans votre `PATH`.
Vérifiez votre environnement :

```bash
tendril doctor
```

`tendril doctor` contrôle `$TENDRIL_HOME`, `config.yaml`, la base de données [SQLite](https://www.sqlite.org), le
répertoire des plans, [Git](https://git-scm.com/) et la [CLI GitHub](https://cli.github.com/) (`gh`). Corrigez toute
mention `[FAIL]` avant de poursuivre.

## Étape 2 : Démarrer Tendril

Lancez l'application de bureau :

```bash
pnpm dev:desktop
```

L'application de bureau s'ouvre et supervise automatiquement le démon `tendril run` en arrière-plan. Le
démon expose l'API REST et WebSocket sur laquelle communiquent l'interface utilisateur et la CLI.

Si vous préférez exécuter le démon sans interface (headless) :

```bash
# Vérifie le port et applique les migrations en attente
tendril run

# Ou écouteur direct avec options personnalisées :
tendril serve --host 127.0.0.1 --port 5010
```

## Étape 3 : Enregistrer votre dépôt

Tendril requiert un dépôt git local pour travailler :

```bash
git clone https://github.com/your-org/your-repo.git
```

Enregistrez le projet depuis **Settings → Projects** dans l'application de bureau, ou via la CLI :

```bash
tendril project add MyProject
tendril project add-repo MyProject /Users/you/Repos/MyProject
tendril project add-verification MyProject CheckResult
```

Les deux méthodes mettent à jour `$TENDRIL_HOME/config.yaml`, que vous pouvez aussi modifier manuellement :

```yaml
codingAgent: claude

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

Définissez `codingAgent` sur l'agent installé sur votre machine :

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models (`apple` via `fm` sur l'appareil)

> [!TIP]
> Ajoutez un fichier `AGENTS.md` à la racine de votre dépôt détaillant l'architecture et les commandes de compilation.
> Tendril l'injecte dans le contexte système de l'agent à chaque exécution. Consultez
> [Intégration d'une base de code](03_Onboarding.md) pour nos recommandations.

## Étape 4 : Créer un plan

Cliquez sur **New Plan** dans l'application de bureau et décrivez la tâche. Tendril mobilise l'agent
de flux de travail [CreatePlan](../02_Concepts/02_Promptwares.md), qui rédige un
plan structuré comprenant la formulation du problème, les solutions par étapes et les objectifs de vérification.

Vous pouvez également créer des plans via la CLI :

```bash
tendril plan create "Add a health-check endpoint" MyProject
```

Le plan entre dans l'état **Draft** (Brouillon). Ouvrez le brouillon pour examiner la spécification proposée. Vous pouvez ajouter des
annotations directement dans l'interface afin de corriger le périmètre ou d'ajouter des contraintes, invitant ainsi
[UpdatePlan](../02_Concepts/02_Promptwares.md) à synthétiser vos retours dans une
nouvelle révision.

## Étape 5 : Exécuter le plan

Dès que le brouillon vous convient, cliquez sur **Execute** (ou lancez `tendril plan execute <plan-id>`).
L'agent [ExecutePlan](../02_Concepts/02_Promptwares.md) va alors :

1. créer un [Git worktree](https://git-scm.com/docs/git-worktree) isolé sous `Worktrees/{repo-name}/`,
   laissant votre branche principale intacte ;
2. charger la spécification du plan, le contexte du dépôt et les notes en mémoire ;
3. implémenter les modifications de code phase par phase avec des commits git incrémentaux ;
4. exécuter chaque barrière de vérification configurée (compilation, linter, tests, captures d'écran).

Suivez l'exécution en direct dans la vue **Jobs** de l'application ou via la CLI :

```bash
tendril job list          # afficher les statuts des jobs
tendril job queue         # inspecter l'ordre de la file d'attente
```

Une fois toutes les étapes terminées et les vérifications requises validées, le plan passe à **Review** (Revue).

> [!NOTE]
> En cas d'échec d'une vérification, le plan passe à l'état **Failed** (Échec) et le worktree est conservé sur le disque. Examinez
> le rapport d'erreur sous `Verification/` ou lancez
> [RetryPlan](../02_Concepts/02_Promptwares.md) pour laisser l'agent corriger le problème.

## Étape 6 : Examiner le résultat

Rendez-vous sur l'écran **Review** du plan pour auditer le travail produit :

- **Git Diff** — parcourez les diffs avec coloration syntaxique sur l'ensemble des fichiers modifiés ;
- **Rapports de vérification** — consultez les résultats des tests et compilations automatisés ;
- **Transcriptions d'exécution** — lisez l'historique des appels d'outils, la sortie standard (stdout/stderr) et les coûts en jetons ;
- **Recommandations de suivi** — analysez les pistes d'amélioration ou la dette technique relevées par l'agent.

Approuvez le plan dès que le résultat vous convient. Tendril déclenche
[CreatePr](../02_Concepts/02_Promptwares.md) pour ouvrir une pull request via
la [CLI GitHub](https://cli.github.com/) (`gh`), passant le plan à l'état **Completed** (Terminé).

## Ce qui vient de se passer

Vous venez de franchir l'ensemble du cycle de développement de Tendril :

```
Draft → Creating → Executing → Review → Completed
```

L'agent autonome a travaillé dans un worktree sandboxé, a validé vos barrières de vérification et a créé une
pull request auditée, tout en archivant les prompts, les diffs et les coûts sous `$TENDRIL_HOME/Plans/`.

## Prochaines étapes

- [Plans](../02_Concepts/01_Plans.md) — découvrir en détail la structure des plans, leurs états et leurs annotations.
- [Promptwares](../02_Concepts/02_Promptwares.md) — adapter les prompts, outils et mémoires des agents de flux de travail.
- [Cycle de vie et jobs](../02_Concepts/03_Lifecycle.md) — comprendre la concurrence, la file d'attente et la télémétrie.
