---
title: verification
description: Manage global verification definitions stored in config.yaml. These can be referenced by projects and plans.
icon: ClipboardCheck
searchHints:
  - verification
  - verify
  - check
  - prompt
  - definition
  - gates
---

# verification

Manage global verification definitions stored in `config.yaml`. Verification gates define automated quality, build, and test checks that coding agents must satisfy before a [plan](01_Plan.md) can transition to `Completed`. They are assigned to projects via [`tendril project add-verification`](02_Project.md#verifications).

## Commands

```terminal
>tendril verification list [--json]
>tendril verification get <name>
>tendril verification add <name> [--prompt <text>]
>tendril verification set <name> [--new-name <name>] [--prompt <text>]
>tendril verification remove <name> [--force]
```

- **list** — displays all registered global verifications. Pass `--json` to output as structured JSON.
- **get** — prints the verification's name and full evaluation prompt text to stdout.
- **add** — registers a new verification check with an optional prompt description.
- **set** — updates a verification definition's prompt or renames it. Renaming a verification updates all project references, plan YAML records, and database rows automatically.
- **remove** — deletes a verification definition. If any active project references the check, Tendril refuses the removal unless `--force` (or `-f`) is supplied, which cleans up references across all projects.

## Examples

```terminal
># Add a new verification gate with prompt instructions
>tendril verification add CargoTest --prompt "Run cargo test --workspace and ensure all test suites pass with exit code 0."

># Inspect full prompt details
>tendril verification get CargoTest

># Update the evaluation prompt
>tendril verification set CargoTest --prompt "Run cargo test --workspace --all-targets and verify zero test failures."

># Rename a verification definition across projects and plans
>tendril verification set CargoTest --new-name RustWorkspaceTests

># List all definitions in JSON format
>tendril verification list --json

># Remove a verification, cleaning up project references
>tendril verification remove RustWorkspaceTests --force
```

## Related

- [project verifications](02_Project.md#verifications) — configure which checks are required for a project
- [plan verifications](01_Plan.md#verifications) — inspect or override verification gate statuses on a plan
- [Configuration Reference](../../03_Configuration/01_Setup.md) — manage global settings in `config.yaml`
