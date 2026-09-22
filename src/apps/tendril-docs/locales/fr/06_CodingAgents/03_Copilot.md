---
title: Copilot
description: Copilot est un agent de codage alternatif propulsé par la CLI Copilot de GitHub.
icon: Bot
searchHints:
  - copilot
  - github
  - agent de codage
---

# Copilot

## Configuration

Définissez Copilot comme agent de codage dans `config.yaml` :

```yaml
codingAgent: copilot
```

Ou sélectionnez-le dans **Settings > Coding Agent**.

Pour plus de détails sur la structure et les paramètres de `config.yaml`, consultez [Installation et paramètres](../03_Configuration/01_Setup.md).

## Prérequis

- La [CLI GitHub Copilot](https://github.com/features/copilot) doit être disponible sous le nom `copilot` dans votre PATH. Installez-la via le script officiel ou le cask [Homebrew](https://brew.sh) :
  ```bash
  curl -fsSL https://gh.io/copilot-install | bash
  # ou : brew install --cask copilot-cli
  ```
  Tendril bascule automatiquement sur `gh copilot` si le binaire autonome `copilot` n'est pas trouvé mais que la [CLI GitHub](https://cli.github.com) (`gh`) est installée.
- Un abonnement actif à [GitHub Copilot](https://github.com/features/copilot) est requis.
- **Authentification** : Copilot ne possède pas de commande CLI `login` et ne partage pas les identifiants avec `gh auth login`. Pour vous connecter :
  1. Lancez la CLI dans votre terminal : `copilot`
  2. À l'invite, exécutez la commande slash : `/login`
  3. Pour les environnements CI sans interface graphique (headless) ou sans surveillance, définissez la variable d'environnement `COPILOT_GITHUB_TOKEN` (ou `GH_TOKEN`) avec un jeton d'accès personnel doté de la permission `Copilot Requests`.

## Profils

Tendril associe les niveaux d'effort à Copilot :

| Profil     | Modèle  | Effort | Cas d'usage                                  |
| ---------- | ------- | ------ | -------------------------------------------- |
| `deep`     | gpt-5.4 | high   | Modifications multi-fichiers complexes       |
| `balanced` | gpt-5.4 | medium | Exécution standard de plans                  |
| `quick`    | gpt-5.4 | low    | Corrections simples et petites modifications |

Le profil est sélectionné automatiquement en fonction du [niveau de complexité du plan](../02_Concepts/01_Plans.md), ou peut être configuré par [promptware](../02_Concepts/02_Promptwares.md) dans `config.yaml`.

Le modèle par défaut pour Copilot dans Tendril est `gpt-5.4`.

### Modèles pris en charge

GitHub Copilot prend en charge les modèles d'OpenAI et d'Anthropic via son environnement d'exécution :

- **Modèles [OpenAI](https://openai.com)** : `gpt-5.4` (par défaut), `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5-mini`, `gpt-4.1` (effort de raisonnement : `low`, `medium`, `high`, `xhigh`).
- **Modèles [Anthropic Claude](https://code.claude.com/docs)** : `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5` (effort de raisonnement : `low`, `medium`, `high`, `xhigh`, `max`).

## Installation des Skills Tendril pour GitHub Copilot

Tendril fournit des skills spécialisées pour GitHub Copilot dans [Visual Studio Code](https://code.visualstudio.com), couvrant le débogage de plans, l'inspection des artefacts d'exécution, les revues de code et le tri d'issues.

### Utilisation de la CLI Skills

Installez les skills pour votre espace de travail :

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

Ou installez-les globalement sur tous les espaces de travail :

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

### Emplacement manuel dans `.agents/skills/`

Les skills peuvent également être placées directement dans le répertoire `.agents/skills/`, `.github/skills/` ou `~/.copilot/skills/` :

```bash
mkdir -p .agents/skills
cp -r /chemin/vers/skills/* .agents/skills/
```

Une fois installées, les skills apparaissent dans GitHub Copilot Chat sous le menu `/skills` et peuvent être appelées directement par des commandes slash (par exemple `/tendril-debug-plan`, `/tendril-review`).

Pour plus de détails, consultez [Skills d'agent](00_Skills.md).
