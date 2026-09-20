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

This is the whole loop, once, on a repository you already have. Budget twenty minutes plus however
long your build takes.

## Step 1: Build and verify

Follow [Installation](02_Installation.md) to build the workspace and put `tendril` on your `PATH`, then
check the environment:

```bash
tendril doctor
```

Every line is prefixed `[OK]`, `[WARN]` or `[FAIL]`. Fix the failures before continuing — a missing
`git`, an unreadable database or an invalid `config.yaml` will stop a job at the worst moment.

## Step 2: Start Tendril

```bash
pnpm dev:app
```

The desktop app opens and starts the `tendril serve` daemon behind it. You do not need a browser: the
daemon exposes the REST and WebSocket API, and the app is the interface to it.

If you would rather run the daemon yourself — to attach the CLI to it, or to tunnel it — do that
instead:

```bash
tendril serve --host 127.0.0.1 --port 5010
```

## Step 3: Register your repository

You need a local git repository for Tendril to work in. Any project will do:

```bash
git clone https://github.com/your-org/your-repo.git
```

Register it from the app's **Settings → Projects**, or from the CLI:

```bash
tendril project add MyProject
tendril project add-repo MyProject /Users/you/Repos/MyProject
tendril project add-verification MyProject CheckResult
```

Either route writes to `$TENDRIL_HOME/config.yaml`, which you can also edit directly:

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

Set `codingAgent` to the agent you want (`claude`, `codex`, `copilot`, `gemini`, `opencode`,
`apple`) and pick
verifications that match your stack. `verifications` names entries from the top-level `verifications:`
list, each of which carries the prompt the agent follows to run that check.

> [!TIP]
> Add an `AGENTS.md` or `CLAUDE.md` at your repo root with the project's conventions. Tendril passes it
> to the agent as context, and it is the cheapest quality improvement available.
> [Onboarding a Codebase](03_Onboarding.md) covers what to put in it.

## Step 4: Create a plan

Click **New Plan** in the app and describe what you want built or fixed. Tendril runs the `CreatePlan`
promptware, which drafts a structured plan: problem, solution, tests. The project's verifications are
seeded onto the plan, and you can toggle which of them run.

The CLI does the same thing:

```bash
tendril plan create "Add a health-check endpoint" MyProject
```

Either way the plan starts in **Draft**. Open it and read the drafted revision — this is the cheap
moment to correct the scope. Annotate anything that is wrong and let `UpdatePlan` fold your notes in.

## Step 5: Execute the plan

When the draft looks right, hit **Execute**. `ExecutePlan` then:

1. creates a **git worktree**, an isolated checkout, so your working branch is untouched;
2. reads the plan, the repository's conventions and the revision;
3. implements the change and commits it;
4. runs the plan's **verifications** — build, lint, test, whatever you configured.

Watch it live in the **Jobs** view, or from the CLI:

```bash
tendril job list          # every job with its status
tendril job queue         # what is waiting, in dispatch order
```

If the agent finishes and the required verifications pass, the plan moves to **Review**.

> [!NOTE]
> If execution fails, the plan moves to **Failed** and the worktree is kept. Read the job log under
> `$TENDRIL_HOME/Jobs/`, fix the blocker, and retry — the agent picks up from the preserved worktree.

## Step 6: Review the result

Open the plan and use the review screen to:

- **browse the diff** — exactly what changed, file by file;
- **check verifications** — each one's status and its report;
- **read the execution log** — the job log, the prompt the agent received and the raw agent
  transcript;
- **view recommendations** — follow-up work the agent flagged while it was in there.

Approve what you are happy with. Tendril then runs `CreatePr` to open the pull request from the
worktree branch, and the plan moves to **Completed**. If something needs another pass, send the plan
back and re-execute.

## What just happened

You ran the full Tendril loop:

```
Draft → Creating → Executing → Review → Completed
```

The agent worked in an isolated worktree, ran your verification suite, and left behind a reviewable
diff and a plan folder on disk that records every step.

## Next steps

- [Plans](../02_Concepts/01_Plans.md) — the states above in full, and what is inside a plan folder.
- [Promptwares](../02_Concepts/02_Promptwares.md) — how to configure and constrain each agent.
- [Lifecycle & Jobs](../02_Concepts/03_Lifecycle.md) — jobs, verifications, concurrency and cost.
