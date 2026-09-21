# CreateIssue

Create a GitHub issue, either from a plan or from a subject supplied by the caller.

## Context

The firmware header contains:
- **TendrilPlanFolder** - path to the plan folder
- **CurrentTime** - current UTC timestamp
- **Repo** - target repository path (local path)
- **Assignee** - GitHub username to assign (optional, may be empty)
- **Labels** - comma-separated labels to apply (optional, may be absent)
- **Comment** - optional comment to include in the issue body (may be empty)
- **IssueTitle** - title to use instead of the plan's (optional, absent in the normal case)
- **IssueBody** - body to use instead of the plan's sections (optional, absent in the normal case)
- **IssueSource** - what the supplied subject came from, for the footer (optional)

`IssueTitle` and `IssueBody` are absent unless the issue is about something other than the plan
itself. When either is present, the plan is still the job's owner (it is what `TendrilPlanFolder`
points at, and where the job is reported) but it is not the issue's subject.

## Execution Steps

### 1. Read the subject

If **IssueTitle** or **IssueBody** is present, that is the subject. Read `plan.yaml` only for the
plan id, and do **not** read the revision or describe the plan's own work in the issue.

Otherwise the plan is the subject:
- Read `plan.yaml` from the plan folder
- Read the latest revision for the plan title, Problem, Solution, and Tests sections

Either way, report plan context to Jobs UI: `tendril job status TendrilJobId --message="Creating issue..." --plan-id=<plan-id> --plan-title="<title>"`

### 2. Identify GitHub Repository

From the `Repo` path:
```bash
cd <Repo>
gh repo view --json nameWithOwner --jq ".nameWithOwner"
```

If this fails, report that the repo is not a GitHub repository and stop.

### 3. Create Issue

Report status: `tendril job status TendrilJobId --message="Creating GitHub issue..."`

Create a well-formatted issue:

```bash
gh issue create --repo <owner/repo> --title "<title>" --body "<body>"
```

- **Title:** `IssueTitle` when present, otherwise the plan title.
- **Body:** Markdown-formatted.

  When `IssueBody` is present, use it as the body. Keep the author's wording rather than rewriting
  it; format it into Markdown, and add a heading only where the text already has that structure.

  Otherwise build it from the plan revision:
  - `## Problem`: The problem statement from the plan revision.
  - `## Proposed Solution`: The technical approach and affected files from the plan's Solution section (if present).
  - `## Verification & Tests`: The test scope and verification criteria from the plan's Tests section (if present).

  In both cases:
  - A footer citing where it came from: `*Created from Tendril Plan <plan-id>*`, and when
    `IssueSource` is present, name it too (e.g. `*Created from Tendril Plan <plan-id>
    (recommendation: <IssueSource>)*`).
  - If `Comment` is non-empty, append it under an `## Additional Context` heading separated by a horizontal rule (`---`).
- **Assignee:** If provided, add `--assignee <Assignee>`
- **Labels:** If `Labels` is non-empty, add `--label <label>` once per comma-separated entry,
  trimming surrounding whitespace. A label the repository does not define makes `gh` reject the
  whole command, so on that failure retry once without `--label` and report which labels were
  dropped.

### 4. Report the result

Print the issue URL so it is captured in the job output.

### Rules

- Do NOT modify any source code
- Use `gh` CLI for all GitHub operations
- If the repo has no GitHub remote, fail with a clear message

