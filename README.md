# Ivy-Tendril-V2

**Ivy-Tendril-V2** is the unified monorepo for the **Ivy Tendril** plan management and autonomous AI coding agent orchestration system.

It brings together the complete Tendril ecosystem into a single repository:
- **`src/apps/tendril-app`**: Tauri desktop application and React 19 frontend UI
- **`src/packages/components`**: UI component library, renderers, widgets, and Storybook (`@ivy-interactive/components`)
- **`src/crates/`**: Headless backend service (`tendril-server`), core engine (`tendril-core`), and CLI (`tendril-cli`)
- **`src/promptwares/`**: Deployed promptware agent programs (CreatePlan, ExecutePlan, etc.)

---

## 🏛 Directory Layout

```
Ivy-Tendril-V2/
├── src/
│   ├── apps/
│   │   └── tendril-app/            # Tauri desktop app + React frontend
│   ├── packages/
│   │   └── components/             # @ivy-interactive/components + Storybook
│   ├── crates/
│   │   ├── tendril-core/           # Core domain models, SQLite database, worktree engine
│   │   ├── tendril-server/         # Axum REST & WebSocket HTTP server daemon
│   │   └── tendril-cli/            # Command-line interface ("tendril")
│   └── promptwares/                # Promptware agent definitions & firmware
├── Cargo.toml                      # Unified Cargo workspace
├── pnpm-workspace.yaml             # Unified pnpm workspace
└── package.json                    # Workspace root scripts
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

## 🤖 Agent Skills

Extend your favorite AI coding agents with official Tendril engineering and debugging skills.

### Quick Start

Install Tendril skills for any supported agent using the universal skills installer:

```bash
npx skills add ivy-interactive/ivy-tendril-v2
```

Or install a specific skill:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan
```

### Supported Tools & Environments

<details>
<summary><strong>Visual Studio Code (GitHub Copilot & Extensions)</strong></summary>

Install skills for GitHub Copilot in VS Code:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

Global install (across all workspaces):

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

Or copy skills directly to `.agents/skills/` or `.github/skills/` (project-level) or `~/.copilot/skills/` (global).

Once installed, skills appear in GitHub Copilot Chat under the `/skills` menu and can be invoked directly as slash commands (e.g. `/tendril-debug-plan`, `/tendril-debug-job`, `/tendril-review`, `/tendrillable`).

Third-party VS Code agent extensions:
- Cline: `npx skills add ivy-interactive/ivy-tendril-v2 --agent cline`
- Continue: `npx skills add ivy-interactive/ivy-tendril-v2 --agent continue`
- Roo Code: `npx skills add ivy-interactive/ivy-tendril-v2 --agent roo`

See the [VS Code Setup Guide](docs/vscode-setup.md) for detailed configuration options.
</details>

<details>
<summary><strong>Claude Code</strong></summary>

Install from the Claude Code marketplace:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

Local development:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

See the [Claude Code Setup Guide](docs/claude-setup.md) for detailed configuration options.
</details>

<details>
<summary><strong>Antigravity CLI (agy)</strong></summary>

Install plugin via Git URL:

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

Local installation:

```bash
agy plugin install ./
```

See the [Antigravity Setup Guide](docs/antigravity-setup.md) for detailed configuration options.
</details>

<details>
<summary><strong>Cursor</strong></summary>

Install targeting Cursor:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor
```

Or copy skills to `.cursor/skills/` (project-level) or `~/.cursor/skills/` (global).

See the [Cursor Setup Guide](docs/cursor-setup.md) for detailed configuration options.
</details>

<details>
<summary><strong>OpenAI Codex</strong></summary>

Install from the Codex plugin marketplace:

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril-v2
codex plugin add tendril-skills@tendril-skills
```
</details>

---

## 📄 License

Apache-2.0 © Ivy Interactive
