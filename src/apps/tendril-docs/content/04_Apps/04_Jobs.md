---
title: Jobs
description: "Running and past promptware runs: status, cost, duration, and live output."
icon: Activity
searchHints:
  - jobs
  - running
  - execution
  - agents
  - status
---

# Jobs

## Overview

Any dispatched promptware (Execute from Drafts, Revise from Review, …) shows up as a job with:

- **Status** — `Running`, `Completed`, `Failed`, `Pending`, …
- **Type** — e.g. `CreatePlan`, `ExecutePlan`, `UpdatePlan`, `CreatePr`
- **Tokens** — Usage vs. your provider quota

## Live output

Built-in terminal shows **stdout/stderr** from the agent (builds, logs, errors)—not only a spinner.

## Controls

| Action          | Effect                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Stop**        | End the run and return the plan to its previous state. The work product (worktree) is kept so you can resume.             |
| **Rerun**       | Re-run the job when a transition is stuck.                                                                                |
| **Force Start** | Start a queued or blocked job immediately, skipping dependency checks.                                                    |
| **Debug**       | Open the Job Debug sheet: the Job Log, Job Prompt, Job Raw Log and Job Eventwire Log, each openable in your editor.       |
| **Delete**      | Remove the job from history. For an `ExecutePlan` job this also discards its work product and resets the plan to `Draft`. |
