import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapperPath = path.join(repoRoot, "scripts", "storybook-dev.ts");
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

/**
 * A probe base far outside 6006..6015, so these tests never depend on whether the developer's real
 * Storybook dev server happens to be running.
 */
const PORT_BASE = 61_000;

const heldServers: net.Server[] = [];

/** Holds `port` on the same loopback host the wrapper probes, until the current test finishes. */
function holdPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      heldServers.push(server);
      resolve();
    });
  });
}

afterEach(async () => {
  await Promise.all(
    heldServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

/** Runs the wrapper in `--print-port` mode, which resolves a port and exits without spawning Storybook. */
function printPort(...forwarded: string[]): string {
  return execFileSync(
    process.execPath,
    [tsxCli, "scripts/storybook-dev.ts", "--print-port", ...forwarded],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, STORYBOOK_PORT_BASE: String(PORT_BASE) },
    },
  ).trim();
}

// Each `printPort` call boots a tsx subprocess, which can take well over the 5s default when the
// machine is busy, so the suite carries its own generous timeout rather than flaking under load.
describe("Storybook dev server port selection", { timeout: 60_000 }, () => {
  it("picks the base port when nothing holds it", () => {
    expect(printPort()).toBe(String(PORT_BASE));
  });

  it("steps to the next port when the base is held", async () => {
    await holdPort(PORT_BASE);

    expect(printPort()).toBe(String(PORT_BASE + 1));
  });

  it("keeps stepping while consecutive ports are held", async () => {
    await holdPort(PORT_BASE);
    await holdPort(PORT_BASE + 1);

    expect(printPort()).toBe(String(PORT_BASE + 2));
  });

  it("falls back to an ephemeral port when the whole range is exhausted", async () => {
    for (let offset = 0; offset < 10; offset++) {
      await holdPort(PORT_BASE + offset);
    }

    // 0 is the sentinel for "drop -p and let Storybook choose", so startup never hard-fails.
    expect(printPort()).toBe("0");
  });

  it("honours an explicit port from the caller without probing", async () => {
    // The base is free, so a probing wrapper would answer with it instead of the caller's port.
    expect(printPort("-p", "7777")).toBe("7777");
    expect(printPort("--port=7777")).toBe("7777");

    // Still the caller's port even when it is the one that is held.
    await holdPort(PORT_BASE);
    expect(printPort("-p", String(PORT_BASE))).toBe(String(PORT_BASE));
  });

  it("spawns storybook non-interactively on loopback without a shell", () => {
    const source = readFileSync(wrapperPath, "utf8");

    // --ci suppresses telemetry/port prompts and stops the browser from being opened.
    expect(source).toContain("--ci");
    // Loopback only — never expose the dev server on every network interface.
    expect(source).toContain("127.0.0.1");
    // Storybook's exact-port flag exits(-1) silently when detect-port disagrees, and detect-port is
    // exactly the component this wrapper exists to work around.
    expect(source).not.toContain("--exact-port");
    // No shell: argument quoting stays correct on Windows.
    expect(source).not.toContain("shell: true");
  });
});
