---
title: vault
description: Gérez les vaults de configuration d'équipe, découvrez et connectez des dépôts partagés sur GitHub, inspectez les ressources du catalogue, importez des projets et publiez des mises à jour directement depuis la CLI.
icon: KeyRound
searchHints:
  - vault
  - sync
  - pull
  - import
  - push
  - catalogue
  - discover
  - connect
  - auto-sync
  - équipe
---

# vault

Gérez les vaults de configuration d'équipe adossés à [Git](https://git-scm.com) et [GitHub](https://github.com). Les vaults permettent aux équipes de partager des configurations de projet, des compétences personnalisées, des configurations de serveur [Model Context Protocol (MCP)](https://modelcontextprotocol.io), des mémoires de promptware et des vérifications entre postes de travail. La CLI interagit avec la [CLI GitHub (`gh`)](https://cli.github.com) pour découvrir les dépôts d'équipe, importer des modèles de projet et soumettre des mises à jour via des [Pull Requests GitHub](https://docs.github.com/en/pull-requests).

Consultez [Projets](02_Project.md) pour la configuration locale des projets et [Configuration globale](06_Config.md) pour les paramètres globaux.

## Commandes

```terminal
>tendril vault list [--json]
>tendril vault status [vault-id] [--json]
>tendril vault discover [--json]
>tendril vault connect <repo-url> [--name <custom-name>]
>tendril vault create <repo-name> [--public] [--org <org>]
>tendril vault disconnect [vault-id] [-y, --yes]
>tendril vault sync [vault-id]
>tendril vault pull [vault-id]
>tendril vault set-auto-sync <enabled> [--vault <vault-id>]
>tendril vault catalog [vault-id] [--json]
>tendril vault import <project-name> [options]
>tendril vault push <projects...> [options]
>tendril vault delete <project-name> [--vault <vault-id>] [-y, --yes]
```

## Gestion des Vaults

#### list

```terminal
>tendril vault list
>tendril vault list --json
```

Liste tous les vaults connectés, en affichant leur identifiant, leur nom, l'URL du dépôt distant [Git](https://git-scm.com), la branche active, le nombre de commits d'avance/de retard, l'horodatage de la dernière synchronisation et l'état de synchronisation automatique.

#### status

```terminal
>tendril vault status
>tendril vault status <vault-id>
>tendril vault status --json
```

Affiche l'état détaillé de diagnostic et de synchronisation pour un vault spécifique ou pour le vault principal configuré, y compris les modifications locales non validées et l'état de suivi de la branche.

#### discover

```terminal
>tendril vault discover
>tendril vault discover --json
```

Analyse [GitHub](https://github.com) à l'aide de la [CLI GitHub (`gh`)](https://cli.github.com) pour découvrir les dépôts de vault existants accessibles à votre compte et à vos organisations.

#### connect

```terminal
>tendril vault connect https://github.com/my-org/team-vault.git
>tendril vault connect my-org/team-vault --name "Engineering Vault"
```

Connecte un dépôt [Git](https://git-scm.com) existant en tant que vault d'équipe. Accepte les URL complètes de dépôt ou la notation abrégée `org/repo`.

#### create

```terminal
>tendril vault create engineering-vault
>tendril vault create team-vault --org my-org --public
```

Crée un nouveau dépôt sur [GitHub](https://github.com) (privé par défaut), initialise l'arborescence standard du vault et le connecte localement. Utilisez `--org` pour cibler une organisation et `--public` pour la visibilité publique.

#### disconnect

```terminal
>tendril vault disconnect
>tendril vault disconnect <vault-id> -y
```

Déconnecte un vault de la configuration locale de Tendril sans supprimer le répertoire du clone local. Passez `-y` ou `--yes` pour ignorer les demandes de confirmation.

#### sync / pull

```terminal
>tendril vault sync
>tendril vault pull
>tendril vault sync <vault-id>
```

Récupère les derniers commits de configuration depuis le dépôt distant du vault et met à jour les projets locaux suivis. `pull` est un alias de `sync`.

#### set-auto-sync

```terminal
>tendril vault set-auto-sync true
>tendril vault set-auto-sync false --vault <vault-id>
```

Active ou désactive la synchronisation automatique pour un vault. Accepte `true`, `false`, `1`, `0`, `yes` ou `no`.

## Catalogue et Partage de projets

#### catalog

```terminal
>tendril vault catalog
>tendril vault catalog <vault-id> --json
```

Liste tous les projets et les nombres de ressources (dépôts, compétences personnalisées, serveurs [Model Context Protocol (MCP)](https://modelcontextprotocol.io), mémoires de promptware et vérifications) publiés dans le catalogue du vault.

#### import

```terminal
>tendril vault import MyProject
>tendril vault import MyProject --target-name LocalProject --merge
>tendril vault import MyProject --repo api=~/code/api --repo web=~/code/web
```

Importe une définition de projet depuis le catalogue du vault dans la configuration locale de Tendril.

| Option                 | Description                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `--target-name <name>` | Nom de projet local personnalisé à enregistrer à la place du nom du catalogue                 |
| `--vault <vault-id>`   | Identifiant ou nom du vault d'où importer (par défaut le vault actif)                         |
| `--repo <name=path>`   | Associe un identifiant de dépôt du vault à un chemin local du système de fichiers (répétable) |
| `--no-permissions`     | Ignore l'importation des règles de sécurité et des autorisations d'exécution                  |
| `--merge`              | Fusionne les paramètres dans un projet local existant au lieu de le remplacer                 |

#### push

```terminal
>tendril vault push MyProject
>tendril vault push ProjectA ProjectB --version "1.2.0" --changelog "Added new skills and verifications"
>tendril vault push MyProject --reviewer alice,bob --title "feat(vault): update MyProject"
```

Rassemble la configuration du projet, les compétences personnalisées, les configurations de [Model Context Protocol (MCP)](https://modelcontextprotocol.io), les mémoires de promptware et les vérifications, les valide sur une branche de fonctionnalité et ouvre une [Pull Request GitHub](https://docs.github.com/en/pull-requests) vers le dépôt du vault.

| Option                | Description                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `--vault <vault-id>`  | Identifiant du vault cible                                                                                          |
| `--version <version>` | Chaîne de version personnalisée (par défaut : horodatage UTC)                                                       |
| `--changelog <text>`  | Notes de modifications incluses dans la description de la pull request                                              |
| `--title <title>`     | Titre personnalisé pour la pull request générée                                                                     |
| `--body <body>`       | Description personnalisée pour le corps de la pull request                                                          |
| `--reviewer <names>`  | Nom(s) d'utilisateur [GitHub](https://github.com) à désigner comme réviseurs (répétable ou séparé par des virgules) |

#### delete

```terminal
>tendril vault delete OldProject
>tendril vault delete OldProject --vault <vault-id> -y
```

Supprime un projet du dépôt du vault et crée une [Pull Request GitHub](https://docs.github.com/en/pull-requests) pour appliquer la suppression. Passez `-y` ou `--yes` pour ignorer la confirmation.

## Exemples

**Connecter et synchroniser un vault d'équipe :**

```terminal
># Découvrir les vaults d'équipe accessibles sur GitHub
>tendril vault discover

># Connecter le dépôt du vault
>tendril vault connect https://github.com/my-org/shared-vault.git

># Récupérer les mises à jour
>tendril vault sync
```

**Importer un projet depuis le catalogue :**

```terminal
># Inspecter les projets disponibles dans le catalogue
>tendril vault catalog

># Importer avec des chemins de dépôts locaux personnalisés
>tendril vault import BackendService --repo backend=~/Projects/backend
```

**Publier les mises à jour de projets par pull request :**

```terminal
># Pousser les modifications et ouvrir une pull request avec des réviseurs désignés
>tendril vault push BackendService --changelog "Added Playwright E2E verification" --reviewer alice,bob
```
