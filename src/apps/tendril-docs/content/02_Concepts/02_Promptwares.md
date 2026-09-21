---
title: Promptwares
description: >-
  Promptwares are the single-purpose workflow agents behind each plan stage — each with its own prompt,
  tools and long-term memory.
icon: Terminal
searchHints:
  - promptware
  - agent
  - prompt
  - tools
  - memory
  - allowedTools
  - profile
  - customInstructions
  - layers
---

# Promptwares

A promptware is a directory containing the instructions, tools, and memory that define a single-purpose
workflow agent. Deployed copies live under `$TENDRIL_HOME/Promptwares/`, one per promptware:

- **Program.md** — the system prompt: the agent's goal, step-by-step procedure, and execution rules.
- **Tools/** — executable scripts and utilities the agent may call during its run.
- **Memory/** — persistent Markdown notes that survive between runs. This feedback loop allows promptwares
  to learn codebase idiosyncrasies and improve rather than repeat errors.

Tendril dispatches promptwares through your configured coding agent (such as
[Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Codex](../06_CodingAgents/02_Codex.md),
[Copilot](../06_CodingAgents/03_Copilot.md), [Gemini](../06_CodingAgents/05_Gemini.md),
[OpenCode](../06_CodingAgents/04_OpenCode.md), Antigravity, or [Cursor](https://www.cursor.com)), executing
one job at a time with least-privilege tool grants.

## Deployment & layers

Tendril ships a standard set of promptwares built into the platform. Teams can also configure an overlay
directory in [config.yaml](../03_Configuration/01_Setup.md) to override system prompts or supply custom
team tools.

Deploy or refresh promptwares:

```bash
tendril promptware deploy
```

To inspect whether a promptware is running from the shipped baseline or a team overlay:

```bash
tendril promptware layers
# or check a specific promptware:
tendril promptware layers ExecutePlan
```

## Core workflow agents

| Promptware       | Role                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| **CreatePlan**   | Draft a plan from a short brief, an inbox item, or a [GitHub](https://github.com) issue.                  |
| **ExpandPlan**   | Flesh out a thin plan into an implementable specification with phases.                                    |
| **UpdatePlan**   | Revise an existing plan from reviewer feedback, chat, and inline annotations.                             |
| **SplitPlan**    | Break a large plan into smaller, independent sub-plans.                                                   |
| **ExecutePlan**  | Create isolated [git worktrees](https://git-scm.com/docs/git-worktree), implement plan phases, run tests. |
| **RetryPlan**    | Take another pass at a plan that failed verification, using logs and diffs.                               |
| **CreatePr**     | Open a GitHub pull request from worktree diffs using [GitHub CLI](https://cli.github.com/) (`gh`).        |
| **CreateIssue**  | Push a plan failure, state, or triage request to GitHub issues.                                           |
| **AddProject**   | Register a new project and configure its repository paths.                                                |
| **SetupProject** | Work out and record how a project builds, runs, and verifies.                                             |
| **SyncRepo**     | Bring a project's repositories up to date with upstream branches.                                         |

## Configuration

Each promptware is configured in [~/.tendril/config.yaml](../03_Configuration/01_Setup.md) under the
`promptwares:` key:

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

| Field                | Required | Description                                                                                                                                                   |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile`            | Yes      | Which agent profile to use — `quick`, `balanced`, or `deep`. Profiles map to a model and an effort level per agent.                                           |
| `allowedTools`       | No       | Tools granted on top of the built-in defaults. Supports `%PROMPTWARE_DIR%`, `%PLAN_DIR%`, and `%PLANS_DIR%` variables to scope tool grants to specific paths. |
| `deniedTools`        | No       | Tools withheld, even if something else would have granted them.                                                                                               |
| `customInstructions` | No       | Free text injected into the agent prompt with priority override markers.                                                                                      |

The `_default` entry is a baseline applied to every promptware; a named entry overrides it.

### Custom instructions

When `customInstructions` is set, Tendril appends it to the compiled firmware prompt with an explicit
priority marker. The agent is instructed to follow it over both the firmware template and the
promptware's own `Program.md`. Use it for per-promptware behavioral overrides without editing shared
program files.

## Execution flow

1. **Context** — compile `Program.md`, attach the plan, inline annotations, project configuration, and
   any `customInstructions` from `config.yaml`.
2. **Tools & permissions** — expose `Tools/` and configured tool grants, expanding `%...%` variables to
   absolute paths. Writable directories are strictly bounded to the plan folder, the promptware's
   `Memory/`, and repository git worktrees.
3. **Run** — launch the coding agent as a background job process in its isolated worktree.
4. **Capture & telemetry** — stream live output to `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`,
   emit progress to the daemon, and record token usage and cost in the plan's `costs.csv`.

## Memory & learning

Memory is the feedback loop: a promptware writes down what it learned about a project or failure mode,
and reads it back on future runs. The CLI exposes memory management directly:

```bash
# List stored memory notes for a promptware
tendril promptware list-memory ExecutePlan

# Read specific memory notes
tendril promptware read-memory ExecutePlan worktree-hygiene.md

# Write or update a memory note from a file (or stdin)
tendril promptware write-memory ExecutePlan worktree-hygiene.md --file notes.md

# Delete an obsolete or falsified memory note
tendril promptware delete-memory ExecutePlan worktree-hygiene.md
```

> [!TIP]
> Memory is meant to be pruned as well as grown — an assumption or rule that has become obsolete should
> be deleted with `delete-memory`, not buried under contradicting notes.

## Direct execution

To test or run a promptware directly in the foreground, bypassing the daemon job service:

```bash
# Run CreatePlan directly with a task prompt
tendril promptware run CreatePlan "Add a health-check endpoint" --profile deep

# Print the compiled firmware prompt without launching the agent
tendril promptware run CreatePlan "Add a health-check endpoint" --dry-run
```

## Next steps

- [Lifecycle & Jobs](03_Lifecycle.md) — what one promptware run looks like while it is happening.
- [Plans](01_Plans.md) — the artifact every promptware reads and writes.
