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
  if (shuttingDown) {
    forceExit(exitCode);
    return;
  }
  shuttingDown = true;
  console.log("\n\x1b[33m[dev-desktop] Shutting down...\x1b[0m");

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
  forceExit(exitCode);
}

/**
 * Leave now. The pipes and timers above can keep the loop alive past the point where there is
 * anything left to do, and a dev runner that lingers after Ctrl+C reads as a hang.
 */
function forceExit(code: number): never {
  process.exit(code);
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
// SIGHUP too: closing the terminal used to orphan the whole tree, daemon and all.
process.on("SIGHUP", () => void shutdown(0));

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

async function main() {
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

  const rawArgs = process.argv.slice(2);
  const noWatch =
    rawArgs.includes("--no-watch") ||
    rawArgs.includes("--no-reload") ||
    process.env.NO_WATCH === "1";
  const noHmr =
    rawArgs.includes("--no-hmr") || rawArgs.includes("--no-reload") || process.env.NO_HMR === "1";

  // Filter out npm/vp forwarding delimiter "--" and custom flags Tauri CLI doesn't know about
  const cleanArgs = rawArgs.filter(
    (arg) => arg !== "--" && arg !== "--no-reload" && arg !== "--no-hmr",
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

main().catch((err) => {
  console.error(err);
  void shutdown(1);
});
