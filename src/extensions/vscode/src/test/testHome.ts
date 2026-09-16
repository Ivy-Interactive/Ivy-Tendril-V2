import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TEST_ISOLATION_ENV } from '../server/homeGuard';

export const STUB_INVOCATIONS_FILE = 'stub-invocations.jsonl';

export interface IsolatedHome {
  path: string;
  dispose(): void;
}

export interface StubInvocation {
  args: string[];
  tendrilHome?: string;
  mode: 'server' | 'cli';
  pid: number;
}

/** Subset of the daemon's `.master` claim the suite asserts on. */
export interface MasterInfo {
  pid: number;
  port: number;
  host?: string;
  scheme?: string;
  secret?: string;
}

/** The bearer secret the stub daemon publishes in `.master` and requires on `/api/*`. */
export const STUB_SECRET = 'stub-secret';

function realPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function isUnderTempDir(candidate: string): boolean {
  const tmp = realPath(os.tmpdir()).replace(/[\\/]+$/, '');
  const resolved = realPath(candidate);
  return resolved.startsWith(tmp + path.sep) || resolved.startsWith(tmp + '/');
}

/**
 * Creates a throwaway TENDRIL_HOME for a test run and points the process at it.
 *
 * Every suite that starts a server or shells out to the CLI must run against one of these: a test
 * that reaches the developer's real ~/.tendril can seize mastership from the production daemon.
 */
export function createIsolatedTendrilHome(): IsolatedHome {
  const homePath = fs.mkdtempSync(path.join(os.tmpdir(), 'tendril-vscode-test-'));

  fs.mkdirSync(path.join(homePath, 'Plans'), { recursive: true });
  fs.mkdirSync(path.join(homePath, 'Logs', 'Jobs'), { recursive: true });
  fs.writeFileSync(
    path.join(homePath, 'config.yaml'),
    ['planFolder: ' + path.join(homePath, 'Plans').replace(/\\/g, '/'), 'projects: []', ''].join('\n'),
    'utf-8'
  );

  process.env.TENDRIL_HOME = homePath;
  // TENDRIL_PLANS and TENDRIL_CONFIG take precedence over the home-derived paths, so an inherited
  // value would send plan writes back to the developer's live Plans directory despite the temp home.
  process.env.TENDRIL_PLANS = path.join(homePath, 'Plans');
  process.env.TENDRIL_CONFIG = path.join(homePath, 'config.yaml');
  process.env[TEST_ISOLATION_ENV] = '1';

  return {
    path: homePath,
    dispose(): void {
      killStubServer(homePath);

      if (!isUnderTempDir(homePath)) {
        throw new Error(
          `Refusing to remove isolated Tendril home ${homePath}: it is not under ${os.tmpdir()}.`
        );
      }

      fs.rmSync(homePath, { recursive: true, force: true });
    }
  };
}

/**
 * Terminates a stub server left behind by the suite, so nothing outlives the test run holding a
 * .master claim (the orphan half of the incident this guard exists for).
 */
export function killStubServer(home: string): void {
  const masterFile = path.join(home, '.master');
  if (!fs.existsSync(masterFile)) {
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(masterFile, 'utf-8')) as { pid?: number };
    if (typeof data.pid === 'number' && data.pid > 0 && data.pid !== process.pid) {
      process.kill(data.pid, 'SIGKILL');
    }
  } catch {
    // Nothing to kill, or already gone.
  }
}

const STUB_SOURCE = `'use strict';
// Stand-in for the tendril binary, used by the VS Code extension test suite so no test ever
// launches a real Tendril daemon.
//
// Deliberately imitates the V2 daemon rather than V1's service, so the suite catches a client that
// is still on the old contracts:
//   - the .master it writes has the fields \`write_master_info\` writes and no \`heartbeat\`;
//   - /api/ping is unauthenticated and every other /api route 401s without the bearer secret;
//   - GET / is a 404, because the Rust daemon registers no static or SPA routes.
const fs = require('fs');
const http = require('http');
const path = require('path');

const args = process.argv.slice(2);
const home = process.env.TENDRIL_HOME;
const SECRET = ${JSON.stringify('stub-secret')};
// \`tendril run\` / \`tendril serve\` are the V2 launch verbs; V1's \`--web\` flag no longer exists.
const isServer = args[0] === 'run' || args[0] === 'serve';

if (home) {
  try {
    fs.appendFileSync(
      path.join(home, ${JSON.stringify(STUB_INVOCATIONS_FILE)}),
      JSON.stringify({ args, tendrilHome: home, mode: isServer ? 'server' : 'cli', pid: process.pid }) + '\\n'
    );
  } catch {
    // Logging is best effort.
  }
}

if (!isServer) {
  process.stdout.write('tendril stub: ' + args.join(' ') + '\\n');
  process.exit(0);
}

if (!home) {
  process.stderr.write('tendril stub: TENDRIL_HOME is not set\\n');
  process.exit(1);
}

const portArg = args.find(a => a.startsWith('--port='));
const requestedPort = portArg ? Number(portArg.slice('--port='.length)) : 0;

function isAuthorized(req) {
  const authorization = req.headers['authorization'] || '';
  if (authorization === 'Bearer ' + SECRET) {
    return true;
  }
  return req.headers['x-api-key'] === SECRET;
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  if (url.startsWith('/api/ping')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong');
    return;
  }

  if (!url.startsWith('/api/')) {
    // No web UI: the V2 daemon has no route here.
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"Not Found"}');
    return;
  }

  if (!isAuthorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":"Unauthorized","message":"Missing or invalid credentials."}');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('[]');
});

server.listen(Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 0, '127.0.0.1', () => {
  const port = server.address().port;
  // Mirrors \`MasterInfo\`: no heartbeat, and \`capabilities\` as \`default_capabilities()\` lists them.
  fs.writeFileSync(
    path.join(home, '.master'),
    JSON.stringify(
      {
        port,
        pid: process.pid,
        secret: SECRET,
        startedAt: new Date().toISOString(),
        host: '127.0.0.1',
        version: '0.0.0-stub',
        apiVersion: 1,
        capabilities: ['jobs', 'plans', 'projects', 'ws', 'auth_bearer', 'auth_api_key'],
        scheme: 'http'
      },
      null,
      2
    )
  );
  process.stdout.write('tendril stub listening on ' + port + '\\n');
});

function shutdown() {
  try {
    const file = path.join(home, '.master');
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (data.pid === process.pid) {
      fs.unlinkSync(file);
    }
  } catch {
    // Best effort.
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
`;

/**
 * Writes a fake tendril executable into the isolated home and returns its path, so
 * `tendril.executablePath` can never resolve to a real (possibly production) binary on PATH.
 */
export function stubTendrilExecutablePath(home: string): string {
  const scriptPath = path.join(home, 'tendril-stub.js');
  fs.writeFileSync(scriptPath, STUB_SOURCE, 'utf-8');

  if (process.platform === 'win32') {
    const cmdPath = path.join(home, 'tendril-stub.cmd');
    fs.writeFileSync(
      cmdPath,
      ['@echo off', `"${process.execPath}" "${scriptPath}" %*`, ''].join('\r\n'),
      'utf-8'
    );
    return cmdPath;
  }

  const shPath = path.join(home, 'tendril-stub');
  fs.writeFileSync(
    shPath,
    ['#!/bin/sh', `exec "${process.execPath}" "${scriptPath}" "$@"`, ''].join('\n'),
    'utf-8'
  );
  fs.chmodSync(shPath, 0o755);
  return shPath;
}

/**
 * Polls for a `.master` file under `home` until it exists, parses, and carries a numeric `pid` and
 * `port`. A missing file, a torn write, or a parse error is treated as "not ready yet" and retried
 * rather than as a failure — the stub writes `.master` in one `writeFileSync`, but a read can still
 * race an in-progress write on some filesystems.
 *
 * On timeout, throws a diagnostic error naming the home, the deadline, the reason the last attempt
 * did not resolve, a directory listing of `home`, and the tail of the stub invocation log — so a
 * genuine readiness failure is debuggable instead of surfacing as a bare assertion mismatch.
 */
export async function waitForMaster(home: string, timeoutMs = 10000): Promise<MasterInfo> {
  const masterFile = path.join(home, '.master');
  const startTime = Date.now();
  let lastReason = 'not attempted yet';

  while (Date.now() - startTime < timeoutMs) {
    try {
      const raw = fs.readFileSync(masterFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<MasterInfo>;
      if (typeof parsed.pid === 'number' && typeof parsed.port === 'number') {
        return parsed as MasterInfo;
      }
      lastReason = `parsed but missing numeric pid/port: ${raw}`;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      lastReason = code === 'ENOENT' ? 'ENOENT (file does not exist yet)' : `parse error: ${String(err)}`;
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  const listing = (() => {
    try {
      return fs.readdirSync(home).join(', ');
    } catch (err: unknown) {
      return `<failed to list ${home}: ${String(err)}>`;
    }
  })();

  const invocationTail = readStubInvocations(home)
    .slice(-5)
    .map(i => JSON.stringify(i))
    .join('\n');

  throw new Error(
    `Timed out waiting for a ready .master under ${home} after ${timeoutMs}ms (last attempt: ${lastReason}).\n` +
      `Directory listing: ${listing}\n` +
      `Last stub invocations:\n${invocationTail || '<none>'}`
  );
}

export function readStubInvocations(home: string): StubInvocation[] {
  const logPath = path.join(home, STUB_INVOCATIONS_FILE);
  if (!fs.existsSync(logPath)) {
    return [];
  }

  return fs
    .readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as StubInvocation);
}
