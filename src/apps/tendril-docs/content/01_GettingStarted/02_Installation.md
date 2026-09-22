---
title: Installation
description: Install Tendril via pre-built binaries or build from source, run the desktop app and CLI, and configure your environment.
icon: Download
searchHints:
  - install
  - pre-built binaries
  - build from source
  - prerequisites
  - cargo
  - pnpm
  - tendril home
  - config.yaml
  - update
---

# Installation

Tendril can be installed via pre-built desktop packages and CLI binaries, or built locally from source.

## Quick install

Download standalone desktop installers (`.dmg`, `.pkg`, `.exe`, `.AppImage`, `.deb`) directly from
[GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) or run one of the
automated install scripts:

**macOS / Linux:**

```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

The installer places the `tendril` CLI binary on your `PATH` and registers the desktop application in your
system menu.

## Prerequisites (for building from source)

If building from source, ensure these dependencies are installed and available on your `PATH`:

| Tool                                         | Version              | Role                                                                                    |
| -------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| [Rust](https://www.rust-lang.org/)           | 1.80+ (2021 edition) | Compiles the native CLI, server daemon, and core.                                       |
| [Node.js](https://nodejs.org/)               | 22 or newer          | Powers the front-end tooling and build scripts.                                         |
| [pnpm](https://pnpm.io/)                     | 11 or newer          | Manages workspace packages and dependencies.                                            |
| [Vite+](https://viteplus.dev/) (`vp`)        | current              | Orchestrates building, linting, formatting, testing.                                    |
| [Git](https://git-scm.com/)                  | 2.30+                | Manages [git worktrees](https://git-scm.com/docs/git-worktree), commits, and branching. |
| [GitHub CLI](https://cli.github.com/) (`gh`) | authenticated        | Opens pull requests and manages issues automatically.                                   |

You will also need at least one authenticated coding agent CLI (e.g. [Claude Code](https://code.claude.com/docs),
[GitHub Copilot](https://github.com/features/copilot), [Gemini](https://ai.google.dev),
[OpenCode](https://opencode.ai), [Antigravity](https://github.com/google-deepmind), or
[Cursor](https://www.cursor.com)). [Onboarding a Codebase](03_Onboarding.md) covers agent configuration in detail.

## Build from source

Clone the repository and install workspace dependencies:

```bash
git clone https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git
cd Ivy-Tendril-V2

pnpm install
pnpm --filter @ivy-interactive/components build   # shared UI library, required by the desktop app
node src/scripts/ensure-wireframe-payload.mjs      # prepares wireframe assets for native build
cargo build --workspace                            # builds tendril-core, tendril-server, tendril-cli
```

> [!NOTE]
> The `@ivy-interactive/components` library and wireframe payload must be generated before compiling the
> native workspace crates, as `tendril-app` and `tendril-wireframe` import these assets at build time.

## Run the desktop app

For local development with hot module reloading:

```bash
pnpm dev:desktop
```

This command builds the necessary sidecar binaries and launches Vite alongside the
[Tauri 2](https://tauri.app) native window. The desktop app manages the background daemon (`tendril run`)
automatically.

### Packaging a standalone release

To package a standalone release bundle for your platform:

```bash
cargo build --release --bin tendril

# Stage the native CLI sidecar for your target architecture
triple=$(rustc -vV | sed -n 's/^host: //p')
mkdir -p src/apps/tendril-app/src-tauri/binaries
cp target/release/tendril "src/apps/tendril-app/src-tauri/binaries/tendril-$triple"

# Fetch the bundled OpenCode sidecar agent
./src/apps/tendril-app/scripts/release/fetch-opencode-sidecar.sh

# Build the installer package (DMG on macOS, NSIS/MSI on Windows, AppImage/deb on Linux)
pnpm --filter @ivy-interactive/tendril-app exec tauri build
```

## Install the CLI

The `tendril` binary serves as both the command-line interface and the daemon server:

```bash
cargo build --release --bin tendril
# or install directly to ~/.cargo/bin:
cargo install --path src/crates/tendril-cli
```

Verify your installation with the health check doctor:

```bash
tendril version
tendril doctor
```

`tendril doctor` verifies `$TENDRIL_HOME`, `config.yaml` syntax, the [SQLite](https://www.sqlite.org) database,
the plans directory, and your `git` and `gh` credentials.

### Running the daemon headless

To run Tendril as a headless server daemon without the desktop UI:

```bash
# Recommended: checks port availability and executes pending database migrations
tendril run

# Or run the direct listener (supports --tls-cert and --tls-key)
tendril serve --host 127.0.0.1 --port 5010
```

> [!NOTE]
> The server listens on `127.0.0.1:5010` by default, exposing REST and WebSocket endpoints. It does not
> serve a static web interface; interact with it via the desktop app or the CLI.

## Configuration & directory layout

All Tendril runtime state is stored within `$TENDRIL_HOME`, resolved in the following precedence:

1. The `TENDRIL_HOME` environment variable;
2. The path recorded in `~/.tendril_location` (if present);
3. The default user location: `~/.tendril`.

Inside `$TENDRIL_HOME`:

```
~/.tendril/
├── config.yaml     # coding agent, project definitions, verifications, promptware overrides
├── tendril.db      # SQLite database for jobs, costs, and execution telemetry
├── Plans/          # structured plans and their isolated git worktrees
├── Jobs/           # execution logs, agent prompts, and raw transcript recordings
└── Promptwares/    # deployed workflow agent definitions
```

A minimal `config.yaml`:

```yaml
codingAgent: claude
maxConcurrentJobs: 20

projects:
  - name: MyProject
    repos:
      - path: /Users/you/Repos/MyProject
    verifications:
      - name: NpmBuild
        required: true
      - name: CheckResult
        required: true
```

Deploy the standard promptwares to initialize the agent definitions:

```bash
tendril promptware deploy
```

> [!WARNING]
> Ensure your chosen coding agent CLI is authenticated before starting your first job. If an agent pauses
> to prompt for credentials in an unattended background process, the job will block or time out.

## Updating

If installed via the install script, re-run the one-liner to fetch the latest release.

If working from a source checkout:

```bash
git pull
pnpm install
pnpm --filter @ivy-interactive/components build
node src/scripts/ensure-wireframe-payload.mjs
cargo build --workspace
```

## Next steps

- [Onboarding a Codebase](03_Onboarding.md) — configure repository prerequisites and verify agent access.
- [Concepts: Plans](../02_Concepts/01_Plans.md) — understand plan structures and review lifecycles.
- [Troubleshooting](06_Troubleshooting.md) — solutions for build and runtime errors.
