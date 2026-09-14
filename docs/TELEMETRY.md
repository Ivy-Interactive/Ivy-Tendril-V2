# Telemetry Data Classification Policy

## Purpose

This document defines what data Tendril may and may not send to third-party telemetry services
(PostHog). The goal is to collect useful analytics while respecting user privacy.

The policy travels with the code: it is ported from the original Tendril app's `TELEMETRY.md` and
trimmed to the events actually wired in V2.

## Opt-in, not opt-out

**Telemetry is off unless you turn it on.** Only an explicit `telemetry: true` in `config.yaml`
enables it; an absent key and `telemetry: false` behave identically — no client is constructed, no
event is queued, and no network call is ever attempted. The key is read in exactly one place,
`TendrilSettings::telemetry_enabled` in
[config.rs](../src/crates/tendril-core/src/config.rs), and V2 never *introduces* the key: saving a
`config.yaml` that does not have it leaves it absent rather than stamping `telemetry: false`, so
round-tripping a file shared with the original app — which reads an absent key as "on" — cannot turn
that app's telemetry off. An explicit value round-trips unchanged.

**This is a deliberate divergence.** The original app is opt-out: it defaults `Telemetry` to `true`
and its own `TELEMETRY.md` states "Telemetry is opt-out: it is on by default." V2 defaults to off
because turning on data collection is not a decision a port should make silently on a user's behalf.
The divergence is safe in one direction only — V2 under-reports relative to the original, never
over-reports. To reverse it, change the field default and the `Default` impl in
[config.rs](../src/crates/tendril-core/src/config.rs) back to `Some(true)`.

Users are identified only by a random UUID persisted to `<TendrilHome>/.anonymous-id`. It is never
derived from a username, machine name, or repository. (The original prefers
`<LocalAppData>/Tendril/.anonymous-id`; a machine running both apps therefore counts as two
installs.)

## Classification Rules

### ALLOWED — Aggregate & Non-Identifying Data

- **Counts**: number of projects, repos, plans, jobs (aggregate totals only)
- **Durations**: time taken to complete operations, in seconds
- **States/Types**: enum values, state names, job types (e.g. `CreatePlan`, `ExecutePlan`)
- **Levels**: plan levels (e.g. `Bug`, `Feature`, `Epic`)
- **Versions**: application version strings, OS name and version strings
- **Agent providers**: coding agent name (e.g. `claude`, `codex`, `copilot`, `gemini`)
- **Booleans**: feature flags, configuration states (e.g. `llm_configured: true`)
- **Technology descriptors**: the project stack hash (see below)
- **Install-salted one-way hashes** of otherwise-forbidden identifiers (see below)

#### Stack hash (`stack_hash`)

The stack descriptor hash is a canonical, similarity-preserving signature of a project's tech stack,
e.g. `fe.ts:react+next+tailwind/be.rs:axum/db:sqlite/test:vitest`. It is composed only from a closed
vocabulary of language, framework, database and test-framework slugs — by construction it carries no
names, paths, versions, counts or free text. It says which stacks Tendril is used on without
revealing whose project it is.

#### Install-salted plan identity (`plan_uuid`)

Raw plan ids remain forbidden, but events still need to be groupable per plan.
`telemetry::derive_plan_uuid` emits `SHA256("tendril-plan:" + anonymous_id + ":" + plan_id)`
truncated to 16 bytes and formatted as an RFC 9562 v8 UUID, instead of the id itself:

- the anonymous id is a per-install salt, so plan `00042` derives a different value on every install
  and cannot correlate unrelated users
- the hash is one-way, so the sequential counter never leaves the machine
- it is scoped to a single anonymous user, so it groups events without widening identity

Ids are normalized to five digits first, so the int-shaped form from the database (`42`) and the
folder-shaped form (`00042`) derive the same value.

Any future need to correlate a forbidden identifier must use this same salted-hash pattern, never the
raw value.

### FORBIDDEN — Identifying Information

Never track:

- **URLs**: repository, PR or issue URLs
- **Paths**: file paths, directory paths, absolute paths to repos
- **Usernames**: GitHub usernames, organization names, email addresses
- **Repository names** and **project names** — even generic ones reveal work context
- **Sequential IDs**: plan ids, issue numbers, PR numbers (hash them per install instead — see
  `plan_uuid`)
- **User input**: task descriptions, commit messages, plan content
- **Titles**: plan titles, issue titles, commit subjects
- **Agent output**: transcripts, tool calls, or error messages that may embed user content

## Decision Framework

1. Can this field identify a person or organization? → Forbidden
2. Can it reveal private repository information? → Forbidden
3. Can it reveal what the user is working on? → Forbidden
4. Can it be correlated across users to de-anonymize them? → Forbidden, unless salted with the
   anonymous id and hashed one-way
5. Does it provide useful aggregate insights? → Allowed

**When in doubt, leave it out.**

## Attached To Every Event

Super properties, set once per process in
[client.rs](../src/crates/tendril-core/src/telemetry/client.rs):

| Property | Status | Notes |
|---|---|---|
| `$session_id` | Compliant | Random UUID, new per process |
| `$geoip_disable: false` | Accepted | PostHog resolves the request IP to a country; the IP is not stored as an event property |
| `app_version` | Compliant | Crate version |
| `os` | Compliant | Platform name |
| `os_version` | Compliant | `uname` release on unix, platform family elsewhere |

`distinct_id` (the anonymous id) is attached to every event. The original's `distribution` / `source`
properties are omitted: they carry a .NET `AppBrand` with no V2 equivalent.

## Current Events Audit

All events comply with this policy. Contexts are typed structs in
[events.rs](../src/crates/tendril-core/src/telemetry/events.rs), so a property set is a compile-time
decision rather than a loose map.

| Event | Properties | Emitted from |
|---|---|---|
| `app_started` | `version`, `project_count`, `llm_configured` | `run_server`, after the master lock is held |
| `job_created` | `job_type`, `agent`, `plan_uuid` | `JobManager::start_job_with` |
| `job_completed` | `job_type`, `status`, `duration_seconds`, `agent`, `plan_uuid` | `finish_job` |
| `plan_created` | `level`, `duration_seconds`, `agent`, `stack_hash`, `plan_uuid` | `finish_job`, `CreatePlan` with a deliverable |
| `pr_created` | `duration_seconds`, `agent`, `plan_uuid` | `finish_job`, `CreatePr` |
| `plan_state_transition` | `from_state`, `to_state`, `plan_uuid` | `apply_plan_state`, once the write reached disk |

`plan_uuid` is always the derived, install-salted value: call sites pass the raw plan id into the
typed context and the client hashes it before capture, so the raw id cannot reach PostHog even from a
call site unaware of the rule.

### Defined but not wired

`onboarding_completed` and `project_created` have context structs in
[events.rs](../src/crates/tendril-core/src/telemetry/events.rs) and no call site: V2 has no
onboarding flow, and project creation happens in the CLI process, where no client is installed. They
exist so a later plan adds a call site rather than a schema.

The client lives in the daemon process only. A CLI invocation never calls `telemetry::install`, so
`tendril plan ...` sends nothing.

## Implementation

- [events.rs](../src/crates/tendril-core/src/telemetry/events.rs) — typed contexts enforcing this
  policy at compile time. New events get a struct here, not a property bag.
- [client.rs](../src/crates/tendril-core/src/telemetry/client.rs) — PostHog client, anonymous id,
  plan uuid derivation. Every `track_*` swallows its own errors and only pushes onto a queue that a
  background task drains: telemetry must never fail or slow a job.
- [telemetry_test.rs](../src/crates/tendril-core/tests/telemetry_test.rs) — asserts zero network
  calls when disabled, the exact property set of every wired event, and plan uuid derivation.
