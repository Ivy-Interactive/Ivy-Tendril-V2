# Guide de configuration de Claude Code pour les Skills Tendril

Ce guide explique comment installer, configurer et tester les Skills d'Agent Tendril dans Claude Code.

## 1. Installation via la marketplace de plugins

Tendril fournit des manifestes de plugins officiels dans `.claude-plugin/marketplace.json` et `.claude-plugin/plugin.json`.

Dans Claude Code, ajoutez le dépôt Ivy-Tendril-V2 comme source de marketplace :

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
```

Installez ensuite le plugin `tendril-skills` :

```
/plugin install tendril-skills@ivy-tendril-v2
```

## 2. Développement et tests locaux

Lors du développement de skills localement ou du test de modifications avant de les pousser :

Lancez Claude Code avec le répertoire de plugins pointant vers votre clone local du dépôt :

```bash
claude --plugin-dir /chemin/vers/ivy-tendril-v2
```

Claude Code lira `.claude-plugin/plugin.json` et montera automatiquement toutes les skills définies dans `skills/`.

## 3. Rétrocompatibilité avec .claude/skills

Pour les flux de travail de dépôts locaux au sein d'Ivy-Tendril-V2 :
- Les liens symboliques dans `.claude/skills/<skill-name>` pointent vers `../../skills/<skill-name>`.
- Toute configuration locale existante de Claude Code référençant `.claude/skills/` continue de fonctionner en toute transparence sans reconfiguration manuelle.

## 4. Invoquer des skills dans Claude Code

Une fois installées, utilisez les commandes slash directement dans votre session Claude Code :

- `/tendril-debug-plan <plan-id>` : Déboguer des plans échoués ou lents.
- `/tendril-debug-job <job-id>` : Inspecter les artefacts de travail et les journaux de décision des agents.
- `/tendril-review` : Effectuer des vérifications de qualité du code et de non-régression sur les diffs actuels.
- `/tendrillable <url>` : Classifier les issues du backlog selon les critères d'adéquation pour agents autonomes.
- `/tendril-release` : Automatiser les montées de version, les mises à jour de dépendances et les flux de publication.

## Licence

Les skills et plugins Tendril sont sous licence [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) à la racine du dépôt.
