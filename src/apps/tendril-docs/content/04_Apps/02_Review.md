---
title: Review
description: "Queue of finished work: Review or Failed plans. Nothing merges without you."
icon: ThumbsUp
searchHints:
  - review
  - approve
  - reject
  - diff
  - verify
---

# Review

The Review app is Tendril's quality gateway. When an agent finishes executing a plan via `ExecutePlan` (see [Promptwares](../02_Concepts/02_Promptwares.md)), the isolated [Git](https://git-scm.com) worktree is preserved and presented here for developer inspection, verification, and triage. Nothing merges or lands on your default branch without explicit operator approval.

## The Review Queue

The sidebar lists all plans requiring developer attention (plans in `Review` or `Failed` status):

- **Badges** — Each row displays the plan `#ID`, project badge, and [Verification](../03_Configuration/01_Setup.md#verifications) status:
  - `Verified` (green) — All required verification gates passed.
  - `Unverified` (warning) — One or more verification gates failed, or gates have not yet run.
  - State indicator (e.g. `Failed`) to easily spot executions requiring troubleshooting.
- **Keyboard Shortcuts** — Use `ArrowLeft` and `ArrowRight` to quickly step through plans in the review queue.

## Review Workspace

The main workspace presents the plan's implementation and inspection tools:

- **Plan Overview & Comments** — Read the plan specification and leave inline comments (`DraftComment`) to give specific line-by-line feedback.
- **Review Actions Bar** — Project-configured review actions (defined under `reviewActions` in [Project Setup](../03_Configuration/02_Projects.md)) render as one-click buttons in the toolbar (e.g. `Run E2E`, `Smoke Test`).
- **Open Full Spec & Diff** — Accessible from the workspace menu, this opens the plan's complete detail page in [Plans](03_Plans.md) to inspect multi-revision diffs, git worktree commit reachability, and generated artifacts.
- **Embedded Plan Chat** — Use the integrated `PlanChatPanel` to ask the agent questions, inspect execution logic, or clarify implementation details before approving.

## Triage Actions

| Action                      | Control                     | Effect                                                                                                                                                                                                |
| --------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create Pull Request**     | Primary CTA                 | Creates a [GitHub](https://github.com) pull request via the [GitHub CLI](https://cli.github.com) (`gh`), links it to the plan in [Pull Requests](06_PullRequests.md), and marks the plan `Completed`. |
| **Push to PR**              | Primary CTA (if PR exists)  | Pushes new worktree commits to an existing pull request branch.                                                                                                                                       |
| **Request Changes**         | Icon button (badged)        | Opens `SuggestChangesDialog` to submit draft comments and feedback, launching an `UpdatePlan` [Job](04_Jobs.md) in the existing worktree.                                                             |
| **Accept Partial Delivery** | Secondary button            | Opens `PartialDeliveryDialog` to accept working portions of a deliverable while staging remaining items.                                                                                              |
| **Reset to Draft**          | Overflow menu               | Opens `ResetToDraftDialog` to move the plan back to `Draft` in [Plans](03_Plans.md) for re-scoping.                                                                                                   |
| **Delete Plan**             | Overflow menu (destructive) | Opens `DeletePlanDialog` to permanently delete the plan and discard its isolated worktree.                                                                                                            |
