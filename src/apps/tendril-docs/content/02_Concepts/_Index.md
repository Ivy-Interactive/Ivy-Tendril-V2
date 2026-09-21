---
title: Concepts
description: The three ideas the rest of Tendril is built on — plans, promptwares and jobs.
icon: Layers
groupExpanded: true
searchHints:
  - concepts
  - model
  - architecture
  - plan
  - promptware
  - job
---

# Concepts

Tendril has a concise conceptual model, and everything in the desktop app and the CLI maps to one of
these three core primitives:

- [Plans](01_Plans.md) — the fundamental unit of work. A plan is a transparent folder on disk, a state
  machine, an immutable set of revisions, inline annotations, and automated verifications.
- [Promptwares](02_Promptwares.md) — the single-purpose workflow agents that move a plan from one state
  to the next, each with its own system prompt, bounded tool grants, and long-term memory.
- [Lifecycle & Jobs](03_Lifecycle.md) — one run of one promptware against a plan constitutes a job:
  status, telemetry, isolated git worktrees, cost tracking, and quality gates that determine whether work
  advances to review.

If you have not run the loop yet, the [Tutorial](../01_GettingStarted/04_Tutorial.md) demonstrates these
primitives in action. You can also review [Onboarding a Codebase](../01_GettingStarted/03_Onboarding.md)
to prepare your repositories for parallel worktrees.
