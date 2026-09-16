import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiscoveryResult, DiscoveryStatus, MasterFileData, TendrilPlanSummary, TendrilProjectSummary } from './types';

export function resolveTendrilHome(homeOverride?: string): string {
  if (homeOverride && homeOverride.trim().length > 0) {
    return path.resolve(homeOverride.trim());
  }

  const envHome = process.env.TENDRIL_HOME;
  if (envHome && envHome.trim().length > 0) {
    return path.resolve(envHome.trim());
  }

  return path.join(os.homedir(), '.tendril');
}

export function getMasterFilePath(tendrilHome: string): string {
  return path.join(tendrilHome, '.master');
}

/** The daemon's own default bind address (`default_host` in tendril-core's config.rs). */
export const DEFAULT_MASTER_HOST = '127.0.0.1';

/**
 * Parses `.master` as the V2 daemon writes it.
 *
 * `pid` and `port` are the only required keys, matching the daemon's serde defaults for everything
 * else. Deliberately does **not** require `heartbeat`: V2 writes no heartbeat at all, so requiring
 * one (as V1's client did) rejects every real V2 claim and makes the daemon permanently
 * undiscoverable. `startedAt`/`apiVersion` accept the snake_case spellings the daemon lists as
 * serde aliases.
 */
export function parseMasterJson(jsonText: string): MasterFileData | null {
  try {
    const raw = JSON.parse(jsonText);
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const pid = raw.pid;
    const port = raw.port;
    if (typeof pid !== 'number' || typeof port !== 'number') {
      return null;
    }

    const host = typeof raw.host === 'string' && raw.host.trim().length > 0
      ? raw.host.trim()
      : DEFAULT_MASTER_HOST;
    const scheme = typeof raw.scheme === 'string' && raw.scheme.trim().length > 0
      ? raw.scheme.trim()
      : 'http';

    return {
      pid,
      port,
      host,
      scheme,
      secret: typeof raw.secret === 'string' && raw.secret.length > 0 ? raw.secret : undefined,
      startedAt: typeof (raw.startedAt ?? raw.started_at) === 'string'
        ? String(raw.startedAt ?? raw.started_at)
        : undefined,
      version: typeof raw.version === 'string' ? raw.version : undefined,
      apiVersion: typeof (raw.apiVersion ?? raw.api_version) === 'number'
        ? Number(raw.apiVersion ?? raw.api_version)
        : undefined,
      capabilities: Array.isArray(raw.capabilities)
        ? raw.capabilities.filter((c: unknown): c is string => typeof c === 'string')
        : undefined
    };
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  if (typeof pid !== 'number' || pid <= 0 || !Number.isInteger(pid)) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const error = err as { code?: string };
    return error.code === 'EPERM';
  }
}

/**
 * Reads `api.apiKey` out of `config.yaml`.
 *
 * Still needed in V2, and for a different reason than in V1. The daemon layers
 * `api_key_middleware` outside `auth_middleware`, so when `api.apiKey` is configured a request must
 * carry a matching `X-Api-Key` *as well as* the bearer secret. When it is not configured (the
 * default) the layer is a no-op and this returns undefined.
 */
export function readApiKeyFromConfig(tendrilHome: string): string | undefined {
  const configPath = process.env.TENDRIL_CONFIG && process.env.TENDRIL_CONFIG.trim().length > 0
    ? path.resolve(process.env.TENDRIL_CONFIG.trim())
    : path.join(tendrilHome, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const lines = content.split('\n');
    let inApiSection = false;

    for (const rawLine of lines) {
      const trimmed = rawLine.trimEnd();
      const isTopLevel = trimmed.length > 0 && trimmed[0] !== ' ' && trimmed[0] !== '\t';

      if (isTopLevel) {
        inApiSection = trimmed.toLowerCase().startsWith('api:');
        continue;
      }

      if (!inApiSection) {
        continue;
      }

      const inner = trimmed.trim();
      if (!inner.toLowerCase().startsWith('apikey:')) {
        continue;
      }

      const colonIdx = inner.indexOf(':');
      const val = inner.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!val || val.startsWith('%')) {
        return undefined;
      }
      return val;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

/**
 * Every credential header an authenticated `/api/*` request needs.
 *
 * `Authorization: Bearer <secret>` is the credential; `X-Api-Key` is only added when `config.yaml`
 * configures one, because the daemon requires both in that case. V1 sent `x-api-key` alone, with
 * the scraped `api.apiKey` in it, which authenticates nothing in V2: the daemon compares an
 * `X-Api-Key` against the `.master` secret, not against the configured key.
 */
export function authHeaders(auth?: Pick<DiscoveryResult, 'secret' | 'apiKey'>): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!auth) {
    return headers;
  }
  if (auth.secret) {
    headers['Authorization'] = `Bearer ${auth.secret}`;
  }
  if (auth.apiKey) {
    headers['X-Api-Key'] = auth.apiKey;
  }
  return headers;
}

/**
 * Reads the master claim and decides whether it names a live daemon.
 *
 * `checkLiveness` covers the pid only. There is no heartbeat in V2 to age out a wedged daemon, so
 * "alive but not serving" is not detectable here; `pingServer` is what settles that, and
 * `ServerManager.getHealthInfo` pairs the two.
 */
export function discoverMaster(tendrilHome: string, checkLiveness = true): DiscoveryStatus {
  const masterFile = getMasterFilePath(tendrilHome);
  if (!fs.existsSync(masterFile)) {
    return { status: 'not_found', message: `Master file not found at ${masterFile}` };
  }

  let content: string;
  try {
    content = fs.readFileSync(masterFile, 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'invalid_content', message: `Could not read .master file: ${message}` };
  }

  const data = parseMasterJson(content);
  if (!data) {
    return { status: 'invalid_content', message: 'Malformed .master file JSON' };
  }

  if (checkLiveness && !isProcessAlive(data.pid)) {
    return {
      status: 'dead_process',
      pid: data.pid,
      message: `Tendril server process PID ${data.pid} is not running`
    };
  }

  const result: DiscoveryResult = {
    // The daemon's own `MasterInfo::base_url()` is `scheme://host:port`. V1's client hardcoded
    // `localhost`, which is a different address: the daemon binds 127.0.0.1, and `localhost`
    // resolves to ::1 first on a dual-stack machine.
    baseUrl: `${data.scheme}://${data.host}:${data.port}`,
    port: data.port,
    pid: data.pid,
    host: data.host,
    scheme: data.scheme,
    secret: data.secret,
    apiKey: readApiKeyFromConfig(tendrilHome),
    apiVersion: data.apiVersion,
    capabilities: data.capabilities
  };

  return { status: 'found', result };
}

export async function pingServer(baseUrl: string, timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // `/api/ping` is one of the daemon's three unauthenticated routes, so this needs no credential.
    const url = `${baseUrl.replace(/\/+$/, '')}/api/ping`;
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when the daemon at `baseUrl` serves an HTML document at its root.
 *
 * The V2 daemon registers API routes only (no `ServeDir`, no SPA fallback), so embedding its root
 * in a webview shows a bare 404. Probed rather than assumed, so a build that does start serving a
 * UI is picked up without another change here.
 */
export async function hasWebDashboard(baseUrl: string, timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/`, { signal: controller.signal });
    if (!res.ok) {
      return false;
    }
    const contentType = res.headers.get('content-type') ?? '';
    return contentType.toLowerCase().includes('text/html');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A plan row as `GET /api/plans` returns it in V2: a nested, snake_case `PlanFile` whose
 * `metadata.id` is an integer. V1 returned a flat camelCase object, which is why every field is
 * read out of `metadata` here and the id is padded back to the five-digit form the rest of Tendril
 * displays.
 */
function toPlanSummary(item: Record<string, unknown>): TendrilPlanSummary {
  const metadata = (item.metadata ?? item) as Record<string, unknown>;
  const rawId = metadata.id;
  const id = typeof rawId === 'number' ? padTendrilId(String(rawId)) : String(rawId ?? '');

  return {
    id,
    title: String(metadata.title ?? ''),
    state: String(metadata.state ?? ''),
    project: metadata.project ? String(metadata.project) : undefined,
    level: metadata.level ? String(metadata.level) : undefined
  };
}

/**
 * Zero-pads a numeric Tendril id to five digits, matching `normalize_job_id` in the Rust CLI.
 *
 * The V2 daemon looks jobs up with `WHERE Id = ?`, an exact match, where V1 normalized the id
 * server-side. So `458` has to become `00458` before it is put in a URL or it 404s. Non-numeric
 * ids are returned unchanged.
 */
export function padTendrilId(id: string): string {
  const trimmed = id.trim();
  if (!/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed.padStart(5, '0');
}

export async function fetchRecentPlans(
  baseUrl: string,
  limit = 5,
  auth?: Pick<DiscoveryResult, 'secret' | 'apiKey'>,
  timeoutMs = 3000
): Promise<TendrilPlanSummary[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/api/plans?limit=${limit}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...authHeaders(auth) },
      signal: controller.signal
    });
    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    if (Array.isArray(data)) {
      return data.map((item: Record<string, unknown>) => toPlanSummary(item));
    }
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchProjects(
  baseUrl: string,
  auth?: Pick<DiscoveryResult, 'secret' | 'apiKey'>,
  timeoutMs = 3000
): Promise<TendrilProjectSummary[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/api/projects`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...authHeaders(auth) },
      signal: controller.signal
    });
    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    if (Array.isArray(data)) {
      return data.map((item: Record<string, unknown>) => ({
        name: String(item.name ?? ''),
        // `color` is a non-optional String on the daemon side and is `""` when unset, so an empty
        // string has to read as "no colour" rather than as a colour named "".
        color: item.color ? String(item.color) : undefined,
        repos: Array.isArray(item.repos) ? item.repos.map(toRepoPath).filter(p => p.length > 0) : []
      }));
    }
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * V2's `repos` entries are `RepoRef { path, baseBranch }`. V1's were bare path strings, so both
 * are accepted: a string passes straight through, an object contributes its `path`.
 */
function toRepoPath(entry: unknown): string {
  if (typeof entry === 'string') {
    return entry;
  }
  if (entry && typeof entry === 'object') {
    const repoPath = (entry as Record<string, unknown>).path;
    if (typeof repoPath === 'string') {
      return repoPath;
    }
  }
  return '';
}

/**
 * How many jobs the daemon reports as `Running`.
 *
 * V1's extension hardcoded this to 0, so the sidebar's "Active Jobs" row and the "N Jobs Running"
 * status bar text were dead wiring: neither could ever show anything but zero. Now that the
 * extension authenticates, the count is cheap to read for real. Any failure reads as 0, as before.
 */
export async function fetchActiveJobsCount(
  baseUrl: string,
  auth?: Pick<DiscoveryResult, 'secret' | 'apiKey'>,
  timeoutMs = 3000
): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/api/jobs?status=Running&limit=200`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...authHeaders(auth) },
      signal: controller.signal
    });
    if (!res.ok) {
      return 0;
    }
    const data = await res.json();
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeRepoPath(p: string): string {
  if (!p) return '';
  return path.normalize(p).replace(/[\\/]+$/, '').toLowerCase();
}

export function isWorkspaceManaged(
  workspacePath: string,
  projects: TendrilProjectSummary[]
): { isManaged: boolean; projectName?: string } {
  if (!workspacePath) {
    return { isManaged: true };
  }

  const normalizedWs = normalizeRepoPath(workspacePath);
  for (const project of projects) {
    for (const repo of project.repos) {
      const normalizedRepo = normalizeRepoPath(repo);
      if (
        normalizedWs === normalizedRepo ||
        normalizedWs.startsWith(normalizedRepo + path.sep) ||
        normalizedWs.startsWith(normalizedRepo + '/')
      ) {
        return { isManaged: true, projectName: project.name };
      }
    }
  }

  return { isManaged: false };
}
