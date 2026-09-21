---
title: Pull Requests
description: Track and open GitHub PRs from Tendril after Review approves CreatePr.
icon: GitPullRequest
searchHints:
  - pull requests
  - pr
  - merge
  - github
---

# Pull Requests

## Flow

Work stays on **branches / worktrees**, not your random dirty tree. After approval, **CreatePr** builds the PR via `gh` from the diff.

## In the app

- **Open** — AI-opened PR awaiting review or CI.
- **Merged** — Landed on the default branch.

You can **merge** from here when checks pass. If CI fails, fix in GitHub or locally and use the usual PR workflow.
