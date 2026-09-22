# Guide de configuration de Cursor pour les Skills Tendril

Ce guide explique comment installer et configurer les Skills d'Agent Tendril dans Cursor.

## 1. Installation rapide (Skills CLI)

Installez les skills Tendril dans votre projet Cursor à l'aide de la CLI des skills :

```bash
# Installation au niveau du projet (s'installe dans .cursor/skills/)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor

# Installation globale (dans tous les espaces de travail Cursor)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor -g
```

## 2. Structure des répertoires dans Cursor

Cursor recherche les définitions de skills dans les emplacements suivants :

- **Niveau projet** : `.cursor/skills/<skill-name>/SKILL.md`
- **Niveau global / utilisateur** : `~/.cursor/skills/<skill-name>/SKILL.md` (macOS/Linux) ou `%USERPROFILE%\.cursor\skills\<skill-name>\SKILL.md` (Windows)

Chaque dossier contient :
- `SKILL.md` : Instructions principales avec frontmatter YAML
- Documentation de référence complémentaire et scripts

## 3. Interaction avec les règles Cursor (.cursorrules)

Vous pouvez référencer les skills Tendril depuis le fichier `.cursorrules` de votre projet ou les fichiers `.cursor/rules/*.mdc` :

```markdown
Lors du débogage de plans échoués ou de la révision de modifications :
- Consultez src/skills/tendril-debug-plan pour le diagnostic d'exécution des plans.
- Exécutez les procédures de src/skills/tendril-review avant de finaliser les pull requests.
```

## 4. Utilisation dans le chat d'agent de Cursor

Dans la fenêtre de chat d'agent de Cursor :
- Tapez `@tendril-debug-plan` ou demandez à l'agent d'inspecter un plan à l'aide de ses instructions.
- Demandez à Cursor d'exécuter `/tendril-review` sur le diff git actif.
- Exécutez `/tendrillable` pour classer les issues selon leur adéquation pour les agents.

## Licence

Les skills et plugins Tendril sont sous licence [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) à la racine du dépôt.
