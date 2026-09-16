/**
 * Shape of `<TENDRIL_HOME>/.master` as the V2 Rust daemon writes it.
 *
 * Mirrors `MasterInfo` in `src/crates/tendril-core/src/config.rs`, which serializes exactly these
 * camelCase keys. Two differences from V1's C# claim matter to this extension:
 *
 * - There is no `heartbeat`. V1 refreshed one every few seconds and clients treated a claim older
 *   than 90s as dead; V2 never writes or updates one, so liveness is "the pid is alive **and**
 *   `/api/ping` answers" and nothing else.
 * - There is a `secret`, which is the bearer credential for every `/api/*` route. V1 had no
 *   per-run secret and clients scraped `api.apiKey` out of `config.yaml` instead.
 */
export interface MasterFileData {
  pid: number;
  port: number;
  /** Interface the daemon bound. Defaults to `127.0.0.1`, as the daemon's own default does. */
  host: string;
  /** `http` or `https`. A request to the wrong scheme is a connection error, not a redirect. */
  scheme: string;
  /** Per-run bearer secret. Absent only from a `.master` written by a build that predates it. */
  secret?: string;
  startedAt?: string;
  version?: string;
  apiVersion?: number;
  capabilities?: string[];
}

export interface DiscoveryResult {
  baseUrl: string;
  port: number;
  pid: number;
  host: string;
  scheme: string;
  /** `.master`'s `secret`, sent as `Authorization: Bearer <secret>`. */
  secret?: string;
  /**
   * `api.apiKey` from `config.yaml`, when configured. The daemon's `api_key_middleware` sits
   * *outside* its bearer auth, so a configured key is required **in addition to** the bearer
   * secret, not as an alternative to it.
   */
  apiKey?: string;
  apiVersion?: number;
  capabilities?: string[];
}

export type DiscoveryStatus =
  | { status: 'found'; result: DiscoveryResult }
  | { status: 'dead_process'; pid: number; message: string }
  | { status: 'not_found'; message: string }
  | { status: 'invalid_content'; message: string };

export interface TendrilPlanSummary {
  id: string;
  title: string;
  state: string;
  project?: string;
  level?: string;
}

export interface TendrilProjectSummary {
  name: string;
  color?: string;
  /**
   * Repository paths. `GET /api/projects` returns `repos: [{ path, baseBranch }]` in V2 where V1
   * returned a bare `string[]`, so the path is projected out here and the rest of the entry is
   * dropped: nothing in the extension uses the base branch.
   */
  repos: string[];
}

export interface ServerHealthInfo {
  isAlive: boolean;
  port?: number;
  baseUrl?: string;
  pid?: number;
  activeJobsCount: number;
}
