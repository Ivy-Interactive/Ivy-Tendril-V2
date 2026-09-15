---
name: tendril-debug-plan
description: Debug a Tendril plan by analyzing its execution logs, session JSONL, verification results, and checking infrastructure. Produces actionable bugfix and improvement recommendations. Use when the user wants to investigate why a plan failed, behaved unexpectedly, or to audit plan execution quality.
---

# tendril-debug-plan

Debug and analyze Tendril plan executions end-to-end - from plan creation through checking/verification - and produce a set of concrete bugfix and improvement recommendations.

## Invocation

```
/tendril-debug-plan <planid> <note>
```

* **planid** - 5-digit Tendril plan ID (e.g., `03451`)
* **note** - free-text context about what to look for (e.g., "verification passed but should not have", "took forever", "got stuck in Executing state")

## What This Skill Does

1. Gathers all artifacts for a plan: `plan.yaml`, revisions, logs, costs, verification reports, session JSONL
2. Analyzes the execution timeline, token usage, tool call patterns, and error loops
3. Cross-references findings with Tendril source code and promptware instructions
4. Produces a structured recommendations report with concrete fixes

## Execution Steps

### Phase 1 - Gather Plan Artifacts

Resolve paths from environment:

* `TENDRIL_HOME` - base config/data directory
* `TENDRIL_PLANS` - plans directory (defaults to `$TENDRIL_HOME/Plans`)
* `REPOS_HOME` - for locating Tendril source code

Read these files from the plan folder (`$TENDRIL_PLANS/{planid}-*/`):

| File | Purpose |
| ---- | ------- |
| `plan.yaml` | Plan metadata: state, repos, commits, PRs, verifications, dependsOn |
| `revisions/*.md` | Plan scope, acceptance criteria, verification checkboxes. Last one is the executable revision. |
| `costs.csv` | Token/cost breakdown per promptware (if available) |
| `verification/*.md` | Verification reports (PreExecution, NpmTest, RustTest, CheckResult, etc.) |
| `worktrees/` | Check if worktrees were created/cleaned up |

The plan folder holds **no logs**. Every job that ran against the plan wrote its artifacts flat into
`$TENDRIL_HOME/Jobs/`, named `{jobId}-{planId}-{promptware}`. Find them all for a plan with:

```bash
ls "$TENDRIL_HOME/Jobs/"*"-{planid}-"*
```

| File | Purpose |
|------|---------|
| `{stem}.md` | Job Log - status, timings, cost, CLI command, final output, agent `## Agent Log` narrative |
| `{stem}.prompt.md` | Job Prompt - the exact prompt handed to the agent |
| `{stem}.raw.jsonl` | Job Raw Log - full unparsed CLI session data |
| `{stem}.eventwire.jsonl` | Job Eventwire Log - Tendril's parsed event stream |

Note that the `CreatePlan` job that created the plan is named `{jobId}-CreatePlan` with **no** plan id,
so it will not appear in the glob above. Use `/tendril-debug-job` to drill into any single job.

### Phase 2 - Locate and Analyze Session JSONL

Each Job Log contains a `SessionId`. The raw Claude session data lives at:

```
~/.claude/projects/*/{SessionId}.jsonl
```

Use `find ~/.claude/projects -name "{SessionId}.jsonl"` to locate each file.

For each JSONL session, extract:

**Token Usage:**

* Sum `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` from `type: "assistant"` messages
* Cache hit ratio: `cache_read / (cache_read + cache_creation + input)`
* Flag messages with unusually high `input_tokens` (context bloat)

**Tool Call Patterns:**

* Count each tool type (Read, Write, Edit, Bash, Grep, Glob)
* Identify repeated reads of the same file (redundant)
* Identify failed tool calls and their errors
* Detect thrashing: read-edit-read-edit cycles on the same file

**Error Patterns:**

* Grep for `error`, `failed`, `exception`, `timeout` in tool results
* Count compilation fix-retry cycles (build -> error -> edit -> build loops)
* Permission errors, missing files, environmental issues

**Time Analysis:**

* Wall-clock duration from first to last timestamp
* Long gaps between messages (slow tools, rate limiting)
* Timeout detection

### Phase 3 - Analyze the Checking/Verification Pipeline

This is the core debugging focus. Examine:

**Pre-execution checks (ExecutePlan Step 1.5-1.8):**

* Did dependency checking work correctly? (`dependsOn` plans completed, PRs merged)
* Did worktree validation catch problems? Or miss them?
* Did code state validation (`**Current implementation**` blocks) match reality?
* Did auto-commit handle dirty files properly?

**Verification execution (ExecutePlan Step 7):**

* Which verifications ran vs were skipped?
* Did verifications match what the plan revision specified?
* For each verification: did the prompt execute correctly? Were failures diagnosed?
* How many fix-retry cycles occurred (max 3 allowed)?
* Were verification results written to `verification/` correctly?
* Were plan verification statuses updated via `tendril plan set-verification`?

**Post-verification (ExecutePlan Step 7.5-8):**

* Were recommendations generated?
* Was the worktree left clean?
* Were zombie processes detected/killed?

**CheckResult / completion verification (Job Manager):**

* For CreatePlan: did `verify_create_plan_result` find the plan folder or the `identified as duplicate:` marker?
* Did `check_dependencies` correctly evaluate dependency plan states?
* Did blocked transitions occur appropriately?

Cross-reference each finding with:

* `src/promptwares/{Type}/Program.md` - could instructions prevent this?
* `src/promptwares/{Type}/Memory/` - is knowledge missing or ignored?
* `src/crates/tendril-core/src/jobs/manager.rs` - job lifecycle and verification
* `src/crates/tendril-core/src/plans/models.rs` - plan state and schema
* `src/crates/tendril-core/src/git/worktree.rs` - worktree management

### Phase 4 - Produce Recommendations Report

Write the report to `$TENDRIL_PLANS/{planid}-*/debug-report.md` (alongside the plan).

Use this format:

```Markdown
# Debug Report: {PlanId} - {Title}

- **Analyzed:** {current timestamp}
- **Plan State:** {state}
- **User Note:** {the note argument}
- **Promptwares Run:** {list}
- **Total Tokens:** {sum}
- **Wall-Clock Time:** {duration}

## Executive Summary

{3-5 sentences: what happened, what went wrong, what is the root cause}

## Timeline

| # | Step | Promptware | Status | Duration | Tokens | Notes |
|---|------|------------|--------|----------|--------|-------|
| 1 | CreatePlan | CreatePlan | Completed | 2m30s | 45k | - |
| 2 | Execute | ExecutePlan | Failed | 15m | 280k | build loop |
| ... | | | | | | |

## Checking & Verification Analysis

### Pre-Execution Checks
{What passed, what failed, what was missed}

### Verification Results
| Verification | Expected | Actual | Correct? | Notes |
|-------------|----------|--------|----------|-------|
| NpmBuild | Pass | Pass | Yes | - |
| RustClippy | Pass | Pass | Yes | - |

### Completion Verification
{How JobManager verified the result, any gaps}

## Findings

### {Finding Title}

- **Category:** {Token Waste | Error Loop | Missing Knowledge | Instruction Gap | Environmental | Architectural | Verification Gap}
- **Severity:** {Low | Medium | High | Critical}
- **Promptware:** {which one}
- **Evidence:** {specific log lines, timestamps, tool call IDs}

{Description with specific evidence.}

**Root Cause:** {why this happened}

**Recommendation:** {concrete fix - which file to change, what to change, why}

---

{Repeat for each finding}

## Concrete Fixes

Priority-ordered list of specific changes:

1. **[High] {file path}**: {what to change and why}
2. **[Medium] {file path}**: {what to change and why}
3. ...

## Skill Self-Improvement Notes

{If this analysis revealed patterns or techniques that would make future debugging faster,
note them here. These will be incorporated into the skill's references/ directory.}
```

## Key Tendril Files for Cross-Reference

These are the files most likely to contain the root cause of issues:

| File | What It Controls |
| ---- | ---------------- |
| `src/crates/tendril-core/src/jobs/manager.rs` | Job lifecycle, dependency checking, completion verification |
| `src/crates/tendril-core/src/jobs/logger.rs` | Job logging, raw outputs, eventwire writing |
| `src/crates/tendril-core/src/jobs/firmware_values.rs` | Firmware values, template interpolation |
| `src/crates/tendril-core/src/jobs/recovery.rs` | Stuck job and plan recovery |
| `src/crates/tendril-core/src/git/worktree.rs` | Worktree creation, cleanup, commit operations |
| `src/crates/tendril-core/src/agents/runner.rs` | Agent CLI spawning, timeout control, JSON streaming |
| `src/crates/tendril-core/src/promptware/mod.rs` | Prompt compilation, firmware embedding |
| `src/crates/tendril-core/src/plans/models.rs` | Plan serialization/deserialization model |
| `src/promptwares/ExecutePlan/Program.md` | Main execution flow, all verification steps |
| `src/promptwares/CreatePlan/Program.md` | Plan creation, folder setup |
| `src/promptwares/{Type}/Memory/` | Agent knowledge base per promptware |

## Rules

* **Read-only by default**: do NOT modify source code, promptware instructions, or memory files during analysis. The output is a recommendations report.
* **Always produce a report**, even if no issues are found - "plan executed cleanly" is a valid finding.
* **Be specific**: cite file paths, line numbers, log timestamps, tool call sequences.
* **Focus on the checking pipeline**: verification gaps (things that should have been caught but were not) are higher priority than token waste.
* **Use targeted reads**: JSONL files can be huge - use offset/limit or grep rather than reading entire files.
* **The user's note is your guide**: prioritize investigating what the user flagged.

## Self-Evolution

This skill is designed to improve over time. After producing a report:

1. If you discovered a new debugging pattern or common failure mode not covered here, write it to `references/{topic}.md`
2. If a cross-reference path was wrong or a file moved, update the paths in this SKILL.md
3. If the report format could be improved based on what you learned, update the template above

The `references/` directory accumulates knowledge from past debugging sessions.
