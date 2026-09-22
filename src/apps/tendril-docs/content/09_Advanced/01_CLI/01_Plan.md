---
title: plan
description: Create, read, update, and validate plans from the terminal. All subcommands resolve the plan folder from TENDRIL_PLANS, TENDRIL_HOME/Plans, or ~/.tendril/Plans when environment variables are unset.
icon: ListChecks
searchHints:
  - plan
  - create
  - list
  - get
  - set
  - update
  - validate
  - repo
  - pr
  - commit
  - verification
  - recommendation
  - rec
  - log
  - revision
  - doctor
  - depends
  - related
  - env
  - wireframes
---

# plan

Create, read, update, and validate plans from the terminal. All subcommands resolve the plan folder from `TENDRIL_PLANS`, `TENDRIL_HOME/Plans`, or `~/.tendril/Plans` when environment variables are unset.

## CRUD

#### plan create

```terminal
>tendril plan create <title> <project> [options]
```

Creates a new plan folder and `plan.yaml` scaffold with state `Draft`. The plan ID is auto-allocated from the `.counter` file. Repositories and default verifications are derived from the project configuration.

| Option                          | Description                                            |
| ------------------------------- | ------------------------------------------------------ |
| `--level <level>`               | Priority level (default: Feature)                      |
| `--initial-prompt <text>`       | Initial prompt text                                    |
| `--source-url <url>`            | Source URL (GitHub issue or PR)                        |
| `--execution-profile <profile>` | Execution profile (`deep` or `balanced`)               |
| `--priority <number>`           | Priority number (default: 0)                           |
| `--verification <Name=Status>`  | Verification entry (repeatable)                        |
| `--related-plan <folder>`       | Related plan folder name (repeatable)                  |
| `--depends-on <folder>`         | Dependency plan folder name (repeatable)               |
| `--chat-session <id>`           | Associate with a chat session                          |
| `--plans-dir <path>`            | Override plans directory path                          |
| `--no-duplicate-check`          | Skip duplicate detection against existing active plans |

#### plan list

```terminal
>tendril plan list [options]
```

Lists plans with optional filters.

| Option                     | Effect                                                         |
| -------------------------- | -------------------------------------------------------------- |
| `--status` / `--state <s>` | Filter by state (e.g. `Draft`, `Executing`, `Failed`)          |
| `-p, --project <name>`     | Filter by project name (validated against configured projects) |
| `--level <level>`          | Filter by level (e.g. `Bug`, `Feature`, `Epic`)                |
| `--has-pr`                 | Only plans that have associated PRs                            |
| `--has-worktree`           | Only plans that have worktrees                                 |
| `-q, --search <query>`     | Filter by text search substring in title or ID                 |
| `--limit <n>`              | Maximum number of results                                      |
| `--format <fmt>`           | Output format: `table` (default), `ids`, `folders`, `json`     |
| `--plans-dir <path>`       | Override plans directory path                                  |

```terminal
>tendril plan list --state Draft
>tendril plan list --project Tendril --level Critical
>tendril plan list --state Failed --format ids
>tendril plan list --format json --limit 10
```

> [!NOTE]
> `plan list` shows plans (from `plan.yaml` files), not jobs. For job history and execution status, use `job list` instead (see [Other Commands](05_Other.md#job-list)).

#### plan get

```terminal
>tendril plan get <plan-id> [field]
```

Prints the full YAML, or a single field value when `[field]` is provided.

**Scalar fields:** `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`

**List fields:** `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations` (each item on its own line)

#### plan set

```terminal
>tendril plan set <plan-id> <field> <value> [options]
>tendril plan set <plan-id> state Completed --allow-failed-verifications
```

Updates a single field and bumps the `updated` timestamp automatically.

Supported fields: `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`.

Setting `state` to `Completed` is refused while any verification is in the `Fail` state: a plan that reads as done while a gate rejected the work hides a missing deliverable from duplicate detection. Re-run the verification, or set it to `Skipped` with an explicit reason. Passing `--allow-failed-verifications` records the transition anyway and sets `partialDelivery: true`.

| Option                         | Effect                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| `--allow-failed-verifications` | Allow moving to `Completed` even with failing verifications         |
| `--reason <text>`              | Explain why the edit was made (reported to listening chat sessions) |
| `--chat-session <id>`          | Originating chat session (excluded from self-notification)          |

#### plan update

```terminal
>cat revised.yaml | tendril plan update <plan-id> --stdin
>tendril plan update <plan-id> --file revised.yaml
```

Replaces the entire `plan.yaml` content from `--file` or `--stdin` (required — `--stdin` is not implicit).

#### plan check-wireframes

```terminal
>tendril plan check-wireframes <plan-id>
```

Checks for wireframe code leakage in a plan's modified files. Exits 0 if clean, or exits 1 with a diagnostic report if any wireframe markers are found.

#### plan validate

```terminal
>tendril plan validate <plan-id>
```

Checks that the plan has all required fields and is internally consistent. Exits with code `1` on structural errors.

## Repos

```terminal
>tendril plan add-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
>tendril plan remove-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
```

Manage the list of repositories associated with a plan. Adding an existing repo is an idempotent no-op.

## Links

```terminal
>tendril plan add-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan remove-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan add-commit <plan-id> <sha> [--reason <text>] [--chat-session <id>]
>tendril plan add-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan add-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
```

Manage PR URLs, commit SHAs, related plans, and blocking dependencies. `add-depends-on` causes `ExecutePlan` to wait for the dependency to reach `Completed` state and merge its PRs before executing. All names are matched case-insensitively.

## Verifications

```terminal
>tendril plan set-verification <plan-id> <name> <status> [--reason <text>] [--chat-session <id>]
>tendril plan verification list <plan-id> [--status <status>] [--json]
>tendril plan verification add <plan-id> <name> [--status <status>] [--reason <text>] [--chat-session <id>]
>tendril plan verification remove <plan-id> <name> [--reason <text>] [--chat-session <id>]
```

Manage verifications on a plan. Valid statuses: `Pending`, `Pass`, `Fail`, `Skipped`. Default status for `add` is `Pending`.

## Worktrees

#### plan cleanup

```terminal
>tendril plan cleanup <plan-id> [--force]
```

Removes all git worktrees associated with a plan. By default only runs on plans in a terminal state (`Completed`, `Failed`, `Skipped`, `Icebox`). Use `--force` to remove worktrees for non-terminal plans.

#### plan add-worktree

```terminal
>tendril plan add-worktree <plan-id> <repo> [--base <branch>]
```

Creates a git worktree for the given plan under `<plan-folder>/Worktrees/<repo-name>`, branching from `origin/<base>` (default: auto-detected default branch). The branch is named `tendril/<plan-folder-name>`.

#### plan remove-worktree

```terminal
>tendril plan remove-worktree <plan-id> <repo-name> [--branch <branch>]
```

Removes a single worktree from `Worktrees/<repo-name>`. Attempts `git worktree remove --force` first; falls back to a force-delete. Also deletes the associated branch (`tendril/<plan-folder>` by default).

## Revisions

```terminal
>cat revision.md | tendril plan write-revision <plan-id> --stdin
>tendril plan write-revision <plan-id> --file revision.md
```

Writes a numbered revision file to `Revisions/` (e.g. `002.md`) from stdin or `--file`. Supports `--no-question-check` to bypass validation, and `--reason` / `--chat-session` for audit attribution.

```terminal
>tendril plan get-revision <plan-id> [--number <n>]
```

Prints revision content to stdout — the latest revision by default, or a specific numbered revision when `--number` is given.

## Questions

A revision can carry questions for the user in fenced `questions` blocks:

````markdown
```questions
questions:                    # 1-4 items
  - id:          string       # required, stable, unique across the whole revision
    title:       string       # required, the question
    header:      string       # optional, <=12 char chip label
    description: markdown     # optional, context shown under the question
    multiple:    bool         # optional, default false; true = multi-select
    options:                  # 2-4 items; omit entirely for a pure free-text question
      - title:       string   # required, 1-5 words
        description: markdown # optional
        value:       slug     # required, ^[a-z0-9][a-z0-9-]*$, referenced by `answer`
        recommended: bool     # optional, max one per question
    answer:      value | [values] | string   # filled in on response
```
````

`write-revision` validates every question block against this schema and rejects the revision if any block is malformed. Use `--no-question-check` only in automated tests.

## Recommendations

```terminal
>tendril plan rec list <plan-id> [--state <state>]
>tendril plan rec all [--project <project>] [--state <state>]
>tendril plan rec rebuild
>tendril plan rec add <plan-id> <title> [-d <description>] [--impact <level>]
>tendril plan rec set <plan-id> <title> <field> <value>
>tendril plan rec accept <plan-id> <title> [--notes <text>]
>tendril plan rec decline <plan-id> <title> [--reason <text>] [--edit-reason <text>]
>tendril plan rec remove <plan-id> <title>
```

Manage recommendations stored in a plan's YAML:

- **list** — list recommendations for a plan; filter by state: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`
- **all** — list recommendations across every plan
- **rebuild** — rebuild the denormalized recommendations projection from disk
- **add** — impact levels: `Small`, `Medium`, `High`
- **set** — supported fields: `title`, `description`, `state`, `impact`, `declineReason`, `notes`
- **accept** — sets state to `Accepted`, or `AcceptedWithNotes` if `--notes` is provided
- **decline** — sets state to `Declined`. `--reason` records why it was declined in `plan.yaml`; `--edit-reason` specifies the notification reason for chat sessions
- **remove** — permanently deletes a recommendation

## Environment

```terminal
>tendril plan env materialize <plan-id> [--repo <repo>] [--force] [--json]
>tendril plan env get <plan-id> [--repo <repo>] [--json]
```

Inspect and write the plan's port allocations and environment files:

- **materialize** — allocates non-conflicting service ports and writes environment files into the plan's worktrees. Use `--force` to overwrite existing files.
- **get** — prints allocated ports and resolved environment variables for a worktree.

## Doctor

```terminal
>tendril plan doctor [options]
```

Scans every folder in the plans directory and reports health issues.

| Option          | Effect                                                                |
| --------------- | --------------------------------------------------------------------- |
| `--fix`         | Migrate plan schemas to the latest version automatically              |
| `--prs`         | Verify every recorded pull request against GitHub via `gh`            |
| `--prune-husks` | Remove empty plan folders that hold no revision and no work artifacts |
| `--dry-run`     | With `--prune-husks`, report what would be removed without deleting   |

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

### Partial delivery backfill

The report lists plans marked `Completed` with a verification in the `Fail` state and no `partialDelivery` flag. These predate the completion guard. To acknowledge the partial delivery:

```terminal
>tendril plan set <id> state Completed --allow-failed-verifications
```
