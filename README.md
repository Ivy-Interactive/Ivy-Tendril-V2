# Ivy-Tendril-V2

**Ivy-Tendril-V2** is the unified monorepo for the **Ivy Tendril** plan management and autonomous AI coding agent orchestration system.

It brings together the complete Tendril ecosystem into a single repository:
- **`apps/tendril-app`**: Tauri desktop application and React 19 frontend UI
- **`packages/components`**: UI component library, renderers, widgets, and Storybook (`@ivy-interactive/components`)
- **`crates/`**: Headless backend service (`tendril-server`), core engine (`tendril-core`), and CLI (`tendril-cli`)
- **`promptwares/`**: Deployed promptware agent programs (CreatePlan, ExecutePlan, etc.)

---

## 🏛 Directory Layout

```
Ivy-Tendril-V2/
├── apps/
│   └── tendril-app/            # Tauri desktop app + React frontend
├── packages/
│   └── components/             # @ivy-interactive/components + Storybook
├── crates/
│   ├── tendril-core/           # Core domain models, SQLite database, worktree engine
│   ├── tendril-server/         # Axum REST & WebSocket HTTP server daemon
│   └── tendril-cli/            # Command-line interface ("tendril")
├── promptwares/                # Promptware agent definitions & firmware
├── Cargo.toml                  # Unified Cargo workspace
├── pnpm-workspace.yaml         # Unified pnpm workspace
└── package.json                # Workspace root scripts
```

---

## 🚀 Getting Started

### Prerequisites
- [Rust](https://rustup.rs/) (edition 2021)
- [Node.js](https://nodejs.org/) (v22+) & [pnpm](https://pnpm.io/) (v11+)
- [Vite+](https://viteplus.dev/) (`vp`)
- GitHub CLI (`gh`)

### Quick Start

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Build components & UI library**:
   ```bash
   pnpm --filter @ivy-interactive/components build
   ```

3. **Run Storybook**:
   ```bash
   pnpm dev:storybook
   ```

4. **Build & run desktop app**:
   ```bash
   pnpm dev:app
   ```

5. **Build backend crates**:
   ```bash
   cargo build --workspace
   ```

6. **Run tests**:
   ```bash
   # Web & component tests
   pnpm test

   # Rust tests
   cargo test --workspace
   ```

---

## 📄 License

Apache-2.0 © Ivy Interactive
