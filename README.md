# Tendril-App

Rust UI application for Tendril, built with Tendril-Service and components-storybook.

The app is a thin operator surface over the Tendril daemon. It holds no state of
its own and talks to nothing else: plans, jobs, revisions and recommendations all
come from `tendril-server` over loopback HTTP, through the Tauri command bridge in
`src-tauri/src/commands/`. The webview never sees the daemon's bearer secret — it
calls `invoke()`, and the Rust side attaches credentials.

## Development

The service is a separate binary that you start yourself. The app does not spawn
or bundle it (sidecar packaging is Plan 00023's scope), so development is a
two-terminal flow.

### Prerequisites

- Rust toolchain (stable) and the [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/)
- `pnpm`
- A `Tendril-Service` checkout next to this one
- `pnpm install` in this repo

### Terminal 1 — the service

From your `Tendril-Service` checkout:

```sh
cargo run -p tendril-server -- --home ~/.tendril --port 5010
```

`--host` defaults to `127.0.0.1`, and it should stay there: the daemon publishes a
bearer secret in `$TENDRIL_HOME/.master`, so it must not be reachable off the
machine.

To develop against throwaway data instead of your real Tendril home, point
`--home` at a scratch directory:

```sh
cargo run -p tendril-server -- --home /tmp/tendril-dev --port 5010
```

> `TENDRIL_PLANS` takes precedence over `TENDRIL_HOME` when the service resolves
> where plans live. If it is exported in your shell, a scratch `--home` still
> reads and writes plans in your real plans directory. Unset it for scratch runs.

### Terminal 2 — the app

```sh
pnpm tauri dev
```

That is all the wiring there is. `src-tauri/src/service/master.rs` polls
`$TENDRIL_HOME/.master` for the daemon's port, scheme and secret, so the app
discovers a hand-started service exactly as it discovers any other running one —
including one started on a different port, or restarted mid-session. If you gave
the service a scratch `--home`, give the app the same one:

```sh
TENDRIL_HOME=/tmp/tendril-dev pnpm tauri dev
```

You can start the app first. With no service running it shows an offline banner
rather than failing; start the service and hit `Reconnect Now` to re-run
discovery. A service that drops while the app is running puts it in
`reconnecting`, which retries by itself every five seconds.

Do not use `Restart Service` for a service you started by hand — it drives the
managed-service supervisor, which does not own your `cargo run` process.

### Frontend only

`pnpm dev` serves the UI in a browser on `127.0.0.1:5173`, which is faster to
iterate on for pure layout work. Anything that calls `invoke()` fails there,
because there is no Rust host — use `pnpm tauri dev` for real data.

### UI dependency pin

CI checks out `SpaceCorps/components-storybook` at a pinned commit SHA in
`.github/workflows/ci.yml`; local development uses whatever sibling checkout
`link:../components-storybook` resolves to, so local and CI can disagree — CI
is the pinned one. To bump: resolve the new SHA
(`gh api repos/SpaceCorps/components-storybook/commits/main --jq .sha`),
replace the `ref:` value, and let CI prove the build. Nothing bumps it
automatically. The library publishes no tags or releases, which is why the
pin is a SHA.

## Tests

```sh
pnpm test                  # vitest
pnpm exec tsc --noEmit     # typecheck, including tests/
cd src-tauri && cargo test
```

`tsconfig.json` deliberately includes `tests/`: the fixtures in `tests/fixtures/`
are annotated against the DTOs in `src/types/api.ts`, so a contract change breaks
the typecheck instead of silently drifting.

`src-tauri/tests/e2e_operator_test.rs` runs the operator flow against a real
service rather than a mock. It skips unless you tell it where the binary is:

```sh
cd ~/git/Tendril-Service && cargo build -p tendril-server   # keep it current
TENDRIL_E2E_SERVER_BIN=~/git/Tendril-Service/target/debug/tendril-server \
  cargo test --test e2e_operator_test
```

Rebuild the binary before running it. A stale one passes while asserting last
week's service behaviour, which defeats the point of the suite.

It spawns that binary on loopback against a `TempDir` home and starts no jobs, so
it never touches your real `~/.tendril` or any coding-agent credentials.
