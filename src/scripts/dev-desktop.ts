#!/usr/bin/env node
import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.PORT) || 5010;
const tendrilHome = process.env.TENDRIL_HOME || path.join(os.homedir(), ".tendril");

function checkServiceHealth(p: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${p}/api/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForService(p: number, timeoutMs = 60000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkServiceHealth(p)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function isPortFree(p: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => {
      tester.close(() => resolve(false));
    });
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(p, host);
  });
}

async function freePortIfOccupied(p: number) {
  const free = await isPortFree(p);
  if (!free) {
    console.log(
      `\x1b[33m[dev-desktop] Port ${p} is in use by a stale process, freeing it...\x1b[0m`,
    );
    try {
      if (process.platform !== "win32") {
        const pids = execSync(`lsof -ti :${p}`, { stdio: ["ignore", "pipe", "ignore"] })
          .toString()
          .trim()
          .split(/\s+/);
        for (const pid of pids) {
          if (pid) {
            try {
              process.kill(Number(pid), "SIGTERM");
            } catch {}
          }
        }
      } else {
        execSync(
          `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${p}') do taskkill /F /PID %a`,
          {
            stdio: "ignore",
          },
        );
      }
      await new Promise((r) => setTimeout(r, 800));
    } catch {}
  }
}

let serverProcess: ChildProcess | null = null;
let appProcess: ChildProcess | null = null;
let shuttingDown = false;
/**
 * Set the instant an interrupt arrives, and it outranks whatever exit code the children report.
 *
 * Ctrl+C reaches the whole foreground group, not just this process, so the Tauri CLI is interrupted
 * at the same moment we are and exits 130 — and its `exit` listener below can win the race against
 * our own signal handler. The old code forwarded that 130 as this script's status, which pnpm reports
 * as `[ELIFECYCLE] Command failed with exit code 130`: a clean Ctrl+C rendered as a crash. A
 * user-initiated interrupt is a normal exit however the children happen to phrase it, so the flag is
 * recorded first and `shutdown` reads it rather than the child's code.
 */
let interrupted = false;
/** Readline interfaces over the service's pipes. They hold the event loop open until closed. */
const lineReaders: readline.Interface[] = [];

/** How long a child tree gets to wind itself down before it is killed outright. */
const SHUTDOWN_GRACE_MS = 5000;

function hasExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

/**
 * Signal a child and everything it started.
 *
 * Windows has no process groups to signal, and both children here are the root of a tree: `cargo run`
 * holds `tendril-server.exe`, and (now that it needs a shell) the `pnpm` command holds the Tauri CLI,
 * vite and another cargo. Killing only the root leaves the rest running, still holding port 5010 and
 * the home's `.master` claim, so the next run is refused by name. `taskkill /T` takes the tree, and
 * `/F` is added only for the forceful pass so the polite one can still be honoured.
 */
function signalTree(proc: ChildProcess, force: boolean) {
  if (!proc.pid || hasExited(proc)) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill ${force ? "/F " : ""}/T /PID ${proc.pid}`, { stdio: "ignore" });
    } else {
      // Each child leads its own group (`detached`), so the negated pid reaches every grandchild.
      process.kill(-proc.pid, force ? "SIGKILL" : "SIGINT");
    }
  } catch {}
}

/** Resolves true once `proc` has exited, or false if `ms` elapses first. */
function waitForExit(proc: ChildProcess, ms: number): Promise<boolean> {
  if (hasExited(proc)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      proc.off("exit", onExit);
      resolve(false);
    }, ms);
    proc.once("exit", onExit);
  });
}

/** SIGTERMs whatever still holds `p`, for a port our own tree was supposed to have released. */
async function reapPort(p: number) {
  if (process.platform === "win32") return;
  if (await isPortFree(p)) return;
  try {
    const pids = execSync(`lsof -ti :${p}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
      .split(/\s+/);
    for (const pid of pids) {
      if (!pid) continue;
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {}
    }
  } catch {}
}

/**
 * Stop both child trees, wait for them, and only then exit.
 *
 * Two things here were wrong before and each produced the same complaint. The interrupt is delivered
 * as `SIGINT` rather than `SIGTERM`: `pnpm` reports a `SIGTERM`ed script as a *failed* run, so a
 * clean Ctrl+C ended in `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` and a nonzero status, while `SIGINT` is
 * the interrupt every process in the tree already exits quietly on — and it is what
 * `tendril-server`'s `shutdown_signal` awaits, so the daemon takes its graceful path instead of
 * being cut down mid-write. And the exit is now *awaited*: the old version signalled and called
 * `process.exit(0)` on the next line, so whether anything actually died was luck, and a survivor
 * still holding port 5010 or the home's `.master` claim made the next run fail by name.
 *
 * A second Ctrl+C during the grace window skips straight to the forceful pass.
 */
async function shutdown(exitCode = 0): Promise<void> {
  // An interrupt is a normal exit, whatever status the interrupted children reported on their way
  // out. See `interrupted`.
  const finalCode = interrupted ? 0 : exitCode;

  if (shuttingDown) {
    forceExit(finalCode);
    return;
  }
  shuttingDown = true;
  // `\r` first, so the terminal's own `^C` echo is overwritten rather than left sitting in front of
  // this line. That stray `^[`-looking prefix in the shutdown output is the echo, not our escape
  // codes, and it is what made the last line of a clean run look corrupted.
  process.stdout.write("\r\x1b[K");
  console.log("\x1b[33m[dev-desktop] Shutting down...\x1b[0m");

  const children: Array<{ label: string; proc: ChildProcess }> = [];
  if (appProcess) children.push({ label: "desktop app", proc: appProcess });
  if (serverProcess) children.push({ label: "service", proc: serverProcess });

  for (const { proc } of children) signalTree(proc, false);

  const settled = await Promise.all(
    children.map(({ proc }) => waitForExit(proc, SHUTDOWN_GRACE_MS)),
  );
  settled.forEach((exited, i) => {
    const child = children[i];
    if (exited || !child) return;
    console.log(
      `\x1b[33m[dev-desktop] The ${child.label} did not stop within ${SHUTDOWN_GRACE_MS}ms; killing it.\x1b[0m`,
    );
    signalTree(child.proc, true);
  });

  // Belt and braces. Vite is started by the Tauri CLI's `beforeDevCommand`, so the tree kill above
  // should already have taken it; the sweep only runs when something is somehow still on the port,
  // which keeps an unrelated dev server on 5173 from being killed on the way out.
  await reapPort(5173);

  for (const reader of lineReaders) reader.close();
  forceExit(finalCode);
}

/**
 * Leave now. The pipes and timers above can keep the loop alive past the point where there is
 * anything left to do, and a dev runner that lingers after Ctrl+C reads as a hang.
 */
function forceExit(code: number): never {
  process.exit(code);
}

/**
 * Called before anything is spawned, so the flag is already set by the time an interrupted child's
 * `exit` listener runs: the group signal reaches them and us at the same moment, and it is a coin
 * toss which callback the loop picks up first.
 *
 * A function rather than top-level code because this module is also imported — by the tests that
 * cover `parseRunnerFlags` — and an import that quietly takes over the importer's SIGINT is a
 * surprise nobody asked for.
 */
function installSignalHandlers() {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    // SIGHUP is here for the same reason as the other two: closing the terminal used to orphan the
    // whole tree, daemon and all.
    process.on(signal, () => {
      interrupted = true;
      void shutdown(0);
    });
  }
}

/**
 * Make sure both Tauri sidecars exist before `tauri dev` looks for them.
 *
 * `tauri.conf.json` declares `binaries/tendril` and `binaries/opencode` as `externalBin`, and the
 * Tauri CLI resolves each by host target triple at dev time as well as at bundle time - a missing
 * one fails the run outright. Neither is committed (see `src-tauri/binaries/.gitignore`): the
 * companion CLI is built from this workspace, and OpenCode is downloaded once and cached.
 *
 * Neither failure is fatal here. A developer who only wants the UI should still get a window, so
 * each problem prints what to run and carries on.
 */
function ensureSidecars() {
  const triple = (() => {
    try {
      const vv = execSync("rustc -vV", { encoding: "utf8" });
      return /^host:\s*(.+)$/m.exec(vv)?.[1]?.trim() ?? null;
    } catch {
      return null;
    }
  })();

  if (!triple) {
    console.error("\x1b[31m[dev-desktop] Could not read the host target triple from rustc.\x1b[0m");
    return;
  }

  const exe = triple.includes("windows") ? ".exe" : "";
  const binDir = path.resolve(__dirname, "..", "apps", "tendril-app", "src-tauri", "binaries");
  fs.mkdirSync(binDir, { recursive: true });

  // The companion CLI, rebuilt every run: it is cheap once cargo has warmed up, and a stale copy
  // means a promptware's `tendril` call runs code that no longer matches this checkout.
  const cliDest = path.join(binDir, `tendril-${triple}${exe}`);
  try {
    execSync("cargo build -p tendril-cli", { stdio: "inherit" });
    const built = path.resolve(__dirname, "..", "..", "target", "debug", `tendril${exe}`);
    fs.copyFileSync(built, cliDest);
    if (!exe) fs.chmodSync(cliDest, 0o755);
  } catch (err) {
    console.error(
      `\x1b[31m[dev-desktop] Could not stage the tendril sidecar at ${cliDest}:\x1b[0m`,
      err instanceof Error ? err.message : err,
    );
  }

  // OpenCode, downloaded once. ~140 MB, so the script no-ops when the file is already there.
  const ocDest = path.join(binDir, `opencode-${triple}${exe}`);
  if (fs.existsSync(ocDest)) return;
  const fetchScript = path.resolve(
    __dirname,
    "..",
    "apps",
    "tendril-app",
    "scripts",
    "release",
    "fetch-opencode-sidecar.sh",
  );
  console.log("\x1b[36m[dev-desktop] Downloading the bundled OpenCode agent (one time)...\x1b[0m");
  try {
    execSync(`bash "${fetchScript}" "${triple}"`, { stdio: "inherit" });
  } catch (err) {
    console.error(
      "\x1b[31m[dev-desktop] Could not download OpenCode; the opencode/ivy/proxy agents will fall\n" +
        `  back to whatever is on your PATH. Run it yourself with:\n    bash ${fetchScript}\x1b[0m`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * The two spellings of "turn hot reload off". `--no-hotreload` is an alias rather than a mistake:
 * the feature is called hot reload throughout, so that is the name a reader reaches for first, and
 * it cost a full build and a started daemon to find out it was not the one. Accepting both is
 * cheaper than being right about which one someone will guess.
 *
 * Exported so the test suite can assert the two are interchangeable rather than trusting that every
 * place which consults them was kept in step — there are three (detection, stripping, and the
 * allowlist below), and an alias that is only honoured by two of them is worse than no alias at all.
 */
export const NO_RELOAD_FLAGS = ["--no-reload", "--no-hotreload"];

/** The flags this runner interprets itself; everything else is the Tauri CLI's to parse. */
export const OWN_FLAGS = ["--no-watch", "--no-hmr", ...NO_RELOAD_FLAGS];

/**
 * Tauri's own `--no-*` flag. Ours to forward untouched, and the one exception to the rejection
 * below, which would otherwise read it as a near miss on one of `OWN_FLAGS`.
 */
const FORWARDED_NO_FLAG = "--no-dev-server-wait";

/** What the runner decided, from argv and the environment alone. */
export interface RunnerFlags {
  /** Rust file watching off: Tauri's `--no-watch`. */
  noWatch: boolean;
  /** Frontend HMR off: `NO_HMR=1` / `VITE_HMR=false` in the child's environment. */
  noHmr: boolean;
  /** The argv to hand the Tauri CLI, with the runner's own flags removed and `--no-watch` re-added. */
  tauriArgs: string[];
  /**
   * A `--no-*` argument that looks like one of ours and is not, or `null`. The caller decides what
   * to do about it; see `reportUnknownFlag`.
   */
  unknownFlag: string | null;
}

/**
 * Work out what the runner was asked to do. Pure, and the single place the flags are interpreted.
 *
 * Both reload spellings have to be honoured in three separate places — detection, the strip that
 * keeps them from reaching a Tauri CLI that has never heard of either, and the allowlist that
 * decides whether an argument is a typo — and an alias honoured in only some of them fails in a way
 * that looks like the flag simply being ignored. Doing all three from one `NO_RELOAD_FLAGS` here,
 * rather than at three call sites, is what makes "they are the same flag" a property of the code
 * instead of a convention.
 */
export function parseRunnerFlags(
  rawArgs: string[],
  env: NodeJS.ProcessEnv = process.env,
): RunnerFlags {
  const noReload = rawArgs.some((arg) => NO_RELOAD_FLAGS.includes(arg));
  const noWatch = rawArgs.includes("--no-watch") || noReload || env.NO_WATCH === "1";
  const noHmr = rawArgs.includes("--no-hmr") || noReload || env.NO_HMR === "1";

  // Drop the npm/vp forwarding delimiter "--" and the flags the Tauri CLI does not know about.
  // `--no-watch` is deliberately absent from the strip: that one is Tauri's own, and it is re-added
  // below so that the env and alias routes to it produce the same argv as passing it directly.
  const cleanArgs = rawArgs.filter(
    (arg) => arg !== "--" && arg !== "--no-hmr" && !NO_RELOAD_FLAGS.includes(arg),
  );

  const tauriArgs: string[] = [];
  if (noWatch) {
    tauriArgs.push("--no-watch");
  }
  for (const arg of cleanArgs) {
    if (!tauriArgs.includes(arg)) {
      tauriArgs.push(arg);
    }
  }

  // Only `--no-*` is checked: those are the names this script owns, a near miss on one of them is
  // the plausible mistake, and anything else really may be a Tauri flag we have never heard of.
  const unknownFlag =
    rawArgs.find(
      (arg) => arg.startsWith("--no-") && !OWN_FLAGS.includes(arg) && arg !== FORWARDED_NO_FLAG,
    ) ?? null;

  return { noWatch, noHmr, tauriArgs, unknownFlag };
}

/**
 * Say which flag was not understood, before anything expensive happens.
 *
 * Everything this script does not recognise is forwarded to the Tauri CLI, which is what lets
 * `--config`, `--features` and friends work without being re-declared here. The cost is that a typo
 * in one of *our* flags reaches a CLI that has never heard of it, and says so in its own vocabulary:
 * `--no-hotreload` produced Tauri's usage text and exit code 2 — naming neither the flag that was
 * meant nor this script — and only after the components build, the wireframe payload, both sidecars
 * and the daemon had already been built and started. A minute of work to reach a spelling mistake.
 */
function reportUnknownFlag(flag: string) {
  console.error(
    `\x1b[31m[dev-desktop] Unknown flag '${flag}'.\x1b[0m\n` +
      `  This runner accepts:\n` +
      `    --no-watch    Rust file watching off (or NO_WATCH=1)\n` +
      `    --no-hmr      Frontend HMR off (or NO_HMR=1)\n` +
      `    --no-reload   Both of the above (--no-hotreload is the same flag)\n` +
      `  Anything else is forwarded to the Tauri CLI. See src/DEVELOPING.md.`,
  );
}

async function main() {
  // Parsed once, up front. The rejection below has to happen before anything expensive, and the
  // launch far below needs the same answer — reading argv twice is how the two spellings drifted
  // apart in the first place.
  const flags = parseRunnerFlags(process.argv.slice(2));

  // First, so a spelling mistake costs a second rather than a full build and a started daemon.
  if (flags.unknownFlag) {
    reportUnknownFlag(flags.unknownFlag);
    process.exit(2);
  }

  console.log(
    "\x1b[36m[dev-desktop] Initializing Tendril desktop development environment...\x1b[0m",
  );

  // Ensure port 5173 (Vite dev server) is free before starting
  await freePortIfOccupied(5173);

  // Ensure @ivy-interactive/components is built before launching the desktop app
  try {
    execSync(`node "${path.resolve(__dirname, "ensure-components.mjs")}"`, { stdio: "inherit" });
  } catch (err) {
    console.error("\x1b[31m[dev-desktop] Could not build @ivy-interactive/components:\x1b[0m", err);
  }

  // The wireframe payload, before anything invokes cargo. `tendril-wireframe`'s build.rs panics
  // when it is missing, so without this both the sidecar build below and `cargo run -p
  // tendril-server` fail on a fresh clone. Fatal, unlike the components build above: every cargo
  // invocation that follows is going to fail anyway, and failing here says why once instead of
  // twice in a build.rs backtrace.
  try {
    execSync(`node "${path.resolve(__dirname, "ensure-wireframe-payload.mjs")}"`, {
      stdio: "inherit",
    });
  } catch {
    console.error(
      "\x1b[31m[dev-desktop] The wireframe payload is missing and could not be generated; every\n" +
        "  cargo build would fail. See the message above.\x1b[0m",
    );
    process.exit(1);
  }

  // Both Tauri sidecars, before the Tauri CLI goes looking for them.
  ensureSidecars();

  const isAlreadyRunning = await checkServiceHealth(port);
  if (isAlreadyRunning) {
    console.log(
      `\x1b[32m[dev-desktop] Tendril service is already active on http://127.0.0.1:${port}\x1b[0m`,
    );
  } else {
    // The CLI the agents' PATH points at (`agents::providers::agent_path` puts `target/debug`
    // first) is built by `ensureSidecars` above, which needs it anyway to stage the sidecar.

    console.log(
      `\x1b[36m[dev-desktop] Starting Tendril service (cargo run -p tendril-server)...\x1b[0m`,
    );
    serverProcess = spawn("cargo", ["run", "-p", "tendril-server", "--", "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        TENDRIL_HOME: tendrilHome,
      },
    });

    if (serverProcess.stdout) {
      const rl = readline.createInterface({ input: serverProcess.stdout });
      lineReaders.push(rl);
      rl.on("line", (line) => {
        console.log(`\x1b[35m[service]\x1b[0m ${line}`);
      });
    }

    if (serverProcess.stderr) {
      const rl = readline.createInterface({ input: serverProcess.stderr });
      lineReaders.push(rl);
      rl.on("line", (line) => {
        console.error(`\x1b[35m[service]\x1b[0m ${line}`);
      });
    }

    serverProcess.on("exit", (code, signal) => {
      if (!shuttingDown) {
        console.error(`\x1b[31m[service] Exited unexpectedly with code ${code} (${signal})\x1b[0m`);
        void shutdown(1);
      }
    });

    process.stdout.write("\x1b[36m[dev-desktop] Waiting for Tendril service to be ready...\x1b[0m");
    const ready = await waitForService(port);
    if (!ready) {
      console.error(
        `\n\x1b[31m[dev-desktop] Service failed to respond on http://127.0.0.1:${port}/api/health within 60s\x1b[0m`,
      );
      await shutdown(1);
      return;
    }
    console.log(`\n\x1b[32m[dev-desktop] Service is up and listening on port ${port}!\x1b[0m`);
  }

  const { noWatch, noHmr, tauriArgs } = flags;

  const flagsSummary: string[] = [];
  if (noWatch) flagsSummary.push("Rust file watching disabled (--no-watch)");
  if (noHmr) flagsSummary.push("frontend HMR disabled (NO_HMR=1)");
  if (flagsSummary.length > 0) {
    console.log(`\x1b[33m[dev-desktop] Hot reload options: ${flagsSummary.join(", ")}\x1b[0m`);
  }

  console.log("\x1b[36m[dev-desktop] Launching desktop app (Tauri dev)...\x1b[0m");

  const appDir = path.resolve(__dirname, "..", "apps", "tendril-app");
  const tauriCli = path.join(appDir, "node_modules", "@tauri-apps", "cli", "tauri.js");
  const childEnv = {
    ...process.env,
    TENDRIL_HOME: tendrilHome,
    ...(noHmr ? { NO_HMR: "1", VITE_HMR: "false" } : {}),
  };

  if (fs.existsSync(tauriCli)) {
    // Run the Tauri CLI's entrypoint on this same Node rather than through
    // `pnpm --filter ... tauri dev`. Three things fall out of dropping that wrapper:
    //
    // - Ctrl+C stops printing `[ELIFECYCLE] Command failed.` / `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`.
    //   pnpm treats a signalled script as a failed one and says so, which made a perfectly clean
    //   shutdown look like a crash.
    // - No shell is needed on Windows. `pnpm` there is a `.cmd` shim that, since the fix for
    //   CVE-2024-27980, Node refuses to spawn directly; `process.execPath` is a real executable.
    // - One less process between us and the Tauri CLI, so the group signal has a shorter tree to
    //   walk and nothing in the middle can swallow it.
    appProcess = spawn(process.execPath, [tauriCli, "dev", ...tauriArgs], {
      cwd: appDir,
      stdio: "inherit",
      detached: process.platform !== "win32",
      env: childEnv,
    });
  } else {
    // A workspace whose dependencies were never installed, or a future layout where the CLI moved.
    // pnpm can still find it, at the cost of the wrapper noise above.
    console.log(
      "\x1b[33m[dev-desktop] @tauri-apps/cli not found locally; falling back to pnpm.\x1b[0m",
    );
    appProcess = spawn(
      "pnpm",
      ["--filter", "@ivy-interactive/tendril-app", "tauri", "dev", ...tauriArgs],
      {
        stdio: "inherit",
        detached: process.platform !== "win32",
        shell: process.platform === "win32",
        env: childEnv,
      },
    );
  }

  appProcess.on("error", (err) => {
    console.error(`\x1b[31m[dev-desktop] Could not launch the desktop app: ${err.message}\x1b[0m`);
    void shutdown(1);
  });

  appProcess.on("exit", (code) => {
    if (!shuttingDown) {
      console.log(`\x1b[33m[dev-desktop] Desktop app closed with exit code ${code}\x1b[0m`);
      void shutdown(code ?? 0);
    }
  });
}

/**
 * Only run the thing when this file *is* the thing being run.
 *
 * `tests/dev-desktop-flags.test.ts` imports `parseRunnerFlags` from here, and without this guard
 * that import starts a daemon and a Tauri window from inside the test runner. Same shape as
 * `generate-app-icons.ts`, which the icon tests import for the same reason. `realpathSync` on both
 * sides because pnpm's store means the path Node reports and the path argv carries are routinely
 * two spellings of one file.
 */
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  installSignalHandlers();
  main().catch((err) => {
    console.error(err);
    void shutdown(1);
  });
}
