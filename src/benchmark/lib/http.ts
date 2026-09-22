// HTTP client for latency and load measurement. node:http rather than fetch: undici's pooling and
// body streaming add scheduling we cannot see, while here a request's time is exactly
// performance.now() before http.request() to the response's last byte, on a keep-alive socket we
// control. Bodies are always drained (a socket is only reused after its body is read) and counted
// as raw body bytes; we never send Accept-Encoding, so both servers answer uncompressed.

import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { TIMEOUTS } from './config.ts';

export interface RequestSpec {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  /** Objects are sent as JSON; strings and Buffers as-is. */
  body?: unknown;
}

export interface RequestOptions extends RequestSpec {
  agent?: http.Agent | false;
  timeoutMs?: number;
  /** Keep the body in the result (default false: only its size is recorded). */
  collectBody?: boolean;
}

export interface RequestResult {
  /** 0 when no HTTP response arrived (connection error, timeout). */
  status: number;
  /** Response body bytes as received. */
  bytes: number;
  /** Request start to last body byte. */
  ms: number;
  /** Request start to response headers. */
  ttfbMs: number;
  /** performance.now() at request start / end. */
  start: number;
  end: number;
  error?: string;
  body?: Buffer;
  headers?: http.IncomingHttpHeaders;
}

/** A keep-alive agent; one per server under test so connection reuse is never shared across apps. */
export function createAgent(opts: { maxSockets?: number; https?: boolean } = {}): http.Agent {
  const o: http.AgentOptions = {
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: opts.maxSockets ?? 64,
    maxFreeSockets: opts.maxSockets ?? 64,
    scheduling: 'fifo',
  };
  return opts.https ? new https.Agent({ ...o, rejectUnauthorized: false }) : new http.Agent(o);
}

function encodeBody(body: unknown, headers: Record<string, string>): Buffer | null {
  if (body === undefined || body === null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
  return Buffer.from(JSON.stringify(body));
}

/** Never rejects: network errors and timeouts come back as status 0 with `error` set. */
export function request(opts: RequestOptions): Promise<RequestResult> {
  const url = new URL(opts.url);
  const mod = url.protocol === 'https:' ? https : http;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const payload = encodeBody(opts.body, headers);
  if (payload) headers['content-length'] = String(payload.length);
  const timeoutMs = opts.timeoutMs ?? TIMEOUTS.httpRequestMs;

  return new Promise((resolve) => {
    let settled = false;
    const start = performance.now();
    let ttfb = 0;
    const finish = (r: Omit<RequestResult, 'start' | 'end' | 'ms' | 'ttfbMs'>) => {
      if (settled) return;
      settled = true;
      const end = performance.now();
      resolve({ ...r, start, end, ms: end - start, ttfbMs: ttfb ? ttfb - start : end - start });
    };
    const req = mod.request(
      url,
      { method: opts.method ?? 'GET', headers, agent: opts.agent ?? undefined, timeout: timeoutMs, rejectUnauthorized: false },
      (res) => {
        ttfb = performance.now();
        let bytes = 0;
        const chunks: Buffer[] | null = opts.collectBody ? [] : null;
        res.on('data', (c: Buffer) => {
          bytes += c.length;
          chunks?.push(c);
        });
        res.on('end', () =>
          finish({
            status: res.statusCode ?? 0,
            bytes,
            headers: res.headers,
            body: chunks ? Buffer.concat(chunks) : undefined,
          }),
        );
        res.on('error', (e) => finish({ status: 0, bytes, error: e.message }));
        res.on('aborted', () => finish({ status: 0, bytes, error: 'response aborted' }));
      },
    );
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs} ms`)));
    req.on('error', (e) => finish({ status: 0, bytes: 0, error: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------------------------
// Load generation

export interface LoadStats {
  concurrency: number;
  /** First request start to last response end. */
  elapsedMs: number;
  /** Responses received (any status). */
  completed: number;
  /** 2xx responses. */
  ok: number;
  /** Non-2xx responses plus network errors. */
  errors: number;
  errorRate: number;
  /** Completed responses per second. */
  throughputRps: number;
  /** 2xx responses per second (the one to report: fast failures must not count as throughput). */
  okRps: number;
  /** Per-request latency (ms) of every completed request, in completion order. */
  latencies: number[];
  bytes: number;
  statuses: Record<string, number>;
  errorSamples: string[];
}

export interface LoadHandle {
  /** Stops issuing new requests, waits for those in flight, returns the stats. */
  stop(): Promise<LoadStats>;
}

function newStats(concurrency: number): LoadStats {
  return {
    concurrency,
    elapsedMs: 0,
    completed: 0,
    ok: 0,
    errors: 0,
    errorRate: 0,
    throughputRps: 0,
    okRps: 0,
    latencies: [],
    bytes: 0,
    statuses: {},
    errorSamples: [],
  };
}

function record(stats: LoadStats, r: RequestResult): void {
  const key = r.status ? String(r.status) : 'error';
  stats.statuses[key] = (stats.statuses[key] ?? 0) + 1;
  if (r.status) {
    stats.completed++;
    stats.latencies.push(r.ms);
    stats.bytes += r.bytes;
  }
  if (r.status >= 200 && r.status < 300) stats.ok++;
  else {
    stats.errors++;
    if (stats.errorSamples.length < 10) stats.errorSamples.push(r.status ? `HTTP ${r.status}` : (r.error ?? 'error'));
  }
}

function finalize(stats: LoadStats, first: number, last: number): LoadStats {
  stats.elapsedMs = last > first ? last - first : 0;
  const total = stats.ok + stats.errors;
  stats.errorRate = total ? stats.errors / total : 0;
  stats.throughputRps = stats.elapsedMs ? stats.completed / (stats.elapsedMs / 1000) : 0;
  stats.okRps = stats.elapsedMs ? stats.ok / (stats.elapsedMs / 1000) : 0;
  return stats;
}

/** One request every `everyMs` (open loop, skipped if the previous one is still running). */
export function startPeriodic(opts: { everyMs: number; next: (i: number) => RequestSpec; agent?: http.Agent; timeoutMs?: number }): LoadHandle {
  const stats = newStats(1);
  let i = 0;
  let busy: Promise<void> | null = null;
  let first = Infinity;
  let last = 0;
  const timer = setInterval(() => {
    if (busy) return;
    busy = request({ ...opts.next(i++), agent: opts.agent, timeoutMs: opts.timeoutMs }).then((r) => {
      first = Math.min(first, r.start);
      last = Math.max(last, r.end);
      record(stats, r);
      busy = null;
    });
  }, opts.everyMs);
  return {
    async stop() {
      clearInterval(timer);
      if (busy) await busy;
      return finalize(stats, first, last);
    },
  };
}

/**
 * Open-loop load: one request every 1000 / ratePerSec ms on a fixed schedule, whether or not earlier
 * ones have answered, so both servers are offered the same request rate (a closed loop offers a
 * faster server more work). At most `maxInFlight` requests are outstanding; a slot that finds the
 * cap reached is skipped and counted in `skipped` rather than queued, so an overloaded server cannot
 * make the harness pile up requests.
 */
export function startOpenLoop(opts: { ratePerSec: number; maxInFlight: number; next: (i: number) => RequestSpec; agent?: http.Agent; timeoutMs?: number }): LoadHandle & { skipped(): number } {
  const stats = newStats(opts.maxInFlight);
  const agent = opts.agent ?? createAgent({ maxSockets: opts.maxInFlight });
  const periodMs = 1000 / opts.ratePerSec;
  const inFlight = new Set<Promise<void>>();
  let i = 0;
  let skipped = 0;
  let first = Infinity;
  let last = 0;
  let stopped = false;
  const t0 = performance.now();
  let slot = 0;
  let timer: NodeJS.Timeout | null = null;
  const tick = () => {
    timer = null;
    if (stopped) return;
    // Every slot that is due fires now (a late timer does not silently lower the offered rate).
    const due = Math.floor((performance.now() - t0) / periodMs);
    for (; slot <= due; slot++) {
      if (inFlight.size >= opts.maxInFlight) {
        skipped++;
        continue;
      }
      const p: Promise<void> = request({ ...opts.next(i++), agent, timeoutMs: opts.timeoutMs }).then((r) => {
        first = Math.min(first, r.start);
        last = Math.max(last, r.end);
        record(stats, r);
        inFlight.delete(p);
      });
      inFlight.add(p);
    }
    timer = setTimeout(tick, Math.max(0, t0 + slot * periodMs - performance.now()));
  };
  tick();
  return {
    skipped: () => skipped,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await Promise.all([...inFlight]);
      if (!opts.agent) agent.destroy();
      return finalize(stats, first, last);
    },
  };
}

/** Joins a base URL and a path without doubling or dropping slashes. */
export function joinUrl(base: string, p: string): string {
  return `${base.replace(/\/+$/, '')}/${p.replace(/^\/+/, '')}`;
}
