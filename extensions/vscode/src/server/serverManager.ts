import * as vscode from 'vscode';
import * as cp from 'child_process';
import { CONFIG_KEYS } from '../constants';
import {
  discoverMaster,
  fetchProjects,
  fetchRecentPlans,
  isWorkspaceManaged,
  pingServer,
  resolveTendrilHome
} from './masterDiscovery';
import { assertIsolatedTendrilHome } from './homeGuard';
import { DiscoveryResult, ServerHealthInfo, TendrilPlanSummary, TendrilProjectSummary } from './types';

export function buildServerArgs(port = 0): string[] {
  const args = ['--web'];
  if (typeof port === 'number' && port > 0) {
    args.push(`--port=${port}`);
  } else {
    args.push('--find-available-port');
  }
  return args;
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
    this.outputChannel = vscode.window.createOutputChannel('Tendril Server');
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
    if (discovery.status !== 'found') {
      return {
        isAlive: false,
        activeJobsCount: 0
      };
    }

    const isReachable = await pingServer(discovery.result.baseUrl, 2000);
    if (!isReachable) {
      return {
        isAlive: false,
        activeJobsCount: 0,
        baseUrl: discovery.result.baseUrl,
        port: discovery.result.port,
        pid: discovery.result.pid
      };
    }

    return {
      isAlive: true,
      baseUrl: discovery.result.baseUrl,
      port: discovery.result.port,
      pid: discovery.result.pid,
      activeJobsCount: 0
    };
  }

  public async getRecentPlans(limit = 5): Promise<TendrilPlanSummary[]> {
    const health = await this.getHealthInfo();
    if (!health.isAlive || !health.baseUrl) {
      return [];
    }

    const discovery = discoverMaster(this.tendrilHome, false);
    const apiKey = discovery.status === 'found' ? discovery.result.apiKey : undefined;
    return fetchRecentPlans(health.baseUrl, limit, apiKey);
  }

  public async getProjects(): Promise<TendrilProjectSummary[]> {
    const health = await this.getHealthInfo();
    if (!health.isAlive || !health.baseUrl) {
      return [];
    }

    const discovery = discoverMaster(this.tendrilHome, false);
    const apiKey = discovery.status === 'found' ? discovery.result.apiKey : undefined;
    return fetchProjects(health.baseUrl, apiKey);
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
    const projects = await this.getProjects();
    const result = isWorkspaceManaged(workspacePath, projects);

    return {
      isManaged: result.isManaged,
      projectName: result.projectName,
      workspacePath
    };
  }

  public async executeCli(args: string[]): Promise<string> {
    assertIsolatedTendrilHome(this.tendrilHome, `run 'tendril ${args.join(' ')}'`);

    const config = vscode.workspace.getConfiguration();
    const executable = config.get<string>(CONFIG_KEYS.executablePath, 'tendril');

    return new Promise((resolve, reject) => {
      cp.execFile(
        executable,
        args,
        {
          env: {
            ...process.env,
            TENDRIL_HOME: this.tendrilHome
          }
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || stdout || error.message));
          } else {
            resolve(stdout);
          }
        }
      );
    });
  }

  public async ensureServerRunning(): Promise<DiscoveryResult> {
    const existing = discoverMaster(this.tendrilHome, true);
    if (existing.status === 'found') {
      const ping = await pingServer(existing.result.baseUrl, 2000);
      if (ping) {
        return existing.result;
      }
    }

    const config = vscode.workspace.getConfiguration();
    const autoStart = config.get<boolean>(CONFIG_KEYS.serverAutoStart, true);

    if (!autoStart) {
      throw new Error(
        'Tendril server is not running and tendril.server.autoStart is disabled.'
      );
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
    requireSpawnedChild: boolean
  ): Promise<DiscoveryResult> {
    const startTime = Date.now();
    let lastStatus = 'not_found';

    while (Date.now() - startTime < timeoutMs) {
      if (requireSpawnedChild && !this.spawnedChild) {
        throw new Error('Tendril server process exited unexpectedly during startup.');
      }

      const current = discoverMaster(this.tendrilHome, true);
      lastStatus = current.status;
      if (current.status === 'found') {
        const isUp = await pingServer(current.result.baseUrl, 1500);
        if (isUp) {
          return current.result;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(
      `Tendril server did not become discoverable at ${this.tendrilHome} within ${timeoutMs}ms (last status: ${lastStatus}).`
    );
  }

  public async startServer(): Promise<DiscoveryResult> {
    assertIsolatedTendrilHome(this.tendrilHome, 'start a Tendril server');

    if (this.isSpawning) {
      throw new Error('Tendril server is already in the process of starting.');
    }

    const existing = discoverMaster(this.tendrilHome, true);
    if (existing.status === 'found') {
      const ping = await pingServer(existing.result.baseUrl, 2000);
      if (ping) {
        this.outputChannel.appendLine(
          `Tendril server is already running on ${existing.result.baseUrl} (PID ${existing.result.pid}).`
        );
        this.notifyStateChanged();
        return existing.result;
      }
    }

    this.isSpawning = true;
    try {
      const config = vscode.workspace.getConfiguration();
      const executable = config.get<string>(CONFIG_KEYS.executablePath, 'tendril');
      const port = config.get<number>(CONFIG_KEYS.serverPort, 0);
      const pollTimeoutMs = config.get<number>(CONFIG_KEYS.serverPollTimeout, 15000);

      const args = buildServerArgs(port);

      this.outputChannel.show(true);
      this.outputChannel.appendLine(`Starting Tendril server: ${executable} ${args.join(' ')}`);
      this.outputChannel.appendLine(`Using TENDRIL_HOME: ${this.tendrilHome}`);

      const child = cp.spawn(executable, args, {
        env: {
          ...process.env,
          TENDRIL_HOME: this.tendrilHome
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.spawnedChild = child;

      child.stdout?.on('data', (data: Buffer) => {
        this.outputChannel.append(data.toString());
      });

      child.stderr?.on('data', (data: Buffer) => {
        this.outputChannel.append(data.toString());
      });

      child.on('error', (err: Error) => {
        this.outputChannel.appendLine(`Failed to start Tendril server: ${err.message}`);
        this.spawnedChild = null;
        this.notifyStateChanged();
      });

      child.on('exit', (code: number | null, signal: string | null) => {
        this.outputChannel.appendLine(
          `Tendril server exited with code ${code ?? 'null'} (signal: ${signal ?? 'none'}).`
        );
        this.spawnedChild = null;
        this.notifyStateChanged();
      });

      try {
        const result = await this.waitUntilDiscoverable(pollTimeoutMs, true);
        this.lastStartupError = undefined;
        this.outputChannel.appendLine(
          `Tendril server successfully connected at ${result.baseUrl} (PID ${result.pid}).`
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
      this.outputChannel.appendLine('Stopping spawned Tendril server...');
      const child = this.spawnedChild;
      this.spawnedChild = null;

      child.kill('SIGTERM');

      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Ignore error if already dead
          }
          resolve();
        }, 3000);

        child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.outputChannel.appendLine('Tendril server stopped.');
      this.notifyStateChanged();
      return;
    }

    const discovery = discoverMaster(this.tendrilHome, true);
    if (discovery.status === 'found') {
      try {
        process.kill(discovery.result.pid, 'SIGTERM');
        this.outputChannel.appendLine(
          `Sent SIGTERM to external Tendril server process (PID ${discovery.result.pid}).`
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showWarningMessage(`Could not stop Tendril server: ${message}`);
      }
    } else {
      vscode.window.showInformationMessage('No active Tendril server found.');
    }

    this.notifyStateChanged();
  }

  public async restartServer(): Promise<DiscoveryResult> {
    await this.stopServer();
    await new Promise(resolve => setTimeout(resolve, 1000));
    return this.startServer();
  }

  public notifyStateChanged(): void {
    void this.getHealthInfo().then(info => {
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
