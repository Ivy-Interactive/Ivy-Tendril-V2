// Suite 6, `ui`: both web UIs in headless Chromium, driven the same way. V1 serves its own UI
// (`Ivy.Tendril --web`); V2's frontend runs through the IPC shim (apps/v2.ts startUi), which serves
// the built dist and answers the page's Tauri invoke()s with the app's real cmd_* functions.
//
// Per dataset x app, one server (and for V2 one shim) and one fresh browser:
//   about-blank-baseline   memory of the browser with nothing but about:blank open
//   cold-load              fresh context per iteration: DOMContentLoaded, load, shell, content,
//                          wire bytes and requests to content, JS heap and DOM nodes after settling
//   navigate:<view>        click on the nav item to the view's ready marker; first visits (one per
//                          fresh context) are nav_first_ms, revisits on the warm page are nav_ms
//   push-rest / push-fs    a REST PUT, or an atomic rewrite of plan.yaml on disk, to the moment the
//                          plans nav badge shows the new count
//   nav-under-load:<view>  the navigate loop while plans.list runs at c=4 plus one plans.update
//                          every 500 ms
//   memory-after-flows     page renderer, whole browser tree, server tree (V2: daemon + shim)
//
// Every time is taken inside the page (performance.now(), or timeOrigin + now() as epoch ms where
// it has to meet a harness clock), by a MutationObserver + requestAnimationFrame watcher installed
// before the app's own scripts. Playwright's locator waits are not used for timing: they poll from
// the driver with a 20/50/100/500 ms backoff, so a view that took 40 ms could be reported at 540.

import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import type { AppAdapter, NavTarget, ReadyCondition, ServerHandle, UiHandle } from '../apps/types.ts';
import { TIMEOUTS, type DatasetName } from '../lib/config.ts';
import { loadManifest, restoreHome, type DatasetManifest } from '../datasets/index.ts';
import { createAgent, joinUrl, request, startClosedLoop, startPeriodic, type LoadStats } from '../lib/http.ts';
import { errorMessage, type Logger } from '../lib/log.ts';
import { isAlive, killTree, registerCleanup, sleep } from '../lib/proc.ts';
import { toMiB, type TreeSample } from '../lib/procstat.ts';
import { newSuiteResult, type AppId, type Metric, type SuiteResult, type Unit } from '../lib/results.ts';
import type { SuiteContext } from './index.ts';

const SUITE = 'ui';

/**
 * Visit order for the navigate loops. The spec lists jobs, dashboard, review, plans; review and
 * plans are swapped apart here because V1 marks both views with the same `.pws-root .pws-title`
 * inside the active pane, so plans right after review would match the old review content before
 * the plans page had rendered. In this order no view shares a ready marker with the one before it
 * (the loop wraps plans -> jobs), which the watcher also checks before every click.
 */
const NAV_ORDER: readonly NavTarget[] = ['jobs', 'review', 'dashboard', 'plans'];

const VIEWPORT = { width: 1280, height: 800 };
const LAUNCH_ARGS = ['--enable-precise-memory-info'];
/** Pause after a cold load reaches content before heap/DOM are read (lets deferred work land). */
const SETTLE_MS = 1000;
/** Pause between push samples so one change's debounce windows never overlap the next. */
const PUSH_GAP_MS = 1500;
/**
 * Push waits. V1 does not react to plan.yaml edits on disk until its 30 s rescan (in development a
 * file push took 28 to 58 s whether the file was rewritten in place, renamed in from the same
 * folder or from outside), and a missed REST change event falls back to the same rescan.
 */
const PUSH_TIMEOUT_MS = TIMEOUTS.uiWaitMs;
/**
 * Clicks wait this long for actionability. Not a measured quantity: when V1 loses its SignalR
 * connection an overlay covers the page and a click can never land.
 */
const CLICK_TIMEOUT_MS = 30_000;
const LOAD_CONCURRENCY = 4;
const LOAD_UPDATE_EVERY_MS = 500;
const LOAD_WARMUP_MS = 1000;
/** Before the memory reading at the end, so the last flow's transient allocations are not caught mid-flight. */
const MEMORY_SETTLE_MS = 2000;
const V2_SHIM_ROLE_LABEL = 'IPC shim (stand-in for the tendril-app host; not the Tauri binary)';

type Want = 'content' | 'empty' | 'any';

// ---------------------------------------------------------------------------------------------
// In-page watcher

/** A ready probe translated to something the page can evaluate without Playwright's engine. */
interface ProbeSpec {
  /** The adapter's original (Playwright) selector, for the record. */
  selector: string;
  css: string;
  /** Lowercased, whitespace-normalised substring for :has-text / :text probes. */
  text: string | null;
  /** css: plain match; has: css elements containing text; text: smallest descendant of css containing text. */
  mode: 'css' | 'has' | 'text';
  state: 'visible' | 'attached';
  kind: string;
}

interface CondSpec {
  anyOf: ProbeSpec[];
  allOf: ProbeSpec[];
  noneOf: ProbeSpec[];
  /** Also require that this shim IPC command has returned at least once (V2 empty states). */
  ipcDone: string | null;
}

interface WaitDone {
  /** performance.now() in the page when the condition first held. */
  t: number;
  /** performance.timeOrigin + t (epoch ms). */
  epoch: number;
  kind: string;
  selector: string;
  via: string;
  error?: string;
}

/**
 * Turns an adapter selector into CSS plus a text filter. The adapters use CSS and, for V1's text
 * markers, a trailing Playwright `:has-text("...")` or `:text("...")`; both are substring,
 * case-insensitive matches, which is what the page-side matcher does. Anything else that is
 * Playwright-only is refused loudly rather than half-supported.
 */
export function translateSelector(sel: string): Pick<ProbeSpec, 'css' | 'text' | 'mode'> {
  const unsupported = /(>>|:has-text\(|:text\(|:text-is\(|:text-matches\(|\btext=|:visible|internal:|:nth-match\(|:right-of\(|:left-of\(|:near\(|:above\(|:below\()/;
  const m = /^(.*?)(\s*):(has-text|text)\("((?:[^"\\]|\\.)*)"\)$/.exec(sel.trim());
  if (!m) {
    if (unsupported.test(sel)) throw new Error(`selector not supported by the in-page watcher: ${sel}`);
    return { css: sel, text: null, mode: 'css' };
  }
  const [, head, gap, pseudo, raw] = m as unknown as [string, string, string, string, string];
  if (unsupported.test(head)) throw new Error(`selector not supported by the in-page watcher: ${sel}`);
  const text = raw.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim().toLowerCase();
  if (pseudo === 'has-text') return { css: head === '' ? '*' : gap ? `${head} *` : head, text, mode: 'has' };
  if (gap || head === '') return { css: head === '' ? ':root' : head, text, mode: 'text' };
  return { css: head, text, mode: 'has' };
}

function probeSpecs(probes: ReadonlyArray<{ selector: string; state: 'visible' | 'attached'; kind: string }>): ProbeSpec[] {
  return probes.map((p) => ({ ...translateSelector(p.selector), selector: p.selector, state: p.state, kind: p.kind }));
}

/**
 * The page-side condition for a view: only the probes of the kind the dataset says to expect (V2's
 * empty states render before data arrives, and V1's jobs canvas exists before any rows), all
 * allOf, none of noneOf.
 */
function condFor(c: ReadyCondition, want: Want, ipcDone: string | null = null): { cond: CondSpec; note: string | null } {
  const matching = want === 'any' ? c.anyOf : c.anyOf.filter((p) => p.kind === want);
  const note = matching.length === 0 ? `no ${want} probe; using every probe` : null;
  return {
    cond: {
      anyOf: probeSpecs(matching.length ? matching : c.anyOf),
      allOf: probeSpecs(c.allOf ?? []),
      noneOf: (c.noneOf ?? []).map((s) => ({ ...translateSelector(s), selector: s, state: 'attached' as const, kind: 'none' })),
      ipcDone,
    },
    note,
  };
}

/**
 * Installed with context.addInitScript, so it runs in every document before the app's scripts.
 * Serialised by Playwright (Function.toString), hence self-contained and loosely typed. `auto`
 * arms watchers at document start (shell and landing content for cold loads).
 */
function pageWatcher(auto: Record<string, CondSpec> | null): void {
  const w = window as unknown as Record<string, any>;
  if (w.top !== w || w.__TBENCH__) return;
  const waits = new Map<string, any>();
  const B: any = { lastClick: null as number | null };
  w.__TBENCH__ = B;
  addEventListener('click', () => (B.lastClick = performance.now()), true);
  const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = (el: Element) => {
    if (!el.isConnected) return false;
    const cv = (el as any).checkVisibility;
    if (typeof cv === 'function' && !cv.call(el, { visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const ok = (el: Element, state: string) => state === 'attached' || visible(el);
  const probe = (p: any): boolean => {
    const els = document.querySelectorAll(p.css);
    if (p.mode === 'css') {
      for (const el of els) if (ok(el, p.state)) return true;
      return false;
    }
    if (p.mode === 'has') {
      for (const el of els) if (norm(el.textContent).includes(p.text) && ok(el, p.state)) return true;
      return false;
    }
    for (const root of els) {
      if (!norm(root.textContent).includes(p.text)) continue;
      let el: Element = root;
      for (;;) {
        let next: Element | null = null;
        for (const c of el.children) {
          if (norm(c.textContent).includes(p.text)) {
            next = c;
            break;
          }
        }
        if (!next) break;
        el = next;
      }
      if (ok(el, p.state)) return true;
    }
    return false;
  };
  const check = (c: any): any => {
    if (c.badge) {
      const el = document.querySelector(c.badge);
      const n = el ? Number((el.textContent ?? '').replace(/[^0-9]/g, '') || '0') : 0;
      return n === c.expected ? { kind: 'badge', selector: c.badge } : null;
    }
    if (c.ipcDone && !(w.__SHIM_IPC__ ?? []).some((x: any) => x.cmd === c.ipcDone && x.ok)) return null;
    const hit = c.anyOf.find((p: any) => probe(p));
    if (!hit) return null;
    for (const p of c.allOf) if (!probe(p)) return null;
    for (const p of c.noneOf) if (probe(p)) return null;
    return hit;
  };
  B.arm = (id: string, c: any) => {
    B.cancel(id);
    let first;
    try {
      first = check(c);
    } catch (e) {
      return { already: false, error: String(e) };
    }
    if (first) return { already: true, selector: first.selector };
    const rec: any = { done: null, checks: 0 };
    let raf = 0;
    const finish = (d: any) => {
      if (rec.done) return;
      rec.done = d;
      rec.stop();
    };
    const attempt = (via: string) => {
      if (rec.done) return;
      rec.checks++;
      try {
        const hit = check(c);
        if (hit) {
          const t = performance.now();
          finish({ t, epoch: performance.timeOrigin + t, kind: hit.kind, selector: hit.selector, via, checks: rec.checks });
        }
      } catch (e) {
        finish({ t: performance.now(), epoch: 0, kind: 'error', selector: '', via, error: String(e) });
      }
    };
    // Mutations catch an insertion before the next paint; frames catch layout-only changes; the
    // timer covers a page whose rAF is throttled.
    const mo = new MutationObserver(() => attempt('mutation'));
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const frame = () => {
      attempt('frame');
      if (!rec.done) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const iv = setInterval(() => attempt('timer'), 100);
    rec.stop = () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
      clearInterval(iv);
    };
    waits.set(id, rec);
    return { already: false };
  };
  B.result = (id: string) => waits.get(id)?.done ?? null;
  B.cancel = (id: string) => {
    const r = waits.get(id);
    if (r && !r.done) r.stop();
    waits.delete(id);
  };
  B.badge = (css: string) => {
    const el = document.querySelector(css);
    return el ? Number((el.textContent ?? '').replace(/[^0-9]/g, '') || '0') : 0;
  };
  if (auto) for (const [id, c] of Object.entries(auto)) B.arm(id, c);
}

type WatcherWindow = { __TBENCH__?: any; __SHIM_IPC__?: Array<{ cmd: string; t: number; ok: boolean }> };

async function arm(page: Page, id: string, cond: CondSpec | { badge: string; expected: number }): Promise<{ already: boolean; selector?: string; error?: string }> {
  return page.evaluate(([i, c]) => (window as unknown as WatcherWindow).__TBENCH__.arm(i, c), [id, cond] as const);
}

async function cancel(page: Page, id: string): Promise<void> {
  await page.evaluate((i) => (window as unknown as WatcherWindow).__TBENCH__?.cancel(i), id).catch(() => {});
}

/** The server behind a page is gone: nothing the page waits for can arrive any more. */
class ServerGone extends Error {}

/** Per page, why waiting on it is pointless (the server behind it exited); null while it is fine. */
const pageBail = new WeakMap<Page, () => string | null>();

/**
 * Waits for a watcher to fire. The time comes from the page; the polling here only decides when
 * we learn it. Gives up early when the server behind the page has exited.
 */
async function waitDone(page: Page, id: string, timeoutMs: number, what: string): Promise<WaitDone> {
  const bail = pageBail.get(page);
  let timer: ReturnType<typeof setInterval> | undefined;
  const gone = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      const why = bail?.();
      if (why) reject(new ServerGone(`${what}: ${why}`));
    }, 250);
  });
  const wait = page.waitForFunction((i) => (window as unknown as WatcherWindow).__TBENCH__?.result(i) ?? null, id, { polling: 25, timeout: timeoutMs });
  wait.catch(() => {});
  try {
    const h = await Promise.race([wait, gone]);
    const v = (await h.jsonValue()) as WaitDone;
    await h.dispose().catch(() => {});
    if (v.error) throw new Error(`${what}: watcher error: ${v.error}`);
    return v;
  } catch (e) {
    await cancel(page, id);
    if (!(e instanceof ServerGone) && /Timeout/i.test(errorMessage(e))) throw new Error(`${what}: timed out after ${timeoutMs} ms`);
    throw e;
  } finally {
    clearInterval(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// Network tap (CDP), per page

interface NetCut {
  requests: number;
  bytes: number;
  failed: number;
  wsOpened: number;
  wsFramesSent: number;
  wsFramesReceived: number;
  wsBytesReceived: number;
}

/**
 * Counts requests and wire bytes (Network.loadingFinished encodedDataLength, headers included) and
 * WebSocket frames. CDP timestamps are monotonic seconds; the first requestWillBeSent carries the
 * wall time too, which maps them onto the page's epoch so a count can be cut at "content ready".
 */
class NetTap {
  private offsetMs: number | null = null;
  private reqs = new Map<string, number>();
  private fins: Array<{ ts: number; bytes: number }> = [];
  private fails: number[] = [];
  private ws: Array<{ ts: number; dir: 'sent' | 'recv' | 'open'; bytes: number }> = [];
  constructor(cdp: CDPSession) {
    cdp.on('Network.requestWillBeSent', (e) => {
      if (e.request.url.startsWith('data:')) return;
      this.offsetMs ??= e.wallTime * 1000 - e.timestamp * 1000;
      if (!this.reqs.has(e.requestId)) this.reqs.set(e.requestId, e.timestamp * 1000);
    });
    cdp.on('Network.loadingFinished', (e) => {
      if (this.reqs.has(e.requestId)) this.fins.push({ ts: e.timestamp * 1000, bytes: e.encodedDataLength });
    });
    cdp.on('Network.loadingFailed', (e) => {
      if (this.reqs.has(e.requestId)) this.fails.push(e.timestamp * 1000);
    });
    cdp.on('Network.webSocketCreated', () => this.ws.push({ ts: Number.NEGATIVE_INFINITY, dir: 'open', bytes: 0 }));
    cdp.on('Network.webSocketFrameSent', (e) => this.ws.push({ ts: e.timestamp * 1000, dir: 'sent', bytes: frameBytes(e.response) }));
    cdp.on('Network.webSocketFrameReceived', (e) => this.ws.push({ ts: e.timestamp * 1000, dir: 'recv', bytes: frameBytes(e.response) }));
  }
  /** Totals up to `epochMs` (page epoch); everything so far when null. */
  cut(epochMs: number | null): NetCut {
    const lim = epochMs === null || this.offsetMs === null ? Number.POSITIVE_INFINITY : epochMs - this.offsetMs;
    let requests = 0;
    for (const ts of this.reqs.values()) if (ts <= lim) requests++;
    let bytes = 0;
    for (const f of this.fins) if (f.ts <= lim) bytes += f.bytes;
    const inWs = this.ws.filter((x) => x.ts <= lim);
    return {
      requests,
      bytes,
      failed: this.fails.filter((ts) => ts <= lim).length,
      wsOpened: inWs.filter((x) => x.dir === 'open').length,
      wsFramesSent: inWs.filter((x) => x.dir === 'sent').length,
      wsFramesReceived: inWs.filter((x) => x.dir === 'recv').length,
      wsBytesReceived: inWs.filter((x) => x.dir === 'recv').reduce((s, x) => s + x.bytes, 0),
    };
  }
}

function frameBytes(r: { opcode: number; payloadData: string }): number {
  // Binary frames (V1's MessagePack SignalR) arrive base64-encoded.
  return r.opcode === 2 ? Math.floor((r.payloadData.length * 3) / 4) : Buffer.byteLength(r.payloadData);
}

// ---------------------------------------------------------------------------------------------
// Result bookkeeping

class Collector {
  private byKey = new Map<string, Metric>();
  private readonly result: SuiteResult;
  constructor(result: SuiteResult) {
    this.result = result;
  }
  add(o: { scenario: string; app: AppId; dataset: string | null; metric: string; unit: Unit; value: number; better?: 'lower' | 'higher'; sampleMeta?: Record<string, unknown> }): void {
    if (!Number.isFinite(o.value)) return;
    const key = `${o.scenario}\u0000${o.app}\u0000${o.dataset ?? ''}\u0000${o.metric}`;
    let m = this.byKey.get(key);
    if (!m) {
      m = { suite: SUITE, scenario: o.scenario, app: o.app, dataset: o.dataset, metric: o.metric, unit: o.unit, samples: [], better: o.better ?? 'lower', meta: {} };
      this.byKey.set(key, m);
      this.result.metrics.push(m);
    }
    m.samples.push(o.value);
    if (o.sampleMeta) ((m.meta!.perSample ??= []) as unknown[]).push(o.sampleMeta);
  }
  meta(scenario: string, app: AppId, dataset: string | null, metric: string, meta: Record<string, unknown>): void {
    const m = this.byKey.get(`${scenario}\u0000${app}\u0000${dataset ?? ''}\u0000${metric}`);
    if (m) Object.assign(m.meta!, meta);
  }
}

// ---------------------------------------------------------------------------------------------
// Session

interface Session {
  app: AppAdapter;
  ds: DatasetName;
  manifest: DatasetManifest;
  home: string;
  server: ServerHandle;
  ui: UiHandle;
  browser: Browser;
  browserCdp: CDPSession;
  want: Record<NavTarget, Want>;
  /** Plans badge the dataset should show with every Draft in place. */
  queue: number;
  col: Collector;
  fail: (scenario: string, e: unknown) => void;
  note: (s: string) => void;
  log: Logger;
  procstat: SuiteContext['procstat'];
  timeoutMs: number;
  /** Where failure screenshots go (<runDir>/logs). */
  diagDir: string;
}

interface PageRig {
  ctx: BrowserContext;
  page: Page;
  cdp: CDPSession;
  net: NetTap;
  pageErrors: string[];
  /** Set once a click could not land (the page stopped taking input); later samples on it are skipped. */
  stuck: string | null;
}

function wantFor(m: DatasetManifest): Record<NavTarget, Want> {
  return {
    plans: m.counts.plansQueue > 0 ? 'content' : 'empty',
    jobs: m.counts.jobs > 0 ? 'content' : 'empty',
    dashboard: 'any',
    review: m.counts.reviewQueue > 0 ? 'content' : 'empty',
    recommendations: 'empty',
  };
}

/**
 * The landing view's condition. On V2 an empty plans list renders before `cmd_list_plans` has
 * answered (plansStore starts as []), so for V2's empty state the answer must also have arrived.
 */
function landingCond(s: Session): CondSpec {
  const want = s.want.plans;
  const { cond } = condFor(s.app.ui.ready.plans, want, s.app.id === 'v2' && want === 'empty' ? 'cmd_list_plans' : null);
  return cond;
}

async function newRig(s: Session): Promise<PageRig> {
  const ctx = await s.browser.newContext({ viewport: VIEWPORT });
  try {
    if (s.ui.initScript) await ctx.addInitScript({ content: s.ui.initScript });
    const shell: CondSpec = { anyOf: probeSpecs([{ selector: s.app.ui.shell, state: 'visible', kind: 'shell' }]), allOf: [], noneOf: [], ipcDone: null };
    await ctx.addInitScript(pageWatcher, { shell, content: landingCond(s) });
    const page = await ctx.newPage();
    pageBail.set(page, () => (isAlive(s.server.pid) ? null : `${s.app.id} server (pid ${s.server.pid}) exited`));
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
    const cdp = await ctx.newCDPSession(page);
    const net = new NetTap(cdp);
    await cdp.send('Network.enable');
    await cdp.send('Performance.enable');
    return { ctx, page, cdp, net, pageErrors, stuck: null };
  } catch (e) {
    await ctx.close().catch(() => {});
    throw e;
  }
}

async function pageMetrics(rig: PageRig, gc: boolean): Promise<{ heapMiB: number; nodes: number; listeners: number }> {
  if (gc) await rig.cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const { metrics } = await rig.cdp.send('Performance.getMetrics');
  const get = (n: string) => metrics.find((m) => m.name === n)?.value ?? NaN;
  return { heapMiB: toMiB(get('JSHeapUsedSize')), nodes: get('Nodes'), listeners: get('JSEventListeners') };
}

interface IpcSummary {
  calls: number;
  failed: number;
  byCmd: Record<string, number>;
  failedByCmd: Record<string, number>;
}

/** V2 only: the shim's IPC log since page time `from` (and up to `to`), summarised in the page. */
async function ipcSummary(page: Page, from = 0, to = Number.POSITIVE_INFINITY): Promise<IpcSummary | null> {
  return page.evaluate(
    ([a, b]) => {
      const l = (window as unknown as WatcherWindow).__SHIM_IPC__;
      if (!l) return null;
      const out = { calls: 0, failed: 0, byCmd: {} as Record<string, number>, failedByCmd: {} as Record<string, number> };
      for (const x of l) {
        if (x.t < a || x.t > b) continue;
        out.calls++;
        out.byCmd[x.cmd] = (out.byCmd[x.cmd] ?? 0) + 1;
        if (!x.ok) {
          out.failed++;
          out.failedByCmd[x.cmd] = (out.failedByCmd[x.cmd] ?? 0) + 1;
        }
      }
      return out;
    },
    [from, to === Number.POSITIVE_INFINITY ? Number.MAX_VALUE : to] as const,
  );
}

async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/** Transport activity between two page times, for meta: V2 IPC calls, WebSocket frames for both. */
async function transportMeta(s: Session, rig: PageRig, from: number, net0: NetCut): Promise<Record<string, unknown>> {
  const net = rig.net.cut(null);
  const out: Record<string, unknown> = {
    requests: net.requests - net0.requests,
    wsFramesReceived: net.wsFramesReceived - net0.wsFramesReceived,
    wsFramesSent: net.wsFramesSent - net0.wsFramesSent,
    wsOpened: net.wsOpened - net0.wsOpened,
  };
  if (s.app.id === 'v2') {
    const ipc = await ipcSummary(rig.page, from).catch(() => null);
    if (ipc) Object.assign(out, { ipcCalls: ipc.calls, ipcFailed: ipc.failed, ipcFailedByCmd: ipc.failedByCmd });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Navigation

let armSeq = 0;

interface NavResult {
  ms: number;
  kind: string;
  via: string;
  /** Harness-side time from issuing the click to the page seeing it (Playwright actionability). */
  clickLagMs: number;
}

let diagSeq = 0;

/** What the page showed when a wait failed: URL, active nav item, active pane text, a screenshot. */
async function diagnose(s: Session, page: Page, what: string): Promise<string> {
  try {
    const d = await page.evaluate(() => {
      const active = document.querySelector('button.tsh-nav-item[data-active="true"]')?.getAttribute('data-menu-item') ?? null;
      const pane = document.querySelector('.tsh-frame-pane[data-active="true"]') ?? document.querySelector('main') ?? document.body;
      return { url: location.pathname + location.search, active, text: (pane?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) };
    });
    const shot = path.join(s.diagDir, `ui-${s.app.id}-${s.ds}-${what}-${++diagSeq}.png`);
    await page.screenshot({ path: shot, timeout: 10_000 }).catch(() => {});
    return `page at ${d.url}, active nav ${d.active ?? 'none'}, content "${d.text}", screenshot ${path.basename(shot)}`;
  } catch (e) {
    return `no diagnostics (${errorMessage(e)})`;
  }
}

async function navigateTo(s: Session, page: Page, target: NavTarget): Promise<NavResult> {
  const { cond } = condFor(s.app.ui.ready[target], s.want[target]);
  const id = `nav-${target}-${++armSeq}`;
  const armed = await arm(page, id, cond);
  if (armed.error) throw new Error(`${target}: watcher could not evaluate its selectors: ${armed.error}`);
  if (armed.already) throw new Error(`${target}: ready marker ${armed.selector} was already present before the click (stale view), sample dropped`);
  try {
    const before = await page.evaluate(() => {
      const b = (window as unknown as WatcherWindow).__TBENCH__;
      b.lastClick = null;
      return performance.now();
    });
    await page.click(s.app.ui.navButton(target), { timeout: CLICK_TIMEOUT_MS }).catch(async (e) => {
      throw new ClickBlocked(`${target}: the nav click did not land within ${CLICK_TIMEOUT_MS} ms: ${shortError(e)}; ${await diagnose(s, page, `click-${target}`)}`);
    });
    const done = await waitDone(page, id, s.timeoutMs, `navigate to ${target}`).catch(async (e) => {
      throw new Error(`${errorMessage(e)}; ${await diagnose(s, page, `nav-${target}`)}`);
    });
    const click = (await page.evaluate(() => (window as unknown as WatcherWindow).__TBENCH__.lastClick)) as number | null;
    if (click === null) throw new Error(`${target}: the click never reached the page`);
    if (done.t < click) throw new Error(`${target}: ready ${Math.round(click - done.t)} ms before the click`);
    return { ms: done.t - click, kind: done.kind, via: done.via, clickLagMs: click - before };
  } finally {
    await cancel(page, id);
  }
}

/** A click that could not land: the page no longer takes input, so its later samples are skipped. */
class ClickBlocked extends Error {}

/**
 * One pass over NAV_ORDER. A failed view is recorded and the pass goes on; if anything failed,
 * the page is steered back to plans so the next pass (and V2's persisted lastPageNav) starts
 * from the same place. Once a click cannot land, the rest is recorded as skipped rather than
 * each waiting out its own timeout.
 */
async function navPass(s: Session, rig: PageRig, scenarioPrefix: string, metric: 'nav_first_ms' | 'nav_ms', extraMeta: Record<string, unknown> = {}): Promise<void> {
  let failed = false;
  for (const target of NAV_ORDER) {
    const scenario = `${scenarioPrefix}:${target}`;
    if (!rig.stuck && !isAlive(s.server.pid)) rig.stuck = `${s.app.id} server (pid ${s.server.pid}) exited`;
    if (rig.stuck) {
      s.fail(scenario, new Error(`skipped: the page stopped taking input earlier (${rig.stuck})`));
      continue;
    }
    try {
      const t0 = await pageNow(rig.page);
      const net0 = rig.net.cut(null);
      const r = await navigateTo(s, rig.page, target);
      const tm = await transportMeta(s, rig, t0, net0);
      s.col.add({ scenario, app: s.app.id, dataset: s.ds, metric, unit: 'ms', value: r.ms, sampleMeta: { kind: r.kind, via: r.via, clickLagMs: round1(r.clickLagMs), ...tm, ...extraMeta } });
    } catch (e) {
      failed = true;
      if (e instanceof ClickBlocked || e instanceof ServerGone) rig.stuck = `${scenario}: ${e.message.split(';')[0]}`;
      s.fail(scenario, e);
    }
  }
  if (failed && !rig.stuck) await backToPlans(s, rig);
}

/** Clicks plans and waits for its view; true when the page responded. */
async function backToPlans(s: Session, rig: PageRig): Promise<boolean> {
  try {
    await rig.page.click(s.app.ui.navButton('plans'), { timeout: CLICK_TIMEOUT_MS });
    const id = `recover-${++armSeq}`;
    const armed = await arm(rig.page, id, condFor(s.app.ui.ready.plans, 'any').cond);
    if (!armed.already) await waitDone(rig.page, id, 30_000, 'recover to plans');
    return true;
  } catch (e) {
    s.log.warn(`${s.app.id}/${s.ds}: could not return to plans: ${shortError(e)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Scenarios

async function blankBaseline(s: Session): Promise<void> {
  const before = await rendererPids(s);
  const ctx = await s.browser.newContext({ viewport: VIEWPORT });
  try {
    const page = await ctx.newPage();
    await page.goto('about:blank');
    await sleep(SETTLE_MS);
    const mem = await browserMemory(s, before);
    const meta = { rendererPid: mem.rendererPid, rendererMethod: mem.rendererMethod, byType: mem.byType };
    s.col.add({ scenario: 'about-blank-baseline', app: s.app.id, dataset: s.ds, metric: 'renderer_footprint_mib', unit: 'MiB', value: mem.rendererMiB, sampleMeta: meta });
    s.col.add({ scenario: 'about-blank-baseline', app: s.app.id, dataset: s.ds, metric: 'browser_tree_footprint_mib', unit: 'MiB', value: mem.totalMiB, sampleMeta: meta });
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function coldLoad(s: Session, i: number): Promise<void> {
  const rig = await newRig(s);
  const scenario = 'cold-load';
  try {
    await rig.page.goto(s.ui.url, { waitUntil: 'commit', timeout: s.timeoutMs });
    const shell = await waitDone(rig.page, 'shell', s.timeoutMs, 'shell visible');
    const content = await waitDone(rig.page, 'content', s.timeoutMs, 'content ready').catch(async (e) => {
      throw new Error(`${errorMessage(e)}; ${await diagnose(s, rig.page, `cold-${i}`)}`);
    });
    await rig.page.waitForLoadState('load', { timeout: s.timeoutMs });
    const nav = await rig.page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return n ? { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, type: n.type, name: n.name, origin: performance.timeOrigin } : null;
    });
    if (!nav) throw new Error('no navigation timing entry');
    const atContent = rig.net.cut(content.epoch);
    const ipc = s.app.id === 'v2' ? await ipcSummary(rig.page, 0, content.t) : null;
    await sleep(SETTLE_MS);
    const pm = await pageMetrics(rig, true);
    const settled = rig.net.cut(null);
    const ipcSettled = s.app.id === 'v2' ? await ipcSummary(rig.page) : null;
    const sampleMeta: Record<string, unknown> = {
      i,
      contentKind: content.kind,
      contentVia: content.via,
      navigationType: nav.type,
      wsOpenedAtContent: atContent.wsOpened,
      wsFramesReceivedAtContent: atContent.wsFramesReceived,
      wsBytesReceivedAtContent: atContent.wsBytesReceived,
      failedRequestsAtContent: atContent.failed,
      bytesAfterSettle: settled.bytes,
      requestsAfterSettle: settled.requests,
      pageErrors: rig.pageErrors.length,
    };
    if (ipc && ipcSettled) {
      Object.assign(sampleMeta, {
        ipcCallsAtContent: ipc.calls,
        ipcFailedAtContent: ipc.failed,
        ipcCallsAfterSettle: ipcSettled.calls,
        ipcFailedByCmd: ipcSettled.failedByCmd,
        ipcByCmd: ipcSettled.byCmd,
      });
    }
    const add = (metric: string, unit: Unit, value: number) => s.col.add({ scenario, app: s.app.id, dataset: s.ds, metric, unit, value, sampleMeta });
    add('dom_content_loaded_ms', 'ms', nav.dcl);
    add('load_ms', 'ms', nav.load);
    add('shell_visible_ms', 'ms', shell.t);
    add('content_ready_ms', 'ms', content.t);
    add('transfer_bytes', 'bytes', atContent.bytes);
    add('request_count', 'count', atContent.requests);
    add('js_heap_used_mib', 'MiB', pm.heapMiB);
    add('dom_nodes', 'count', pm.nodes);
  } catch (e) {
    s.fail(scenario, e);
    await rig.ctx.close().catch(() => {});
    return;
  }
  // First visits of each view, in the same fresh context: one more nav_first sample per cold load.
  try {
    await navPass(s, rig, 'navigate', 'nav_first_ms', { context: `cold-load ${i}` });
  } finally {
    await rig.ctx.close().catch(() => {});
  }
}

interface WarmPage {
  rig: PageRig;
  rendererPid: number | null;
  rendererMethod: string;
}

async function openWarmPage(s: Session): Promise<WarmPage> {
  const before = await rendererPids(s);
  const rig = await newRig(s);
  try {
    await rig.page.goto(s.ui.url, { waitUntil: 'commit', timeout: s.timeoutMs });
    await waitDone(rig.page, 'content', s.timeoutMs, 'warm page content ready');
    await rig.page.waitForLoadState('load', { timeout: s.timeoutMs });
    await sleep(SETTLE_MS);
  } catch (e) {
    await rig.ctx.close().catch(() => {});
    throw e;
  }
  const after = await rendererPids(s);
  const fresh = [...after.keys()].filter((p) => !before.has(p));
  return fresh.length === 1 ? { rig, rendererPid: fresh[0]!, rendererMethod: 'new renderer pid around page creation' } : { rig, rendererPid: null, rendererMethod: `ambiguous (${fresh.length} new renderer pids)` };
}

/** Reads the plans badge and checks it against the dataset; returns what the page shows. */
async function badgeNow(s: Session, page: Page): Promise<number> {
  return page.evaluate((css) => (window as unknown as WatcherWindow).__TBENCH__.badge(css), s.app.ui.navBadge('plans'));
}

/** Waits until the plans badge shows `expected` (used to restore state between scenarios). */
async function waitBadge(s: Session, page: Page, expected: number, timeoutMs: number, what: string): Promise<void> {
  const id = `badge-${++armSeq}`;
  const armed = await arm(page, id, { badge: s.app.ui.navBadge('plans'), expected });
  if (!armed.already) await waitDone(page, id, timeoutMs, what);
}

type PushKind = 'push-rest' | 'push-fs';

function pushTargets(m: DatasetManifest): string[] {
  const t = m.ids.pushTargets.filter((id) => id !== m.ids.updatePlanId);
  return t.length ? t : m.ids.pushTargets;
}

function planYaml(s: Session, id: string): string {
  const row = s.manifest.plans.find((p) => p[0] === id);
  if (!row) throw new Error(`plan ${id} is not in the ${s.ds} manifest`);
  return path.join(s.home, 'Plans', row[2], 'plan.yaml');
}

/** Rewrites the `state:` line through a temp file outside Plans/ and a rename (atomic, one event). */
function writePlanState(s: Session, id: string, value: string, seq: number): () => void {
  const file = planYaml(s, id);
  const text = fs.readFileSync(file, 'utf8');
  if (!/^state:[^\n]*$/m.test(text)) throw new Error(`${file} has no top-level state: line`);
  const tmpDir = path.join(s.home, '.tbench-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `plan-${id}-${seq}.yaml`);
  fs.writeFileSync(tmp, text.replace(/^state:[^\n]*$/m, `state: ${value}`));
  return () => fs.renameSync(tmp, file);
}

async function setState(s: Session, kind: PushKind, id: string, value: string, seq: number): Promise<{ startEpoch: number; meta: Record<string, unknown> }> {
  if (kind === 'push-rest') {
    const spec = s.app.api['plans.update']({ planId: id, jobId: '', i: value === 'Icebox' ? 0 : 1 });
    const body = spec.body as { value?: string } | undefined;
    if (body?.value !== value) throw new Error(`adapter plans.update sent ${JSON.stringify(spec.body)}, expected state ${value}`);
    const startEpoch = Date.now();
    const r = await request({ method: spec.method, url: joinUrl(s.server.baseUrl, spec.path), headers: s.server.authHeaders(), body: spec.body });
    if (r.status < 200 || r.status >= 300) throw new Error(`PUT ${spec.path} -> ${r.status || r.error}`);
    return { startEpoch, meta: { status: r.status, requestMs: round1(r.ms) } };
  }
  const commit = writePlanState(s, id, value, seq);
  const startEpoch = Date.now();
  commit();
  return { startEpoch, meta: { renameMs: round1(Date.now() - startEpoch) } };
}

async function pushScenario(s: Session, rig: PageRig, kind: PushKind, samples: number): Promise<void> {
  const page = rig.page;
  const targets = pushTargets(s.manifest);
  if (samples <= 0) return;
  if (rig.stuck) {
    s.fail(kind, new Error(`skipped ${samples} sample(s): the page stopped taking input earlier (${rig.stuck})`));
    return;
  }
  if (!targets.length) {
    s.note(`${kind} skipped for ${s.app.id}/${s.ds}: the dataset has no Draft plan besides the auto-opened one`);
    return;
  }
  const q = s.queue;
  let pendingRestore: string | null = null;
  for (let i = 0; i < samples; i++) {
    if (!isAlive(s.server.pid)) {
      s.fail(kind, new Error(`skipped ${samples - i} sample(s): ${s.app.id} server (pid ${s.server.pid}) exited`));
      return;
    }
    const target = targets[Math.floor(i / 2) % targets.length]!;
    const value = i % 2 === 0 ? 'Icebox' : 'Draft';
    const expected = i % 2 === 0 ? q - 1 : q;
    const id = `${kind}-${++armSeq}`;
    try {
      const shown = await badgeNow(s, page);
      if (shown !== (i % 2 === 0 ? q : q - 1)) throw new Error(`plans badge shows ${shown} before sample ${i}, expected ${i % 2 === 0 ? q : q - 1}`);
      const armed = await arm(page, id, { badge: s.app.ui.navBadge('plans'), expected });
      if (armed.already) throw new Error(`plans badge already shows ${expected}`);
      const { startEpoch, meta } = await setState(s, kind, target, value, i);
      pendingRestore = value === 'Icebox' ? target : null;
      const done = await waitDone(page, id, PUSH_TIMEOUT_MS, `${kind} ${value} of ${target}`);
      s.col.add({ scenario: kind, app: s.app.id, dataset: s.ds, metric: 'push_latency_ms', unit: 'ms', value: done.epoch - startEpoch, sampleMeta: { i, target, value, badge: `${expected + (value === 'Icebox' ? 1 : -1)}->${expected}`, via: done.via, ...meta } });
    } catch (e) {
      s.fail(kind, e);
      await cancel(page, id);
    }
    await sleep(PUSH_GAP_MS);
  }
  // An odd sample count (or a failure) can leave a target in Icebox; put it back unmeasured.
  if (pendingRestore) {
    try {
      await setState(s, kind, pendingRestore, 'Draft', samples);
      await waitBadge(s, page, q, PUSH_TIMEOUT_MS, `${kind} restore of ${pendingRestore}`);
      await sleep(PUSH_GAP_MS);
    } catch (e) {
      s.fail(kind, new Error(`restoring ${pendingRestore} to Draft failed: ${errorMessage(e)}`));
    }
  }
}

async function navUnderLoad(s: Session, rig: PageRig, cycles: number): Promise<void> {
  if (cycles <= 0) return;
  const agent = createAgent({ maxSockets: LOAD_CONCURRENCY + 2 });
  const auth = s.server.authHeaders();
  const list = s.app.api['plans.list']({ planId: '', jobId: '', i: 0 });
  const updateId = s.manifest.ids.updatePlanId;
  let loop: ReturnType<typeof startClosedLoop> | null = null;
  let periodic: ReturnType<typeof startPeriodic> | null = null;
  let listStats: LoadStats | null = null;
  let updateStats: LoadStats | null = null;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let serverDied = false;
  let stopping: Promise<[LoadStats, LoadStats | null]> | null = null;
  try {
    loop = startClosedLoop({ concurrency: LOAD_CONCURRENCY, agent, next: () => ({ method: list.method, url: joinUrl(s.server.baseUrl, list.path), headers: auth }) });
    if (updateId) {
      periodic = startPeriodic({
        everyMs: LOAD_UPDATE_EVERY_MS,
        agent,
        next: (i) => {
          const u = s.app.api['plans.update']({ planId: updateId, jobId: '', i });
          return { method: u.method, url: joinUrl(s.server.baseUrl, u.path), headers: auth, body: u.body };
        },
      });
    } else {
      s.note(`nav-under-load for ${s.app.id}/${s.ds}: no plan to update, so the background load is plans.list only`);
    }
    // A closed loop against a dead server spins on ECONNREFUSED as fast as the harness can go,
    // which would load the machine and bury the stats; stop it as soon as the server is gone.
    const l = loop;
    const pr = periodic;
    watchdog = setInterval(() => {
      if (isAlive(s.server.pid) || serverDied) return;
      serverDied = true;
      stopping = Promise.all([l.stop(), pr ? pr.stop() : Promise.resolve(null)]);
    }, 100);
    await sleep(LOAD_WARMUP_MS);
    for (let c = 0; c < cycles; c++) await navPass(s, rig, 'nav-under-load', 'nav_ms', { cycle: c });
  } finally {
    clearInterval(watchdog);
    // Assigned inside the watchdog callback, which control-flow analysis cannot see.
    const early = stopping as Promise<[LoadStats, LoadStats | null]> | null;
    if (early) [listStats, updateStats] = await early;
    else {
      listStats = loop ? await loop.stop() : null;
      updateStats = periodic ? await periodic.stop() : null;
    }
    agent.destroy();
  }
  // The navigation pass can notice a dead server before the watchdog's next tick does.
  if (!isAlive(s.server.pid)) serverDied = true;
  const loadMeta = {
    backgroundLoad: {
      plansList: listStats && { concurrency: LOAD_CONCURRENCY, completed: listStats.completed, okRps: round1(listStats.okRps), errors: listStats.errors, statuses: listStats.statuses },
      plansUpdate: updateStats && { everyMs: LOAD_UPDATE_EVERY_MS, planId: updateId, completed: updateStats.completed, errors: updateStats.errors, statuses: updateStats.statuses },
      serverExited: serverDied,
    },
  };
  for (const t of NAV_ORDER) s.col.meta(`nav-under-load:${t}`, s.app.id, s.ds, 'nav_ms', loadMeta);
  if (serverDied) {
    s.note(`${s.app.id}/${s.ds}: the server exited during nav-under-load; the background load was stopped when that was noticed`);
    return;
  }
  if (listStats && listStats.errors) s.note(`nav-under-load ${s.app.id}/${s.ds}: ${listStats.errors} background plans.list error(s) (${listStats.errorSamples.slice(0, 3).join('; ')})`);
  if (rig.stuck) {
    // With the load gone the app may reconnect; memory is read either way, but say which state it was in.
    const recovered = await backToPlans(s, rig);
    s.note(`${s.app.id}/${s.ds}: the page stopped taking input during nav-under-load (${rig.stuck}); ${recovered ? 'it responded again once the load stopped' : 'it was still unresponsive after the load stopped, so memory-after-flows describes that state'}`);
    if (recovered) rig.stuck = null;
  }
  // The periodic writes alternate Icebox/Draft, so the plan may be left in Icebox: restore it.
  if (updateId) {
    const u = s.app.api['plans.update']({ planId: updateId, jobId: '', i: 1 });
    const r = await request({ method: u.method, url: joinUrl(s.server.baseUrl, u.path), headers: auth, body: u.body });
    if (r.status < 200 || r.status >= 300) s.fail('nav-under-load', new Error(`restoring ${updateId} to Draft failed: ${r.status || r.error}`));
    else if (!rig.stuck) await waitBadge(s, rig.page, s.queue, PUSH_TIMEOUT_MS, 'badge after nav-under-load').catch((e) => s.fail('nav-under-load', e));
  }
}

// ---------------------------------------------------------------------------------------------
// Memory

async function processInfo(s: Session): Promise<Array<{ type: string; id: number; cpuTime: number }>> {
  const r = (await s.browserCdp.send('SystemInfo.getProcessInfo')) as { processInfo: Array<{ type: string; id: number; cpuTime: number }> };
  return r.processInfo;
}

async function rendererPids(s: Session): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (const p of await processInfo(s)) if (p.type === 'renderer') out.set(p.id, p.cpuTime);
  return out;
}

function roleOfType(t: string): string {
  if (t === 'browser' || t === 'renderer') return t;
  if (t === 'GPU') return 'gpu';
  if (/network/i.test(t)) return 'network';
  return 'utility';
}

/**
 * Footprint of the whole Chromium tree (browser process plus descendants, by process type) and of
 * one renderer: `preferPid` when known, else the only renderer created since `before`, else the
 * renderer with the most CPU time (the page that did the work).
 */
async function browserMemory(s: Session, before: Map<number, number>, preferPid: number | null = null): Promise<{ totalMiB: number; rendererMiB: number; rendererPid: number | null; rendererMethod: string; byType: Record<string, number>; sample: TreeSample }> {
  const info = await processInfo(s);
  const browserPid = info.find((p) => p.type === 'browser')?.id;
  if (!browserPid) throw new Error('CDP SystemInfo.getProcessInfo reported no browser process');
  const typeOf = new Map(info.map((p) => [p.id, p.type]));
  const sample = await s.procstat.sampleTree([{ role: 'browser', pid: browserPid }]);
  const byType: Record<string, number> = {};
  for (const p of sample.procs) {
    const role = roleOfType(typeOf.get(p.pid) ?? 'other');
    byType[role] = (byType[role] ?? 0) + toMiB(p.phys_footprint);
  }
  const renderers = info.filter((p) => p.type === 'renderer' && sample.procs.some((x) => x.pid === p.id));
  let pid: number | null = null;
  let method = '';
  if (preferPid && renderers.some((r) => r.id === preferPid)) {
    pid = preferPid;
    method = 'new renderer pid around page creation';
  } else {
    const fresh = renderers.filter((r) => !before.has(r.id));
    if (fresh.length === 1) {
      pid = fresh[0]!.id;
      method = 'only renderer created for this page';
    } else if (renderers.length) {
      const top = [...renderers].sort((a, b) => b.cpuTime - a.cpuTime)[0]!;
      pid = top.id;
      method = `renderer with the most CPU time (${renderers.length} renderers)`;
    }
  }
  const rp = pid === null ? undefined : sample.procs.find((p) => p.pid === pid);
  return { totalMiB: toMiB(sample.total.footprint), rendererMiB: rp ? toMiB(rp.phys_footprint) : NaN, rendererPid: pid, rendererMethod: method || 'none found', byType: roundMap(byType), sample };
}

async function memoryAfterFlows(s: Session, warm: WarmPage): Promise<void> {
  const scenario = 'memory-after-flows';
  await sleep(MEMORY_SETTLE_MS);
  const mem = await browserMemory(s, new Map(), warm.rendererPid);
  const meta = { rendererPid: mem.rendererPid, rendererMethod: warm.rendererPid ? warm.rendererMethod : mem.rendererMethod, byType: mem.byType, browserRssMiB: round1(toMiB(mem.sample.total.resident)) };
  s.col.add({ scenario, app: s.app.id, dataset: s.ds, metric: 'renderer_footprint_mib', unit: 'MiB', value: mem.rendererMiB, sampleMeta: meta });
  s.col.add({ scenario, app: s.app.id, dataset: s.ds, metric: 'browser_tree_footprint_mib', unit: 'MiB', value: mem.totalMiB, sampleMeta: meta });
  const serverRole = s.app.id === 'v1' ? 'server' : 'daemon';
  const roots = [{ role: serverRole, pid: s.server.pid }, ...(await s.ui.extraProcesses())];
  const tree = await s.procstat.sampleTree(roots);
  // A root that could not be read (it exited) would otherwise count as 0 MiB.
  const lostRoots = tree.missing.filter((m) => roots.some((r) => r.pid === m.pid));
  if (lostRoots.length) throw new Error(`server tree not measurable: ${lostRoots.map((m) => `${m.role} pid ${m.pid} (${m.err})`).join(', ')}`);
  const byRole: Record<string, number> = {};
  for (const [role, agg] of Object.entries(tree.byRole)) byRole[role] = round2(toMiB(agg.footprint));
  const roleLabels: Record<string, string> = { [serverRole]: s.app.id === 'v1' ? 'Ivy.Tendril --web' : 'tendril serve' };
  if (byRole['v2-shim'] !== undefined) roleLabels['v2-shim'] = V2_SHIM_ROLE_LABEL;
  s.col.add({
    scenario,
    app: s.app.id,
    dataset: s.ds,
    metric: 'server_tree_footprint_mib',
    unit: 'MiB',
    value: toMiB(tree.total.footprint),
    sampleMeta: { rssMiB: round1(toMiB(tree.total.resident)), processes: tree.procs.length, missing: tree.missing },
  });
  s.col.meta(scenario, s.app.id, s.ds, 'server_tree_footprint_mib', { byRole, roleLabels });
  const pm = await pageMetrics(warm.rig, false);
  s.col.add({ scenario, app: s.app.id, dataset: s.ds, metric: 'js_heap_used_mib', unit: 'MiB', value: pm.heapMiB, sampleMeta: { gc: false } });
  s.col.add({ scenario, app: s.app.id, dataset: s.ds, metric: 'dom_nodes', unit: 'count', value: pm.nodes, sampleMeta: { listeners: pm.listeners } });
}

// ---------------------------------------------------------------------------------------------
// Driver

async function closeBrowser(browser: Browser, pid: number | null, log: Logger): Promise<void> {
  const closed = await Promise.race([browser.close().then(() => true), sleep(15_000).then(() => false)]).catch(() => false);
  if (!closed && pid && isAlive(pid)) {
    log.warn(`Chromium ${pid} did not close within 15 s; killing it`);
    await killTree(pid, { signal: 'SIGKILL', graceMs: 1000 }).catch(() => {});
  }
}

interface SessionDeps {
  ctx: SuiteContext;
  col: Collector;
  result: SuiteResult;
}

async function runSession(d: SessionDeps, app: AppAdapter, ds: DatasetName, manifest: DatasetManifest): Promise<void> {
  const { ctx, result } = d;
  const log = ctx.log.child(`${app.id}/${ds}`);
  const k = ctx.knobs.ui;
  const fail = (scenario: string, e: unknown) => {
    const error = shortError(e);
    log.warn(`${scenario}: ${error}`);
    result.failures.push({ app: app.id, dataset: ds, scenario, error });
  };
  const note = (s: string) => {
    if (!result.notes.includes(s)) result.notes.push(s);
  };

  const restored = await restoreHome({ paths: ctx.paths, dataset: ds, app: app.id, runDir: ctx.runDir, suffix: 'ui', log });
  const server = await app.startServer({ home: restored.home, runDir: ctx.runDir, mode: 'web' });
  let ui: UiHandle | null = null;
  let browser: Browser | null = null;
  let browserPid: number | null = null;
  let unregister: (() => void) | null = null;
  try {
    // The shim follows the daemon (its bridges read .master once), so it always starts after it.
    ui = await app.startUi(server, ctx.runDir);
    browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    const b = browser;
    unregister = registerCleanup(() => closeBrowser(b, browserPid, log));
    const browserCdp = await browser.newBrowserCDPSession();
    const s: Session = {
      app,
      ds,
      manifest,
      home: restored.home,
      server,
      ui,
      browser,
      browserCdp,
      want: wantFor(manifest),
      queue: manifest.counts.plansQueue,
      col: d.col,
      fail,
      note,
      log,
      procstat: ctx.procstat,
      timeoutMs: TIMEOUTS.uiWaitMs,
      diagDir: path.join(ctx.runDir, 'logs'),
    };
    browserPid = (await processInfo(s)).find((p) => p.type === 'browser')?.id ?? null;
    log.info(`server ready in ${Math.round(server.timings.httpReadyMs)} ms; ui ${ui.url}; Chromium ${browser.version()} (pid ${browserPid})`);

    const alive = (scenario: string) => {
      if (isAlive(server.pid)) return true;
      fail(scenario, new Error(`${app.id} server (pid ${server.pid}) is no longer running; skipping the rest of ${ds}`));
      return false;
    };

    try {
      await blankBaseline(s);
    } catch (e) {
      fail('about-blank-baseline', e);
    }

    log.info(`cold-load x${k.coldLoads}`);
    for (let i = 0; i < k.coldLoads && alive('cold-load'); i++) await coldLoad(s, i);

    if (!alive('navigate')) return;
    let warm: WarmPage;
    try {
      warm = await openWarmPage(s);
    } catch (e) {
      fail('navigate', e);
      return;
    }
    try {
      const shown = await badgeNow(s, warm.rig.page).catch(() => NaN);
      if (shown !== s.queue) {
        note(`${app.id}/${ds}: plans badge shows ${shown}, dataset manifest says ${s.queue}; push expectations follow the page`);
        if (Number.isFinite(shown)) s.queue = shown;
      }
      log.info(`navigate: 1 first-visit pass + ${k.navCycles} revisit cycle(s)`);
      await navPass(s, warm.rig, 'navigate', 'nav_first_ms', { context: 'warm page' });
      for (let c = 0; c < k.navCycles && alive('navigate'); c++) await navPass(s, warm.rig, 'navigate', 'nav_ms', { cycle: c });
      log.info(`push-rest x${k.pushSamples}, push-fs x${k.fsPushSamples}`);
      if (alive('push-rest')) await pushScenario(s, warm.rig, 'push-rest', k.pushSamples);
      if (alive('push-fs')) await pushScenario(s, warm.rig, 'push-fs', k.fsPushSamples);
      log.info(`nav-under-load x${k.navUnderLoadCycles}`);
      if (alive('nav-under-load')) await navUnderLoad(s, warm.rig, k.navUnderLoadCycles);
      if (alive('memory-after-flows')) {
        try {
          await memoryAfterFlows(s, warm);
        } catch (e) {
          fail('memory-after-flows', e);
        }
      }
      const errs = warm.rig.pageErrors;
      if (errs.length) note(`${app.id}/${ds}: ${errs.length} page error(s) on the warm page, e.g. ${errs.slice(0, 2).join(' | ')}`);
      if (app.id === 'v2') {
        const ipc = await ipcSummary(warm.rig.page).catch(() => null);
        if (ipc) {
          for (const m of result.metrics.filter((x) => x.app === 'v2' && x.dataset === ds && x.scenario === 'memory-after-flows' && x.metric === 'renderer_footprint_mib')) {
            m.meta = { ...m.meta, warmPageIpc: ipc };
          }
          const f1 = ipc.failedByCmd['cmd_list_all_recommendations'] ?? 0;
          if (f1) note(`V2 known bug F1 reproduced: cmd_list_all_recommendations is not registered (${f1} failed call(s) on the ${ds} warm page); the app falls back to one cmd_list_recommendations per plan (${ipc.byCmd['cmd_list_recommendations'] ?? 0} calls). Measured as is.`);
        }
      }
    } finally {
      await warm.rig.ctx.close().catch(() => {});
    }
  } finally {
    if (browser) await closeBrowser(browser, browserPid, log);
    unregister?.();
    if (ui) await ui.stop().catch((e) => log.warn(`stopping the UI host failed: ${errorMessage(e)}`));
    await server.stop().catch((e) => log.warn(`stopping the server failed: ${errorMessage(e)}`));
    fs.rmSync(restored.home, { recursive: true, force: true });
  }
}

export async function run(ctx: SuiteContext): Promise<SuiteResult> {
  const result = newSuiteResult(SUITE, ctx.runId, ctx.profile);
  const col = new Collector(result);
  const k = ctx.knobs.ui;
  result.notes.push(
    `Chromium headless (Playwright chromium.launch headless:true, ${LAUNCH_ARGS.join(' ')}), viewport ${VIEWPORT.width}x${VIEWPORT.height}, one fresh browser per dataset x app; ${k.coldLoads} cold loads, ${k.navCycles} revisit cycles, ${k.pushSamples} REST pushes, ${k.fsPushSamples} file pushes, ${k.navUnderLoadCycles} cycles under load.`,
    `Times are measured inside the page: cold-load milestones from navigation start (performance.timeOrigin); navigation from the click event to the view's ready marker (MutationObserver + requestAnimationFrame watcher installed before the app's scripts); push from the harness's Date.now() at the write to the page's timeOrigin + now() when the plans badge shows the new count.`,
    `View order in navigation loops is ${NAV_ORDER.join(', ')} (V1 uses the same ready marker for plans and review, so they are never visited back to back). nav_first_ms samples are first visits in fresh contexts: one per cold load plus one on the warm page.`,
    `transfer_bytes / request_count cover HTTP responses finished by content ready (CDP encodedDataLength, headers included); WebSocket traffic is in meta (V1's SignalR, V2's shim IPC socket).`,
    `V2 runs through the IPC shim; its memory is reported under role v2-shim: ${V2_SHIM_ROLE_LABEL}. The real tendril-app is measured in the desktop suite.`,
    `push-fs rewrites plan.yaml's state line via a temp file outside Plans/ and a rename; it includes each app's file-watcher debounce.`,
  );
  if (ctx.apps.some((a) => a.id === 'v2')) {
    result.notes.push(
      `V2 views are React.lazy inside one Suspense boundary, and React 19 holds revealed Suspense content until 300 ms after its fallback was shown (FALLBACK_THROTTLE_MS, present in the built vendor-react chunk). V2 first visits and cold loads therefore sit near 300 ms after the fallback, or well below it when the chunk arrives before the fallback commits; this is what a user sees, and it makes those V2 samples bimodal across runs.`,
    );
  }
  for (const [di, ds] of ctx.datasets.entries()) {
    const manifest = loadManifest(ctx.paths, ds);
    const order = di % 2 === 0 ? ctx.apps : [...ctx.apps].reverse();
    for (const app of order) {
      if (!manifest) {
        result.failures.push({ app: app.id, dataset: ds, scenario: '(session)', error: `dataset ${ds} is not built; run \`datasets\`` });
        continue;
      }
      ctx.log.info(`ui: ${app.id} on ${ds}`);
      try {
        await runSession({ ctx, col, result }, app, ds, manifest);
      } catch (e) {
        ctx.log.warn(`ui ${app.id}/${ds} session failed: ${errorMessage(e)}`);
        result.failures.push({ app: app.id, dataset: ds, scenario: '(session)', error: errorMessage(e) });
      }
    }
  }
  // The baseline shares metric names with memory-after-flows (the report labels it by scenario), and
  // the report's headline takes the first metric of a name it finds, so baselines go last.
  const isBaseline = (m: Metric) => m.scenario === 'about-blank-baseline';
  result.metrics.sort((a, b) => Number(isBaseline(a)) - Number(isBaseline(b)));
  if (ctx.datasets.length > 1) result.notes.push(`App order alternates per dataset (ABBA over datasets: ${ctx.datasets.map((d, i) => `${d} ${(i % 2 === 0 ? ctx.apps : [...ctx.apps].reverse()).map((a) => a.id).join(',')}`).join('; ')}); within a dataset each app's samples are taken back to back on its own server.`);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Small helpers

/**
 * One line per failure: Playwright appends its whole call log to timeouts, of which only an
 * overlay intercepting the click is worth keeping.
 */
function shortError(e: unknown): string {
  const msg = errorMessage(e);
  const lines = msg.split('\n');
  let out = lines[0]!.trim();
  const blocker = lines.find((l) => l.includes('intercepts pointer events'));
  if (blocker && !out.includes('intercepts pointer events')) out += ` (${blocker.replace(/\u001b\[[0-9;]*m/g, '').trim().slice(0, 200)})`;
  return out;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function roundMap(m: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round2(v)]));
}
