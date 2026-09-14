#!/usr/bin/env node
/**
 * Starts `storybook dev` on the first free port in a predictable range instead of a random
 * ephemeral one, so the dev server URL can be bookmarked and deep-linked.
 *
 * Storybook 8.6 cannot do this with `-p` alone: its free-port probe (`detect-port`) never learns
 * which host the server is about to bind, so a port held on 127.0.0.1 reads as free on Windows
 * (where `localhost` resolves to ::1 first) and the real `listen` then throws EADDRINUSE. This
 * wrapper probes 127.0.0.1 itself — the same host Storybook binds — which is strictly more
 * accurate, and leaves Storybook's own silent fallback as the safety net for the millisecond race
 * between probe and bind.
 *
 * Usage:
 *   node scripts/storybook-dev.mjs [--print-port] [extra storybook dev args]
 *
 * Env:
 *   STORYBOOK_PORT_BASE  first port to probe (default 6006); the range is base..base+9
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";

const HOST = "127.0.0.1";
const RANGE_SIZE = 10;

const argv = process.argv.slice(2);
const printPortOnly = argv.includes("--print-port");
const forwarded = argv.filter((arg) => arg !== "--print-port");

const portBase = Number(process.env.STORYBOOK_PORT_BASE) || 6006;

/** True when the caller already picked a port, in which case their choice wins and we never probe. */
function hasPortFlag(args) {
  return args.some((arg) => arg === "-p" || arg === "--port" || /^(?:-p|--port)=/.test(arg));
}

/** The caller's port, or 0 when the flag is present but carries no readable value. */
function callerPort(args) {
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
function isPortFree(port) {
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
async function findFreePort(base) {
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

let cli;
try {
  cli = createRequire(import.meta.url).resolve("storybook/bin/index.cjs");
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

// `process.execPath` rather than a shell keeps argument quoting correct on Windows.
const child = spawn(process.execPath, args, { stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
