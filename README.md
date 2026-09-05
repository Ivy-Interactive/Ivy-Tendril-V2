# Tendril-Service

**Tendril-Service** is a headless, high-performance implementation of the **Ivy Tendril** plan management and autonomous AI coding agent orchestration system, written in **Rust**.

It provides the complete backend service, REST and WebSocket APIs, SQLite database persistence with full-text search, Git worktree lifecycle management, and full CLI functionality — with **no UI**, designed to be consumed by developer IDEs (such as Tendril-IDE), autonomous agents, and command-line operators.

---

## 🏛 Architecture

The repository is organized as a Cargo workspace with three primary crates:

```
Tendril-Service/
├── crates/
│   ├── tendril-core/       # Core domain models, SQLite database, Git & worktree engine, promptware compiler, agent runtime
│   ├── tendril-server/     # Axum REST & WebSocket HTTP server daemon with .master file discovery
│   └── tendril-cli/        # Complete command-line interface ("tendril") matching all Tendril operations
├── promptwares/            # Deployed promptware agent programs (CreatePlan, ExecutePlan, etc.)
├── Cargo.toml
└── README.md
```

### 1. `tendril-core`
- **Domain Models**: Plans (`PlanYaml`, `PlanFile`, `PlanMetadata`), Statuses (`Draft`, `Creating`, `Updating`, `Executing`, `Review`, `Failed`, `Completed`, `Skipped`, `Icebox`, `Blocked`), Verifications (`Pending`, `Pass`, `Fail`, `Skipped`), Recommendations, Jobs (`JobItem`, `JobArgsBase`), and Projects (`ProjectConfig`, `RepoRef`).
- **Database (`rusqlite`)**: Embedded SQLite (`tendril.db`) with schema migrations (1 through 21), WAL mode, busy timeout, cascade foreign keys, and FTS5 search.
- **Plans Engine**: Safe title formatting, 5-digit ID allocation (`00042`), YAML reader/writer, numbered revision tracking (`Revisions/001.md`), dependency checker with GitHub PR verification, and completion guards (`PlanCompletionGuard`).
- **Git & Worktree Management**: Isolated worktrees (`Worktrees/{repo}`), branch derivation (`tendril/{folder}`), commit log/diff/file analysis, and PR creation via `gh`.
- **Promptwares & Firmware**: Compiles agent firmware prompts from `Program.md`, tools, and persistent memory files (`Memory/`).
- **Agent Runtime**: Launching agent CLI tools (`claude`, `antigravity`, `gemini`, `opencode`, `codex`, `copilot`, `ivy`), event parsing, and token/cost tracking from model pricing catalogs.
- **Jobs Engine**: Background async queue with concurrency limits (`max_concurrent_jobs`), cancellation, disk logging (`.raw.jsonl`, `.eventwire.jsonl`, `## Agent Log`), and stale output watchdogs.

### 2. `tendril-server`
- **Axum Web Server**: High-throughput asynchronous REST API:
  - `/api/ping`, `/api/health`
  - `/api/plans` (list, get, create, update fields, revisions, recommendations)
  - `/api/jobs` (start, list, status, fail, cancel, add-log)
  - `/api/inbox` (direct plan creation intake)
  - `/api/projects`, `/api/verifications`, `/api/config`
  - `/api/ws` (WebSocket connection for live streaming of events, simulation steps, and plan approvals)
- **Master Instance**: Manages the `.master` file lifecycle for zero-config CLI discovery and cleanup on shutdown.

### 3. `tendril-cli`
The `tendril` executable matches the full Tendril CLI surface:
- `tendril plan <list|create|update|get|set|validate|doctor|cleanup|write-revision|get-revision|rec|...>`
- `tendril job <list|start|status|cancel|add-log>`
- `tendril project <list|get|add|remove|set|add-repo|remove-repo|add-verification|remove-verification>`
- `tendril verification <list|get|add|remove|set>`
- `tendril promptware <list-memory|read-memory|write-memory|delete-memory|write-tool|deploy>`
- `tendril config <get|set>`
- `tendril doctor`
- `tendril version`
- `tendril models`
- `tendril serve [--port <PORT>]`
- `tendril mcp` (stdio Model Context Protocol server)

---

## 🚀 Getting Started

### Prerequisites
- [Rust](https://rustup.rs/) (1.80+ or latest stable)
- `git`
- GitHub CLI (`gh`) for PR tracking

### Building

```bash
cargo build --release
```

The compiled `tendril` CLI binary will be located at `target/release/tendril` (or `target/release/tendril.exe` on Windows).

### Checking System Health

```bash
cargo run --bin tendril -- doctor
```

### Listing Plans

```bash
cargo run --bin tendril -- plan list
```

### Running the API Daemon

```bash
cargo run --bin tendril -- serve --port 5010
```

---

## 📄 License

Apache-2.0 © SpaceCorps Technology
