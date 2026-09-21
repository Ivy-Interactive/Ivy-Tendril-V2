---
title: Tutorial
description: >-
  A complete end-to-end walkthrough: build Tendril, register a local repository, create your first
  plan, execute it with an agent, review the result and open a pull request.
icon: GraduationCap
searchHints:
  - tutorial
  - walkthrough
  - quickstart
  - first plan
  - end to end
  - example
---

# Tutorial

This is the complete end-to-end workflow on a repository of your choice. It covers registering a project,
generating a plan, executing changes in isolated worktrees, reviewing diffs, and shipping a pull request.

## Step 1: Build and verify

Follow [Installation](02_Installation.md) to install or build Tendril and place `tendril` on your `PATH`.
Verify your environment:

```bash
tendril doctor
```

`tendril doctor` audits `$TENDRIL_HOME`, `config.yaml`, the [SQLite](https://www.sqlite.org) database, the
plans directory, [Git](https://git-scm.com/), and [GitHub CLI](https://cli.github.com/) (`gh`). Resolve any
`[FAIL]` items before proceeding.

## Step 2: Start Tendril

Launch the desktop application:

```bash
pnpm dev:desktop
```

The desktop app launches and automatically supervises the `tendril run` daemon in the background. The
daemon exposes the REST and WebSocket API that the desktop UI and CLI communicate over.

If you prefer to run the daemon headlessly:

```bash
# Checks port and runs pending migrations
tendril run

# Or direct listener with custom options:
tendril serve --host 127.0.0.1 --port 5010
```

## Step 3: Register your repository

Tendril requires a local git repository to work with:

```bash
git clone https://github.com/your-org/your-repo.git
```

Register the project from the desktop app's **Settings → Projects**, or via the CLI:

```bash
tendril project add MyProject
tendril project add-repo MyProject /Users/you/Repos/MyProject
tendril project add-verification MyProject CheckResult
```

Both methods update `$TENDRIL_HOME/config.yaml`, which you can also edit manually:

```yaml
codingAgent: claude

projects:
  - name: MyProject
    repos:
      - path: /Users/you/Repos/MyProject
    verifications:
      - name: NpmBuild
        required: true
      - name: CheckResult
        required: true
```

Set `codingAgent` to your installed agent:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models (`apple` via on-device `fm`)

> [!TIP]
> Add an `AGENTS.md` file at your repository root detailing architectural conventions and build commands.
> Tendril injects this into the agent's system context on every run. See
> [Onboarding a Codebase](03_Onboarding.md) for recommendations.

## Step 4: Create a plan

Click **New Plan** in the desktop app and provide a task description. Tendril dispatches the
[CreatePlan](../02_Concepts/02_Promptwares.md) workflow agent, drafting a structured
plan containing problem statements, phased solutions, and verification targets.

You can also create plans from the CLI:

```bash
tendril plan create "Add a health-check endpoint" MyProject
```

The plan enters **Draft**. Open the plan draft to inspect the proposed specification. You can add inline
annotations directly in the UI to correct scope or add constraints, prompting
[UpdatePlan](../02_Concepts/02_Promptwares.md) to synthesize your feedback into a
revised revision.

## Step 5: Execute the plan

Once the draft meets your requirements, click **Execute** (or run `tendril plan execute <plan-id>`).
The [ExecutePlan](../02_Concepts/02_Promptwares.md) agent:

1. creates an isolated [Git worktree](https://git-scm.com/docs/git-worktree) under `Worktrees/{repo-name}/`,
   leaving your primary branch untouched;
2. loads the plan specification, repository context, and memory notes;
3. implements the code modifications phase-by-phase with incremental git commits;
4. runs each configured verification gate (build, lint, test, screenshots).

Monitor execution live in the desktop **Jobs** view or via the CLI:

```bash
tendril job list          # view job statuses
tendril job queue         # inspect dispatch queue order
```

When all phases complete and required verifications pass, the plan transitions to **Review**.

> [!NOTE]
> If a verification check fails, the plan enters **Failed** and the worktree is preserved on disk. Inspect
> the error report under `Verification/` or run
> [RetryPlan](../02_Concepts/02_Promptwares.md) to let the agent fix the problem.

## Step 6: Review the result

Navigate to the plan's **Review** screen to inspect the work:

- **Git Diff** — browse syntax-highlighted diffs across affected files;
- **Verification Reports** — review automated build and test outputs;
- **Execution Transcripts** — read tool call traces, stdout/stderr, and token costs;
- **Follow-up Recommendations** — inspect technical debt or improvements flagged by the agent.

Approve the plan when satisfied. Tendril triggers
[CreatePr](../02_Concepts/02_Promptwares.md) to open a pull request via
[GitHub CLI](https://cli.github.com/) (`gh`), moving the plan to **Completed**.

## What just happened

You completed the standard Tendril development loop:

```
Draft → Creating → Executing → Review → Completed
```

The autonomous agent operated in a sandbox worktree, satisfied your verification gates, and produced an
audited pull request while recording all prompts, diffs, and costs under `$TENDRIL_HOME/Plans/`.

## Next steps

- [Plans](../02_Concepts/01_Plans.md) — deep dive into plan structure, states, and annotations.
- [Promptwares](../02_Concepts/02_Promptwares.md) — customize workflow agent prompts, tools, and memory.
- [Lifecycle & Jobs](../02_Concepts/03_Lifecycle.md) — understand concurrency, queueing, and telemetry.
