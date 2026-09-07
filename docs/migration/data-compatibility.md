# Data and Schema Incompatibilities: Ivy Tendril to SpaceCorps Cutover

This document catalogues the concrete schema and data-handling incompatibilities between the reference Ivy Tendril system and the SpaceCorps (`Tendril-Service` + `Tendril-App`) rewrite.

Each item details the **Owner**, **Reproduction**, **Fix**, and **Regression Test**.

---

### I1 — `PUT /api/config` Destroys Unknown Keys

- **Owner**: `Tendril-Service` (tracked in [Plan 00066](plan://00066))
- **Reproduction**:
  1. Load a full Ivy Tendril `config.yaml` containing settings such as `editor`, `promptwares`, `codingAgents`, `shareTunnel`, `vault`, `vaults`, `llm`, `auth`, `api`, `tunnel`, `desktopNotifications`, `sidebarOpen`, `themeMode`, and `dismissedUpdateVersion`.
  2. Send a `PUT /api/config` request with a modified scalar setting (e.g. `jobTimeout: 150`).
  3. `put_config_handler` deserializes into `TendrilSettings` (12 fields) and serializes back over `config.yaml`.
  4. All unmodeled keys (15+ sections) are permanently deleted from disk.
- **Fix**:
  - Deserialize the existing config into a flexible `serde_yaml::Value` mapping.
  - Merge the incoming changes into the mapping, preserving all unmodeled and extension keys.
  - Serialize the merged mapping back to disk atomically, or expand `TendrilSettings` to include a `#[serde(flatten)] extra: BTreeMap<String, serde_yaml::Value>`.
- **Regression Test**:
  - `cargo test --test migration_compat_test test_ivy_config_yaml_preserves_unknown_keys_on_app_mapping`
  - Harness rehearsal: `node scripts/migration/rehearse-cutover.mjs` verifies SHA-256 digest preservation.

---

### I2 — `chatSessionId` Silently Dropped from `plan.yaml`

- **Owner**: `Tendril-Service`
- **Reproduction**:
  1. Create a `plan.yaml` containing `chatSessionId: "381b81c0e24045a5a95ec513d7dddab2"` (introduced in Ivy [Plan 00053](plan://00053)).
  2. Read and write the plan using `tendril-core` plan serializers.
  3. The Rust `PlanYaml` struct in `crates/tendril-core/src/models/plan.rs` does not define `chat_session_id`, so Serde silently drops the key upon write.
- **Fix**:
  - Add `#[serde(rename = "chatSessionId", skip_serializing_if = "Option::is_none")] pub chat_session_id: Option<String>` to `PlanYaml`.
  - Preserve the field across all plan read/update commands and endpoints.
- **Regression Test**:
  - `cargo test --test migration_compat_test test_chat_session_id_plan_yaml_preservation`

---

### I3 — Missing `plan.yaml` Schema Migration Framework

- **Owner**: `Tendril-Service` (tracked in [Plan 00066](plan://00066))
- **Reproduction**:
  1. Point `tendril-server` at a plan directory containing a legacy version 0 plan (e.g. `state: ReadyForReview` or `state: Building`, missing `schemaVersion`).
  2. The service attempts to deserialize into current enum variants and errors or leaves the plan unindexed.
  3. Ivy Tendril executes migrations automatically on startup via `Services/Plans/Migrations` (`PlanMigrator`), rewriting legacy state names, title-cased subfolders, and YAML normalization.
- **Fix**:
  - Introduce an `IPlanMigration` trait and `PlanMigrator` in `tendril-core`.
  - Check `schemaVersion` on startup and sweep non-terminal plans through migrations sequentially before serving.
- **Regression Test**:
  - `cargo test --test migration_compat_test test_legacy_v0_plan_yaml_compatibility`

---

### I4 — `.master` Shapes Diverge Across Implementations

- **Owner**: `Tendril-App` (Fixed in this plan)
- **Reproduction**:
  1. Ivy Tendril writes `.master` with `{pid, port, scheme, startedAt, heartbeat}` without `secret` or `version`.
  2. Tendril-Service writes `{port, pid, secret, startedAt, host, version, apiVersion, capabilities}`.
  3. Tendril-App's `MasterInfo` previously defaulted missing fields, adopting the Ivy daemon with `secret: ""` and then failing with broken connection / unauthorized errors.
- **Fix**:
  - Implemented `detect_foreign_master()` in `src-tauri/src/daemon.rs` and `src-tauri/src/service/master.rs`.
  - Detects presence of `heartbeat` key or missing/empty `secret` or `version`.
  - Transitions to a dedicated `ForeignMaster` connection state with an actionable user-facing message explaining that the SpaceCorps desktop app requires `Tendril-Service`.
- **Regression Test**:
  - `cargo test --test master_discovery_test test_master_discovery_foreign_ivy_shape`
  - `cargo test --test migration_compat_test test_ivy_master_reports_foreign_master_state`

---

### I5 — Chat Storage Format Incompatibility

- **Owner**: `Tendril-Service` (tracked in [Plan 00065](plan://00065))
- **Reproduction**:
  1. Ivy Tendril stores chat sessions in `Chats/*.json` using PascalCase keys (`Id`, `Title`, `CreatedAt`, `UpdatedAt`, `AgentId`, `ModelId`, `Messages`, `Effort`, `SpawnedJobIds`).
  2. Messages contain `Id`, `Role`, `Content`, `Timestamp`, `AgentId`, `ModelId`, `RawStream`, `Effort`.
  3. A standard Rust serde struct with camelCase or snake_case defaults will fail to deserialize or will drop `RawStream` and `SpawnedJobIds`.
- **Fix**:
  - Define `ChatSession` and `ChatMessage` models with `#[serde(rename_all = "PascalCase")]` in `tendril-core`.
  - Include optional fields `raw_stream` and `spawned_job_ids` so historical transcript data remains intact.
- **Regression Test**:
  - `cargo test --test migration_compat_test test_pascal_case_chat_session_compatibility`

---

### I6 — Costs and History Not Recorded

- **Owner**: `Tendril-Service` (backend) + `Tendril-App` (frontend) (tracked in [Plan 00019](plan://00019))
- **Reproduction**:
  1. The SQLite database includes a `Costs` table created by `migrations.rs`, but no code path in `tendril-server` or `tendril-core` inserts rows when jobs complete.
  2. No aggregate endpoint exists for day/week/month metrics, token counts, or cost forecasts.
  3. `DashboardView.tsx` in `Tendril-App` only sums the jobs currently present on the page, displaying inaccurate totals when pagination is active.
- **Fix**:
  - Tendril-Service: Record token counts and cost calculations in `Costs` on job completion; expose `GET /api/costs/summary` and `GET /api/costs/series`.
  - Tendril-App: Query the summary and series endpoints in `DashboardView.tsx` instead of performing client-side page summation.
- **Regression Test**:
  - `pnpm vitest run tests/dto-mapping.test.ts`

---

### I7 — Question Block Lint Validation Missing

- **Owner**: `Tendril-Service` (tracked in [Plan 00065](plan://00065))
- **Reproduction**:
  1. Post a revision containing a malformed fenced `questions` block (e.g. duplicate IDs, invalid choices, or missing recommended option) via `write-revision`.
  2. `revisions.rs` in `tendril-core` currently accepts the revision without question syntax validation, incrementing the revision counter.
  3. Firmware requires question blocks to be validated strictly on write unless `--no-question-check` is specified.
- **Fix**:
  - Implement `QuestionValidationService` in `tendril-core` mirroring Ivy's normative rules in `Plans.md`.
  - Reject invalid blocks before incrementing revision numbers.
- **Regression Test**:
  - `pnpm vitest run tests/migration-parity.test.ts`

---

### I8 — Realtime Contract Absent

- **Owner**: `Tendril-Service` (tracked in [Plan 00024](plan://00024))
- **Reproduction**:
  1. Connect a WebSocket client to `GET /api/ws`.
  2. Send a job start payload. The endpoint replies with simulated static strings rather than streaming live agent process stdout or job status events.
  3. No envelope wrapping (`jobId`, `planId`, `seq`) is provided, preventing reliable event routing and resume on reconnection.
- **Fix**:
  - Complete Plan 00024: Scope WebSocket messages with session/job/plan identifiers, monotonic sequence numbers, and resume support via `?since=<seq>`.
- **Regression Test**:
  - `pnpm vitest run tests/event-stream.test.ts`

---

### I9 — Missing REST Endpoints for Plan Operations

- **Owner**: `Tendril-Service` (tracked in [Plan 00019](plan://00019))
- **Reproduction**:
  1. Attempt to update recommendation state (`PUT /api/plans/:id/recommendations/:title`), mutate per-plan verification status (`PUT /api/plans/:id/verifications/:name`), query dependency graphs, or fetch `.md` / `.jsonl` job logs over REST.
  2. All requests return 404.
  3. Tendril-App must either fail actions or resort to local filesystem traversal fallback.
- **Fix**:
  - Implement the missing REST routes in `crates/tendril-server/src/routes/` to expose core library functions over HTTP.
- **Regression Test**:
  - `cargo test --test e2e_operator_test`
