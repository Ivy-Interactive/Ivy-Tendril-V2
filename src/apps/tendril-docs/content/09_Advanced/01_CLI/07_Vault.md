---
title: vault
description: Manage team configuration vaults, discover and connect shared repositories on GitHub, inspect catalog assets, import projects, and publish configuration updates directly from the CLI.
icon: KeyRound
searchHints:
  - vault
  - sync
  - pull
  - import
  - push
  - catalog
  - discover
  - connect
  - auto-sync
  - team
---

# vault

Manage team configuration vaults backed by [Git](https://git-scm.com) and [GitHub](https://github.com). Vaults allow teams to share project configurations, custom skills, [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server configurations, promptware memories, and verifications across workstations. The CLI interacts with the [GitHub CLI (`gh`)](https://cli.github.com) to discover team repositories, import project templates, and submit updates via [GitHub Pull Requests](https://docs.github.com/en/pull-requests).

See [Projects](02_Project.md) for local project configuration and [Global Config](06_Config.md) for global settings.

## Commands

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

## Vault Management

#### list

```terminal
>tendril vault list
>tendril vault list --json
```

Lists all connected vaults, displaying their ID, name, remote [Git](https://git-scm.com) repository URL, active branch, ahead/behind commit counts, last sync timestamp, and auto-sync status.

#### status

```terminal
>tendril vault status
>tendril vault status <vault-id>
>tendril vault status --json
```

Shows detailed diagnostic and synchronization status for a specific vault or the primary configured vault, including uncommitted local modifications and branch tracking state.

#### discover

```terminal
>tendril vault discover
>tendril vault discover --json
```

Scans [GitHub](https://github.com) using the [GitHub CLI (`gh`)](https://cli.github.com) to discover existing vault repositories accessible to your account and organizations.

#### connect

```terminal
>tendril vault connect https://github.com/my-org/team-vault.git
>tendril vault connect my-org/team-vault --name "Engineering Vault"
```

Connects an existing [Git](https://git-scm.com) repository as a team vault. Accepts full repository URLs or `org/repo` shorthand.

#### create

```terminal
>tendril vault create engineering-vault
>tendril vault create team-vault --org my-org --public
```

Creates a new repository on [GitHub](https://github.com) (private by default), initializes standard vault directory layouts, and connects it locally. Use `--org` to target an organization and `--public` for public visibility.

#### disconnect

```terminal
>tendril vault disconnect
>tendril vault disconnect <vault-id> -y
```

Disconnects a vault from local Tendril configuration without deleting the local clone directory. Pass `-y` or `--yes` to skip confirmation prompts.

#### sync / pull

```terminal
>tendril vault sync
>tendril vault pull
>tendril vault sync <vault-id>
```

Pulls the latest configuration commits from the remote vault repository and updates tracked local projects. `pull` is an alias for `sync`.

#### set-auto-sync

```terminal
>tendril vault set-auto-sync true
>tendril vault set-auto-sync false --vault <vault-id>
```

Enables or disables automatic synchronization for a vault. Accepts `true`, `false`, `1`, `0`, `yes`, or `no`.

## Catalog & Project Sharing

#### catalog

```terminal
>tendril vault catalog
>tendril vault catalog <vault-id> --json
```

Lists all projects and asset counts (repositories, custom skills, [Model Context Protocol (MCP)](https://modelcontextprotocol.io) servers, promptware memories, and verifications) published in the vault catalog.

#### import

```terminal
>tendril vault import MyProject
>tendril vault import MyProject --target-name LocalProject --merge
>tendril vault import MyProject --repo api=~/code/api --repo web=~/code/web
```

Imports a project definition from the vault catalog into local Tendril configuration.

| Option                 | Description                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `--target-name <name>` | Custom local project name to register instead of the catalog name         |
| `--vault <vault-id>`   | Vault ID or name to import from (defaults to active vault)                |
| `--repo <name=path>`   | Map a vault repository identifier to a local filesystem path (repeatable) |
| `--no-permissions`     | Skip importing security rules and execution permissions                   |
| `--merge`              | Merge settings into an existing local project instead of replacing it     |

#### push

```terminal
>tendril vault push MyProject
>tendril vault push ProjectA ProjectB --version "1.2.0" --changelog "Added new skills and verifications"
>tendril vault push MyProject --reviewer alice,bob --title "feat(vault): update MyProject"
```

Collects project configuration, custom skills, [Model Context Protocol (MCP)](https://modelcontextprotocol.io) configurations, promptware memories, and verifications, commits them to a feature branch, and opens a [GitHub Pull Request](https://docs.github.com/en/pull-requests) against the vault repository.

| Option                | Description                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `--vault <vault-id>`  | Target vault identifier                                                                         |
| `--version <version>` | Custom version string (defaults to UTC timestamp)                                               |
| `--changelog <text>`  | Changelog notes included in the pull request description                                        |
| `--title <title>`     | Custom title for the generated pull request                                                     |
| `--body <body>`       | Custom body description for the pull request                                                    |
| `--reviewer <names>`  | [GitHub](https://github.com) username(s) to assign as reviewers (repeatable or comma-separated) |

#### delete

```terminal
>tendril vault delete OldProject
>tendril vault delete OldProject --vault <vault-id> -y
```

Removes a project from the vault repository and creates a [GitHub Pull Request](https://docs.github.com/en/pull-requests) to apply the deletion. Pass `-y` or `--yes` to skip confirmation.

## Examples

**Connect and sync a team vault:**

```terminal
># Discover accessible team vaults on GitHub
>tendril vault discover

># Connect vault repository
>tendril vault connect https://github.com/my-org/shared-vault.git

># Pull updates
>tendril vault sync
```

**Import a project from the catalog:**

```terminal
># Inspect available catalog projects
>tendril vault catalog

># Import with custom local repository paths
>tendril vault import BackendService --repo backend=~/Projects/backend
```

**Publish project updates via pull request:**

```terminal
># Push changes and open a pull request with assigned reviewers
>tendril vault push BackendService --changelog "Added Playwright E2E verification" --reviewer alice,bob
```
