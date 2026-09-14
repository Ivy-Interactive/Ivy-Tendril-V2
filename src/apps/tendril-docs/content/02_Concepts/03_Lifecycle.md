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
---

# Lifecycle & Jobs

Every time Tendril does something on your behalf it creates a **job**: one run of one promptware
against one plan. Jobs are how a plan moves, and they are the thing you watch while it is happening.

## Job statuses

| Status        | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| **Pending**   | Created, not yet admitted to the queue.                                      |
| **Queued**    | Waiting for a concurrency slot.                                              |
| **Running**   | The agent is working.                                                        |
| **Completed** | Finished successfully.                                                       |
| **Failed**    | The agent errored, or the work did not pass.                                 |
| **Timeout**   | Exceeded its time limit and was terminated.                                  |
| **Stopped**   | Stopped by you.                                                              |
| **Blocked**   | Cannot proceed — a dependency, a missing credential or a decision is needed. |

## The execution loop

1. **Queue** — the job is created and queued behind whatever is already running.
2. **Prepare** — for a job that writes code, Tendril creates a git worktree per repository under the
   plan's `Worktrees/` folder, so the run never touches your checkout.
3. **Implement** — the promptware works through the plan, committing as it goes.
4. **Verify** — each configured verification runs and its result is recorded.
5. **Report** — output, cost and the resulting plan state are written back.

Stopping a job returns the plan to the state it was in before the job started, and keeps the work
product so you can inspect the worktree. See [Plans](01_Plans.md) for the state table.

## Verifications

A verification is a named check recorded in the plan's `plan.yaml`. Each one gets a result — `Pass`,
`Fail` or `Skipped` — plus a written report in the plan's `Verification/` folder. Which checks a plan
carries depends on what it touches; in this repository the names are:

| Verification    | Checks                                                              |
| --------------- | ------------------------------------------------------------------- |
| **NpmBuild**    | The pnpm workspace builds.                                          |
| **NpmLint**     | Lint and formatting pass on the TypeScript packages.                |
| **NpmTest**     | The Vitest suites pass.                                             |
| **RustBuild**   | The Cargo workspace compiles.                                       |
| **RustClippy**  | Clippy is clean.                                                    |
| **RustFormat**  | `cargo fmt` reports no changes.                                     |
| **RustTest**    | The Rust tests pass.                                                |
| **Screenshots** | UI evidence was captured for a visible change.                      |
| **CheckResult** | The agent's own end-to-end confirmation that the plan's tests hold. |

A verification that does not apply to a plan is marked `Skipped` rather than quietly dropped, so a
report exists either way. A plan reaches **Review** only when its required verifications pass;
otherwise it goes to **Failed** and `RetryPlan` can take another pass with the failure as context.

> [!TIP]
> When a verification fails, run its command by hand in the plan's worktree. The command is usually
> correct and the worktree is usually missing a setup step — see
> [Onboarding a Codebase](../01_GettingStarted/03_Onboarding.md).

## Concurrency & worktrees

Several jobs can run at once, capped by `maxConcurrentJobs` in `config.yaml` (default `20`):

```yaml
maxConcurrentJobs: 4
```

Because each executing plan gets its own worktrees, parallel jobs on the same repository do not
collide — but they do share your machine and your agent's rate limits, so lower the cap if runs start
starving each other.

## Cost tracking

Every run records the tokens it spent and what they cost. The durable record is the plan's
`costs.csv`, appended one row per run:

```
Promptware,Tokens,Cost,Model,CostSource,Agent
ExecutePlan,148213,1.9042,claude-opus-5,api,claude
```

The `Cost` field is left empty rather than zeroed when a run cannot be priced — a flat-rate
subscription, for example — so the tokens are still on record without inventing a number.

## Watching jobs

The desktop app shows live status and streaming output, and the CLI reads the same data:

```bash
tendril job list
tendril job queue
```

`tendril job list` shows every job with its status and plan; `tendril job queue` shows dispatch order,
which is what you want when a job is sitting in `Queued` longer than expected. A job that is blocked
behind others can be promoted with `tendril job force-start <id>`.

Full output for every job lives on disk at `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/` — the
job log, the exact prompt the agent received and the raw agent transcript.

## Next steps

- [Plans](01_Plans.md) — the states jobs move a plan between.
- [Promptwares](02_Promptwares.md) — what actually runs inside a job.
- [Troubleshooting](../01_GettingStarted/06_Troubleshooting.md) — when a job does not behave.
