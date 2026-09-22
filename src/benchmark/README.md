# Tendril V1 vs V2 benchmark

A reproducible benchmark comparing **Tendril V1** (C#/.NET 10 + Ivy Framework, release `v1.2.4`) with
**Tendril V2** (Rust axum daemon + Tauri 2 + React/Vite, pinned commit) on this machine:

1. **Responsiveness**: cold and warm start, API latency and throughput, UI load and navigation,
   push latency (server change to UI), one-shot CLI latency, desktop launch, across dataset sizes
   and under load.
2. **Memory**: `phys_footprint` of every process each app runs (RSS as context): the real desktop
   apps as a whole process tree (the headline), the idle headless backend, after UI flows and under
   API load.
3. **Bundle sizes**: installers, installed app (also after first launch), core binaries, sidecars,
   bundled toolchains and the frontend (eager and total JS/CSS, raw, gzip -9 and brotli 11).
4. **Network**: bytes each UI exchanges with its backend, what crosses the loopback sockets of each
   architecture, and the external traffic of the real desktop apps.

The report, `benchmark.md`, is generated from measured results by `report`; nothing in it is typed
by hand except `analysis.md`, which is injected when its front matter names the run.

## Quick start

Everything runs from the repo root with Node 26 (TypeScript is executed directly; there is no build
step and no `package.json` here):

```sh
node src/benchmark/bin/tendril-bench.ts doctor              # environment + tool/build/dataset checks
node src/benchmark/bin/tendril-bench.ts setup               # clone, check out, build everything
node src/benchmark/bin/tendril-bench.ts datasets            # generate + migrate + snapshot dataset homes
node src/benchmark/bin/tendril-bench.ts run --profile quick # the published profile (about 40 minutes)
node src/benchmark/bin/tendril-bench.ts run --quiet-load 2  # full profile on a quiet machine (several hours)
node src/benchmark/bin/tendril-bench.ts report              # benchmark.md + charts from the latest complete run
```

The desktop suite and the network suite's desktop checks put real app windows on screen; keep the
screen unlocked (a locked screen is detected and flagged, but it throttles WebKit and shrinks new
windows, so those numbers are not representative).

Typecheck (must pass):

```sh
node_modules/.bin/tsc -p src/benchmark/tsconfig.json
```

If `node_modules/.bin/tsc` is missing in a fresh worktree, use
`node_modules/.pnpm/node_modules/.bin/tsc -p src/benchmark/tsconfig.json` (same compiler).

## Commands and flags

Common flags: `--workspace <dir>` (default `~/Desktop/tendril-benchmark`, or `$TENDRIL_BENCH_WORKSPACE`),
`--profile quick|full` (default `full`), `--v2-ref <sha>` (V2 commit under test), `--verbose`, `-h/--help`.
Unknown suites, datasets, apps or profiles are rejected before anything is created (exit code 2).

### `setup` (build/setup.ts)

Clones `ivy-tendril-v1` at `v1.2.4` and `ivy-tendril-v2` at the pinned sha into the workspace,
builds everything and writes `build-info.json`. Each step writes a stamp
(`<ws>/builds/.stamps/<step>.json`) with a key over its inputs; a step is skipped only when the key
matches and its outputs exist, so a second `setup` is a no-op (about 20 s: the clone steps always
check the checkout).

| flag | meaning |
|---|---|
| `--only a,b` | only these steps, or the groups `v1`, `v2`, `clone` |
| `--skip a,b` | skip these steps |
| `--force` | rebuild even when a stamp says the step is up to date |
| `--smoke` | also run the opt-in `smoke` step (V2 daemon + shim in Chromium, then the real V2 app once, on screen) |
| `--list` | print every step and whether it is up to date, then exit |

Steps: `v1-clone`, `v2-clone`, `procstat`, `v1-publish` (dotnet publish of the tag, single file),
`v1-pkg` (release pkg download, sha256 checked against GitHub, expanded), `v2-deps`, `v2-wireframe`,
`v2-frontend`, `v2-cli` (`cargo build --release --bin tendril`, CI's command), `v2-sidecars`,
`v2-app` (`tauri build --bundles app,dmg --no-sign` with `CI=true`), `v2-shim`, `v1-select`, `smoke`.

`build-info.json` records schema version, pins (resolved shas), tool versions, per-step status,
duration, commands and log, per-step sections (`v1.clone`, `v1.publish`, `v1.releasePkg`,
`v1.selection`, `v2.clone`, `v2.deps`, `v2.wireframe`, `v2.frontend`, `v2.cli`, `v2.sidecars`, `v2.app`,
`v2.shim`), and an `artifacts` summary with flat aliases the adapters read (`v1.serverBin`,
`v1.desktopApp`, `v2.bin`, `v2.dist`, `v2.shimBin`, `v2.shimInit`, `v2.appPath`, `v2.dmgPath`).

V1's server and desktop binary is the installed `/Applications/Ivy Tendril.app` when it is
byte-identical to the release pkg: v1.2.4 re-points the user's `tendril` CLI symlink at whatever
`.app` it runs from, so a second copy of the app is never started. The self-built publish is the
fallback. Env overrides: `TENDRIL_BENCH_V1_BIN`, `TENDRIL_BENCH_V1_APP`, `TENDRIL_BENCH_V2_BIN`,
`TENDRIL_BENCH_V2_DIST`, `TENDRIL_BENCH_V2_SHIM`, `TENDRIL_BENCH_V2_SHIM_INIT`, `TENDRIL_BENCH_V2_APP`.

### `datasets` (datasets/index.ts)

Generates the synthetic dataset homes, runs each app's own DB migrate (`Ivy.Tendril db-migrate`,
`tendril --home H db migrate`), inserts the same job rows into both databases, checks the migrate
left config and plans untouched, and snapshots per-app template homes. A dataset is rebuilt only
when its fingerprint (generator version, spec, both binaries) changed.

| flag | meaning |
|---|---|
| `--dataset a,b` | only these datasets (default all four) |
| `--force` | rebuild even when the fingerprint matches |

### `run`

Runs suites into `<ws>/runs/<runId>/` (`runId` = `YYYYMMDD-HHMMSS-<profile>`, local time).

| flag | meaning |
|---|---|
| `--suite a,b\|all` | `size, cli, startup, idle, api, ui, network, desktop` (always executed in that order) |
| `--dataset a,b` | override the profile's datasets (`empty, small, medium, large`) for every suite |
| `--app v1,v2` | restrict to one app |
| `--run-id <id>` | resume or append into an existing run; a rerun metric replaces the earlier one with the same key |
| `--quiet-load <x>` | before each suite, wait until the 1-minute load average is below `x` (0 = do not wait) |
| `--quiet-timeout <s>` | give up waiting after `s` seconds (default 600); the wait and whether it succeeded are recorded |

A suite whose module is missing, fails to import or crashes is recorded as a result with failures
and the run continues. The run's status in `run.json` is `complete` only when every requested suite
finished (with or without recorded per-sample failures).

### `report` (report/generate.ts)

| flag | meaning |
|---|---|
| `--run <runId>` | the run to report (default: the latest complete run) |
| `--out <file.md>` | where to write the report (default `src/benchmark/benchmark.md`); `charts/` and `results/<runId>/` (the raw JSON, with home directories shortened to `~`, the hostname and secret-like keys removed, busiest processes reduced to their executable name) go next to it. When the report is written inside the run directory the results are linked, not copied into themselves. |
| `--analysis <file.md>` | hand-written analysis to inject (default `src/benchmark/analysis.md`, only if its front matter says `runId: <this run>`) |
| `--fixtures` | render the synthetic fixtures in `report/fixtures/` (default out `<ws>/runs/fixtures-report/benchmark.md`); `node src/benchmark/report/make-fixtures.ts` regenerates them |

The output is deterministic: the same results give byte-identical markdown and SVG.

### `doctor` and `clean`

`doctor` prints the environment and about 35 checks (clones, binaries, shim, procstat, datasets,
Playwright/Chromium, tools, load, power, thermal); `--json` gives machine-readable output.
`clean` removes per-run homes (`--homes`), a run (`--run <id>`), stray temp files (`--tmp`) and stops
leftover processes that reference the workspace (`--leftovers`); it is a dry run unless `--yes`.

## Profiles and runtime

Every iteration count and duration comes from `lib/config.ts`:

| knob | quick | full |
|---|---|---|
| datasets (server suites: startup, idle, api, ui, network) | empty, small, large | empty, small, medium, large |
| datasets (desktop) | small | empty, medium, large |
| datasets (cli) | small, large | small, large |
| startup first-start / warm runs | 3 / 3 | 5 / 10 |
| idle runs x (settling + window) | 2 x (20 s + 10 s) | 5 x (120 s + 45 s) |
| api instances; warmup / timed requests per scenario and instance | 3; 100 / 30 | 3; 100 / 100 |
| api concurrency levels x duration (once per instance) | [1, 8] x 2 s | [1, 8, 32] x 5 s |
| ui sessions per dataset and app | 1 | 3 |
| ui cold loads / nav cycles / REST pushes / file pushes / nav-under-load cycles (per dataset and app, split across sessions) | 3 / 3 / 3 / 3 / 2 | 9 / 6 / 10 / 5 / 6 |
| network cold loads / pushes / idle windows / sessions (pushes) | 3 / 3 / 1 x 20 s / 1 (2) | 5 / 10 / 3 x 60 s / 3 (4) |
| network desktop external traffic / real-host check | 30 s / 30 s | 90 s / 45 s |
| desktop warmup + runs x duration | 1 + 3 x 30 s | 1 + 5 x 60 s |
| cli warmup / runs | 1 / 5 | 3 / 20 |

Runtime on this machine (Apple M4 Max, 16 cores): the `quick` profile takes about 40 minutes (the
published report is a `quick` run; each suite's duration is in its environment table). The `full`
profile is not calibrated: by its knobs it runs for several hours (idle alone is 5 runs x 165 s per
app and dataset), so trim its datasets or runs before using it.

| dataset | plans | jobs | projects |
|---|---|---|---|
| empty | 0 | 0 | 1 |
| small | 50 | 50 | 3 |
| medium | 300 | 200 | 5 |
| large | 1500 | 500 | 8 |

Two revisions of about 8 KB per plan; state mix Draft 30 / Review 15 / Completed 35 / Failed 5 /
Skipped 5 / Icebox 10 percent, in exact quotas; seeded PRNG (seed 42), fixed dates and mtimes, so
content is identical across runs and apps. `config.yaml` is byte-identical for both apps and leaves
every background job at the apps' shipped defaults (V1's model pricing warmup and worktree cleanup,
V2's model enrichment and worktree reaper all run); only telemetry, inbox polling and desktop
notifications are off. Git fixture repos for the projects live in `<ws>/datasets/repos/`.

## Suites

| suite | what it measures |
|---|---|
| `size` | installers, installed apps (and after first launch: V2 copies its sidecars into its home) with component breakdown, core binaries, sidecars, toolchains, the .NET single-file bundle breakdown, frontend eager/total JS and CSS (raw, gzip -9, brotli 11). No processes. |
| `cli` | one-shot CLI wall time, peak footprint and CPU for semantically equivalent commands (`--version`, `plan list`, `plan list --plans-dir`, `plan get`), measured by `native/cliexec.c` on the exited process |
| `startup` | first start (fresh home) and warm restart: HTTP ready, data ready, usable, footprint at ready, peak footprint, CPU to ready; V2's startup phases from its log |
| `idle` | the headless backend alone (V1 `--web` server incl. its server-side UI vs V2 daemon only): a settling phase after ready (CPU and peak reported), then a measured window of footprint, CPU and wakeups |
| `api` | independent server instances; sequential latency per scenario (with response bytes), closed-loop throughput and latency at several concurrency levels, server peak footprint and CPU under load |
| `ui` | headless Chromium, independent sessions: cold load, navigation (first visit and revisits), push latency (REST and file edit), navigation under a fixed background load, renderer / browser / server memory after the flows |
| `network` | bytes on the wire per UI scenario (two legs, see below), external traffic of the real desktop apps, and a check of the IPC shim against the real V2 host |
| `desktop` | the real desktop apps (both WKWebView): launch milestones from the launch command and, as `cold-launch`, from the backend's spawn; whole-tree footprint over time with per-role breakdown, CPU and wakeups |

### How V2 runs in the browser: the IPC shim

The V2 frontend only talks to its Tauri host, so Chromium cannot run it directly. `v2-shim` (a
standalone crate with its own `[workspace]`, built against the V2 clone's `src-tauri`) stands in for
the host: it serves the built `dist` and answers the page's `invoke()`s by running the app's real
`cmd_*` handlers in a Tauri MockRuntime, with the app's WS and SSE bridges forwarding change events.
`build.rs` generates the handler list from the app's `generate_handler![...]`, so a re-pin cannot
drop commands. `v2-shim/init.js` provides `window.__TAURI_INTERNALS__` in the page; invokes travel
over one WebSocket (`/__shim/ws`, with `POST /__shim/ipc/<cmd>` as a fallback) and every call is
logged in `window.__SHIM_IPC__`.

```
v2shim <dist-dir> <port> [--home <tendril-home>] [--host <ip>] [--allow-no-master]
v2shim --describe
```

It refuses to start without a home, with `~/.tendril`, or without `<home>/.master` (exit 3) unless
`--allow-no-master`. The shim is not the Tauri binary: its memory is reported under its own role,
and the real `tendril-app` is measured in the desktop suite.

### Network suite

Bytes are counted by a byte-counting TCP proxy (`lib/tcpproxy.ts`) that follows HTTP/1.1 and
WebSocket framing, so every byte is attributed to a request, a category (asset, API, WebSocket,
SSE) and a route. Two legs:

- **UI to backend** (`ui_*`, the like-for-like comparison and the headline): what the page exchanges
  with its backend, assets and data separately. V1: Chromium <-> V1 server. V2: Chromium <-> shim,
  which in the real app is in-process IPC plus bundled assets and never touches a socket.
- **Architecture-internal sockets** (`net_*`): what crosses a loopback socket in each shipped
  architecture. V1: the same leg as above. V2: host <-> daemon only (REST, one WebSocket, one SSE
  stream); the shim reaches the daemon through a proxy via a shadow `TENDRIL_HOME` whose `.master`
  names the proxy (the daemon's own `.master` is never touched).

Scenarios: `cold-load`, `nav:<view>`, `push`, `idle` (per minute), `session`; a window closes after
1.5 s without a byte on either leg. `desktop-external` runs `nettop` over every process from before
the real app (and V2's daemon) is spawned and filters to the app's process tree afterwards.
`real-host-cold-load` launches the real `Tendril.app` with a shadow home in front of a proxied
daemon and compares its host <-> daemon traffic with the shim's cold load.

## Metric definitions

**Memory** (MiB, 2^20 bytes), read with `proc_pid_rusage(RUSAGE_INFO_V4)` by `native/procstat.c`
(verified identical to `footprint -p` for both apps):

- `footprint`: sum of `ri_phys_footprint` over the process set (dirty + compressed + swapped +
  IOKit-owned memory): what Activity Monitor shows as "Memory" and what the kernel uses for jetsam,
  comparable across a .NET process, a Rust process, WebKit XPC services and Chromium helpers.
- `peak footprint`: sum of per-process `ri_interval_max_phys_footprint` after resetting the interval
  at the start of the window; an upper bound on the simultaneous peak.
- `rss`: sum of `ri_resident_size`, context only (double-counts shared clean pages, misses compressed memory).
- Process sets: the server process plus all its descendants; for the desktop apps also the WebKit
  processes whose responsible pid is the app (they are not its children) and, for V2, the daemon.

**CPU**: `ri_user_time + ri_system_time` (mach ticks to ns), as CPU seconds (`cpu_s`, `cpu_s_to_ready`,
`cpu_s_to_15s`, `settling_cpu_s`, `server_cpu_s`) or the mean percent of one core over a window
(`cpu_percent_mean`). `idle_wakeups_per_s` = package idle + interrupt wakeups per second.

**Startup**: readiness polled every 5 ms. `http_ready_ms`: spawn to the first successful health
response (V1 `GET /api/ping`, V2 `GET /api/health`); `data_ready_ms`: V1's `Initial sync complete`
log line, and for V2 the same as HTTP (its health endpoint answers only after the initial sync);
`usable_ms` = max of the two (V1's sync line can precede its HTTP), the headline. V2-only
`phase_*_ms` come from its log (port bound, watches registered, plans synced, recommendations rebuilt).

**Idle**: `footprint_mean_mib`, `cpu_percent_mean`, `idle_wakeups_per_s`, `rss_mib` over the measured
window; `footprint_window_start_mib` and `footprint_end_mib` at its edges; `peak_footprint_mib` over
the window; `settling_cpu_s` and `settling_peak_footprint_mib` for the settling phase before it.

**API**: `latency_ms` request start to last body byte on a keep-alive connection, uncompressed (no
`Accept-Encoding`), with `responseBytes` in meta; `ttfb_ms` to the response headers;
`latency_ms_per_kb` (context only, never a verdict: it favours the larger payload). Under load
(`<scenario>@c<N>`): `throughput_rps` (2xx per second, closed loop of N connections spread over up to
8 worker threads whose CPU and event-loop use are recorded), `latency_ms`, `error_rate`,
`server_peak_footprint_mib`, `server_cpu_s`, and the report derives `server_cpu_ms_per_request`.

**UI** (times taken inside the page): `dom_content_loaded_ms`, `load_ms`, `shell_visible_ms`,
`content_ready_ms` from navigation start; `transfer_bytes`, `request_count` up to content ready;
`js_heap_used_mib`, `dom_nodes`; `nav_first_ms` / `nav_ms` from the click event to the view's ready
marker; `push_latency_ms` from the write (harness clock) to the plans badge change (page clock,
corrected by the measured clock offset); `renderer_footprint_mib`, `browser_tree_footprint_mib`,
`server_tree_footprint_mib` (V2: daemon plus the shim stand-in).

**Desktop**: `app_process_ms`, `webcontent_spawn_ms`, `window_visible_ms` (process milestones, not
content), `cpu_s_to_15s`; `cold-launch` adds `backend_ready_ms` (V2's daemon) and the same milestones
timed from the backend's spawn; `footprint_15s_mib`, `footprint_end_mib` (the headline, with per-role
breakdown), `footprint_mean_mib`, `peak_footprint_mib`, `rss_end_mib`, `cpu_percent_mean`,
`idle_wakeups_per_s` from +15 s to the end.

**Network**: `ui_*` / `net_*` `total_bytes`, `down_bytes`, `up_bytes`, `asset_bytes`, `data_bytes`,
`ws_bytes`, `requests`, `ws_messages`, `connections` per scenario; `*_bytes_per_min` and friends for
idle; `ext_bytes_in`, `ext_bytes_out`, `ext_connections` for the desktop apps.

**Sizes**: apparent bytes (`lstat` size of regular files; symlinks not followed), never `du`, in MB
(10^6 bytes) with exact bytes in the report. Compressed sizes are per file with Node's zlib (gzip
level 9, brotli quality 11), matching `gzip -9 -n` exactly and `brotli -q 11` within a few bytes.
V2's eager JS is the entry chunk plus its transitive static imports (the V2 repo's own definition in
`code-splitting.test.tsx`, so it excludes the lazy chunks its landing view loads next); V1's is the
Ivy entry closure plus the Tendril widgets bundle (its root shell is an external widget).

## Methodology

- **Replicates.** In `cli`, `startup`, `idle` and `desktop` every repeated measurement (command,
  start, idle run, launch) is its own replicate and the apps alternate in ABBA order (V1, V2, V2, V1,
  ...) so a linear drift in machine state cancels. `api` and `ui` take many samples from one
  running server or browser session, which are not independent; there each app gets several
  **instances** per dataset (fresh home, server and browser each), in ABBA order across instances
  with the first app alternating per dataset, and every sample carries its instance. The instance
  is the replicate. Within an instance an app's samples are taken back to back. `network` runs one
  session per app and dataset, alternating the first app per dataset. The 1-minute load average is
  recorded for every suite (every 5 s) and per api/ui instance.
- **Statistics.** Medians with 95% percentile-bootstrap intervals (2000 resamples, seeded per
  metric), hierarchical where there are instances (resample instances, then samples). V2 vs V1 is the
  ratio of medians with a bootstrap interval. A difference counts when a two-sided Mann-Whitney U test
  gives p < 0.01 and the medians differ by at least 5%. The test runs on pooled samples (optimistic
  with instances; the intervals are the honest precision), exact (permutation distribution with
  midranks, ties included) up to 60 pooled samples, normal approximation with tie and continuity
  correction above. With fewer than 5 samples per app no test can reach p < 0.01; those comparisons
  are decided by value ("every run" when every sample of one app beat every sample of the other,
  "unclear" otherwise). One sample per app is **indicative** and never counted as a win. Sizes are
  exact (1% counts). The report also states how many significant differences survive a
  Holm-Bonferroni correction over all tested comparisons.
- **Timeouts are results.** A sample the app did not complete within its limit (startup 300 s, UI
  waits 120 s, a click the page never accepted within 30 s, a server that exited, a desktop window
  that never appeared, CLI 300 s) is stored as a censored value (`Metric.censored`) and ranks at its
  limit in the test and the median; the report shows ">= x" and how many timed out, and never drops
  such a comparison as one-sided. Other failed samples are listed and left out.
- **Improvement column.** Every comparison table says how many times better or worse V2 is than V1,
  from V2's side ("13x faster", "6.1x slower"), with the 95% interval of the factor, and marks
  "(n.s.)", "(unclear)", "(indicative, n=1)", "(context only, not judged)" or a ">=" bound where
  those apply.
- **Idle windows.** The measured idle window opens `settleSec` after ready (120 s in `full`), after
  V1's +15 s pricing fetch and +60 s cost backfill and V2's +30 s PR sync.
- **Background load for UI navigation** is an open loop at the same fixed rate for both apps (25
  `plans.list` per second, at most 8 in flight, plus one plan update every 500 ms).

## Process hygiene

- Every app process gets an explicit, per-run `TENDRIL_HOME` (server homes under
  `<ws>/runs/<runId>/homes/`; desktop homes under `~/Library/Caches/tendril-benchmark/<runId>/`,
  because a LaunchServices app reading `~/Desktop` needs a privacy consent) and an empty
  `CLAUDE_CONFIG_DIR`. The harness refuses to start an app without one and refuses `~/.tendril`.
  Removed from every child environment: `TENDRIL_HOME TENDRIL_CONFIG TENDRIL_PLANS PORT HOST VERBOSE
  BASE_PATH IVY_TLS TENDRIL_NOT_MASTER TENDRIL_BETA TENDRIL_AUTH_PASSWORD BasicAuth__Users RUST_LOG
  DOTNET_gcServer DOTNET_GCHeapHardLimit DOTNET_TieredPGO`.
- Ports are allocated free on loopback, never 5000, 5010, 5173, 6041 or 7000.
- Processes run in their own process group and are stopped with SIGTERM, then SIGKILL after 5 s,
  descendants included. Desktop apps are identified by `TENDRIL_HOME` in their environment (other
  sessions may run the same bundles), quit (V1 SIGINT first) and checked for leftovers. After each
  suite the runner stops anything still running and records it; Ctrl-C stops everything and marks
  the run interrupted. V2 launches set `TENDRIL_SKIP_SERVICE_PROVISION=1` and
  `TENDRIL_SKIP_SERVICE_AUTOSTART=1` (no LaunchAgent, no sidecar copy).
- Every spawned process's stdout and stderr is kept in `<runDir>/logs/`, next to `harness.log`.

## Caveats

The report repeats these next to the affected numbers.

- The V2 UI runs in Chromium through the IPC shim (one loopback WebSocket message per command), not
  the Tauri host; the shim's memory is not `tendril-app` memory. The network suite checks the shim's
  host traffic against the real app.
- UI timings are Blink; the desktop apps use WKWebView, where only launch milestones and memory are
  measured. Launch milestones are process events: V1's window appears after its in-process server
  answers, Tauri's before the page has loaded. No content milestone is measured in the desktop apps.
- V2's daemon starts before its app; `launch` leaves that out, `cold-launch` includes it.
- Desktop windows differ: V1 opens at 900x628 points, V2 at 1280x800 points (V1 is smaller); the suite
  records the sizes it observed.
- The idle and api suites compare V1's web server (which renders its UI on the server) with V2's
  daemon alone (no UI host); the desktop whole tree is the like-for-like memory number.
- API payloads differ: V2's plan list returns full plan objects including the latest revision text,
  V1's a thin summary. Latency is always shown next to response bytes.
- V1 desktop runs with `IVY_TLS=0`; the shipped app uses TLS (this favours V1 slightly).
- V1 is a signed release build; V2 is built from source at the pinned commit.
- Both apps' background fetches run (shipped defaults) and add noise to CPU and external traffic.
- Peak footprint of a process set is a sum of per-process peaks (an upper bound).
- Background load on the machine is recorded but cannot be removed; see the load numbers per suite.

## Layout

```
src/benchmark/
  README.md                 this file
  benchmark.md              generated report (by `report`), with charts/ and results/<runId>/
  analysis.md               optional hand-written interpretation, injected by runId
  bin/tendril-bench.ts      CLI: setup | datasets | run | report | doctor | clean
  lib/                      config (pins, profiles), proc, procstat, stats, results, env, sizes, http, tcpproxy, log
  native/procstat.c         proc_pid_rusage / responsibility / window helper (persistent child)
  native/cliexec.c          runs one CLI command and reads the exited process's rusage
  apps/                     AppAdapter for V1 and V2 (binaries, readiness, auth, selectors, desktop launch)
  datasets/                 dataset generator and the `datasets` command
  build/setup.ts            the `setup` command
  v2-shim/                  IPC shim crate (own [workspace]) and init.js
  tools/resdump.cs          dumps V1's embedded frontend resources (dotnet run)
  suites/                   one module per suite plus the runner (suites/index.ts)
  report/                   report generator, SVG charts, fixtures and their generator

<ws>/ (default ~/Desktop/tendril-benchmark)
  ivy-tendril-v1/           clone @ v1.2.4 (f6b1de3d)
  ivy-tendril-v2/           clone @ pinned V2 sha
  builds/                   v1-publish/, v2-shim/, bin/procstat, bin/cliexec, .stamps/
  artifacts/v1|v2/          release pkg + expanded app; Tendril.app + dmg
  build-info.json           what was built, from which sha, when, with which tools
  datasets/<name>/v1|v2/    migrated template homes per app; datasets/repos/ fixture repos
  runs/<runId>/             run.json, results/<suite>.json, homes/, logs/
  empty-claude-config/      empty dir passed to both apps as CLAUDE_CONFIG_DIR
```

## For contributors

- Only erasable TypeScript (no `enum`, `namespace`, parameter properties or `import x = require`),
  relative imports with the `.ts` extension, `import type` for types, ESM, no new npm dependencies
  (Node built-ins and the repo's `playwright`). `src/benchmark` is not a pnpm workspace package and
  the shim is not in the cargo workspace, so CI is unaffected.
- Comments explain why, not what. Never use the em dash character anywhere in this directory.
- A suite is `suites/<name>.ts` exporting `run(ctx: SuiteContext): Promise<SuiteResult>` (schema in
  `lib/results.ts`). Take counts from `ctx.knobs`, use `ctx.interleave` for repeated comparisons,
  record every failed sample in `failures`, a timed-out one also in `Metric.censored`, and the
  instance of each sample in `Metric.instance` when samples share a server.
- `apps/index.ts` exports `createAdapters(ids, opts)`; `setup`, `datasets` and `report` export
  `main(ctx: CommandContext)`.
