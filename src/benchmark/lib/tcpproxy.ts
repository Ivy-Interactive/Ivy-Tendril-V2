// A byte-counting TCP proxy for the network suite. It listens on a free loopback port and pipes every
// connection to one target, counting the application-layer bytes in each direction: HTTP heads and
// bodies, WebSocket framing and SSE streams all cross it the same way, so "bytes" here is what the
// two endpoints actually wrote to the socket (TCP/IP headers excluded, which on loopback is the only
// thing the kernel adds).
//
// On top of the raw counts it follows HTTP/1.1 framing (request/response heads, Content-Length and
// chunked bodies, a 101 upgrade into WebSocket frames) so every byte can be attributed to the
// request that caused it. That gives the asset / API / WebSocket / SSE split and per-route totals
// without trusting either client's own accounting. Only heads, chunk-size lines and WebSocket frame
// headers are ever inspected; bodies are skipped by arithmetic, so the cost per chunk is a few
// counter updates. A stream it cannot parse (TLS, HTTP/2, garbage) is still counted, just
// attributed to `other`.
//
// It adds one loopback hop, so it is only ever used by the network suite, never by a timing suite.

import net from 'node:net';
import { performance } from 'node:perf_hooks';

export type Category = 'asset' | 'api' | 'sse' | 'ws' | 'other';
export const CATEGORIES: readonly Category[] = ['asset', 'api', 'sse', 'ws', 'other'];

/** Bytes (and requests) attributed to one category or route. */
export interface Tally {
  up: number;
  down: number;
  /** HTTP requests (a WebSocket upgrade and an SSE stream count as one request each). */
  requests: number;
}

export interface ProxyCounters {
  /** performance.now() when taken. */
  at: number;
  /** Client to server (requests, frames the client sends). */
  up: number;
  /** Server to client (responses, pushed frames). */
  down: number;
  connsOpened: number;
  connsClosed: number;
  /** Connections open when the counters were taken (not a difference in a delta: the value at its end). */
  connsOpen: number;
  requests: number;
  /** WebSocket data frames (text, binary, continuation) per direction. */
  wsFrames: { up: number; down: number };
  /** WebSocket ping/pong/close frames per direction. */
  wsControlFrames: { up: number; down: number };
  categories: Record<Category, Tally>;
  /** Per route (`GET /api/plans/:id`, `WS /ivy/messages`, `asset .js`): only non-zero entries. */
  routes: Record<string, Tally>;
}

export interface ConnRecord {
  id: number;
  openedAt: number;
  closedAt: number | null;
  up: number;
  down: number;
  /** Route of the first request on the connection (null when none was parsed). */
  first: string | null;
}

// ---------------------------------------------------------------------------------------------
// Classification

/** Sec-Fetch-Dest values of subresources a page loads as code, style or media rather than data. */
const ASSET_DESTS = new Set(['document', 'iframe', 'frame', 'script', 'style', 'font', 'image', 'manifest', 'worker', 'sharedworker', 'serviceworker', 'audio', 'video', 'track', 'object', 'embed', 'xslt', 'audioworklet', 'paintworklet']);
const ASSET_EXT = /\.(?:m?js|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|ico|webp|avif|wasm|map|html?)$/i;

/** Ids in paths collapse so per-route totals group by endpoint, not by plan. */
function normalizePath(p: string): string {
  return p
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) || /^\d{5}-/.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) ? ':id' : seg))
    .join('/');
}

function extOf(p: string): string {
  const m = /(\.[A-Za-z0-9]+)$/.exec(p);
  return m ? m[1]!.toLowerCase() : '';
}

interface Exchange {
  method: string;
  route: string;
  category: Category;
  up: number;
  down: number;
  /** Response must have no body (HEAD). */
  noBody: boolean;
}

// ---------------------------------------------------------------------------------------------
// One direction's framing state

type Mode = 'head' | 'body' | 'chunk-size' | 'chunk-data' | 'chunk-crlf' | 'trailers' | 'until-close' | 'ws' | 'opaque';

const CRLFCRLF = Buffer.from('\r\n\r\n');
/** A head this long without its terminating blank line is not HTTP; stop parsing. */
const MAX_HEAD = 64 * 1024;

interface Side {
  mode: Mode;
  /** Partial head carried over from earlier chunks. */
  head: Buffer | null;
  /** Body / chunk / frame payload bytes still to skip. */
  remaining: number;
  /** Partial chunk-size or trailer line. */
  line: string;
  /** The exchange the bytes flowing now belong to (null: unattributed). */
  ex: Exchange | null;
  /** Partial WebSocket frame header. */
  wsHdr: number[];
}

function newSide(): Side {
  return { mode: 'head', head: null, remaining: 0, line: '', ex: null, wsHdr: [] };
}

interface Conn {
  rec: ConnRecord;
  up: Side;
  down: Side;
  /** Requests sent whose responses have not started yet (HTTP/1.1 answers in order). */
  pending: Exchange[];
}

function headerMap(lines: string[]): Map<string, string> {
  const h = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]!;
    const c = l.indexOf(':');
    if (c <= 0) continue;
    const k = l.slice(0, c).trim().toLowerCase();
    const v = l.slice(c + 1).trim();
    h.set(k, h.has(k) ? `${h.get(k)}, ${v}` : v);
  }
  return h;
}

// ---------------------------------------------------------------------------------------------
// Proxy

export interface ProxyOptions {
  targetHost: string;
  targetPort: number;
  /** Listen address (default 127.0.0.1) and port (default 0: any free port). */
  host?: string;
  port?: number;
  label?: string;
}

export class CountingProxy {
  readonly label: string;
  readonly targetHost: string;
  readonly targetPort: number;
  private server: net.Server;
  private sockets = new Set<net.Socket>();
  private conns: ConnRecord[] = [];
  private nextId = 1;
  private c = { up: 0, down: 0, opened: 0, closed: 0, requests: 0, wsUp: 0, wsDown: 0, wsCtlUp: 0, wsCtlDown: 0 };
  private cats: Record<Category, Tally> = { asset: tally(), api: tally(), sse: tally(), ws: tally(), other: tally() };
  private routes = new Map<string, Tally>();
  private portNo = 0;
  private closed = false;

  private constructor(o: ProxyOptions) {
    this.label = o.label ?? `proxy->${o.targetHost}:${o.targetPort}`;
    this.targetHost = o.targetHost;
    this.targetPort = o.targetPort;
    this.server = net.createServer((client) => this.accept(client));
  }

  static async start(o: ProxyOptions): Promise<CountingProxy> {
    const p = new CountingProxy(o);
    await new Promise<void>((resolve, reject) => {
      p.server.once('error', reject);
      p.server.listen(o.port ?? 0, o.host ?? '127.0.0.1', () => {
        p.server.off('error', reject);
        const a = p.server.address();
        p.portNo = typeof a === 'object' && a ? a.port : 0;
        resolve();
      });
    });
    return p;
  }

  get port(): number {
    return this.portNo;
  }

  get url(): string {
    return `http://127.0.0.1:${this.portNo}`;
  }

  private accept(client: net.Socket): void {
    if (this.closed) {
      client.destroy();
      return;
    }
    const rec: ConnRecord = { id: this.nextId++, openedAt: performance.now(), closedAt: null, up: 0, down: 0, first: null };
    this.conns.push(rec);
    this.c.opened++;
    const conn: Conn = { rec, up: newSide(), down: newSide(), pending: [] };
    const upstream = net.connect({ host: this.targetHost, port: this.targetPort });
    // No Nagle on either leg: the proxy must not add coalescing delays the endpoints did not ask for.
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    this.sockets.add(client);
    this.sockets.add(upstream);
    client.on('data', (chunk: Buffer) => {
      rec.up += chunk.length;
      this.c.up += chunk.length;
      this.feed(conn, 'up', chunk);
    });
    upstream.on('data', (chunk: Buffer) => {
      rec.down += chunk.length;
      this.c.down += chunk.length;
      this.feed(conn, 'down', chunk);
    });
    // pipe() handles backpressure and half-close; the 'data' listeners above see the same chunks.
    client.pipe(upstream);
    upstream.pipe(client);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      rec.closedAt = performance.now();
      this.c.closed++;
      client.destroy();
      upstream.destroy();
      this.sockets.delete(client);
      this.sockets.delete(upstream);
    };
    client.on('close', finish);
    upstream.on('close', finish);
    client.on('error', finish);
    upstream.on('error', finish);
  }

  // -------------------------------------------------------------------------------------------
  // Attribution

  private route(key: string): Tally {
    let t = this.routes.get(key);
    if (!t) {
      t = tally();
      this.routes.set(key, t);
    }
    return t;
  }

  private attribute(ex: Exchange | null, dir: 'up' | 'down', n: number): void {
    if (n <= 0) return;
    if (!ex) return; // unattributed bytes stay in the raw totals and surface as `other`
    ex[dir] += n;
    this.cats[ex.category][dir] += n;
    this.route(ex.route)[dir] += n;
  }

  private newExchange(method: string, route: string, category: Category, noBody: boolean): Exchange {
    const ex: Exchange = { method, route, category, up: 0, down: 0, noBody };
    this.c.requests++;
    this.cats[category].requests++;
    this.route(route).requests++;
    return ex;
  }

  /** Moves an exchange (and everything attributed to it so far) to another category. */
  private reclassify(ex: Exchange, category: Category): void {
    if (ex.category === category) return;
    const from = this.cats[ex.category];
    const to = this.cats[category];
    from.up -= ex.up;
    from.down -= ex.down;
    from.requests--;
    to.up += ex.up;
    to.down += ex.down;
    to.requests++;
    ex.category = category;
  }

  private onRequestHead(conn: Conn, text: string, headBytes: number): void {
    const lines = text.split('\r\n');
    const [method = '?', target = '/'] = lines[0]!.split(' ');
    const h = headerMap(lines);
    const pathOnly = target.split('?')[0]!.split('#')[0]!;
    const dest = h.get('sec-fetch-dest');
    const upgrade = /websocket/i.test(h.get('upgrade') ?? '');
    let category: Category;
    if (upgrade) category = 'ws';
    else if (/text\/event-stream/i.test(h.get('accept') ?? '')) category = 'sse';
    else if (dest !== undefined) category = ASSET_DESTS.has(dest) ? 'asset' : 'api';
    else category = method === 'GET' && ASSET_EXT.test(pathOnly) ? 'asset' : 'api';
    const route = category === 'asset' ? `asset ${extOf(pathOnly) || (dest ?? 'document')}` : `${upgrade ? 'WS' : method} ${normalizePath(pathOnly)}`;
    const ex = this.newExchange(method, route, category, method === 'HEAD');
    conn.rec.first ??= route;
    this.attribute(ex, 'up', headBytes);
    conn.pending.push(ex);
    const side = conn.up;
    side.ex = ex;
    const te = h.get('transfer-encoding') ?? '';
    const len = Number(h.get('content-length') ?? '0');
    if (/chunked/i.test(te)) side.mode = 'chunk-size';
    else if (len > 0) {
      side.mode = 'body';
      side.remaining = len;
    } else side.mode = 'head';
  }

  private onResponseHead(conn: Conn, text: string, headBytes: number): void {
    const lines = text.split('\r\n');
    const status = Number(lines[0]!.split(' ')[1] ?? '0');
    const h = headerMap(lines);
    const side = conn.down;
    if (status >= 100 && status < 200 && status !== 101) {
      // Interim response (100 Continue): belongs to the waiting request, which is still waiting.
      this.attribute(conn.pending[0] ?? null, 'down', headBytes);
      side.mode = 'head';
      return;
    }
    const ex = conn.pending.shift() ?? this.newExchange('?', '? (response without a parsed request)', 'other', false);
    side.ex = ex;
    this.attribute(ex, 'down', headBytes);
    if (status === 101) {
      this.reclassify(ex, 'ws');
      side.mode = 'ws';
      side.wsHdr = [];
      side.remaining = 0;
      // The client only sends frames after it has seen the 101, which passed through here first.
      conn.up.mode = 'ws';
      conn.up.ex = ex;
      conn.up.wsHdr = [];
      conn.up.remaining = 0;
      return;
    }
    if (/text\/event-stream/i.test(h.get('content-type') ?? '')) this.reclassify(ex, 'sse');
    const te = h.get('transfer-encoding') ?? '';
    const cl = h.get('content-length');
    if (ex.noBody || status === 204 || status === 304) side.mode = 'head';
    else if (/chunked/i.test(te)) side.mode = 'chunk-size';
    else if (cl !== undefined) {
      const len = Number(cl);
      if (len > 0) {
        side.mode = 'body';
        side.remaining = len;
      } else side.mode = 'head';
    } else side.mode = 'until-close';
  }

  // -------------------------------------------------------------------------------------------
  // Framing

  private feed(conn: Conn, dir: 'up' | 'down', chunk: Buffer): void {
    const side = dir === 'up' ? conn.up : conn.down;
    const n = chunk.length;
    let i = 0;
    while (i < n) {
      switch (side.mode) {
        case 'head': {
          const prev = side.head;
          const buf = prev ? Buffer.concat([prev, chunk.subarray(i)]) : chunk.subarray(i);
          const end = buf.indexOf(CRLFCRLF, prev ? Math.max(0, prev.length - 3) : 0);
          if (end < 0) {
            if (buf.length > MAX_HEAD) {
              side.head = null;
              side.mode = 'opaque';
              side.ex = null;
            } else side.head = Buffer.from(buf);
            i = n;
            break;
          }
          const headLen = end + 4;
          const text = buf.toString('latin1', 0, end);
          i += headLen - (prev ? prev.length : 0);
          side.head = null;
          if (!/^[A-Z]+ \S+ HTTP\/1\.[01]$|^HTTP\/1\.[01] \d{3}/.test(text.slice(0, text.indexOf('\r\n') < 0 ? text.length : text.indexOf('\r\n')))) {
            // Not HTTP/1.x (or out of sync): count the rest of this direction as unattributed.
            side.mode = 'opaque';
            side.ex = null;
            i = n;
            break;
          }
          if (dir === 'up') this.onRequestHead(conn, text, headLen);
          else this.onResponseHead(conn, text, headLen);
          break;
        }
        case 'body':
        case 'chunk-data':
        case 'chunk-crlf': {
          const k = Math.min(side.remaining, n - i);
          this.attribute(side.ex, dir, k);
          side.remaining -= k;
          i += k;
          if (side.remaining === 0) {
            if (side.mode === 'body') side.mode = 'head';
            else if (side.mode === 'chunk-data') {
              side.mode = 'chunk-crlf';
              side.remaining = 2;
            } else side.mode = 'chunk-size';
          }
          break;
        }
        case 'chunk-size':
        case 'trailers': {
          const nl = chunk.indexOf(10, i);
          const stop = nl < 0 ? n : nl + 1;
          side.line += chunk.toString('latin1', i, nl < 0 ? n : nl);
          this.attribute(side.ex, dir, stop - i);
          i = stop;
          if (nl < 0) break;
          const line = side.line.trim();
          side.line = '';
          if (side.mode === 'chunk-size') {
            const size = parseInt(line.split(';')[0]!, 16);
            if (!Number.isFinite(size)) {
              side.mode = 'opaque';
              side.ex = null;
            } else if (size === 0) side.mode = 'trailers';
            else {
              side.mode = 'chunk-data';
              side.remaining = size;
            }
          } else if (line === '') side.mode = 'head';
          break;
        }
        case 'ws': {
          if (side.remaining > 0) {
            const k = Math.min(side.remaining, n - i);
            this.attribute(side.ex, dir, k);
            side.remaining -= k;
            i += k;
            break;
          }
          const hdr = side.wsHdr;
          hdr.push(chunk[i]!);
          this.attribute(side.ex, dir, 1);
          i++;
          if (hdr.length < 2) break;
          const len7 = hdr[1]! & 0x7f;
          const need = 2 + (len7 === 126 ? 2 : len7 === 127 ? 8 : 0) + (hdr[1]! & 0x80 ? 4 : 0);
          if (hdr.length < need) break;
          let len = len7;
          if (len7 === 126) len = hdr[2]! * 256 + hdr[3]!;
          else if (len7 === 127) {
            len = 0;
            for (let k = 2; k < 10; k++) len = len * 256 + hdr[k]!;
          }
          const opcode = hdr[0]! & 0x0f;
          if (opcode >= 8) {
            if (dir === 'up') this.c.wsCtlUp++;
            else this.c.wsCtlDown++;
          } else if (dir === 'up') this.c.wsUp++;
          else this.c.wsDown++;
          side.wsHdr = [];
          side.remaining = len;
          break;
        }
        case 'until-close':
          this.attribute(side.ex, dir, n - i);
          i = n;
          break;
        case 'opaque':
          i = n;
          break;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Reading

  snapshot(): ProxyCounters {
    const categories = {} as Record<Category, Tally>;
    let attributedUp = 0;
    let attributedDown = 0;
    for (const k of CATEGORIES) {
      categories[k] = { ...this.cats[k] };
      attributedUp += this.cats[k].up;
      attributedDown += this.cats[k].down;
    }
    // Whatever was never attributed (a head still in flight, an unparsable stream) is `other`, so
    // the categories always add up to the raw totals.
    categories.other.up += this.c.up - attributedUp;
    categories.other.down += this.c.down - attributedDown;
    const routes: Record<string, Tally> = {};
    for (const [k, t] of this.routes) routes[k] = { ...t };
    return {
      at: performance.now(),
      up: this.c.up,
      down: this.c.down,
      connsOpened: this.c.opened,
      connsClosed: this.c.closed,
      connsOpen: this.c.opened - this.c.closed,
      requests: this.c.requests,
      wsFrames: { up: this.c.wsUp, down: this.c.wsDown },
      wsControlFrames: { up: this.c.wsCtlUp, down: this.c.wsCtlDown },
      categories,
      routes,
    };
  }

  /** Every connection so far (copies), oldest first. */
  connections(): ConnRecord[] {
    return this.conns.map((c) => ({ ...c }));
  }

  /** up + down so far; cheap, for "has anything moved" polling. */
  totalBytes(): number {
    return this.c.up + this.c.down;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

function tally(): Tally {
  return { up: 0, down: 0, requests: 0 };
}

/** b - a. `connsOpen` is b's (a level, not a flow). Routes with no change are left out. */
export function deltaCounters(a: ProxyCounters, b: ProxyCounters): ProxyCounters {
  const categories = {} as Record<Category, Tally>;
  for (const k of CATEGORIES) categories[k] = subTally(a.categories[k], b.categories[k]);
  const routes: Record<string, Tally> = {};
  for (const [k, t] of Object.entries(b.routes)) {
    const d = subTally(a.routes[k], t);
    if (d.up || d.down || d.requests) routes[k] = d;
  }
  return {
    at: b.at,
    up: b.up - a.up,
    down: b.down - a.down,
    connsOpened: b.connsOpened - a.connsOpened,
    connsClosed: b.connsClosed - a.connsClosed,
    connsOpen: b.connsOpen,
    requests: b.requests - a.requests,
    wsFrames: { up: b.wsFrames.up - a.wsFrames.up, down: b.wsFrames.down - a.wsFrames.down },
    wsControlFrames: { up: b.wsControlFrames.up - a.wsControlFrames.up, down: b.wsControlFrames.down - a.wsControlFrames.down },
    categories,
    routes,
  };
}

function subTally(a: Tally | undefined, b: Tally): Tally {
  return { up: b.up - (a?.up ?? 0), down: b.down - (a?.down ?? 0), requests: b.requests - (a?.requests ?? 0) };
}

/** Routes by total bytes, largest first, as compact rows for result meta. */
export function topRoutes(c: ProxyCounters, n: number): Array<{ route: string; requests: number; up: number; down: number }> {
  return Object.entries(c.routes)
    .map(([route, t]) => ({ route, requests: t.requests, up: t.up, down: t.down }))
    .sort((x, y) => y.up + y.down - (x.up + x.down) || (x.route < y.route ? -1 : 1))
    .slice(0, n);
}
