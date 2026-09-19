# Developing Tendril

Internal notes on running this repository. The user-facing install and quick-start live in the
[root README](../README.md); this is the part that only matters if you are working *on* Tendril.

Every command below was read off the actual `package.json` scripts and `src/scripts/dev-desktop.ts`
rather than remembered. If one stops working, fix it here in the same change — five translated READMEs
spent months telling people to run a `tendril --web` flag that never existed, and that is what
happens when a command lives only in someone's shell history.

## Prerequisites

- [Rust](https://rustup.rs/) (edition 2021)
- [Node.js](https://nodejs.org/) v22+ and [pnpm](https://pnpm.io/) v11+
- [Vite+](https://viteplus.dev/) — the `vp` binary, which is what every package's own scripts call
- GitHub CLI (`gh`), for the PR and issue paths

```bash
vp i
```

## The one you probably want

```bash
vp run dev:desktop -- --no-reload
```

The desktop app with **hot reload off** — no Rust file watching, no frontend HMR. Use it when a
reload would throw away the state you are trying to look at: a live job, a chat mid-turn, an open
terminal pane, or anything reached through several navigations.

`pnpm dev:desktop -- --no-reload` is the same thing. Note the `--` in both forms: it stops the runner
from eating the flag. `dev-desktop.ts` filters `--` back out before handing the rest to the Tauri
CLI, so you do not need to care where it lands.

### Its flags

| Flag | Env | Effect |
|---|---|---|
| `--no-watch` | `NO_WATCH=1` | Rust file watching off — the app does not rebuild when a crate changes |
| `--no-hmr` | `NO_HMR=1` | Frontend HMR off — the webview does not hot-replace modules |
| `--no-reload` | — | Both of the above |

It prints which of these are active on start-up, so a surprising rebuild is easy to rule out.

| Env | Default | Effect |
|---|---|---|
| `PORT` | `5010` | Port the daemon listens on |
| `TENDRIL_HOME` | `~/.tendril` | Config, database, plans and logs directory |

**Point `TENDRIL_HOME` somewhere disposable when testing anything destructive** — migrations, plan
deletion, worktree reclaim, job sweeps, tunnels. It is one variable between a scratch home and your
real plans.

## Running things

```bash
pnpm dev:desktop      # Tauri desktop app + daemon (the normal one; see flags above)
pnpm dev:app          # frontend only, in a browser — no Tauri, so no bridge commands
pnpm dev:tauri        # Tauri's own dev, without the dev-desktop wrapper
pnpm dev:storybook    # the component library in isolation
pnpm dev:docs         # the documentation site
```

`dev:app` is worth knowing about and also worth knowing the limit of: anything that reaches the
daemon through a Tauri `cmd_*` command cannot work there, because the webview holds no bearer
credential. That covers the Jobs table's server-paged query, the agent terminal, and the tunnel
controls. If a feature is mysteriously empty in the browser and fine in the desktop app, this is why.

The daemon on its own, without any UI:

```bash
cargo run -p tendril-cli -- run          # port check + migrations, then serve
cargo run -p tendril-cli -- serve        # bare listener, no pre-flight (takes --tls-cert/--tls-key)
cargo run -p tendril-cli -- doctor       # reports on the installation; exit 0 unless something FAILs
cargo run -p tendril-cli -- --help       # everything else
```

Only one daemon may own a `TENDRIL_HOME` at a time — a second is refused by name rather than left to
race on SQLite, which is what used to happen (the loser died on "database is locked"). To run two,
give the second its own home. `--home` is a global argument, so it goes *before* the subcommand:

```bash
cargo run -p tendril-cli -- --home /tmp/tendril-scratch run --port 5011
```

## Building

```bash
pnpm build                                        # components, then app, then docs — in that order
pnpm --filter @ivy-interactive/components build   # just the component library
cargo build --workspace                           # the three crates
```

**The component library's build order is load-bearing.** The app typechecks against
`packages/components/dist`, not its source, so a stale `dist` produces type errors in files you never
touched. If you see errors that make no sense, rebuild that package first and re-read them. This has
sent several people chasing phantom failures.

## Checks

```bash
pnpm check            # every package's own check (vp check + tsc --noEmit)
pnpm test             # every package's tests
pnpm typecheck        # tsc --noEmit everywhere
cargo test --workspace
```

Per package, from its own directory:

```bash
vp check              # lint + types
vp check --fix        # and fix what it can
vp fmt                # format
vp test --run         # tests once, no watch
vp test --run path/to/one.test.tsx
```

`cargo fmt --check` and `cargo clippy --all-targets` before pushing Rust.

### Known-failing test

`src/apps/tendril-app/tests/code-splitting.test.tsx` has one failing assertion on the eager-bundle
budget. It is documented in the file, including two fixes that were tried and did not work and why,
so **read the comment before touching it** rather than re-deriving. Everything else should be green;
if something else is red, it is a real regression or another branch's work in your tree.

## Layout

```
src/
├── apps/
│   ├── tendril-app/          # Tauri desktop app + React frontend
│   │   └── src-tauri/        # the Rust host: cmd_* commands, the bridge to the daemon
│   └── tendril-docs/         # documentation site
├── packages/components/      # @ivy-interactive/components + Storybook
├── crates/
│   ├── tendril-core/         # domain models, SQLite, worktrees, agents, plans, jobs
│   ├── tendril-server/       # Axum REST + WebSocket daemon
│   └── tendril-cli/          # the `tendril` binary
├── extensions/vscode/        # VS Code / Antigravity extension
├── promptwares/              # agent definitions and firmware (see promptwares/AGENTS.md)
├── skills/                   # agent workflow skills
└── scripts/                  # repository tooling, incl. dev-desktop.ts
```

Two binaries, easily confused: **`tendril-app`** is the desktop app, **`tendril`** is the CLI *and*
the server.

## Things worth knowing before changing them

- **`docs/ui-parity-contract.md`** records how V2's UI is meant to match Tendril V1, across several
  passes. V1 lives in the `Ivy-Tendril` repository and is the behavioural contract — when in doubt
  about what a view should do, read the C# rather than inferring it.
- **The shell owns app padding and scrolling.** `AppDescriptor.fullBleed` in
  `apps/tendril-app/src/state/navigation.ts` decides between a 16px inset and full bleed, per app.
  Do not add outer padding to a view root; `tests/shell-content-padding.test.tsx` encodes the list.
- **`resolve_agent`** in `crates/tendril-core/src/agents/` is what actually launches an agent. A path
  that builds a launch config without it silently gets no tool allow-list, which then trips a
  restrictive permission mode. That bug cost a long debugging session; changes there deserve care.
- **The component library is consumed as built `.mjs` bundles**, not source. That is why the build
  order matters above, and it is also why cross-package tree-shaking does not happen.
