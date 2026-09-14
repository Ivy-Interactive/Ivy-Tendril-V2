---
title: Installation
description: Build Tendril from source, run the desktop app and the CLI, and decide where your Tendril home lives.
icon: Download
searchHints:
  - install
  - build from source
  - prerequisites
  - cargo
  - pnpm
  - tendril home
  - config.yaml
  - update
---

# Installation

> [!IMPORTANT]
> Tendril is built from source today. There are no published installers and no download script, so
> ignore any `install-tendril.sh` / `install-tendril.ps1` one-liner you may have seen — those install
> the previous generation of Tendril, not this one.

## Prerequisites

Install these first and make sure each one is on `PATH`:

| Tool                                         | Version                | Why                                                   |
| -------------------------------------------- | ---------------------- | ----------------------------------------------------- |
| [Rust](https://rustup.rs/)                   | edition 2021 toolchain | the CLI, the server and the desktop app's native side |
| [Node.js](https://nodejs.org/)               | 22 or newer            | the front end build                                   |
| [pnpm](https://pnpm.io/)                     | 11 or newer            | the workspace package manager                         |
| [Vite+](https://viteplus.dev/) (`vp`)        | current                | build, check, test and format for every package       |
| `git`                                        | any recent             | worktrees, commits, branches                          |
| [GitHub CLI](https://cli.github.com/) (`gh`) | authenticated          | `CreatePr` opens pull requests through it             |

You also need the CLI of the coding agent you intend to use, installed and logged in.
[Onboarding a Codebase](03_Onboarding.md) walks through that.

## Build from source

```bash
git clone https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git
cd Ivy-Tendril-V2

pnpm install
pnpm --filter @ivy-interactive/components build   # the shared UI library, needed by the app
cargo build --workspace                            # tendril-core, tendril-server, tendril-cli
```

The components library has to be built before the app: the app imports it as a workspace package and
consumes its build output.

## Run the desktop app

For day-to-day development:

```bash
pnpm dev:app
```

That starts the Vite dev server and the Tauri shell together. The app launches the `tendril serve`
daemon itself and supervises it, so there is nothing else to start.

To produce an installable bundle, build the CLI first and drop it where Tauri expects the sidecar
binary:

```bash
cargo build --release --bin tendril

# Tauri resolves the sidecar per target triple; ask rustc for yours.
triple=$(rustc -vV | sed -n 's/^host: //p')
mkdir -p src/apps/tendril-app/src-tauri/binaries
cp target/release/tendril "src/apps/tendril-app/src-tauri/binaries/tendril-$triple"

pnpm --filter @ivy-interactive/tendril-app exec tauri build
```

The app declares `binaries/tendril` as an `externalBin`, which is why the copy step is not optional —
without it the bundle builds but ships without a daemon. Bundle targets are `nsis` and `msi` on
Windows, `dmg` and `app` on macOS, `deb` and `appimage` on Linux.

## Install the CLI

The same binary is the CLI:

```bash
cargo build --release --bin tendril     # ./target/release/tendril
# or, to put it on PATH:
cargo install --path src/crates/tendril-cli
```

Check it:

```bash
tendril version
tendril doctor
```

`tendril doctor` prints one line per check — Tendril home, `config.yaml` validity, the SQLite
database, the plans directory, `git` and `gh`. Fix anything marked `[FAIL]` before going further;
`[WARN]` lines are usually optional pieces you have not configured yet.

You can also run the daemon on its own:

```bash
tendril serve --host 127.0.0.1 --port 5010
```

> [!NOTE]
> That address serves the REST and WebSocket API only. There is no web page at
> `http://127.0.0.1:5010` to open in a browser — the user interface is the desktop app.

## Configuration

Everything Tendril owns lives under one directory, `$TENDRIL_HOME`, resolved in this order:

1. the `TENDRIL_HOME` environment variable, if set;
2. the path written in `~/.tendril_location`, if that file exists;
3. `~/.tendril`.

Inside it:

```
~/.tendril/
├── config.yaml     # agent, projects, verifications, promptware overrides
├── tendril.db      # jobs, costs and telemetry (SQLite)
├── Plans/          # one folder per plan
├── Jobs/           # one folder per job: log, prompt, raw agent output
└── Promptwares/    # the deployed promptwares
```

The file must be called exactly `config.yaml`. A minimal one:

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

> [!NOTE]
> There is no onboarding wizard. Configure Tendril through the app's **Settings** view, by editing
> `config.yaml`, or from the CLI with `tendril project add`, `tendril project add-repo` and
> `tendril project add-verification`. [Tutorial](04_Tutorial.md) does it both ways.

To deploy the standard set of promptwares into `$TENDRIL_HOME/Promptwares/`:

```bash
tendril promptware deploy
```

> [!WARNING]
> Install and authenticate your coding agent's CLI before your first run. An agent that stops to ask
> for a login will stall an otherwise healthy job.

## Updating

```bash
git pull
pnpm install
pnpm --filter @ivy-interactive/components build
cargo build --workspace
```

Packaged installers and automatic background updates are not published for this generation of Tendril
yet, so updating means pulling and rebuilding.

## Next steps

- [Onboarding a Codebase](03_Onboarding.md) — prepare the machine and the repository.
- [Troubleshooting](06_Troubleshooting.md) — if any of the above did not go to plan.
