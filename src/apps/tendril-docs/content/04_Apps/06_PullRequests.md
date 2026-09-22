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

The Pull Requests app provides cross-project tracking for all [GitHub](https://github.com) pull requests created from approved Tendril plans. It offers a single dashboard to monitor which PRs are open, merged, or closed, alongside the token spend and cost associated with each delivery.

## PR Lifecycle & Workflow

1. **Approval** — Once a plan finishes execution and is approved in [Review](02_Review.md), clicking **Create Pull Request** launches the `CreatePr` promptware (see [Promptwares](../02_Concepts/02_Promptwares.md)).
2. **Creation** — Tendril uses the [GitHub CLI](https://cli.github.com) (`gh`) to push the isolated [Git](https://git-scm.com) worktree branch and open a pull request on [GitHub](https://github.com) with an AI-generated summary (see [GitHub Integration](../07_Integrations/01_Github.md)).
3. **Tracking** — The pull request is linked to the plan and tracked in this view until merged or closed.

## The Pull Requests Table

The table lists every pull request recorded across your projects:

| Column         | Description                                              | Interaction                                                                                |
| -------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Plan**       | Plan `#ID` and title.                                    | Click to open a slide-over preview sheet displaying the full plan specification.           |
| **Project**    | Project badge.                                           | Displays the project color defined in [Project Setup](../03_Configuration/02_Projects.md). |
| **Status**     | Status badge (`Open`, `Merged`, `Closed`, or `Unknown`). | Hover tooltip displays the timestamp of the last GitHub check.                             |
| **PR**         | GitHub pull request number (e.g. `#84`).                 | Click to open the pull request on [GitHub](https://github.com) in your default browser.    |
| **Tokens**     | Cumulative tokens consumed by the plan.                  | Compact token count (e.g. `450K`, `1.2M`).                                                 |
| **Cost**       | Total USD cost for all jobs on this plan.                | Formatted currency spend.                                                                  |
| **Repository** | GitHub repository target (`owner/repo`).                 | Full target repository path.                                                               |
| **Branch**     | Git branch name.                                         | Source branch in the repository.                                                           |

## Filtering & Synchronization

- **Status Filters** — Use the status badge selector above the table to filter by `Open`, `Merged`, `Closed`, or `Unknown`.
- **Search** — Filter rows in real time across plan ID, title, project name, repository, or branch name.
- **Resync with GitHub** — Click the **Resync** button to run a synchronization pass (`gh pr list`) across configured repositories. Tendril reports any unreachable, unauthenticated, or rate-limited repositories.

> [!NOTE]
> Merged pull requests are terminal and are not re-checked during periodic sync passes.

## Row Actions

Each pull request row provides four quick actions:

- **View Plan** — Navigates to the plan's detail workspace in the [Plans](03_Plans.md) app.
- **Follow Up** — Opens the New Plan dialog prefilled with the repository, project, and branch reference so you can easily scaffold follow-up tasks, bug fixes, or refinements in [Plans](03_Plans.md).
- **Open PR** — Opens the pull request on [GitHub](https://github.com) in your web browser.
- **Resync** — Refreshes status from GitHub for that specific repository.
