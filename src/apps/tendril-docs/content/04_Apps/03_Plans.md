---
title: Plans
description: "Plans in Draft (or Blocked): shape the work before execution (PlansApp)."
icon: Feather
searchHints:
  - draft
  - plan
  - ideation
  - blocked
  - makeplan
---

# Plans

The Plans app is Tendril's workspace for shaping, refining, and preparing engineering work before executing code changes. Working on plans first ensures requirements, architecture, and verification steps are clear before launching agent execution runs.

## Managing Drafts

- **Creating Plans** — Press `Ctrl+Alt+N` (`Cmd+Option+N` on macOS) or click **+ New Plan** in the shell header to open the creation dialog.
- **The Drafts Queue** — The sidebar lists all plans in `Draft` or `Blocked` status. Plans currently running in execution jobs are safely withheld from the draft queue to avoid concurrent edits.
- **Badges** — Each draft displays its `#ID` tag, title, project badge, and complexity level badge (e.g. L1, L2, L3) styled with the project's configured level palette.
- **Process Wallpaper** — When the queue is empty, Tendril displays the interactive process lifecycle wallpaper with navigation to Plans, [Review](02_Review.md), and [Jobs](04_Jobs.md).

## Plan Workspace (`PlanWorkspace`)

Selecting a plan opens the rich workspace interface:

### Tabs

- **Plan** — Displays the latest plan specification revision in [Markdown](https://www.markdownguide.org) with live task checklists, problem description, proposed approach, and verification criteria.
- **Details** — Plan metadata, assigned project context (from [Project Setup](../03_Configuration/02_Projects.md)), created/updated timestamps, and revision history.
- **Diff View** — Appears whenever a plan has multiple revisions (`revisionCount > 1`), providing side-by-side or unified diff comparison between revisions.
- **Recommendations** — Lists proactive [Recommendations](07_Recommendations.md) generated for this plan with inline Accept and Decline triage controls.
- **Git** — Appears once execution artifacts exist. Tracks active [Git](https://git-scm.com) worktrees, recorded commits, PR references (see [Pull Requests](06_PullRequests.md)), and warns if unmerged commits are at risk, with a button to synchronize worktrees with remotes.

### Panels & Chat

- **Verifications Panel** — Accessible from the top-right corner dropdown, this panel displays configured [Verification](../03_Configuration/01_Setup.md#verifications) gates (`Build`, `Test`, `Lint`, etc.) with their real-time pass/fail status and output logs.
- **Plan Chat** — Embedded interactive chat panel (`PlanChatPanel`) to brainstorm, refine approach, or ask the agent questions about the plan before launching code changes.

## Promptware Actions

See [Promptwares](../02_Concepts/02_Promptwares.md) for background on how these workflows execute:

| Action               | Purpose                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ExecutePlan**      | Locks the latest plan revision, creates an isolated [Git](https://git-scm.com) worktree branch, and launches the [Coding Agent](../06_CodingAgents/_Index.md) to implement the changes. |
| **ExpandPlan**       | Prompts an agent to flesh out a brief summary into a structured plan with detailed steps, file targets, and testing plans.                                                              |
| **SplitPlan**        | Breaks a large or complex plan into smaller, focused sub-plans that can execute independently.                                                                                          |
| **Shelve to Icebox** | Moves the plan to the [Icebox](05_Icebox.md) to declutter the active queue while preserving all context.                                                                                |
| **Delete Plan**      | Prompts for confirmation to permanently remove the plan folder and records.                                                                                                             |

## Files on Disk & Real-time Sync

Every plan is backed by a directory under `$TENDRIL_HOME/plans/<planId>/`:

- `plan.yaml` — Plan metadata in [YAML](https://yaml.org), state, project association, and verification records. See [CLI Plan](../09_Advanced/01_CLI/01_Plan.md).
- `revisions/` — Versioned markdown files (`001.md`, `002.md`, etc.) representing each iteration of the specification.
- `costs.csv` — Append-only token and cost ledger.

Tendril uses filesystem watchers to detect edits made in external text editors or IDEs, updating the UI instantly without manual refresh.
