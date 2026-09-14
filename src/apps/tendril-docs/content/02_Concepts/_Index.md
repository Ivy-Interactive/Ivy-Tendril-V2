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

Tendril has a small vocabulary, and everything in the app and the CLI is one of these three things:

- [Plans](01_Plans.md) — the unit of work. A plan is a folder on disk, a state, a set of revisions and
  a set of verifications.
- [Promptwares](02_Promptwares.md) — the single-purpose agents that move a plan from one state to the
  next, each with its own prompt, tools and memory.
- [Lifecycle & Jobs](03_Lifecycle.md) — one run of one promptware is a job: status, output, cost, and
  the verifications that decide whether the work advances.

If you have not run the loop yet, [Tutorial](../01_GettingStarted/04_Tutorial.md) makes these concrete
in about twenty minutes.
