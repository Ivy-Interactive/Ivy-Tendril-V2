---
title: GitHub
description: Tendril integrates with GitHub for issue importing, automatic PR creation, and PR status tracking.
icon: GitBranch
searchHints:
  - github
  - issues
  - pull requests
  - prs
  - import
---

# GitHub

## Authentication

Tendril uses the [GitHub CLI](https://cli.github.com) (`gh`) for authentication with [GitHub](https://github.com). Run `gh auth login` to authenticate before using GitHub features.

> [!NOTE]
> Ensure `gh` is installed and available on your PATH. Tendril will prompt you during onboarding if it is missing.

## Importing Issues via the Inbox

Tendril provides a dedicated **Inbox** view in the sidebar to browse [GitHub](https://github.com) issues and turn them into [plans](../02_Concepts/01_Plans.md):

1. Open **Inbox** from the navigation sidebar.
2. Select a category:
   - **My Issues**: Issues assigned to you across configured project repositories.
   - **Review Requests**: Open pull requests requesting your review.
   - **Project Issues**: All open issues for a selected project repository.
3. Filter by search terms, labels, or milestones. A single query retrieves up to 1,000 open issues (GitHub's search ceiling).
4. Select one or more issues and click **Create Plan** to launch the `CreatePlan` [promptware](../02_Concepts/02_Promptwares.md), or customize the plan description in the New Plan dialog before firing.

Each created plan retains the source URL linking directly back to the original GitHub issue.

### Automated Issue Sweep & Proposals

Tendril includes an automated background sweep for assigned GitHub issues:

- Configure `inbox.checkIntervalMinutes` (or click the Settings gear in the Inbox view) to set how frequently Tendril queries GitHub for newly assigned issues.
- **Auto-Accept Mode**: When `inbox.autoAcceptAssignedIssues` is enabled, newly discovered issues immediately start a `CreatePlan` job.
- **Proposals Mode**: When disabled, swept issues are staged as **Inbox Proposals** in the Inbox view. You can review each proposal's description and choose to **Accept** (initiating the plan) or **Dismiss** (storing a durable record so the issue is never re-imported).
- Click **Check Now** in the Inbox toolbar to trigger an immediate manual sweep without waiting for the scheduled timer.

## Creating Pull Requests

When a plan has completed and verified its changes, open the **Create PR** dialog to create a pull request:

1. Review and edit the generated PR title, description, and reviewers.
2. Configure PR options:
   - **Solve Merge Conflicts**: Automatically attempts to resolve branch merge conflicts against the target base.
   - **Merge**: Merges the PR once checks pass (uncheck to open the PR for team review without merging).
   - **Delete Branch**: Deletes the worktree branch once merged.
   - **Include Artifacts**: Attaches plan verification artifacts, screenshots, and logs to the PR body.
   - **Create as Draft**: Opens the pull request in draft status.
3. Tendril runs the `CreatePr` [promptware](../02_Concepts/02_Promptwares.md) via `gh` to push the branch, create the pull request, and link the PR URL to the plan.

## PR Status Tracking

The [Pull Requests view](../04_Apps/06_PullRequests.md) in the sidebar tracks all open, merged, and closed pull requests across your projects. Tendril monitors PR state changes, keeping your [plan board](../04_Apps/03_Plans.md) in sync without manual intervention.
