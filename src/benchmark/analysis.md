---
runId: 20260922-235629-quick
---

# Bottom line

V2 is much smaller and lighter than V1. It is also faster on almost every interactive path people
feel day to day: navigation, CLI calls, API reads, and seeing a plan change that an agent made on disk.
It is **not** better everywhere. This run shows four V2 regressions: startup on large homes, plan
writes, first content on small homes, and chatty UI traffic. It also found one correctness bug:
on large homes V2 silently drops about 60% of the per-plan recommendation lookups (315 to 333 of
525 per cold load). All of these should be fixed before V2 replaces V1. None of them looks
architectural. Each one points at a specific piece of code, listed under "What V2 should fix" below.

| | V1 | V2 | Improvement (V2 vs V1) |
|---|---:|---:|---|
| macOS installer | 388.9 MB | 71.2 MB | 5.5x smaller |
| Installed app, after first launch | 1,167.9 MB | 397.2 MB | 2.9x smaller |
| Desktop app, whole process tree (50 plans; screen locked, see caveats) | 353.5 MiB | 178.4 MiB | 2.0x less |
| Idle backend, 1,500 plans (V1 web server vs V2 daemon, host excluded) | 217.8 MiB | 32.5 MiB | 6.7x less |
| UI navigation to Jobs, revisit | 299 ms | 24.5 ms | 12.2x faster |
| CLI `plan list` | 170 ms | 7.9 ms | 21.5x faster |
| API: list 50 plans, 1,500-plan home | 6.84 ms | 1.00 ms | 6.8x faster |
| Plan file edited on disk until the UI shows it | 28,467 ms | 540 ms | 52.8x faster |
| Cold start to usable, 1,500 plans | 2,206 ms | 7,679 ms | **3.5x slower** |
| API: update a plan field | 6.02 ms | 9.89 ms | **1.6x slower** |
| UI cold load to content, 50 plans | 484 ms | 693 ms | **1.4x slower** |
| UI traffic for one push update | 6.2 KB | 47 KB (504 KB host to daemon) | **7.6x larger** |

# Why V2 wins where it wins

- **Size.** V1 ships a self-contained .NET runtime (the 166 MB single-file binary), a full .NET SDK
  (651 MB) and PowerShell (196 MB). V2 needs none of them, so the installer and the installed app are
  both about 5.5x smaller. The fair comparison is "after first launch": V2 then copies its
  `tendril` and `opencode` sidecars into its home, which brings it to 397 MB. That is still 2.9x
  smaller.
- **Memory.** V1's backend is one .NET process that also holds the server-side UI (a widget tree
  per connection). V2's daemon holds only data. Note the idle row compares V1's web server with
  V2's daemon *without* the Tauri host. The whole-desktop-tree row includes everything on both sides
  (app, WebKit processes, and V2's daemon), and there V2 uses 2x less. That 2x is the number to quote.
- **Navigation.** V1 renders every view on the server and streams it over SignalR, so each click
  is a round trip plus a re-render (about 300 ms). V2 renders in the page from data it already has,
  so a revisit takes about 25 ms.
- **CLI.** Agents call `tendril plan ...` constantly. A V1 call pays .NET startup (about 170 ms and
  53 MiB peak per call on this machine). A V2 call is a native binary (8 ms, 6 MiB).
- **Edits made outside the app.** V1's plan watcher listens for directory changes only
  (`NotifyFilter = DirectoryName` in `PlanWatcherService.cs`), so a `plan.yaml` edited in place is
  only noticed by the 30 s full rescan. V2 sees the edit in about 540 ms, most of which is its
  500 ms debounce. This is the biggest user-visible gain in the run, because agents edit plan files.
  One limit: V2 watches only the 500 newest plan folders ("1500 plan folders exceed the 500 watch
  cap; the 1000 oldest rely on the 30s rescan"). An edit to an older plan on a large home waits for
  the rescan just as it does in V1. The push scenarios edit recent plans.

# What V2 should fix

1. **Startup on large homes (3.5x slower at 1,500 plans).** Nearly all of it is registering file
   watches, about 1,500 of them. The cost grows faster than the plan count and depends on how busy
   `fseventsd` is. During development, with other sessions loading the machine, the same start took
   34 to 46 s. One recursive watch on `Plans/`, or watching only active plans, should remove most
   of it.
2. **Plan writes (1.6x slower) and per-request DB setup.** `GET /api/plans` and the write paths
   open a fresh SQLite connection and run the migration check on every request (`open_database`
   in `routes/plans/crud.rs`). A pooled connection would help every endpoint.
3. **First content on small homes (1.4x slower).** The lazily loaded views hit React 19's 300 ms
   Suspense fallback throttle, so first visits land either well under 300 ms or just above it. On the
   1,500-plan home V2 is already faster (about 450 ms vs 640 ms). Preloading the landing view's chunk,
   or not showing a fallback for it, should flip the small case too.
4. **UI traffic.**
   - Every push makes the host re-fetch the whole plan list: 504 KB host to daemon for one state
     change on a 50-plan home, against 6 KB for V1.
   - The Jobs view polls every 5 s, about 187 KB per idle minute. V1 sends 114 B per minute, just
     its keep-alives.
   - The host opens a new TCP connection for every command: 38 for one cold load.

   Per-plan change events over the existing SSE stream, push-based job updates and one shared
   keep-alive HTTP client would fix all three. On loopback this costs CPU and battery rather than
   bandwidth. It would matter for remote use (tunnels).
5. **Recommendations are silently lost on large homes (a correctness bug, not just speed).**
   `cmd_list_all_recommendations` is not registered in `src-tauri/src/lib.rs`, so the frontend
   (`api/bridge.ts`, `listCrossPlanRecommendations`) falls back to one `cmd_list_recommendations`
   call per plan, all fired at once with `Promise.all`. Each call opens a new HTTP connection to the
   daemon. On the 1,500-plan home, 315 to 333 of those calls failed on every cold load in this run.
   Reproduced by hand: 525 simultaneous calls give about 230 failures (44%), every one "error sending
   request". The same calls in batches of 64 all succeed. That fits the burst overflowing the daemon's
   listen queue (`kern.ipc.somaxconn` is 128 here). The fallback's `catch` ignores the failures, so
   the Recommendations view and the startup "Pending" count drop those plans without an error.
   Registering the command, and reusing one HTTP client, fixes it.
6. **List payloads.** `GET /api/plans?limit=50` returns full plan objects, including the latest
   revision text: 464 KB against V1's 6 KB. That is fine on loopback. A summary shape for list views
   would shrink both the list and the push re-fetch in item 4.

# V1 problems the run surfaced

- Pushes are slow on larger homes. A REST write on the 1,500-plan home took 13 to 28 s to reach the
  UI, because it falls back to the 30 s rescan. An edit made on disk always does.
- V1 serves its 12.8 MB of UI assets uncompressed on every cold load.
- It downloads about 4.9 MB from a CDN within 30 s of starting (the model-pricing warmup, which
  runs at +15 s). V2's shipped model enrichment downloads 0.35 MB in the same window.
- During development one V1 server aborted under load on the 1,500-plan home, with an unhandled
  `ObjectDisposedException` in `Ivy.Core.WidgetTree.RefreshRequested`. It did not recur in the
  published run.

# How much to trust these numbers

- **This is the quick profile.** Most headline rows have 2 or 3 runs per app. They count as a
  difference only when every run of one app beat every run of the other, which held for every row
  above. The per-request rows (API, CLI) are proper tests at p < 0.01. Treat factors as
  approximate, but do not doubt their direction.
- **The machine was shared.** Other sessions kept the 1-minute load average at 9 to 25 during the
  server suites. V1 and V2 were interleaved, so both saw the same noise. Absolute times would be
  lower on a quiet machine.
- **The desktop suite ran with the screen locked.** New windows opened at 90% size and WebKit
  throttles covered views. The 2x memory ratio matches unlocked development runs (V1 396 to 423 MiB,
  V2 174 to 188 MiB). The absolute values are not representative of an app in use.
  Window-visible times are not comparable either: V2's window appears before its content, V1's only
  after its server is up.
- **V2 memory includes its shipped background work.** Both apps run on shipped defaults, so V2's
  model enrichment is on. That is why its idle daemon sits at 33 to 39 MiB rather than the 8 MiB seen
  with enrichment off.
- **The V2 UI suites use an IPC shim.** It runs the real `tendril-app` command handlers. The
  network suite checked it against the real `Tendril.app` behind a proxy: the real app moved 1.20 MB
  in 40 host-to-daemon requests on cold load, and the shim 1.20 MB in 38.
- **Code version.** The published run used harness commit `84e6141c`. The two commits after it only
  keep the Mac awake and bound page calls; they do not change any measurement.
