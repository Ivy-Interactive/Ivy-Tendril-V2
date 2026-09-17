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

function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n\x1b[33m[dev-desktop] Shutting down...\x1b[0m");

  if (appProcess && appProcess.pid) {
    try {
      if (process.platform !== "win32") {
        process.kill(-appProcess.pid, "SIGTERM");
      } else {
        appProcess.kill("SIGTERM");
      }
    } catch {}
  }

  if (serverProcess && serverProcess.pid) {
    try {
      if (process.platform !== "win32") {
        process.kill(-serverProcess.pid, "SIGTERM");
      } else {
        serverProcess.kill("SIGTERM");
      }
    } catch {}
  }

  // Also clean up any lingering Vite frontend processes on port 5173
  try {
    if (process.platform !== "win32") {
      const pids = execSync("lsof -ti :5173", { stdio: ["ignore", "pipe", "ignore"] })
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
    }
  } catch {}

  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);

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

  const isAlreadyRunning = await checkServiceHealth(port);
  if (isAlreadyRunning) {
    console.log(
      `\x1b[32m[dev-desktop] Tendril service is already active on http://127.0.0.1:${port}\x1b[0m`,
    );
  } else {
    // The agents this daemon launches get `target/debug` at the front of their PATH, so `tendril` in a
    // promptware resolves to this workspace's CLI rather than to whatever the developer has installed
    // (see `agents::providers::agent_path`). `cargo run -p tendril-server` does not build the CLI, so
    // without this the binary that PATH entry points at may be missing or stale.
    console.log(
      "\x1b[36m[dev-desktop] Building the Tendril CLI so agents resolve this workspace's binary...\x1b[0m",
    );
    try {
      execSync("cargo build -p tendril-cli", { stdio: "inherit" });
    } catch {
      console.error(
        "\x1b[31m[dev-desktop] Could not build the CLI; agents will fall back to the `tendril` on your PATH\x1b[0m",
      );
    }

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
      rl.on("line", (line) => {
        console.log(`\x1b[35m[service]\x1b[0m ${line}`);
      });
    }

    if (serverProcess.stderr) {
      const rl = readline.createInterface({ input: serverProcess.stderr });
      rl.on("line", (line) => {
        console.error(`\x1b[35m[service]\x1b[0m ${line}`);
      });
    }

    serverProcess.on("exit", (code, signal) => {
      if (!shuttingDown) {
        console.error(`\x1b[31m[service] Exited unexpectedly with code ${code} (${signal})\x1b[0m`);
        cleanup();
      }
    });

    process.stdout.write("\x1b[36m[dev-desktop] Waiting for Tendril service to be ready...\x1b[0m");
    const ready = await waitForService(port);
    if (!ready) {
      console.error(
        `\n\x1b[31m[dev-desktop] Service failed to respond on http://127.0.0.1:${port}/api/health within 60s\x1b[0m`,
      );
      cleanup();
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
  appProcess = spawn(
    "pnpm",
    ["--filter", "@ivy-interactive/tendril-app", "tauri", "dev", ...tauriArgs],
    {
      stdio: "inherit",
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        TENDRIL_HOME: tendrilHome,
        ...(noHmr ? { NO_HMR: "1", VITE_HMR: "false" } : {}),
      },
    },
  );

  appProcess.on("exit", (code) => {
    if (!shuttingDown) {
      console.log(`\x1b[33m[dev-desktop] Desktop app closed with exit code ${code}\x1b[0m`);
      cleanup();
    }
  });
}

main().catch((err) => {
  console.error(err);
  cleanup();
});
