---
title: Recommendations
description: Suggested follow-ups (refactors, hygiene, tests) inferred from your repos—no manual ticket required.
icon: Lightbulb
searchHints:
  - recommendations
  - suggestions
  - auto
---

# Recommendations

The Recommendations app is Tendril's triage center for AI-suggested codebase improvements, test coverage additions, architectural cleanups, and technical debt items discovered during plan executions.

## Sourcing & Eligibility

As [Coding Agents](../06_CodingAgents/_Index.md) analyze, execute, and verify plans, they surface related improvements (e.g. untested edge cases, deprecated dependencies, refactoring opportunities, or performance bottlenecks).

To keep recommendations actionable and avoid premature work:

- Only recommendations originating from **Completed** plans appear in the Recommendations app (see [Plan Lifecycle](../02_Concepts/03_Lifecycle.md)).
- Recommendations originating from failed or executing plans remain attached to their source plan until that plan succeeds.

## The Recommendations Queue

The sidebar presents all pending recommendations:

- **Source Plan Tag** — Displays the origin plan number (e.g. `#14`).
- **Title** — Concise description of the suggested improvement.
- **Project Badge** — Identifies which project repository the recommendation targets (configured in [Project Setup](../03_Configuration/02_Projects.md)).
- **Impact Badge** — Color-coded urgency and value assessment:
  - `High` (green) — Critical fixes, significant refactors, or essential test gaps.
  - `Medium` (amber) — Cleanups, maintainability improvements, or non-blocking enhancements.
  - `Low` (neutral) — Minor polish or cosmetic improvements.

## Detail View & Triage Actions

Selecting a recommendation displays its full technical rationale, impact assessment, and a link to open the original **Source Plan** in [Plans](03_Plans.md).

Developers can triage recommendations using four core actions:

| Action                  | Control            | Effect                                                                                                                                                                                                                    |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accept**              | CircleCheck button | Marks recommendation `Accepted` and immediately starts a `CreatePlan` background [Job](04_Jobs.md) (see [Promptwares](../02_Concepts/02_Promptwares.md)) to scaffold a new implementation draft in [Plans](03_Plans.md).  |
| **Accept with Notes**   | Check button       | Opens `RecommendationNoteDialog` allowing the developer to add specific constraints or requirements. The agent receives both the original recommendation and the operator's notes.                                        |
| **Decline**             | X button           | Marks recommendation `Declined` with optional decline notes, removing it from the pending queue.                                                                                                                          |
| **Create GitHub Issue** | GitHub icon button | Opens `CreateIssueDialog` to file the recommendation directly as a [GitHub](https://github.com) issue via the [GitHub CLI](https://cli.github.com) (`gh`) in the project repository. Leaves the recommendation `Pending`. |

Once an action is completed, Tendril automatically advances to the next recommendation in the queue, allowing rapid review of proposed improvements.
