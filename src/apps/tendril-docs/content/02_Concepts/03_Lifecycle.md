---
title: Lifecycle & Jobs
description: >-
  A job is one run of one promptware. This is what happens while it runs — status, output,
  verifications and cost.
icon: RefreshCw
searchHints:
  - job
  - lifecycle
  - status
  - verification
  - worktree
  - concurrency
  - cost
  - tokens
  - queue
  - stop-all
---

# Lifecycle & Jobs

Every time Tendril does something on your behalf it creates a **job**: one run of a single
[workflow agent (promptware)](02_Promptwares.md) against one [plan](01_Plans.md). Jobs are how a plan
moves through its lifecycle, and they are what you observe in real time in the desktop app and CLI.

## Job statuses

| Status        | Meaning                                                               |
| ------------- | --------------------------------------------------------------------- |
| **Pending**   | Created, not yet admitted to the queue.                               |
| **Queued**    | Waiting for an available concurrency slot.                            |
| **Running**   | The coding agent process is actively executing.                       |
| **Completed** | Finished successfully and passed all required gates.                  |
| **Failed**    | The agent errored, or required verification checks failed.            |
| **Timeout**   | Exceeded its configured execution time limit and was terminated.      |
| **Stopped**   | Stopped by user action.                                               |
| **Blocked**   | Cannot proceed — waiting on a dependent job, credential, or decision. |

## The execution loop

1. **Queue** — the job is created and queued behind currently running tasks.
2. **Prepare** — for code-modifying promptwares ([ExecutePlan](02_Promptwares.md),
   [RetryPlan](02_Promptwares.md)), Tendril provisions an isolated
   [Git worktree](https://git-scm.com/docs/git-worktree) per repository under the plan's
   `Worktrees/{repo-name}/` folder. The run never touches or locks your primary working checkout.
3. **Implement** — the workflow agent works through the plan phases, making incremental commits.
4. **Verify** — each configured verification gate executes in the worktree and records its result.
5. **Report** — output logs, token costs, and updated plan state are saved to disk and reported to the
   daemon.

Stopping a job returns the plan to the state it was in before the job began, while preserving the
worktree state so you can inspect partial progress. See [Plans](01_Plans.md) for the complete state table.

## Verifications

A verification is an automated quality gate recorded in `plan.yaml`. Each check produces a result —
`Pass`, `Fail`, or `Skipped` — along with a detailed report in the plan's `Verification/` folder.
Which checks run depends on what files the plan modifies:

| Verification    | Checks                                                           |
| --------------- | ---------------------------------------------------------------- |
| **NpmBuild**    | The pnpm / npm workspace builds cleanly.                         |
| **NpmLint**     | Linting and formatting pass on TypeScript / JavaScript packages. |
| **NpmTest**     | Automated test suites pass (Vitest, Jest, etc.).                 |
| **RustBuild**   | Cargo packages compile without compiler errors.                  |
| **RustClippy**  | Clippy linter reports no warnings or errors.                     |
| **RustFormat**  | `cargo fmt --check` reports consistent formatting.               |
| **RustTest**    | Rust unit and integration test suites pass.                      |
| **Screenshots** | Visual evidence was captured for UI modifications.               |
| **CheckResult** | The agent's own end-to-end confirmation that plan criteria hold. |

A verification that does not apply to a plan is marked `Skipped` rather than silently omitted,
ensuring an explicit audit trail. A plan reaches **Review** only when its required verifications pass.
If a verification fails, the plan enters **Failed**, and
[RetryPlan](02_Promptwares.md) can take another pass with the exact error output
and current diff as context.

> [!TIP]
> When a verification fails, inspect the report in `Verification/` and test the command directly in
> the plan's worktree. The check is usually correct and the worktree may just be missing a dependency
> or build artifact — see [Onboarding a Codebase](../01_GettingStarted/03_Onboarding.md).

## Concurrency & worktrees

Multiple jobs can run simultaneously, governed by `maxConcurrentJobs` in
[~/.tendril/config.yaml](../03_Configuration/01_Setup.md) (default `20`):

```yaml
maxConcurrentJobs: 4
```

Because each executing plan operates inside dedicated [git worktrees](https://git-scm.com/docs/git-worktree),
parallel jobs on the same repository do not collide. However, parallel runs share your CPU, memory, and
coding agent API rate limits, so adjust `maxConcurrentJobs` to suit your workstation.

## Cost tracking

Every run records the tokens spent and estimated dollar costs. The durable audit log is the plan's
`costs.csv`, appended with one row per run:

```csv
Promptware,Tokens,Cost,Model,CostSource,Agent
ExecutePlan,148213,1.9042,claude-opus-5,api,claude
```

When an agent runs on an unmetered subscription (or local model like Apple Foundation Models), the
`Cost` field remains empty rather than recording zero, preserving token metrics without fabricating
dollar amounts.

## Managing & inspecting jobs

The desktop app displays live job status and streaming terminal output via the daemon's WebSocket
stream. The CLI provides full parity:

```bash
# List all active and recent jobs
tendril job list

# Filter jobs by status
tendril job list --status Running
tendril job list --status Failed

# Inspect dispatch queue order and available slots
tendril job queue

# Promote a queued or blocked job to run immediately
tendril job force-start <job-id>

# Cancel a running job
tendril job cancel <job-id> -m "Stopping for review"

# Halt every running, queued, and blocked job
tendril job stop-all

# Clean up completed or failed jobs from the database
tendril job clear --completed
tendril job clear --failed
```

Full logs and transcripts for every run are permanently stored on disk at
`$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`, including the raw system prompt, tool execution
traces, and agent transcripts.

## Next steps

- [Plans](01_Plans.md) — the states jobs move a plan between.
- [Promptwares](02_Promptwares.md) — what actually runs inside a job.
- [Troubleshooting](../01_GettingStarted/06_Troubleshooting.md) — diagnosing stuck or failing jobs.
