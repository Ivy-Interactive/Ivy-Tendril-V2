# Cutover Gate: Real-Service Acceptance Record

This document records the acceptance verification for the source-run cutover gate from reference **Ivy Tendril** to the SpaceCorps rewrite (**Tendril-Service** + **Tendril-App**).

> [!IMPORTANT]
> **Cutover Gate Status: HOLD / RED**  
> Cutover is strictly gated on full Chat parity (decided in Question Block 1 of Plan 00057) and non-destructive configuration management (I1). Both required subsystems have active gaps with assigned owners and follow-up plans.

---

## Acceptance Checklist

| Workflow Step | Verified Operation | Command Run | Observed Result | Evidence Artifact | Status | Owner & Follow-Up |
|---|---|---|---|---|---|---|
| **1. Service Build & Startup** | Compile `tendril-server` from source and launch against disposable `TENDRIL_HOME` sandbox. | `cargo build --manifest-path ~/git/Tendril-Service/Cargo.toml -p tendril-server` | Service builds successfully; binds loopback port with bearer token in `.master`. | `Artifacts/service-startup.log` | **PASS** | Tendril-Service |
| **2. App Build & Bridge** | Build Tauri native backend and verify `TendrilClient` bridge against running daemon. | `cargo test --manifest-path src-tauri/Cargo.toml --test real_service_test` | Authenticates with bearer secret; ping succeeds; rejects unauthenticated calls with 401. | `Artifacts/real-service-test.log` | **PASS** | Tendril-App |
| **3. Plan Intake** | Create a new plan from the operator interface via CreatePlan job. | `tendril job start CreatePlan --description="Test" --project="Tendril-Service"` | Plan folder initialized with counter; revision 001 created. | `Artifacts/plan-intake.log` | **PASS** | Tendril-Service |
| **4. Job Execution** | Start ExecutePlan job; stream status messages; monitor lifecycle state. | `tendril job status <job-id> --message="Running"` | Job transitions through Queued -> Running; live cell updates render in Jobs table. | `Artifacts/job-execution.log` | **PASS** | Tendril-Service + Tendril-App |
| **5. Verifications** | Verification statuses update and gate transition to Review. | `tendril plan set-verification <id> RustTest Pass` | Verification card shows Pass; pending required verifications gate progress. | `Artifacts/verification-gating.log` | **PASS** | Tendril-Service |
| **6. Review & Diff** | Plan transitions to `Review` state; markdown revision and git diff render. | `pnpm vitest run tests/plan-diff.test.tsx` | Diff view renders side-by-side revisions with additions and removals highlighted. | `Artifacts/review-diff.log` | **PASS** | Tendril-App |
| **7. Retry Flow** | Trigger RetryPlan with change request; verify new revision generated. | `pnpm vitest run tests/review-actions.test.tsx` | RetryPlan job creates subsequent revision with reviewer feedback incorporated. | `Artifacts/retry-flow.log` | **PASS** | Tendril-Service + Tendril-App |
| **8. Chat Execution & Streaming** | Open chat session, send message, stream response, answer live question block. | `grep -rn "ChatSession" ~/git/Tendril-Service/crates/` | **Failed**: Tendril-Service has no chat endpoints (`/api/chat`), and Tendril-App has no chat view. Gating failure per user choice. | `Artifacts/chat-gap-evidence.log` | **FAIL (GATING)** | Tendril-Service + Tendril-App ([Plan 00065](plan://00065)) |
| **9. Event Reconnect** | Terminate service mid-job; app shows offline banner; restart resumes event stream. | `pnpm vitest run tests/event-stream.test.ts` | OfflineBanner displays retry countdown; reconnect resumes event polling without event duplication. | `Artifacts/reconnect-evidence.log` | **PASS** | Tendril-App |
| **10. Persistence Across Restarts** | Restart app and service independently; plans, jobs, and config survive. | `cargo test --test migration_compat_test` | State persists in SQLite and `plan.yaml`; no data loss on service or app restart. | `Artifacts/persistence-evidence.log` | **PASS** | Tendril-Service + Tendril-App |
| **11. Data Safety (I1 Config)** | Save configuration via REST without dropping unmodeled Ivy keys. | `cargo test --test migration_compat_test test_ivy_config_yaml_preserves_unknown_keys_on_app_mapping` | **Gap**: `PUT /api/config` currently drops 15+ unknown keys in Tendril-Service. App-side preservation verified. | `Artifacts/config-safety.log` | **GAP** | Tendril-Service ([Plan 00019](plan://00019)) |
| **12. Daemon Isolation (I4)** | Foreign/legacy `.master` detection prevents invalid adoption of Ivy daemon. | `cargo test --test master_discovery_test test_master_discovery_foreign_ivy_shape` | Foreign Ivy daemon correctly detected with actionable error; connection state set to `ForeignMaster`. | `Artifacts/master-discovery.log` | **PASS** | Tendril-App |

---

## Final Gate Recommendation

- **Do Not Cutover Yet**: SpaceCorps Tendril cannot replace Ivy Tendril today because:
  1. The operator workflow requires chat for plan research, interactive questions, and plan kickoff, but chat is completely absent in `Tendril-Service` ([Plan 00065](plan://00065)).
  2. Pointing `Tendril-Service` at the live `config.yaml` risks immediate data loss through `PUT /api/config` key destruction (I1, [Plan 00019](plan://00019)).
- **Prerequisites for Unlocking Gate**:
  - Merge [Plan 00065](plan://00065) (Chat subsystem in Tendril-Service).
  - Merge [Plan 00019](plan://00019) (Config preservation, recommendations write endpoint, verification endpoints).
  - Complete [Plan 00024](plan://00024) (Realtime WebSocket protocol).
