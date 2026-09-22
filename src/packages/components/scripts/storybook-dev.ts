#!/usr/bin/env node
/**
 * Starts `storybook dev` on the first free port in a predictable range instead of a random
 * ephemeral one, so the dev server URL can be bookmarked and deep-linked.
 *
 * Storybook 8.6 cannot do this with `-p` alone: its free-port probe (`detect-port`) never learns
 * which host the server is about to bind, so a port held on 127.0.0.1 reads as free on Windows
 * (where `localhost` resolves to ::1 first) and the real `listen` then throws EADDRINUSE. This
 * wrapper probes 127.0.0.1 itself - the same host Storybook binds - which is strictly more
 * accurate, and leaves Storybook's own silent fallback as the safety net for the millisecond race
 * between probe and bind.
 *
 * Usage:
 *   tsx scripts/storybook-dev.ts [--print-port] [extra storybook dev args]
 *
 * Env:
 *   STORYBOOK_PORT_BASE  first port to probe (default 6006); the range is base..base+9
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";

const HOST = "127.0.0.1";
const RANGE_SIZE = 10;

const argv = process.argv.slice(2);
const printPortOnly = argv.includes("--print-port");
const forwarded = argv.filter((arg) => arg !== "--print-port");

const portBase = Number(process.env.STORYBOOK_PORT_BASE) || 6006;

/** True when the caller already picked a port, in which case their choice wins and we never probe. */
function hasPortFlag(args: string[]): boolean {
  return args.some((arg) => arg === "-p" || arg === "--port" || /^(?:-p|--port)=/.test(arg));
}

/** The caller's port, or 0 when the flag is present but carries no readable value. */
function callerPort(args: string[]): number {
  for (const [index, arg] of args.entries()) {
    if (arg === "-p" || arg === "--port") {
      const value = Number(args[index + 1]);
      return Number.isInteger(value) ? value : 0;
    }
    const inlineValue = /^(?:-p|--port)=(\d+)$/.exec(arg);
    if (inlineValue) return Number(inlineValue[1]);
  }
  return 0;
}

/** Resolves true when `port` accepts a listener on the loopback interface Storybook binds. */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => {
      probe.close(() => resolve(false));
    });
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, HOST);
  });
}

/** First free port in base..base+9, or 0 when every one of them is taken. */
async function findFreePort(base: number): Promise<number> {
  for (let port = base; port < base + RANGE_SIZE; port++) {
    if (await isPortFree(port)) return port;
  }
  return 0;
}

const callerOwnsPort = hasPortFlag(forwarded);
const port = callerOwnsPort ? callerPort(forwarded) : await findFreePort(portBase);

// Resolve `--print-port` before touching the Storybook CLI, so the mode works uninstalled.
if (printPortOnly) {
  process.stdout.write(`${port}\n`);
  process.exit(0);
}

if (!callerOwnsPort && port === 0) {
  process.stderr.write(
    `No free port in ${portBase}..${portBase + RANGE_SIZE - 1} - letting Storybook pick an ephemeral one.\n`,
  );
}

let cli: string | undefined;
try {
  const require = createRequire(import.meta.url);
  try {
    const pkgPath = require.resolve("storybook/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.storybook;
    if (binRel) {
      const resolved = path.resolve(path.dirname(pkgPath), binRel);
      if (existsSync(resolved)) cli = resolved;
    }
  } catch {
    // Fall back to direct subpath resolution
  }

  if (!cli) {
    for (const subpath of ["storybook/bin/index.cjs", "storybook/dist/bin/dispatcher.js"]) {
      try {
        cli = require.resolve(subpath);
        break;
      } catch {
        // Continue
      }
    }
  }

  if (!cli) {
    throw new Error("Storybook CLI not found");
  }
} catch {
  process.stderr.write('Cannot resolve the storybook CLI - run "pnpm install" first.\n');
  process.exit(1);
}

const args = [cli, "dev", "--ci", "--host", HOST];
if (!callerOwnsPort && port > 0) args.push("-p", String(port));
args.push(...forwarded);

// Print the URL up front so a review action can deep-link without waiting for Storybook's banner.
process.stdout.write(
  port > 0
    ? `Storybook will start on http://${HOST}:${port}/\n`
    : "Storybook will start on an ephemeral port - watch for the URL in the banner below.\n",
);

/** Windows reports a hard native crash (STATUS_ACCESS_VIOLATION) as this exit status. */
const ACCESS_VIOLATION = 3_221_225_477;
/** A crash this late is a real fault worth surfacing, not the startup race. */
const STARTUP_WINDOW_MS = 120_000;
const MAX_RESTARTS = 2;

/**
 * Runs Storybook, restarting it if it dies at startup with a native crash.
 *
 * Storybook 8.6 on Vite+ 0.3.2 did this on roughly 40% of starts here (7 in 17): the process
 * vanished right after "Starting preview.." with an empty stderr and nothing but
 * `Exit status 3221225477` from pnpm, which is 0xC0000005. A `process.dlopen` trace put it in the
 * window where the Rust addons behind Vite+ load into a process Storybook has already made busy.
 * Storybook 10.6 on Vite+ 0.3.3 builds the preview in under a second and did not reproduce it in
 * 20 starts, so this is a guard rather than a workaround - but a silent exit status is a bad thing
 * to hand somebody, so name it and retry instead of dying quietly.
 */
function run(restarts: number): void {
  const startedAt = Date.now();
  // `process.execPath` rather than a shell keeps argument quoting correct on Windows.
  const child = spawn(process.execPath, args, { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    const crashedStarting = code === ACCESS_VIOLATION && Date.now() - startedAt < STARTUP_WINDOW_MS;
    if (crashedStarting && restarts < MAX_RESTARTS) {
      process.stderr.write(
        `Storybook died while starting with a Windows access violation (0xC0000005) - restarting (${restarts + 1}/${MAX_RESTARTS}).\n`,
      );
      run(restarts + 1);
      return;
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

run(0);
