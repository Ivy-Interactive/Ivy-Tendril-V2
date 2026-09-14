# Common Failure Modes

Patterns observed from past debugging sessions and plan executions.

## Instruction Gap Failures

### Silently Skipped Deliverables
- **Symptom**: Plan revision lists N components to create, agent only creates N-1
- **Root cause**: Program.md does not enforce a checklist-driven approach per deliverable
- **Where to look**: Compare revision acceptance criteria against actual file changes in commits
- **Fix area**: `src/promptwares/ExecutePlan/Program.md` - add explicit deliverable tracking

### CheckResult False Positive
- **Symptom**: Verification marked Pass despite missing files or unmet targets
- **Root cause**: Verification prompt checks build/test success but does not cross-reference the full plan revision
- **Where to look**: `verification/*.md` reports, compare against revision requirements
- **Fix area**: Verification prompts in `config.yaml`, `src/promptwares/ExecutePlan/Program.md` Step 7

## Token Waste Patterns

### Redundant File Reads
- **Symptom**: Same file read 4+ times in a single session
- **Where to look**: JSONL analysis - count Read tool calls per file path
- **Threshold**: >3 reads of the same file is suspicious, >6 is definitely wasteful

### Context Bloat
- **Symptom**: Single message with very high `input_tokens` (>50k)
- **Where to look**: JSONL messages sorted by input_tokens
- **Root cause**: Usually reading large files when grep would suffice

## Error Loop Patterns

### Build-Fix Cycles
- **Symptom**: 3+ iterations of build -> error -> edit -> build
- **Where to look**: JSONL tool call sequences, grep for `cargo build` or `pnpm build`
- **Root cause**: Agent missing knowledge about API changes, type system, or framework patterns
- **Fix area**: `src/promptwares/{Type}/Memory/` - add knowledge about the specific error pattern

### Type Mismatch Loops
- **Symptom**: Agent repeatedly tries different type casts/interfaces
- **Where to look**: JSONL edit tool calls on the same lines
- **Root cause**: Missing memory about the project's type hierarchy

## Environmental Failures

### Stuck Plans
- **Symptom**: Plan stays in Executing state indefinitely
- **Where to look**: `recovery.rs` - runs on startup and reconciliation
- **Root cause**: Agent process died without cleanup
- **Fix area**: `src/crates/tendril-core/src/jobs/recovery.rs`

### Plan Counter Collisions
- **Symptom**: Two plans with the same ID
- **Where to look**: `$TENDRIL_PLANS/.counter`
- **Root cause**: Multiple Tendril instances running simultaneously

### Missing Logs
- **Symptom**: No `.raw.jsonl` for a job
- **Where to look**: `$TENDRIL_HOME/Jobs/{jobId}-*` - all four artifacts share one stem
- **Root cause**: The raw writer is opened from job launch; if the job never launched, only the seeded `.md` exists

## Verification Integrity Failures

### Delegated Verification Self-Certification
- **Symptom**: A verification that has its own dedicated promptware is marked Pass by the ExecutePlan agent without actually running the separate promptware.
- **Where to look**: Check `verification/{Name}.md` - does it show actual test execution or just a code review? Cross-reference with config.yaml promptwares section.
- **Root cause**: The agent wrote the verification report manually and bypassed the CLI to update plan.yaml directly.
- **Detection**: If a verification name matches a directory under `Promptwares/`, it is delegated and should NOT be self-certified.
- **Fix area**: `src/promptwares/ExecutePlan/Program.md` (instruction-level). The CLI is the only supported mechanism for setting verification status.

## Log / Output Failures

Every job artifact lives flat in `$TENDRIL_HOME/Jobs/` keyed by job id (`{jobId}-{planId}-{promptware}.{md,prompt.md,raw.jsonl,eventwire.jsonl}`). There is no `Logs/` folder under promptwares or plans.
