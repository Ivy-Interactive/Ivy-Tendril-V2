import * as vscode from "vscode";
import * as cp from "child_process";
import * as net from "net";
import { CONFIG_KEYS } from "../constants";
import {
  DEFAULT_MASTER_HOST,
  discoverMaster,
  fetchActiveJobsCount,
  fetchProjects,
  fetchRecentPlans,
  isWorkspaceManaged,
  pingServer,
  resolveTendrilHome,
} from "./masterDiscovery";
import { assertIsolatedTendrilHome } from "./homeGuard";
import {
  DiscoveryResult,
  ServerHealthInfo,
  TendrilPlanSummary,
  TendrilProjectSummary,
} from "./types";

/**
 * The daemon's own default port (`Commands::Run`'s `--port` default in tendril-cli's main.rs). Used
 * as the base of the free-port search when `tendril.server.port` is left at 0.
 */
export const DEFAULT_SERVER_PORT = 5010;

/** Ports tried above the base before giving up. */
const PORT_SEARCH_ATTEMPTS = 64;

/**
 * The V2 launch line.
 *
 * V1 was `tendril --web [--port=N | --find-available-port]`. Neither the bare `--web` flag nor
 * `--find-available-port` exists in the Rust CLI, so both are a clap parse error and the spawn dies
 * immediately. `tendril run --port=N` is the closest counterpart: like V1's `--web` path it migrates
 * the database and pre-checks the port before handing off to the server.
 *
 * The port must be concrete. `--port=0` is not the auto-assign it was in V1: `MasterGuard::acquire`
 * records the *requested* port in `.master`, so a 0 would publish `port: 0` while the listener sat
 * on an ephemeral port, and nothing could find it. `findAvailablePort` picks the number instead,
 * which is what V1 delegated to `--find-available-port`.
 */
export function buildServerArgs(port: number = DEFAULT_SERVER_PORT): string[] {
  const resolved = typeof port === "number" && port > 0 ? port : DEFAULT_SERVER_PORT;
  return ["run", `--port=${resolved}`, `--host=${DEFAULT_MASTER_HOST}`];
}

/** True when a loopback listener cannot be bound at `port`, mirroring the CLI's `is_port_in_use`. */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(true));
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port, DEFAULT_MASTER_HOST);
  });
}

/**
 * First free loopback port at or above `basePort`.
 *
 * Replaces V1's `--find-available-port`, which scanned upward from the base port in the same way.
 * Inherently racy (the port can be taken between the probe and the daemon's bind), which is why
 * `tendril run` still reports "port is already in use" on its own and that message is surfaced.
 */
export async function findAvailablePort(
  basePort = DEFAULT_SERVER_PORT,
  attempts = PORT_SEARCH_ATTEMPTS,
): Promise<number> {
  for (let offset = 0; offset < attempts; offset++) {
    const candidate = basePort + offset;
    if (candidate > 65535) {
      break;
    }
    if (!(await isPortInUse(candidate))) {
      return candidate;
    }
  }

  throw new Error(
    `No free port found in ${basePort}-${Math.min(basePort + attempts - 1, 65535)}. ` +
      "Set tendril.server.port to a specific free port.",
  );
}

export class ServerManager implements vscode.Disposable {
  private readonly outputChannel: vscode.OutputChannel;
  private spawnedChild: cp.ChildProcess | null = null;
  private isSpawning = false;
  private shutdownPromise: Promise<void> | null = null;
  private readonly onDidChangeStateEmitter = new vscode.EventEmitter<ServerHealthInfo>();
  public readonly onDidChangeState = this.onDidChangeStateEmitter.event;
  /** Reason the last `startServer()` failed, for callers (tests) that swallow the thrown error. */
  public lastStartupError: Error | undefined;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Tendril Server");
  }

  public get tendrilHome(): string {
    const config = vscode.workspace.getConfiguration();
    const homeOverride = config.get<string>(CONFIG_KEYS.homeDirectory);
    return resolveTendrilHome(homeOverride);
  }

  public get isSpawnedByExtension(): boolean {
    return this.spawnedChild !== null && !this.spawnedChild.killed;
  }

  public async getHealthInfo(): Promise<ServerHealthInfo> {
    const discovery = discoverMaster(this.tendrilHome, true);
    if (discovery.status !== "found") {
      return {
        isAlive: false,
        activeJobsCount: 0,
      };
    }

    // V2 writes no heartbeat, so a live pid proves nothing about whether the daemon is serving.
    // `/api/ping` is the only liveness signal there is, and it decides `isAlive`.
    const isReachable = await pingServer(discovery.result.baseUrl, 2000);
    if (!isReachable) {
      return {
        isAlive: false,
        activeJobsCount: 0,
        baseUrl: discovery.result.baseUrl,
        port: discovery.result.port,
        pid: discovery.result.pid,
      };
    }

    return {
      isAlive: true,
      baseUrl: discovery.result.baseUrl,
      port: discovery.result.port,
      pid: discovery.result.pid,
      activeJobsCount: await fetchActiveJobsCount(discovery.result.baseUrl, discovery.result, 2000),
    };
  }

  /** The reachable daemon plus its credentials, or undefined when nothing is serving. */
  private async getAuthenticatedTarget(): Promise<DiscoveryResult | undefined> {
    const discovery = discoverMaster(this.tendrilHome, true);
    if (discovery.status !== "found") {
      return undefined;
    }
    if (!(await pingServer(discovery.result.baseUrl, 2000))) {
      return undefined;
    }
    return discovery.result;
  }

  public async getRecentPlans(limit = 5): Promise<TendrilPlanSummary[]> {
    const target = await this.getAuthenticatedTarget();
    if (!target) {
      return [];
    }

    return fetchRecentPlans(target.baseUrl, limit, target);
  }

  public async getProjects(): Promise<TendrilProjectSummary[]> {
    const target = await this.getAuthenticatedTarget();
    if (!target) {
      return [];
    }

    return fetchProjects(target.baseUrl, target);
  }

  public async checkWorkspaceProjectStatus(): Promise<{
    isManaged: boolean;
    projectName?: string;
    workspacePath?: string;
  }> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return { isManaged: true };
    }

    const workspacePath = folders[0].uri.fsPath;
    // A daemon that answered with an empty project list and a daemon that could not be reached at
    // all both reduce to `[]` in `getProjects`, and V1 read both as "this folder is unmanaged" and
    // offered to add it. That prompt is one-shot per workspace path, so firing it while the daemon
    // was down permanently suppressed the real one. Resolve the target first and say nothing when
    // there is nobody to ask.
    const target = await this.getAuthenticatedTarget();
    if (!target) {
      return { isManaged: true, workspacePath };
    }

    const projects = await fetchProjects(target.baseUrl, target);
    const result = isWorkspaceManaged(workspacePath, projects);

    return {
      isManaged: result.isManaged,
      projectName: result.projectName,
      workspacePath,
    };
  }

  public async executeCli(args: string[]): Promise<string> {
    assertIsolatedTendrilHome(this.tendrilHome, `run 'tendril ${args.join(" ")}'`);

    const config = vscode.workspace.getConfiguration();
    const executable = config.get<string>(CONFIG_KEYS.executablePath, "tendril");

    return new Promise((resolve, reject) => {
      cp.execFile(
        executable,
        args,
        {
          env: {
            ...process.env,
            TENDRIL_HOME: this.tendrilHome,
          },
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || stdout || error.message));
          } else {
            resolve(stdout);
          }
        },
      );
    });
  }

  public async ensureServerRunning(): Promise<DiscoveryResult> {
    const existing = discoverMaster(this.tendrilHome, true);
    if (existing.status === "found") {
      const ping = await pingServer(existing.result.baseUrl, 2000);
      if (ping) {
        return existing.result;
      }
    }

    const config = vscode.workspace.getConfiguration();
    const autoStart = config.get<boolean>(CONFIG_KEYS.serverAutoStart, true);

    if (!autoStart) {
      throw new Error("Tendril server is not running and tendril.server.autoStart is disabled.");
    }

    return this.startServer();
  }

  /**
   * Polls `discoverMaster` + `pingServer` until a discoverable, reachable server appears or
   * `timeoutMs` elapses. When `requireSpawnedChild` is set, bails out immediately if
   * `this.spawnedChild` has already gone null (the process died during startup) rather than
   * waiting out the full deadline.
   */
  private async waitUntilDiscoverable(
    timeoutMs: number,
    requireSpawnedChild: boolean,
    describeFailure?: () => string,
  ): Promise<DiscoveryResult> {
    const startTime = Date.now();
    let lastStatus = "not_found";

    while (Date.now() - startTime < timeoutMs) {
      if (requireSpawnedChild && !this.spawnedChild) {
        throw new Error(
          `Tendril server process exited unexpectedly during startup.${describeFailure?.() ?? ""}`,
        );
      }

      const current = discoverMaster(this.tendrilHome, true);
      lastStatus = current.status;
      if (current.status === "found") {
        const isUp = await pingServer(current.result.baseUrl, 1500);
        if (isUp) {
          return current.result;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(
      `Tendril server did not become discoverable at ${this.tendrilHome} within ${timeoutMs}ms ` +
        `(last status: ${lastStatus}).${describeFailure?.() ?? ""}`,
    );
  }

  public async startServer(): Promise<DiscoveryResult> {
    assertIsolatedTendrilHome(this.tendrilHome, "start a Tendril server");

    if (this.isSpawning) {
      throw new Error("Tendril server is already in the process of starting.");
    }

    const existing = discoverMaster(this.tendrilHome, true);
    if (existing.status === "found") {
      const ping = await pingServer(existing.result.baseUrl, 2000);
      if (ping) {
        this.outputChannel.appendLine(
          `Tendril server is already running on ${existing.result.baseUrl} (PID ${existing.result.pid}).`,
        );
        this.notifyStateChanged();
        return existing.result;
      }

      // A live pid that will not answer `/api/ping` is unrecoverable from here, and spawning anyway
      // is worse than failing: `MasterGuard::acquire` refuses to take mastership from a live pid
      // unless TENDRIL_ALLOW_MASTER_TAKEOVER=1, so the child would exit and the caller would sit
      // through the whole poll deadline to be told only that it "exited unexpectedly". V1 had
      // `tendril master release` for this; V2 has no such command, so the message has to say what to
      // do by hand.
      this.lastStartupError = new Error(
        `A Tendril daemon (PID ${existing.result.pid}) holds the master claim in ${this.tendrilHome} ` +
          `on port ${existing.result.port} but is not answering ${existing.result.baseUrl}/api/ping. ` +
          'Tendril refuses to take mastership from a live process and has no "release" command, so ' +
          `starting another server against this home cannot succeed. Stop PID ${existing.result.pid}, ` +
          "or point tendril.homeDirectory at a different TENDRIL_HOME.",
      );
      this.outputChannel.appendLine(this.lastStartupError.message);
      throw this.lastStartupError;
    }

    this.isSpawning = true;
    try {
      const config = vscode.workspace.getConfiguration();
      const executable = config.get<string>(CONFIG_KEYS.executablePath, "tendril");
      const configuredPort = config.get<number>(CONFIG_KEYS.serverPort, 0);
      const pollTimeoutMs = config.get<number>(CONFIG_KEYS.serverPollTimeout, 15000);

      const port =
        typeof configuredPort === "number" && configuredPort > 0
          ? configuredPort
          : await findAvailablePort();
      const args = buildServerArgs(port);

      this.outputChannel.show(true);
      this.outputChannel.appendLine(`Starting Tendril server: ${executable} ${args.join(" ")}`);
      this.outputChannel.appendLine(`Using TENDRIL_HOME: ${this.tendrilHome}`);

      const child = cp.spawn(executable, args, {
        env: {
          ...process.env,
          TENDRIL_HOME: this.tendrilHome,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.spawnedChild = child;

      // The daemon reports the two failures the extension cannot predict — "port is already in use"
      // and "refusing to take mastership from live PID" — on its own streams and then exits. Kept so
      // the thrown error can carry that text instead of only "exited unexpectedly".
      const recentOutput: string[] = [];
      const record = (text: string) => {
        recentOutput.push(text);
        if (recentOutput.length > 40) {
          recentOutput.splice(0, recentOutput.length - 40);
        }
      };
      const describeFailure = (): string => {
        const tail = recentOutput.join("").trim();
        return tail.length > 0 ? ` Server output: ${tail}` : "";
      };

      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        record(text);
        this.outputChannel.append(text);
      });

      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        record(text);
        this.outputChannel.append(text);
      });

      child.on("error", (err: Error) => {
        record(err.message);
        this.outputChannel.appendLine(`Failed to start Tendril server: ${err.message}`);
        this.spawnedChild = null;
        this.notifyStateChanged();
      });

      child.on("exit", (code: number | null, signal: string | null) => {
        this.outputChannel.appendLine(
          `Tendril server exited with code ${code ?? "null"} (signal: ${signal ?? "none"}).`,
        );
        this.spawnedChild = null;
        this.notifyStateChanged();
      });

      try {
        const result = await this.waitUntilDiscoverable(pollTimeoutMs, true, describeFailure);
        this.lastStartupError = undefined;
        this.outputChannel.appendLine(
          `Tendril server successfully connected at ${result.baseUrl} (PID ${result.pid}).`,
        );
        this.notifyStateChanged();
        return result;
      } catch (err: unknown) {
        this.lastStartupError = err instanceof Error ? err : new Error(String(err));
        throw this.lastStartupError;
      }
    } finally {
      this.isSpawning = false;
    }
  }

  public async stopServer(): Promise<void> {
    if (this.spawnedChild && !this.spawnedChild.killed) {
      this.outputChannel.appendLine("Stopping spawned Tendril server...");
      const child = this.spawnedChild;
      this.spawnedChild = null;

      child.kill("SIGTERM");

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // Ignore error if already dead
          }
          resolve();
        }, 3000);

        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.outputChannel.appendLine("Tendril server stopped.");
      this.notifyStateChanged();
      return;
    }

    const discovery = discoverMaster(this.tendrilHome, true);
    if (discovery.status === "found") {
      try {
        process.kill(discovery.result.pid, "SIGTERM");
        this.outputChannel.appendLine(
          `Sent SIGTERM to external Tendril server process (PID ${discovery.result.pid}).`,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showWarningMessage(`Could not stop Tendril server: ${message}`);
      }
    } else {
      vscode.window.showInformationMessage("No active Tendril server found.");
    }

    this.notifyStateChanged();
  }

  public async restartServer(): Promise<DiscoveryResult> {
    await this.stopServer();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return this.startServer();
  }

  public notifyStateChanged(): void {
    void this.getHealthInfo().then((info) => {
      this.onDidChangeStateEmitter.fire(info);
    });
  }

  /**
   * Awaitable teardown: stops a spawned server (when `tendril.server.stopOnExit` is set) and waits
   * for its `exit` event — via `stopServer()` — before disposing, so the `.master` claim it releases
   * on shutdown is guaranteed gone by the time this resolves. Idempotent: repeated calls return the
   * same in-flight/completed promise.
   */
  public async shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = (async () => {
        const config = vscode.workspace.getConfiguration();
        const stopOnExit = config.get<boolean>(CONFIG_KEYS.serverStopOnExit, false);

        if (stopOnExit && this.spawnedChild && !this.spawnedChild.killed) {
          await this.stopServer();
        }

        this.onDidChangeStateEmitter.dispose();
        this.outputChannel.dispose();
      })();
    }

    return this.shutdownPromise;
  }

  public dispose(): void {
    void this.shutdown();
  }
}
