# Tendril V1 vs V2 benchmark

A reproducible benchmark comparing **Tendril V1** (C#/.NET 10 + Ivy Framework, release `v1.2.4`) with
**Tendril V2** (Rust axum daemon + Tauri 2 + React/Vite, pinned commit) on this machine:

1. **Responsiveness**: cold and warm start, API latency and throughput, UI load and navigation,
   push latency (server change to UI), one-shot CLI latency, across dataset sizes and under load.
2. **Memory**: `phys_footprint` of every process each app runs (RSS as context), idle, after UI
   flows, under API load, and for the real desktop apps (WKWebView) as a whole process tree.
3. **Bundle sizes**: installers, installed app, core binaries, sidecars, bundled toolchains and the
   frontend (eager and total JS/CSS, raw, gzip 9 and brotli 11).

The report, `benchmark.md`, is generated from measured results by `report`; nothing in it is typed
by hand except `analysis.md`, which is injected when its `runId` matches.

## Quick start

Everything runs from the repo root with Node 26 (TypeScript is executed directly; there is no build
step and no `package.json` here):

```sh
node src/benchmark/bin/tendril-bench.ts doctor              # environment + tool/build/dataset checks
node src/benchmark/bin/tendril-bench.ts setup               # clone, check out, build everything
node src/benchmark/bin/tendril-bench.ts datasets            # generate + migrate + snapshot dataset homes
node src/benchmark/bin/tendril-bench.ts run --profile quick # smoke run (minutes)
node src/benchmark/bin/tendril-bench.ts run --quiet-load 2  # full run on a quiet machine
node src/benchmark/bin/tendril-bench.ts report              # benchmark.md + charts from the latest complete run
```

Typecheck (must pass):

```sh
node_modules/.bin/tsc -p src/benchmark/tsconfig.json
```

If `node_modules/.bin/tsc` is missing in a fresh worktree, use
`node_modules/.pnpm/node_modules/.bin/tsc -p src/benchmark/tsconfig.json` (same compiler).

## Commands

| command | what it does |
|---|---|
| `setup` | clones `ivy-tendril-v1` at `v1.2.4` and `ivy-tendril-v2` at the pinned sha into the workspace, builds everything, writes `build-info.json` (`build/setup.ts`) |
| `datasets` | generates the synthetic datasets, runs each app's own DB migrate, snapshots per-app template homes (`datasets/index.ts`) |
| `run` | runs suites into `<ws>/runs/<runId>/` |
| `report` | writes `benchmark.md`, `charts/*.svg` and copies raw results to `results/<runId>/` (`report/generate.ts`) |
| `doctor` | prints the environment and checks clones, builds, datasets, tools, Playwright/Chromium, load and power (`--json` for machine-readable output) |
| `clean` | removes per-run homes (`--homes`), a run (`--run <id>`), stray temp files (`--tmp`), and stops leftover processes that reference the workspace (`--leftovers`); a dry run unless `--yes` |

Common flags: `--workspace <dir>` (default `~/Desktop/tendril-benchmark`, or `$TENDRIL_BENCH_WORKSPACE`),
`--profile quick|full` (default `full`), `--v2-ref <sha>`.

`run` flags:

| flag | meaning |
|---|---|
| `--suite a,b\|all` | `size, cli, startup, idle, api, ui, desktop` (always executed in that order) |
| `--dataset a,b` | override the profile's datasets (`empty, small, medium, large`) |
| `--app v1,v2` | restrict to one app |
| `--run-id <id>` | resume or append into an existing run; a rerun metric replaces the earlier one with the same key |
| `--quiet-load <x>` | before each suite, wait until the 1-minute load average is below `x` (0 = do not wait) |
| `--quiet-timeout <s>` | give up waiting after `s` seconds (default 600); the wait and whether it succeeded are recorded |

Unknown suites, datasets, apps or profiles are rejected before anything is created (exit code 2).
A suite whose module is missing, fails to import or crashes is recorded as a `SuiteResult` with
failures, and the run continues with the next suite. The run's status in `run.json` is `complete`
only when every requested suite finished (with or without recorded per-sample failures).

## Workspace layout

```
<ws>/ivy-tendril-v1/          clone @ v1.2.4 (f6b1de3d)
<ws>/ivy-tendril-v2/          clone @ pinned V2 sha
<ws>/builds/v1-publish/       dotnet publish output (Ivy.Tendril single file)
<ws>/builds/v2-shim/          IPC shim crate + its target dir
<ws>/builds/bin/procstat      native process-stat helper (compiled on first use)
<ws>/artifacts/v1|v2/         release installer and expanded app bundles
<ws>/build-info.json          what was built, from which sha, when, with which tools
<ws>/datasets/<name>/v1|v2/   migrated, snapshotted template homes per app
<ws>/runs/<runId>/            run.json, results/<suite>.json, homes/, logs/
<ws>/empty-claude-config/     empty dir passed to both apps as CLAUDE_CONFIG_DIR
```

`runId` is `YYYYMMDD-HHMMSS-<profile>` in local time.

## Profiles and datasets

Every iteration count and duration comes from `lib/config.ts`:

| knob | quick | full |
|---|---|---|
| datasets (server suites) | empty, small | empty, small, medium, large |
| datasets (desktop) | small | empty, medium, large |
| datasets (cli) | small | small, large |
| startup first-start / warm runs | 2 / 3 | 5 / 10 |
| idle runs x duration | 1 x 20 s | 5 x 60 s |
| api sequential warmup / samples | 10 / 50 | 25 / 300 |
| api concurrency x duration | [1, 8] x 3 s | [1, 8, 32] x 8 s |
| ui cold loads / nav cycles / push / fs-push / nav-under-load | 2 / 2 / 4 / 2 / 2 | 8 / 8 / 20 / 10 / 8 |
| desktop warmup + runs x duration | 1 + 1 x 30 s | 1 + 5 x 60 s |
| cli warmup / runs | 1 / 5 | 3 / 20 |

| dataset | plans | jobs | projects |
|---|---|---|---|
| empty | 0 | 0 | 1 |
| small | 50 | 50 | 3 |
| medium | 300 | 200 | 5 |
| large | 1500 | 500 | 8 |

Two revisions of about 8 KB per plan; state mix Draft 30 / Review 15 / Completed 35 / Failed 5 /
Skipped 5 / Icebox 10 percent; seeded PRNG (seed 42), so content is identical across runs and apps.

## Suites

| suite | what it measures |
|---|---|
| `size` | installers, installed apps and their component breakdown, core binaries, sidecars, toolchains, .NET single-file bundle breakdown, frontend eager/total JS and CSS (raw, gzip 9, brotli 11) |
| `cli` | one-shot CLI wall time and peak footprint for semantically equivalent commands |
| `startup` | first start (fresh home) and warm restart: HTTP ready, data ready, footprint at ready, peak footprint, CPU to ready |
| `idle` | server tree footprint, CPU and wakeups sampled every second after ready |
| `api` | sequential latency per scenario (with response bytes), closed-loop throughput and latency at several concurrency levels, server peak footprint and CPU under load |
| `ui` | headless Chromium: cold load, navigation (first visit and revisits), push latency (REST and file-system triggered), navigation under background load, renderer and server memory after the flows |
| `desktop` | the real desktop apps (both WKWebView): process start, window visible, whole-tree footprint over time with per-role breakdown, CPU and wakeups |

V1 runs as `Ivy.Tendril --web`; V2 runs as `tendril serve` plus, for the UI, a small IPC shim that
drives the real `tendril-app` command handlers so the V2 frontend can run in Chromium. The shim is a
stand-in for the Tauri host process, not the Tauri binary; V2 host memory comes from the desktop suite.

## Metric definitions

**Memory** (reported in MiB, 2^20 bytes), read with `proc_pid_rusage(RUSAGE_INFO_V4)` by
`native/procstat.c` (verified identical to `footprint -p` for both apps):

- `footprint`: sum of `ri_phys_footprint` over the process set (dirty + compressed + swapped +
  IOKit-owned memory). This is the headline number: it is what Activity Monitor shows as "Memory" and
  what the kernel uses for jetsam limits, and it means the same thing for a .NET process, a Rust
  process, WebKit XPC services and Chromium helpers.
- `peak footprint`: sum of per-process `ri_interval_max_phys_footprint` after resetting the interval
  at the start of the scenario (`proc_reset_footprint_interval`). A sum of per-process peaks is an
  upper bound on the simultaneous peak of the set.
- `rss`: sum of `ri_resident_size`. Context only: it double-counts shared clean pages (the dyld shared
  cache, mapped assemblies) and misses compressed memory.
- The process set is the server process plus all its descendants; for the desktop apps also the
  WebKit processes whose responsible pid is the app (they are not its children), and for V2 the daemon.

**CPU**: `ri_user_time + ri_system_time` converted from mach ticks to ns. Reported as CPU-seconds
(`cpu_s`) or as the average percent of one core over a window (`cpu_percent`). Idle efficiency is
`pkg_idle_wkups + interrupt_wkups` per second.

**Latency**: request time is `performance.now()` just before the request is issued to the last byte
of the response body, on a keep-alive connection owned by the harness (Node `http`, no
`Accept-Encoding`, so both servers answer uncompressed). Readiness is polled every 5 ms: `http_ready_ms`
is spawn to the first successful health response (V1 `GET /api/ping`, V2 `GET /api/health`);
`data_ready_ms` is spawn to V1's `Initial sync complete` log line (for V2 the health endpoint only
answers after the initial sync, so both are the same). A timeout is a recorded result, never retried.

**Throughput**: closed loop, `c` workers each sending the next request when the previous one
finished; `throughput_rps` counts 2xx responses per second, and errors are reported separately.

**Sizes**: apparent bytes (`lstat` size of regular files; symlinks are not followed), never `du`.
File sizes are reported in MB (10^6 bytes) together with the exact byte count. Compressed sizes are
per file with Node's zlib (gzip level 9, brotli quality 11), which is how assets travel over HTTP;
they match `gzip -9 -n` exactly and `brotli -q 11` within a few bytes per file. The eager JS of V2 is
the entry chunk plus its transitive static imports (the V2 repo's own definition in
`code-splitting.test.tsx`); for V1 it is the Ivy entry closure plus the Tendril widgets bundle,
because V1's root shell is an external widget.

## Statistics

- Summaries: n, min, max, mean, sd, median, p5/p25/p75/p90/p95/p99 (linear interpolation, type 7), IQR, CV.
- Medians carry a 95% percentile bootstrap CI (2000 resamples, seeded mulberry32 PRNG, so a report
  regenerated from the same results is byte-identical).
- V2 versus V1 is the ratio of medians (V2 / V1) with a bootstrap CI that resamples both groups.
- Differences are flagged "not significant" when a two-sided Mann-Whitney U test gives p >= 0.01
  (exact distribution for small samples without ties, otherwise normal approximation with tie and
  continuity correction, matching scipy's defaults).
- Repeated measurements of the two apps are interleaved in ABBA order (v1, v2, v2, v1, ...) so a
  linear drift in machine state cancels out of the comparison.
- The 1-minute load average is recorded at the start and end of every suite and every 5 s during it.

## Process hygiene

- Every app process gets an explicit, per-run `TENDRIL_HOME` under `<ws>/runs/<runId>/homes/`
  (the harness refuses to start an app without one, and refuses `~/.tendril` outright), plus an empty
  `CLAUDE_CONFIG_DIR`. These variables are removed from every child environment:
  `TENDRIL_HOME TENDRIL_CONFIG TENDRIL_PLANS PORT HOST VERBOSE BASE_PATH IVY_TLS TENDRIL_NOT_MASTER
  TENDRIL_BETA TENDRIL_AUTH_PASSWORD BasicAuth__Users RUST_LOG DOTNET_gcServer DOTNET_GCHeapHardLimit
  DOTNET_TieredPGO`.
- Ports are allocated free on loopback, never 5000, 5010, 5173, 6041 or 7000.
- Processes are spawned in their own process group and stopped with SIGTERM, then SIGKILL after 5 s,
  including any descendants. After each suite the runner stops anything still running and records
  the leak in the suite's notes; Ctrl-C stops everything before exiting and marks the run interrupted.
- Every spawned process's stdout and stderr is kept in `<runDir>/logs/`, next to `harness.log`.

## Caveats

These are measured or known confounds; the report repeats them next to the affected numbers.

- The V2 UI runs in Chromium through an IPC shim (one extra loopback HTTP hop per command), not in the
  Tauri host; the shim's memory is not `tendril-app` memory.
- UI timings are Blink (headless Chromium); the desktop apps use WKWebView, where only process-level
  start and memory are measured.
- Desktop windows differ in size: V1 opens at 900x628 points (1800x1200 pixels on a 2x display), V2 at
  1280x800 points, so V1 is the smaller window. The suite records the sizes it actually observed.
- API payloads differ: V2's plan list returns full plan objects including the latest revision text,
  V1's a thin summary. Latency is always shown next to response bytes.
- V1 is a signed release build; V2 is built from source at the pinned commit.
- Peak footprint of a process set is a sum of per-process peaks (an upper bound).
- Background load on the machine is recorded but cannot be removed; see the load numbers per suite.

## For contributors

- Only erasable TypeScript (no `enum`, `namespace`, parameter properties or `import x = require`),
  relative imports with the `.ts` extension, `import type` for types, ESM, no new npm dependencies
  (Node built-ins and the repo's `playwright`).
- Comments explain why, not what. Never use the em dash character anywhere in this directory.
- A suite is `suites/<name>.ts` exporting `run(ctx: SuiteContext): Promise<SuiteResult>`
  (`suites/index.ts`, schema in `lib/results.ts`). Use `ctx.knobs` for counts, `ctx.interleave` for
  repeated app comparisons, and record every failed sample in `failures`.
- `apps/index.ts` exports `createAdapters(ids: AppId[], opts: AdapterOptions): Promise<AppAdapter[]>`
  (`apps/types.ts`).
- `setup`, `datasets` and `report` modules export `main(ctx: CommandContext): Promise<number | void>`
  (`lib/config.ts`); the CLI imports them lazily and reports a clear error when one is missing.
