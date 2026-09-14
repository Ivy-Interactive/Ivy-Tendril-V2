---
title: Promptwares
description: >-
  Promptwares are the self-improving agents behind each plan stage — each with its own prompt, tools and
  memory.
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
---

# Promptwares

A promptware is a folder. Deployed copies live under `$TENDRIL_HOME/Promptwares/`, one per promptware:

- **Program.md** — the system prompt: the goal, the procedure and the rules for this one job.
- **Tools/** — scripts the agent may call as tools.
- **Memory/** — long-lived notes that survive between runs. This is what makes a promptware improve
  rather than repeat itself.

Tendril runs them through the coding agent you configured, one job at a time, each with only the tools
that job needs. To install or refresh the standard set:

```bash
tendril promptware deploy
```

## Core jobs

| Promptware       | Role                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| **CreatePlan**   | Draft a plan from a short brief, an inbox item or a GitHub issue.     |
| **ExpandPlan**   | Flesh out a thin plan into something implementable.                   |
| **UpdatePlan**   | Revise an existing plan from review feedback and annotations.         |
| **SplitPlan**    | Break a large plan into smaller sub-plans.                            |
| **ExecutePlan**  | Create the worktree, implement the plan, run the verifications.       |
| **RetryPlan**    | Take another pass at a plan that failed, with the failure as context. |
| **CreatePr**     | Open the pull request from the worktree diff, using `gh`.             |
| **CreateIssue**  | Push a plan failure or state to GitHub for triage.                    |
| **AddProject**   | Register a new project and its repositories.                          |
| **SetupProject** | Work out and record how a project builds, runs and verifies.          |
| **SyncRepo**     | Bring a project's repositories up to date.                            |

## Configuration

Each promptware is configured in `config.yaml` under the `promptwares:` key:

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
      Always include acceptance criteria in the plan.
```

| Field                | Required | Description                                                                                                                                                   |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile`            | Yes      | Which agent profile to use — `quick`, `balanced` or `deep`. Profiles map to a model and an effort level per agent.                                            |
| `allowedTools`       | No       | Tools granted on top of the built-in defaults. Supports the `%PROMPTWARE_DIR%`, `%PLAN_DIR%` and `%PLANS_DIR%` variables, so a grant can be scoped to a path. |
| `deniedTools`        | No       | Tools withheld, even if something else would have granted them.                                                                                               |
| `customInstructions` | No       | Free text injected into the agent prompt.                                                                                                                     |

The `_default` entry is a baseline applied to every promptware; a named entry overrides it.

### Custom instructions

When `customInstructions` is set, Tendril appends it to the end of the firmware prompt with an explicit
priority marker, and the agent is told to follow it over both the firmware template and the
promptware's own `Program.md`. Use it for per-promptware behavioural overrides without editing shared
program files.

## Execution flow

1. **Context** — load `Program.md`, attach the plan, the project context and any custom instructions
   from `config.yaml`.
2. **Tools** — expose `Tools/` and the configured tool grants, with `%…%` variables expanded to real
   paths.
3. **Run** — the agent runs as a background job with isolated state, in its own worktree where the job
   needs one.
4. **Capture** — output streams to the job's folder in `$TENDRIL_HOME/Jobs/`; tokens and cost are
   appended to the plan's `costs.csv`.

## Memory

Memory is the feedback loop: a promptware writes down what it learned about a project, and reads it
back on the next run. The CLI exposes the whole surface, which is also how a promptware manages its own:

```bash
tendril promptware list-memory ExecutePlan
tendril promptware read-memory ExecutePlan worktree-hygiene.md
tendril promptware write-memory ExecutePlan worktree-hygiene.md
tendril promptware delete-memory ExecutePlan worktree-hygiene.md
```

Memory is meant to be pruned as well as grown — a note that has been falsified should be deleted, not
buried under a correction.

To run a promptware directly, bypassing the job service:

```bash
tendril promptware run CreatePlan "Add a health-check endpoint" --profile deep
```

## Next steps

- [Lifecycle & Jobs](03_Lifecycle.md) — what one promptware run looks like while it is happening.
- [Plans](01_Plans.md) — the artifact every promptware reads and writes.
