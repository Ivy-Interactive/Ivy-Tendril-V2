## Reference Documents

This section is appended to your firmware because your **Program** cites it. It is the contract for
plan folders, the `tendril plan` CLI, `plan.yaml`, verifications, question blocks and plan-content
conventions, verified against the shipped CLI — where it disagrees with a memory or a habit, this
section is right and the habit is stale. Two rules apply everywhere:

- **Never read or write `plan.yaml`, or a file under `Revisions/`, directly.** Always go through
  `tendril plan`, which validates, writes atomically, bumps `updated`, syncs the database and
  notifies any chat session watching the plan.
- **Pass option values in the equals form** — `--initial-prompt="..."`, not
  `--initial-prompt "..."`. Any token starting with `-` is read as an option name, so a value that
  begins with a dash (a markdown bullet, a flag-like word) fails the parse with exit 2 and no shell
  quoting fixes it. Positional arguments must not begin with `-` either. `--home <path>` is a
  **global** option and goes *before* the subcommand (`tendril --home /tmp/h plan list`); after it,
  the parse fails with "unexpected argument '--home' found".

### Plan Folders

Plans live under `planFolder` from `config.yaml`.

```
{planFolder}/00003-FourthPlan/
├── plan.yaml            # metadata — CLI only, never hand-edited
├── Revisions/           # plan content: 001.md, 002.md, ...
├── Verification/        # PreExecution.md, then one report per verification
├── Artifacts/           # summary.md, recommendations.md, screenshots/, ...
└── Worktrees/           # isolated git checkouts used during execution
```

`Revisions/`, `Artifacts/` and `Worktrees/` are created by `tendril plan create`; `Verification/` on
first write. **Job logs are not in the plan folder** — they live in
`{TendrilHome}/Logs/Jobs/<job-id>.md`, one file per job.

**Folder naming** is `{ID:D5}-{SafeTitle}`. The ID is five digits, allocated by `tendril plan create`
as one past the highest existing plan folder ID. **There is no `.counter` file**, so do not look for
one and do not try to predict the next ID. SafeTitle is derived from the title by the CLI
(non-alphanumerics dropped, each word capitalised, spaces removed) and is **not truncated**.

**SafeTitle is a folder name only.** Never pass it anywhere, and never reuse the PascalCase form as
the plan's `title` — that is a separate human-readable string in Title Case *with spaces*.

A plan can be named to the CLI as an absolute path, a folder name (`00003-FourthPlan`), a
zero-padded ID (`00003`) or a bare number (`3`).

### Reading Plan Data

`tendril plan get <plan-id>` prints the whole `plan.yaml` verbatim; with a trailing `<field>` it prints
just that value. Field names are matched case-insensitively, and an unrecognised one is
**an error (exit 1), not a blank line** — a typo is loud rather than indistinguishable from a genuinely
empty list, and the error lists every valid field.

Scalar fields print one value: `id`, `title`, `state`, `project`, `level`, `created`, `updated`,
`executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`. `id` prints
**unpadded** (`3`, not `00003`); `created`/`updated` print RFC 3339 UTC; an unset optional scalar
prints an empty line, never the word `null`. List fields print **one item per line**, so they pipe
into `grep`/`wc`; an empty list is empty output with exit 0, distinct from the exit-1 error above.

| Field | Line format | Example line |
|---|---|---|
| `repos`, `prs`, `commits`, `dependsOn`, `relatedPlans` | the bare value | `/repos/Foo` |
| `verifications` | `Name=Status` | `RustBuild=Pending` |
| `recommendations` | `Title=State` | `Extract the helper=Pending` |
| `allocatedPorts` | `name=port` | `backend=3001` |

Revision content and plan search are separate:

```bash
tendril plan get-revision <plan-id>                # latest; --number=<n> for a specific one
tendril plan list [--project=<name>] [--state=<State>] [--level=<level>] [--search="<text>"] \
                  [--has-pr] [--has-worktree] [--limit=<n>] [--format=table|ids|folders|json]
```

`--format` defaults to `table` (`ID  STATE  LEVEL  PROJECT  TITLE`, newest first); `ids` prints
padded IDs one per line, `folders` prints folder names. An unrecognised `--format` or `--state`, a
`--limit=0`, or a `--number` with no such revision are all errors rather than silent fallbacks.

### Writing Plan Data

```bash
tendril plan set <plan-id> <field> <value>
tendril plan add-repo <plan-id> <repo-path>            # remove-repo
tendril plan add-pr <plan-id> <pr-url>                 # remove-pr
tendril plan add-commit <plan-id> <sha>
tendril plan add-depends-on <plan-id> <folder-name>    # remove-depends-on
tendril plan add-related-plan <plan-id> <folder-name>  # remove-related-plan
```

`plan set` prints `Set <field> = <value>` — the value that was written, so you can read your own write
back. The settable fields are exactly `state`, `title`, `level`, `project`, `executionProfile`,
`initialPrompt`, `sourceUrl`, `priority`. Anything else — including `id`, `created`, `updated` and
every list field — is an error naming the settable set; the list fields have the `add-*`/`remove-*`
verbs above instead. `remove-pr` matches on `owner/repo#number`, so a URL recorded with a `/files`
suffix can be removed by its base form — that is how a PR recorded against the wrong plan gets
unpicked.

**Say why you edited.** More than one chat session can be watching a plan; every direct edit is
reported to the others. Pass `--reason="<why>"` on `set`, `write-revision`, `set-verification`, the
`add-*`/`remove-*` verbs, `verification add`/`remove` and the `rec` verbs so they are told the intent
and not just the diff — omitting it gets a warning on stderr. (On `rec decline`, `--reason` is the
*decline* reason stored in the plan; the notification reason there is `--edit-reason`.)

`plan set <plan-id> state <value>` accepts only the states in **Plan States** below and is subject to
the completion guard in **Verifications**. Whether *you* should set the state at all is a policy
question your **Program** answers — some promptwares own a transition, and ExecutePlan is forbidden
from setting state because the server derives it from the exit code and the verification statuses.

### Creating A Plan

```bash
tendril plan create <TITLE> <PROJECT> [options]
```

Both positionals are **required**. `<PROJECT>` must already exist and have at least one repo; a
missing project fails with `Project '<name>' not found.` and one with no repos fails rather than
producing a plan `ExecutePlan` can build no worktree for.

The new plan **inherits the project's configuration**: its `repos` are the project's repo paths, and
its `verifications` are the project's verification set in the project's configured order — each
seeded `Pending` if the project marks it `required`, `Skipped` if not. `--verification Name=Status`
overrides the status of one of them, or appends a verification the project does not list.

Options, all in equals form: `--level`, `--initial-prompt`, `--source-url`, `--execution-profile`
(`deep` or `balanced`), `--priority`, `--verification` (repeatable), `--depends-on` (repeatable),
`--related-plan` (repeatable), `--no-duplicate-check`.

Output is parseable. Note the `Name:Status` colon here, against the `Name=Status` equals sign
`plan get <plan-id> verifications` uses; the trailing block appears unless `--no-duplicate-check`
was passed, and lists `folder|title|state` for plans with similar titles:

```
PlanId: 00003
Directory: /home/me/.tendril/Plans/00003-FourthPlan
Verifications:
RustBuild:Pending
RustTest:Skipped
CheckResult:Pending
DuplicateCandidates:
00002-FourthPlanish|Fourth Planish|Draft
```

### Writing Revisions

```bash
tendril plan write-revision <plan-id> --stdin --reason="<why>" <<'EOF'
<revision markdown>
EOF
```

Content comes from stdin with `--stdin`, or from `--file <path>`. The next number is allocated from
the highest existing revision and written to `Revisions/<NNN>.md`; the command prints `Revision 002
written.` Two things happen on the way in: **question blocks are validated** (a malformed block
rejects the whole revision — see **Question Blocks**; `--no-question-check` bypasses validation and is
for scripted and test use, never reach for it), and **links are polished** unconditionally — see
**Plan Content Conventions**.

### Verifications

A plan's verifications live in `plan.yaml`, never in the revision markdown. Each is a `name` and a
`status` of `Pending`, `Pass`, `Fail` or `Skipped`. Every verification of the plan's project is
**seeded at creation** in the project's configured order, which is also **the order they run in** —
that is why a summarising check ends up last. `Pending` means ExecutePlan will run it, `Skipped` means
it will not; a user toggles between those two from the plan UI, and the agent writes `Pass`/`Fail`
after running one. Definitions live in the top-level `verifications` block of `config.yaml`; a project
references them by name plus `required`.

```bash
tendril plan verification list <plan-id> [--status=<Status>] [--json]
tendril plan verification add <plan-id> <name> [--status=<Status>]   # name must be a known definition
tendril plan verification remove <plan-id> <name>
tendril plan set-verification <plan-id> <name> <status>
```

`verification list` prints a `Name  Status` table **in run order**; `--json` gives
`[{"name":"...","status":"..."}]`. `set-verification` prints `Verification updated.` and — unlike
`verification add` — does **not** check the name against the configured definitions, so a misspelt
name silently appends a new entry. Spell the name exactly as `verification list` reports it.

**The completion guard.** A plan cannot be set `Completed` while any verification is `Fail`; the
attempt fails with `Plan transition blocked: Plan '<id>' cannot be marked Completed because
verifications failed: <names>`. Re-run the verification and record the real result, or set it
`Skipped` with a `--reason` saying why. Only when a human has explicitly asked for the plan to ship
anyway, pass `--allow-failed-verifications`: that completes the plan, sets **`partialDelivery: true`**,
and warns on stderr. `partialDelivery` is how everything downstream knows the deliverable may be
missing, so never use the flag to get past a verification you simply have not run.

### Recommendations

Improvements found while working on a plan, surfaced in the Recommendations app and the Review tab.
States are `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`.

```bash
tendril plan rec add <plan-id> <title> --description="<markdown>" [--impact=Small|Medium|High]
tendril plan rec list <plan-id> [--state=<State>]
tendril plan rec accept <plan-id> <title> [--notes="<text>"]   # any notes promote to AcceptedWithNotes
tendril plan rec decline <plan-id> <title> [--reason="<text>"]
tendril plan rec set <plan-id> <title> <field> <value>         # rec remove <plan-id> <title> to drop
```

`--description` has **no `-d` short form**. Its markdown is rendered, so file links in it follow the
plan-content rules below.

### Worktrees And Environment

```bash
tendril plan add-worktree <plan-id> <repo-path> [--base=<branch>]
tendril plan remove-worktree <plan-id> <repo-name> [--branch=<branch>]
tendril plan cleanup <plan-id> [--force]
tendril plan env materialize <plan-id> [--repo=<repo>] [--force] [--json]
tendril plan env get <plan-id> [--repo=<repo>] [--json]
```

`add-worktree` creates `Worktrees/<repo-name>` on branch `tendril/<ID>-<SafeTitle>`, prints both, and
materialises the plan's environment. `cleanup` refuses a plan that is not terminal (`Completed`,
`Failed`, `Skipped`, `Icebox`) because a running agent may be inside those worktrees; `--force`
overrides. `env materialize` allocates a free TCP port for each of the project's named `ports` —
retaining anything already in `allocatedPorts`, so a re-execution keeps the same URLs — and writes the
project's configured `envFiles` into the worktrees; `env get` prints what they resolved to.

### Logging Your Own Progress

```bash
tendril job status <job-id> -m "<what you are doing>"
tendril job fail <job-id> -m "<why it failed>"
tendril job add-log <job-id> <action> --summary="<text>"
```

`<job-id>` is the `TendrilJobId` value from your firmware header — an alphanumeric id such as `00458`,
with no dashes. `job status` and `job fail` are progress telemetry: **when no daemon is running they
print a warning on stderr and exit 0.** Do not guard them with a health check and do not treat a
warning as a failed step — they are usually links in an `&&` chain and must never abort it.
`job add-log` never needs the daemon at all, appending an `## Agent Log` section straight to
`{TendrilHome}/Logs/Jobs/<job-id>.md`.

### plan.yaml

A freshly created plan, as `tendril plan get <plan-id>` prints it:

```yaml
schemaVersion: 3
state: Draft
project: Demo
level: Feature
title: Fourth Plan
repos:
- /repos/Foo
created: 2026-09-16T09:39:16.844499Z
updated: 2026-09-16T09:39:16.844502Z
prs: []
commits: []
verifications:
- name: RustBuild
  status: Pending
- name: RustTest
  status: Skipped
relatedPlans: []
dependsOn: []
priority: 0
partialDelivery: false
```

| Field | Description |
|---|---|
| `schemaVersion` | Plan schema version. CLI- and migration-managed. |
| `state` | Current plan state — see **Plan States**. |
| `project` | Project name matching a `projects` entry in `config.yaml`. |
| `level` | One of the levels defined in `config.yaml`. Defaults to `Feature`. |
| `title` | Human-readable title in **Title Case with spaces** (`Show File Details In The Changes Dialog`). **Never** the PascalCase no-space form — that is the folder's SafeTitle. Must be identical to the `# {title}` H1 at the top of the revision markdown. |
| `repos` | Affected repository paths as plain strings (`- /repos/Foo`), not objects. Seeded from the project. |
| `created` / `updated` | UTC timestamps. CLI-written; `updated` is bumped on every write. |
| `prs` / `commits` | Associated pull request URLs and commit SHAs. |
| `worktrees` | Registry of worktrees created for this plan. CLI-managed; absent on older plans. |
| `verifications` | List of `{name, status}` — see **Verifications**. |
| `relatedPlans` | Related plan folder names (parent, split-from, follow-up). |
| `dependsOn` | Plan folder names this plan depends on (`- 01478-WorktreeIsolation`). ExecutePlan blocks until all of them are `Completed` and their PRs merged. |
| `priority` | Integer, `0` = normal. Higher runs first. Set by the launcher, not by agents. |
| `partialDelivery` | `true` when the plan was completed over a failed verification, so the deliverable may be missing. Set only by `--allow-failed-verifications`. |
| `executionProfile` | (Optional) Profile for ExecutePlan: `deep` or `balanced`. Overrides the `config.yaml` default. CreatePlan sets it from its complexity analysis. |
| `initialPrompt` / `sourceUrl` | (Optional) The original user description, and the GitHub issue or PR URL that triggered this plan. |
| `recommendations` / `chatSessionId` | (Optional) See **Recommendations**; and the chat session the plan was created from. Both CLI-managed. |
| `allocatedPorts` | (Optional) Map of the project's named service ports to this plan's assigned TCP port (`backend: 3001`). CLI-managed — never hand-edit. |

**Do not invent fields.** An unknown field (`tags`, `category`) is *preserved* verbatim on
round-trip, which is worse than it sounds: nothing reads it, nothing validates it, no UI shows it,
and it sits in the file forever looking like it means something. Put the information in the revision
markdown, where it will actually be read.

### Plan States

| State | Meaning | Where it shows |
|---|---|---|
| `Draft` | Ready for review or action | Plans |
| `Creating` | CreatePlan or ExpandPlan working | Jobs |
| `Updating` | UpdatePlan or SplitPlan working | Jobs |
| `Executing` | ExecutePlan running | Jobs |
| `Review` | Execution finished, awaiting human review | Review |
| `Failed` | Execution errored | Review |
| `Completed` | PR created, plan done | — |
| `Skipped` | Dismissed, or split into child plans | — |
| `Blocked` | Waiting on `dependsOn` plans | Plans |
| `Icebox` | Parked for later | Icebox |

The usual paths: ExpandPlan takes `Draft → Creating → Draft`; UpdatePlan `Draft → Updating → Draft`;
SplitPlan `Draft → Updating → Skipped` for the parent plus new `Draft`s; ExecutePlan
`Draft → Creating → Executing → Review`, or `→ Failed`, or `→ Blocked → Draft` when a dependency is
unmet; CreatePr `Review → Completed`. `Skipped` and `Icebox` are also set by hand. `Completed` and
`Skipped` are **terminal and immutable**: a plan in either can move to the other, but nothing else
about it can change. Any name outside the ten above is rejected by `plan set`.

### Question Blocks

You run headless and cannot ask the user anything mid-run. A planning agent that hits a genuine
ambiguity instead emits one or more fenced `questions` blocks in the revision markdown. The user
answers them in the UI, which writes the answers back into the same blocks; UpdatePlan then folds
those answers into the plan and retires the questions. Emit a block only for an ambiguity that
research cannot settle and that changes what gets built — a question you could answer by reading the
code is not a question, it is research you skipped.

A block holds 1–4 questions; a revision may contain any number of blocks. Place each block where it
belongs — right after the `# {title}` H1 for a question about overall scope, inline under the
`## Solution` subsection it concerns for one design decision.

````
```questions
questions:                    # 1-4 items
  - id:          slug         # required, ^[a-z0-9][a-z0-9-]*$, unique across the whole revision
    title:       string       # required, the question
    header:      string       # optional, <=12 char label shown as an eyebrow above the title
    description: markdown     # optional, block markdown shown under the question
    multiple:    bool         # optional, default false; true = multi-select
    optional:    bool         # optional, default false; true = answering is not expected
    other:       bool         # optional, default TRUE; renders a free-text "Other" field
    options:                  # 2-4 items; omit entirely for a pure free-text question
      - title:       string   # required, 1-5 words
        description: markdown # optional, block markdown expanding on this option
        value:       slug     # required, ^[a-z0-9][a-z0-9-]*$, unique within the question
        recommended: bool     # optional, at most one per question
    answer:      value | [values] | string   # filled in on response
```
````

No other keys are allowed anywhere — an unknown key is a parse error, not a note.

The `questions:` wrapper above is the canonical shape and the one to write. Two shorthands parse
identically, because a fence that already says `questions` makes the word inside look redundant: a
**bare sequence** (the list without its `questions:` key) and, for a block asking exactly one thing, a
**lone mapping** with no wrapper and no dash.

````
```questions
- id: caching-strategy        # bare sequence — drop the dash too for a lone mapping
  title: Which caching strategy?
  options:
    - title: In-memory
      value: in-memory
      recommended: true
    - title: Redis
      value: redis
```
````

An `id` is what separates either shorthand from the pre-schema plain-text form, so a question written
that way must carry one. A block with neither the wrapper nor an `id` is read as legacy free text: it
warns rather than failing the write, and renders as a static callout the user cannot answer.

An `id` is also how an answer is addressed — the UI reports an answer as that id and a value, with no
block or position alongside it. So it must be unique across the **whole revision**, not merely within
its own block, and must keep its meaning across revisions: rewording a question is fine, but renaming
its `id` orphans the answer already given for it.

#### Shapes

Three shapes fall out of `multiple` and the presence of `options`: single-select is `options` alone,
multi-select is `multiple: true` plus `options`, and a pure free-text question has no `options` at all.

`other` defaults to `true`, so **every question already offers a free-text field**. Never hand-author
an option titled "Other", "Something else" or "Custom" — it duplicates what the UI renders, and the
linter rejects it. Setting `other: false` with no options is unanswerable and is also rejected.

#### Descriptions

Both `description` fields render as full block markdown — paragraphs, lists, tables and fenced code
all work. Reach for a snippet or a table when it settles the question faster than another sentence
would: an option that proposes an API is clearer showing the call than describing it. Use a `|` block
scalar for any description spanning more than one line, so blank lines and indentation survive YAML
parsing intact. Quote `title`, `header` and `description` whenever the value contains a colon, a quote
or a code span — `title: "Option: SQLite"`. A fence inside a description needs the `questions` fence to
be **longer** than the one it contains, which is ordinary CommonMark: open the block with four
backticks and the descriptions can use three.

#### Answer Semantics

- An entry matching an option's `value` is that option; an entry matching nothing is the user's own
  free text (allowed because `other` defaults to `true`; with `other: false` it is a lint error).
- `multiple: true` means `answer` is always a list, even with one selection; `multiple: false` means
  it is always a scalar. Mismatching the two is a lint error either way.
- `answer` absent means not yet answered; UpdatePlan carries the block forward unchanged. There is no
  third state — `answer` is either absent or a value, **never `null`**. A question that does not need
  answering is marked `optional: true` when written, which is a property of the question rather than
  something the user does to it.

**An unanswered question never blocks execution.** ExecutePlan and RetryPlan resolve one themselves —
taking the `recommended` option when there is one, otherwise the most reasonable answer they can
defend — and log the choice. Leaving a question unanswered says "you decide"; it is not a way of
stopping the plan. That is why `recommended: true` matters: it is the default execution will actually
take, so pick the option you would be willing to ship.

`optional: true` says the plan is complete without an answer: the question is worth putting to the
user, but not worth their time if they have none to give. It renders and answers like any other
question; the difference is what it tells the reader, since the UI lists an optional question as
answered-for-now, leaving what is unstruck as what still wants a human.

#### Lint Rules

`tendril plan write-revision` validates every block. It prints **every problem at once**, each line
prefixed with the line number of the opening fence, and **writes nothing** — so a rejected revision
**does not consume a revision number**. Fix the reported lines and re-run.

```
Error: Validation error: Question block validation failed:
3: block 1: question 1: option 'Other' duplicates what other: true provides
3: block 1: question 1: more than one option is recommended
26: block 2: question 1: invalid id 'BadId', must match ^[a-z0-9][a-z0-9-]*$
```

Blocks are numbered by position in the document, so a revision with more than one gets a `block N:`
prefix in front of the `question N:` prefix; with a single block the `block` prefix is omitted.

| Rule | Message |
|---|---|
| 1–4 questions per block | `block must contain between 1 and 4 questions` |
| Every question has a non-empty `id` | `question N: id is required` |
| `id` is a slug | `question N: invalid id '<id>', must match ^[a-z0-9][a-z0-9-]*$` |
| `id` unique across the whole revision, blocks included | `question N: duplicate question id '<id>'` |
| Every question has a `title` | `question N: title is required` |
| `header` at most 12 characters | `question N: header must be 12 characters or fewer` |
| 2–4 options when `options` is present | `question N: question must have between 2 and 4 options` |
| A question is answerable | `question N: other: false with no options is unanswerable` |
| No hand-authored "Other"/"Something else"/"Custom" option | `question N: option '<title>' duplicates what other: true provides` |
| Every option has a `title` | `question N: option title is required` |
| `value` is a slug | `question N: option value '<value>' must match ^[a-z0-9][a-z0-9-]*$` |
| `value` unique within a question | `question N: duplicate option value '<value>'` |
| At most one `recommended: true` per question | `question N: more than one option is recommended` |
| `answer` is never null | `question N: answer: null is not a state; omit the key, or mark the question optional` |
| `answer` is a list iff `multiple: true` | `question N: multiple: true requires a list answer` / `question N: answer must be a scalar when multiple is false` |
| An unmatched `answer` needs `other` | `question N: answer '<value>' matches no option and other is false` |
| Anything else | `question N: parse error: <detail>` |

A `questions` fence written *inside* a longer fence is documentation, not a question — this section is
itself an example — so it is neither validated nor rendered. A legacy plain-text block (no wrapper and
no `id`) warns rather than failing, and is never rewritten.

### Plan Content Conventions

- **Local file links:** `[filename:line](file:///path/to/filename)` for a source file with a line
  number, `[filename](file:///path/to/filename)` without. The line number belongs in the **display
  text only** — never append it to the URL (no `:348` suffix, no `#L123` fragment), or the editor
  cannot open the path. Never put backticks in link text. **Only link files that already exist** —
  for a file the plan will create, write its path in inline code (`` `src/new/thing.rs` ``), because
  a link to a non-existent path renders broken.
- **Plan references:** `[Plan 03156](plan://03156)` navigates to that plan in the Plans app. The ID
  may be padded (`plan://03156`) or not (`plan://3156`).
- **Title:** the `# {title}` H1 at the top of the revision must be **identical** to the plan's
  `title` field.
- **Images and diagrams:** ordinary markdown `![alt](url)`; Graphviz/DOT (```` ```dot ````,
  ```` ```graphviz ````) or Mermaid (```` ```mermaid ````). Prefer DOT for layout, and only when a
  diagram genuinely helps.

`write-revision` **polishes links on the way in**, so these rules are enforced rather than merely
advised. It strips a `:NNN` or `#LNNN` anchor from a `file:///` URL, shortens link text that was a
full path or a verbose `file:///` URL down to `filename` or `filename:line`, removes backticks from
file-link text, rewrites a link to another plan's revision file as `plan://NNNNN`, and turns a bare
`Plan NNNNN` mention into a `plan://` link when that plan exists. Inline code, fenced code and
`questions` fences are left untouched — a question's option `value` is matched literally against the
answer, so polishing one would corrupt it. Polishing is silent, so do not fight it: write the
canonical form and the file on disk will match what you wrote.
